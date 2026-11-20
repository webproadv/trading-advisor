import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memoryStore";
import { autopilotSweep, catalystScopes, guardPositions, runCatalystScan, type Deps } from "@/lib/engine";
import { supertrendOf, trendState } from "@/lib/indicators";
import type { Position, Portfolio, Rate } from "@/lib/types";
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
    this.positions.push({ positionId: "p1", instrumentId: id, openRate: price, amount, units: amount / price, isBuy: true });
    return { positionId: "p1", price };
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
