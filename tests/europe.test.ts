import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memoryStore";
import { usdPer } from "@/lib/fx";
import { autopilotSweep, executeSuggestion, snapshot, type Deps } from "@/lib/engine";
import { dueScanSlotsEu, euSessionOf, isPremarketSlot, isRegularFor, marketOf, romeDay, scopeOfSlot, sessionFor } from "@/lib/time";
import { fmtPrice } from "@/lib/format";
import { validateSettings } from "@/lib/risk";
import { DEFAULT_SETTINGS, type Portfolio, type Position, type Rate } from "@/lib/types";

const utc = (s: string) => new Date(s);

describe("mercati europei", () => {
  it("riconosce il mercato dal suffisso", () => {
    expect(marketOf("ENI.MI")).toEqual({ group: "EU", currency: "EUR" });
    expect(marketOf("sap.de").group).toBe("EU");
    expect(marketOf("NESN.SW").currency).toBe("CHF");
    expect(marketOf("AAPL")).toEqual({ group: "US", currency: "USD" });
    expect(marketOf("BRK.B").group).toBe("US");
  });
  it("orari 09:00-17:30 ora italiana, con ora legale e solare", () => {
    // estate (CEST = UTC+2): 09:00 = 07:00Z
    expect(euSessionOf(utc("2026-07-14T06:59:00Z")).session).toBe("premarket");
    expect(euSessionOf(utc("2026-07-14T07:00:00Z")).session).toBe("regular");
    expect(euSessionOf(utc("2026-07-14T15:29:00Z")).session).toBe("regular");
    expect(euSessionOf(utc("2026-07-14T15:30:00Z")).session).toBe("closed");
    // inverno (CET = UTC+1): 09:00 = 08:00Z
    expect(euSessionOf(utc("2026-12-02T07:59:00Z")).session).toBe("premarket");
    expect(euSessionOf(utc("2026-12-02T08:00:00Z")).session).toBe("regular");
    expect(euSessionOf(utc("2026-12-02T07:00:00Z")).session).toBe("premarket"); // 08:00 CET = pre-apertura
    expect(euSessionOf(utc("2026-12-02T06:59:00Z")).session).toBe("closed");
  });
  it("festivita' e weekend", () => {
    expect(euSessionOf(utc("2026-12-25T10:00:00Z")).session).toBe("closed");
    expect(euSessionOf(utc("2026-04-06T10:00:00Z")).session).toBe("closed"); // Pasquetta
    expect(euSessionOf(utc("2026-11-14T10:00:00Z")).session).toBe("closed"); // sabato
    expect(euSessionOf(utc("2026-05-25T10:00:00Z")).session).toBe("regular");  // Lunedi' di Pentecoste: aperte Milano ecc.
    expect(sessionFor("NESN.SW", utc("2026-05-25T10:00:00Z")).session).toBe("closed"); // Zurigo chiusa
  });
  it("Europa e USA hanno sessioni indipendenti", () => {
    const t = utc("2026-07-14T09:00:00Z"); // 11:00 Roma, 05:00 New York
    expect(isRegularFor("ENI.MI", t)).toBe(true);
    expect(isRegularFor("AAPL", t)).toBe(false);
    const t2 = utc("2026-07-14T17:00:00Z"); // 19:00 Roma, 13:00 New York
    expect(isRegularFor("ENI.MI", t2)).toBe(false);
    expect(isRegularFor("AAPL", t2)).toBe(true);
  });
  it("slot di scansione europei", () => {
    const t = utc("2026-07-14T06:35:00Z"); // 08:35 Roma
    expect(dueScanSlotsEu(["08:30", "11:00"], t)).toEqual(["2026-07-14@08:30@EU"]);
    expect(dueScanSlotsEu(["08:30"], utc("2026-07-18T06:35:00Z"))).toEqual([]);
    expect(scopeOfSlot("2026-07-14@08:30@EU")).toBe("EU");
    expect(scopeOfSlot("2026-07-14@08:00")).toBe("US");
    expect(isPremarketSlot("2026-07-14@08:30@EU")).toBe(true);
    expect(isPremarketSlot("2026-07-14@11:00@EU")).toBe(false);
  });
  it("giorno di Roma e formato prezzo", () => {
    expect(romeDay(utc("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
    expect(fmtPrice("ENI.MI", 14.5)).toMatch(/€/);
    expect(fmtPrice("AAPL", 14.5)).toBe("$14,50");
    expect(fmtPrice("AAPL", -8.64)).toBe("-$8,64");
  });
  it("impostazioni: orari europei validati", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, scan_times_eu: ["25:00"] }).length).toBeGreaterThan(0);
  });
});

describe("cambio valuta", () => {
  it("USD = 1, usa la cache, ripiega sul valore vecchio, fallisce senza dati", async () => {
    const store = new MemoryStore();
    const now = utc("2026-07-14T10:00:00Z");
    let calls = 0;
    const ok = (async () => { calls++; return new Response(JSON.stringify({ rates: { USD: 1.1 } })); }) as unknown as typeof fetch;
    const ko = (async () => { calls++; return new Response("x", { status: 500 }); }) as unknown as typeof fetch;
    expect(await usdPer("USD", store, now, ok)).toBe(1);
    expect(await usdPer("EUR", store, now, ok)).toBe(1.1);
    expect(await usdPer("EUR", store, utc("2026-07-14T12:00:00Z"), ok)).toBe(1.1);
    expect(calls).toBe(1);
    expect(await usdPer("EUR", store, utc("2026-07-15T10:00:00Z"), ko)).toBe(1.1); // cache scaduta ma fetch fallita
    await expect(usdPer("CHF", store, now, ko)).rejects.toThrow(/non disponibile/);
    const bad = (async () => new Response(JSON.stringify({ rates: { USD: 99 } }))) as unknown as typeof fetch;
    await expect(usdPer("SEK", store, now, bad)).rejects.toThrow();
  });
});

class FakeEtoro {
  cash = 5000; positions: Position[] = []; rateMap: Record<number, Rate> = {}; opened: Array<[number, number]> = []; closed: Array<[string, number | null]> = [];
  async rates(ids: number[]) { const o: Record<number, Rate> = {}; for (const i of ids) if (this.rateMap[i]) o[i] = this.rateMap[i]; return o; }
  async candles() { return []; }
  async search() { return null; }
  async portfolio(): Promise<Portfolio> { return { cash: this.cash, positions: [...this.positions] }; }
  async openBuy(id: number, amount: number) {
    this.opened.push([id, amount]); this.cash -= amount;
    const price = this.rateMap[id].ask;
    this.positions.push({ positionId: `p${this.positions.length + 1}`, instrumentId: id, openRate: price, amount, units: amount / price, isBuy: true });
    return { positionId: `p${this.positions.length}`, price };
  }
  async close(positionId: string | number, _id: number, units: number | null = null) {
    this.closed.push([String(positionId), units]); this.positions = this.positions.filter((p) => p.positionId !== String(positionId));
  }
}
const tg = { enabled: false, send: async () => {}, answer: async () => {}, edit: async () => {} };
const noClaude = { enabled: false, analyze: async () => ({ summary: "", ideas: [], sources: [] }) };

describe("operazioni su titoli europei", () => {
  const MORNING = utc("2026-07-14T09:00:00Z"); // 11:00 Roma: Europa aperta, USA chiusa
  let store: MemoryStore, eto: FakeEtoro, d: Deps, now: Date;
  const sugg = () => store.createSuggestion({
    symbol: "ENI.MI", instrument_id: 77, side: "buy", units: 10, amount_usd: 150, price_ref: 14, target_price: 17, stop_price: 13, confidence: 85,
    rationale: "t", sources: [], origin: "scan", expires_at: new Date(MORNING.getTime() + 5 * 86400_000).toISOString(),
  });
  beforeEach(() => {
    store = new MemoryStore(); eto = new FakeEtoro(); now = MORNING;
    eto.rateMap = { 77: { bid: 13.99, ask: 14 } };
    d = { store, etoro: eto as never, tg, claude: noClaude, now: () => now, fx: async (c) => (c === "EUR" ? 1.1 : 1) };
  });
  it("converte i prezzi in EUR in USD: 10 azioni a 14 EUR = 154 USD", async () => {
    const s = await sugg();
    const r = await executeSuggestion(d, s.id, { by: "manual", units: 10 });
    expect(r.ok).toBe(true);
    expect(eto.opened).toEqual([[77, 154]]);
    expect(store.trades[0].units).toBeCloseTo(10, 3);
  });
  it("mercato europeo chiuso: va in coda anche se gli USA sono aperti", async () => {
    const s = await sugg(); now = utc("2026-07-14T17:00:00Z"); // USA aperti, Europa chiusa
    const r = await executeSuggestion(d, s.id, { by: "manual", units: 10 });
    expect(r.status).toBe("approved");
    expect(eto.opened).toHaveLength(0);
  });
  it("autopilot compra titolo europeo con Europa aperta (USA chiusa)", async () => {
    store.settings = { ...store.settings, mode: "autopilot" };
    await sugg();
    const out = await autopilotSweep(d);
    expect(out).toHaveLength(1);
    expect(eto.opened[0][0]).toBe(77);
    expect(eto.opened[0][1]).toBeLessThanOrEqual(150);
  });
  it("il valore della posizione e' in USD indipendente dalla valuta", async () => {
    eto.positions = [{ positionId: "p1", instrumentId: 77, openRate: 14, amount: 154, units: 11, isBuy: true }];
    eto.rateMap[77] = { bid: 15.4, ask: 15.5 }; // +10%
    const snap = await snapshot(d);
    expect(snap.positions[0].value).toBeCloseTo(169.4, 1);
    expect(snap.pnl).toBeCloseTo(15.4, 1);
  });
  it("senza cambio configurato un titolo in EUR non viene comprato", async () => {
    d = { ...d, fx: undefined };
    const s = await sugg();
    const r = await executeSuggestion(d, s.id, { by: "manual", units: 10 });
    expect(r.ok).toBe(false);
    expect(eto.opened).toHaveLength(0);
  });
});
