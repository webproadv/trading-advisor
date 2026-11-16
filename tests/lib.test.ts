import { describe, expect, it } from "vitest";
import { sessionOf, dueScanSlots, isPremarketSlot, etParts } from "@/lib/time";
import { sma, rsi, analyze, favorableBuy, favorableSell } from "@/lib/indicators";
import { sizeBuy, exitDecision, upsidePct, validateSettings } from "@/lib/risk";
import { signSession, verifySession, safeEqual } from "@/lib/session";
import { parseCandles, parseRates, parsePortfolio, parseOpen } from "@/lib/etoro";
import { extractJson, normalizeIdeas } from "@/lib/claude";
import { DEFAULT_SETTINGS } from "@/lib/types";

const utc = (s: string) => new Date(s);

describe("sessioni di mercato (ora di New York)", () => {
  it("estate (EDT): 09:30 ET = 13:30Z apre la sessione regolare", () => {
    expect(sessionOf(utc("2026-07-14T13:29:00Z")).session).toBe("premarket");
    expect(sessionOf(utc("2026-07-14T13:30:00Z")).session).toBe("regular");
    expect(sessionOf(utc("2026-07-14T20:00:00Z")).session).toBe("afterhours");
  });
  it("inverno (EST): 09:30 ET = 14:30Z", () => {
    expect(sessionOf(utc("2026-12-02T14:29:00Z")).session).toBe("premarket");
    expect(sessionOf(utc("2026-12-02T14:30:00Z")).session).toBe("regular");
  });
  it("weekend e festivita' sono chiusi", () => {
    expect(sessionOf(utc("2026-11-14T15:00:00Z")).session).toBe("closed"); // sabato
    expect(sessionOf(utc("2026-11-26T15:00:00Z")).session).toBe("closed"); // Thanksgiving
  });
  it("chiusura anticipata alle 13:00 ET il giorno dopo Thanksgiving", () => {
    expect(sessionOf(utc("2026-11-27T17:59:00Z")).session).toBe("regular");
    expect(sessionOf(utc("2026-11-27T18:00:00Z")).session).toBe("afterhours");
  });
  it("segnala calendario scaduto dopo il 2027", () => {
    expect(sessionOf(utc("2028-03-01T15:00:00Z")).calendarStale).toBe(true);
    expect(sessionOf(utc("2026-03-02T15:00:00Z")).calendarStale).toBe(false);
  });
  it("slot di scansione dovuti e premarket", () => {
    const now = utc("2026-07-14T12:05:00Z"); // 08:05 ET
    expect(etParts(now).minutes).toBe(8 * 60 + 5);
    expect(dueScanSlots(["08:00", "10:00"], now)).toEqual(["2026-07-14@08:00"]);
    expect(dueScanSlots(["08:00"], utc("2026-07-18T12:05:00Z"))).toEqual([]);
    expect(isPremarketSlot("2026-07-14@08:00")).toBe(true);
    expect(isPremarketSlot("2026-07-14@10:00")).toBe(false);
  });
});

describe("indicatori", () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
  it("sma e rsi", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2], 5)).toBeNull();
    expect(rsi(up)).toBeGreaterThan(95);
    expect(rsi(up.slice().reverse())).toBeLessThan(5);
  });
  it("analyze: trend rialzista e candele insufficienti", () => {
    const candles = up.map((c, i) => ({ t: `d${i}`, o: c, h: c, l: c, c }));
    expect(analyze(candles)?.trend).toBe("up");
    expect(analyze(candles.slice(0, 10))).toBeNull();
  });
  it("regole favorevole acquisto/vendita", () => {
    expect(favorableBuy({ trend: "up", rsi14: 45, sma20: 100, sma50: 95 }, 100)).toBe(true);
    expect(favorableBuy({ trend: "up", rsi14: 70, sma20: 100, sma50: 95 }, 100)).toBe(false);
    expect(favorableSell({ rsi14: 80, sma20: 100, sma50: 95 }, 110)).toBe(true);
    expect(favorableSell({ rsi14: 50, sma20: 100, sma50: 95 }, 110)).toBe(false);
  });
});

describe("rischio", () => {
  const s = { ...DEFAULT_SETTINGS, max_daily_invest_usd: 300, max_position_usd: 150, max_open_positions: 2 };
  it("sizeBuy rispetta posizione, tetto giornaliero e giacenza", () => {
    expect(sizeBuy({ settings: s, price: 50, cash: 10000, investedToday: 0, openCount: 0 })).toMatchObject({ amount: 150, units: 3, reasons: [] });
    expect(sizeBuy({ settings: s, price: 50, cash: 10000, investedToday: 250, openCount: 0 }).amount).toBe(50);
    expect(sizeBuy({ settings: s, price: 50, cash: 10000, investedToday: 295, openCount: 0 }).reasons.join()).toMatch(/giornaliero/);
    expect(sizeBuy({ settings: s, price: 50, cash: 5, investedToday: 0, openCount: 0 }).reasons.join()).toMatch(/giacenza/);
    expect(sizeBuy({ settings: s, price: 50, cash: 10000, investedToday: 0, openCount: 2 }).reasons.join()).toMatch(/posizioni/);
  });
  it("exitDecision", () => {
    const t = { stop_loss_pct: 5, take_profit_pct: 10 };
    expect(exitDecision(100, 94.9, t)).toBe("stop_loss");
    expect(exitDecision(100, 110, t)).toBe("take_profit");
    expect(exitDecision(100, 103, t)).toBeNull();
    expect(exitDecision(0, 103, t)).toBeNull();
  });
  it("upsidePct e validateSettings", () => {
    expect(upsidePct(110, 100)).toBeCloseTo(10);
    expect(upsidePct(null, 100)).toBeNull();
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
    expect(validateSettings({ ...DEFAULT_SETTINGS, stop_loss_pct: 0 }).length).toBeGreaterThan(0);
    expect(validateSettings({ ...DEFAULT_SETTINGS, max_daily_invest_usd: -1 }).length).toBeGreaterThan(0);
  });
});

describe("sessione firmata", () => {
  const secret = "x".repeat(40);
  it("firma, verifica, scadenza e manomissione", async () => {
    const t = await signSession(secret, 1_000_000, 60);
    expect(await verifySession(t, secret, 1_000_000 + 30_000)).toBe(true);
    expect(await verifySession(t, secret, 1_000_000 + 120_000)).toBe(false);
    expect(await verifySession(t, "y".repeat(40), 1_000_000)).toBe(false);
    expect(await verifySession(t.replace(/.$/, "A"), secret, 1_000_000)).toBe(false);
    expect(await verifySession(undefined, secret)).toBe(false);
    expect(await verifySession(t, "corta")).toBe(false);
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
  });
});

describe("parser eToro (tolleranti)", () => {
  it("candele, quotazioni, portafoglio, apertura", () => {
    const c = parseCandles({ candles: [{ instrumentId: 1, candles: [{ fromDate: "2026-01-01", open: 1, high: 2, low: 0.5, close: 1.5 }] }] });
    expect(c[0].c).toBe(1.5);
    const r = parseRates({ rates: [{ instrumentID: 1001, bid: 10, ask: 10.1 }] });
    expect(r[1001]).toEqual({ bid: 10, ask: 10.1 });
    const p = parsePortfolio({ clientPortfolio: { credit: 5000, positions: [{ positionID: 7, instrumentID: 1001, openRate: 10, amount: 100, units: 10, isBuy: true }] } });
    expect(p.cash).toBe(5000);
    expect(p.positions[0]).toMatchObject({ positionId: "7", instrumentId: 1001, isBuy: true });
    expect(parseOpen({ orderForOpen: { orderID: 55 } }).orderId).toBeDefined();
  });
  it("formato sconosciuto: nessun crash", () => {
    expect(parsePortfolio({}).positions).toEqual([]);
    expect(parseCandles(null)).toEqual([]);
  });
});

describe("risposta di Claude", () => {
  it("extractJson da testo con recinto e rumore", () => {
    expect(extractJson('ecco:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson("niente json")).toBeNull();
  });
  it("normalizeIdeas scarta fonti non cercate e lati non validi", () => {
    const r = normalizeIdeas({ summary: "ok", ideas: [
      { symbol: "aapl", side: "buy", confidence: 80, target_price: 200, stop_price: 180, rationale: "x", source_urls: ["https://ok.com/a", "https://evil.com"] },
      { symbol: "X", side: "hold", confidence: 80, rationale: "y" },
    ] }, new Set(["https://ok.com/a"]));
    expect(r.ideas).toHaveLength(1);
    expect(r.ideas[0].symbol).toBe("AAPL");
  });
});

describe("telegram: piu' chat", () => {
  it("invia a tutte le chat elencate e ignora gli spazi", async () => {
    const { Telegram, parseChatIds } = await import("@/lib/telegram");
    expect(parseChatIds(" 1, -100 ,,2 ")).toEqual(["1", "-100", "2"]);
    const sent: string[] = [];
    const f = (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body)).chat_id); return new Response(JSON.stringify({ ok: true })); }) as unknown as typeof fetch;
    await new Telegram("tok", "11,22", f).send("ciao");
    expect(sent).toEqual(["11", "22"]);
  });
});

describe("telegram: secondo bot", () => {
  it("invia con entrambi i bot e risponde ai pulsanti col bot di origine", async () => {
    const { Telegram } = await import("@/lib/telegram");
    const calls: string[] = [];
    const f = (async (u: string, init: RequestInit) => { calls.push(`${u.split("/bot")[1]}|${JSON.parse(String(init.body)).chat_id ?? ""}`); return new Response(JSON.stringify({ ok: true })); }) as unknown as typeof fetch;
    const tg = new Telegram("T1", "11", f, [{ token: "T2", chatIds: ["22", "33"] }]);
    await tg.send("x");
    expect(calls.sort()).toEqual(["T1/sendMessage|11", "T2/sendMessage|22", "T2/sendMessage|33"]);
    calls.length = 0;
    await tg.forBot(1).answer("cb", "ok");
    expect(calls).toEqual(["T2/answerCallbackQuery|"]);
    calls.length = 0;
    await tg.setWebhooks("https://a.app/api/telegram/webhook", "s");
    expect(calls.length).toBe(2);
  });
});
