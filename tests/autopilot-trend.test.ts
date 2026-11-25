import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memoryStore";
import { autopilotSweep, catalystScopes, guardPositions, runCatalystScan, runRotation, type Deps } from "@/lib/engine";
import { supertrendOf, trendState } from "@/lib/indicators";
import type { Position, Portfolio, Rate } from "@/lib/types";
import type { Tech } from "@/lib/indicators";
import { trendCandles } from "./fixtures";

const THU = new Date("2026-07-16T19:20:00Z"); // 15:20 ET giovedi': domani si negozia
const FRI = new Date("2026-07-17T19:20:00Z"); // 15:20 ET venerdi': nel weekend no
const FRI_OPEN = new Date("2026-07-17T14:00:00Z"); // 10:00 ET venerdi', sessione dopo l'acquisto
let mode: "up" | "down" = "up";

class FakeEtoro {
  cash = 5000; positions: Position[] = []; rateMap: Record<number, Rate> = {}; opened: number[] = []; closed: string[] = [];
  async rates(ids: number[]) { const o: Record<number, Rate> = {}; for (const i of ids) if (this.rateMap[i]) o[i] = this.rateMap[i]; return o; }
  async candles(id: number) { return trendCandles(mode === "up" ? 1 : -1, this.rateMap[id]?.bid ?? 100); }
  async search() { return null; }
  async portfolio(): Promise<Portfolio> { return { cash: this.cash, positions: [...this.positions] }; }
  async openBuy(id: number, amount: number) {
    this.opened.push(id); this.cash -= amount;
    const price = this.rateMap[id].ask;
    const positionId = `p${this.opened.length}`;
    this.positions.push({ positionId, instrumentId: id, openRate: price, amount, units: amount / price, isBuy: true });
    return { positionId, price };
  }
  async close(positionId: string | number) { this.closed.push(String(positionId)); this.positions = this.positions.filter((p) => p.positionId !== String(positionId)); }
}
class FakeTg { enabled = true; sent: string[] = []; async send(h: string) { this.sent.push(h); } async answer() {} async edit() {} }

let store: MemoryStore, eto: FakeEtoro, now: Date, d: Deps;
const claudeWith = (ideas: unknown[]) => ({ enabled: true, analyze: async () => ({ summary: "", ideas: [], sources: [] }), catalysts: async () => ({ summary: "risultati attesi", sources: [], ideas: ideas as never }) });
beforeEach(() => {
  mode = "up"; store = new MemoryStore(); eto = new FakeEtoro(); now = THU;
  eto.rateMap = { 1: { bid: 99.9, ask: 100 } };
  store.watch.set("AAA", { symbol: "AAA", instrument_id: 1, active: true });
  store.settings = { ...store.settings, mode: "autopilot" };
  d = { store, etoro: eto as never, tg: new FakeTg(), claude: claudeWith([]), now: () => now };
});
const overnightIdea = () => store.createSuggestion({
  symbol: "AAA", instrument_id: 1, side: "buy", units: 1, amount_usd: 100, price_ref: 100, target_price: 104, stop_price: 98, confidence: 85,
  rationale: "🌙 test", sources: [], origin: "scan", expires_at: new Date(THU.getTime() + 3600_000).toISOString(),
} as never);

describe("Supertrend ed EMA 9/50", () => {
  it("rialzista su una salita, ribassista su una discesa", () => {
    const up = trendState(trendCandles(1), 100.2, "x")!, down = trendState(trendCandles(-1), 99.8, "x")!;
    expect(up.supertrend).toBe("up"); expect(up.emaTrend).toBe("up"); expect(up.bullish).toBe(true); expect(up.bearish).toBe(false);
    expect(down.supertrend).toBe("down"); expect(down.emaTrend).toBe("down"); expect(down.bearish).toBe(true); expect(down.bullish).toBe(false);
    expect(supertrendOf(trendCandles(1).slice(0, 5))).toBeNull();
    expect(trendState(trendCandles(1), 60, "x")!.bullish).toBe(false); // crollo improvviso sotto la serie: Supertrend gira
    expect(trendState(trendCandles(1, 100, 30), 100, "x")).toBeNull();
  });
});

describe("guardia: uscita su trend ribassista 1/5/10 minuti", () => {
  const pos = (): Position => ({ positionId: "p9", instrumentId: 1, openRate: 100, amount: 100, units: 1, isBuy: true });
  const at = (bid: number) => { now = new Date("2026-07-16T15:00:00Z"); eto.positions = [pos()]; eto.rateMap = { 1: { bid, ask: bid + 0.1 } }; };
  it("chiude con profitto >= 1$ e trend ribassista", async () => {
    mode = "down"; at(102);
    await guardPositions(d);
    expect(eto.closed).toEqual(["p9"]);
  });
  it("non chiude se il profitto e' sotto la soglia o il trend e' rialzista", async () => {
    mode = "down"; at(100.5);
    await guardPositions(d);
    expect(eto.closed).toEqual([]);
    mode = "up"; at(102);
    await guardPositions(d);
    expect(eto.closed).toEqual([]);
  });
  it("kill switch e consulente: nessuna chiusura", async () => {
    mode = "down"; at(102);
    store.settings = { ...store.settings, kill_switch: true };
    await guardPositions(d);
    store.settings = { ...store.settings, kill_switch: false, mode: "advisor" };
    await guardPositions(d);
    expect(eto.closed).toEqual([]);
  });
});

describe("acquisti overnight su notizie attese", () => {
  it("finestra prima della chiusura solo se domani si negozia", () => {
    const s = store.settings;
    now = THU; expect(catalystScopes(d, s)).toEqual(["US"]);
    now = FRI; expect(catalystScopes(d, s)).toEqual([]);
    now = new Date("2026-07-16T19:45:00Z"); expect(catalystScopes(d, s)).toEqual([]); // troppo tardi
    expect(catalystScopes(d, { ...s, max_overnight_usd: 0 })).toEqual([]);
  });
  it("la scansione crea idee overnight, l'autopilot compra anche con trend ribassista, e vende subito se l'apertura e' in perdita", async () => {
    mode = "down";
    d = { ...d, claude: claudeWith([{ symbol: "AAA", side: "buy", confidence: 85, target_price: 104, stop_price: 98, rationale: "risultati dopo la chiusura", source_urls: [] }]) };
    expect(await runCatalystScan(d, "US")).toMatch(/1 idee overnight/);
    const [s] = await store.listSuggestions(["pending"]);
    expect(s.rationale).toMatch(/^🌙/);
    expect((await store.kvGet<{ horizon: string }>(`conf:${s.id}`))?.horizon).toBe("overnight");
    await autopilotSweep(d);
    expect(eto.opened).toEqual([1]);
    expect(((await store.kvGet<unknown[]>("overnight")) ?? []).length).toBe(1);
    // il giorno dopo apre in perdita: vendita immediata
    now = FRI_OPEN; eto.rateMap = { 1: { bid: 98, ask: 98.1 } };
    await guardPositions(d);
    expect(eto.closed).toEqual(["p1"]);
    expect(((await store.kvGet<unknown[]>("overnight")) ?? []).length).toBe(0);
  });
  it("se all'apertura e' in guadagno resta aperta", async () => {
    await overnightIdea().then((s) => store.kvSet(`conf:${s.id}`, { horizon: "overnight", claude: 85, rule: false }));
    await autopilotSweep(d);
    expect(eto.opened).toEqual([1]);
    now = FRI_OPEN; eto.rateMap = { 1: { bid: 100.5, ask: 100.6 } };
    await guardPositions(d);
    expect(eto.closed).toEqual([]);
    expect(((await store.kvGet<unknown[]>("overnight")) ?? []).length).toBe(0);
  });
  it("mai il venerdi'", async () => {
    now = FRI;
    const s = await overnightIdea();
    await store.updateSuggestion(s.id, { expires_at: new Date(FRI.getTime() + 3600_000).toISOString() });
    await store.kvSet(`conf:${s.id}`, { horizon: "overnight", claude: 85, rule: false });
    await autopilotSweep(d);
    expect(eto.opened).toEqual([]);
  });
});

describe("rotazione: i migliori titoli \"acquisto\" dell'Analisi, venduti al +1%", () => {
  const NOON = new Date("2026-07-16T15:00:00Z"); // 11:00 ET
  const tech = (buy: number, verdict: "buy" | "neutral", asOf: Date): Tech => ({ price: 100, asOf: asOf.toISOString(), signals: { buy, sell: 0, neutral: 9 - buy, verdict, detail: {} } } as unknown as Tech);
  const seed = async (symbols: Array<[string, number, number, "buy" | "neutral"]>) => {
    for (const [sym, id, buy, verdict] of symbols) {
      store.watch.set(sym, { symbol: sym, instrument_id: id, active: true });
      eto.rateMap[id] = { bid: 99.9, ask: 100 };
      await store.kvSet(`tech:${sym}`, tech(buy, verdict, NOON));
    }
  };
  const sent = () => (d.tg as unknown as FakeTg).sent;
  beforeEach(async () => {
    now = NOON;
    await seed([["A1", 1, 5, "buy"], ["A2", 2, 9, "buy"], ["A3", 3, 7, "buy"], ["A4", 4, 6, "buy"], ["A5", 5, 8, "buy"], ["A6", 6, 4, "buy"], ["A7", 7, 3, "buy"], ["N1", 8, 9, "neutral"]]);
    store.watch.delete("AAA");
    store.settings = { ...store.settings, max_daily_invest_usd: 10000, max_position_usd: 600, max_open_positions: 100, rotation_target_pct: 1 };
  });
  it("compra i primi 5 per potenzialita' (solo giudizio acquisto), avvisa su Telegram e non ripete nella stessa ora", async () => {
    await runRotation(d);
    expect([...eto.opened].sort()).toEqual([1, 2, 3, 4, 5]); // A2,A5,A3,A4,A1 ; esclusi A6, A7 e N1 (neutro)
    expect(sent().join("\n")).toMatch(/Rotazione top 5[\s\S]*A2[\s\S]*A5/);
    await runRotation(d);
    expect(eto.opened.length).toBe(5);
  });
  it("vende appena una posizione della rotazione fa +1%, le altre restano", async () => {
    await runRotation(d);
    now = new Date(NOON.getTime() + 5 * 60_000);
    eto.rateMap[2] = { bid: 101.2, ask: 101.3 };
    await guardPositions(d);
    expect(eto.closed).toEqual(["p1"]);
    expect(sent().join("\n")).toMatch(/Venduto/);
    await guardPositions(d);
    expect(eto.closed).toEqual(["p1"]);
  });
  it("il limite di perdita giornaliera blocca i nuovi acquisti e avvisa una sola volta", async () => {
    store.settings = { ...store.settings, max_daily_loss_eur: 1000 };
    await store.kvSet("equity_open", { day: "2026-07-16", equity: 1e9 }); // patrimonio di inizio giornata molto piu' alto: perdita oltre il limite
    await runRotation(d);
    expect(eto.opened.length).toBe(0);
    expect(sent().join("\n")).toMatch(/Limite di perdita giornaliera/);
    now = new Date(NOON.getTime() + 61 * 60_000);
    await runRotation(d);
    expect(eto.opened.length).toBe(0);
    expect(sent().filter((m) => /Limite di perdita giornaliera/.test(m)).length).toBe(1);
  });
  it("dopo 60 minuti ripete il ciclo e non ricompra i titoli gia' in portafoglio", async () => {
    await runRotation(d);
    now = new Date(NOON.getTime() + 61 * 60_000);
    await store.kvSet("tech:A2", tech(9, "buy", now)); // dati ancora freschi
    for (const s of ["A1", "A3", "A4", "A5"]) await store.kvSet(`tech:${s}`, tech(5, "buy", now));
    await runRotation(d);
    expect(eto.opened.length).toBe(5);
  });
  it("rispetta il filtro di trend, il kill switch e la modalita' consulente", async () => {
    mode = "down";
    await runRotation(d);
    expect(eto.opened).toEqual([]);
    expect(sent().join("\n")).toMatch(/non rialzista/);
    mode = "up"; now = new Date(NOON.getTime() + 61 * 60_000);
    store.settings = { ...store.settings, kill_switch: true };
    await runRotation(d);
    store.settings = { ...store.settings, kill_switch: false, mode: "advisor" };
    await runRotation(d);
    expect(eto.opened).toEqual([]);
  });
  it("senza filtro di trend compra anche con trend ribassista; con mercato chiuso non fa nulla", async () => {
    mode = "down";
    store.settings = { ...store.settings, rotation_trend_filter: false };
    now = new Date("2026-07-18T15:00:00Z"); // sabato
    await runRotation(d);
    expect(eto.opened).toEqual([]);
    now = NOON;
    await runRotation(d);
    expect(eto.opened.length).toBe(5);
  });
});
