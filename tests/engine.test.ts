import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memoryStore";
import { autopilotSweep, executeSuggestion, executeApprovedQueue, monitorPositions, snapshot, tick, type Deps } from "@/lib/engine";
import type { Position, Portfolio, Rate } from "@/lib/types";

const REG = new Date("2026-07-14T15:00:00Z");   // 11:00 ET, sessione regolare
const SAT = new Date("2026-07-18T15:00:00Z");   // sabato

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
class FakeTg { enabled = true; sent: string[] = []; async send(h: string) { this.sent.push(h); } async answer() {} async edit() {} }
const noClaude = { enabled: false, analyze: async () => ({ summary: "", ideas: [], sources: [] }) };

let store: MemoryStore, eto: FakeEtoro, tg: FakeTg, now: Date, d: Deps;
const mk = () => { store = new MemoryStore(); eto = new FakeEtoro(); tg = new FakeTg(); now = REG; d = { store, etoro: eto as never, tg, claude: noClaude, now: () => now }; };
const addSugg = (over: Record<string, unknown> = {}) => store.createSuggestion({
  symbol: "AAA", instrument_id: 1, side: "buy", units: 1, amount_usd: 100, price_ref: 100, target_price: 120, stop_price: 95, confidence: 85,
  rationale: "test", sources: [], origin: "scan", expires_at: new Date(REG.getTime() + 5 * 86400_000).toISOString(), ...over,
} as never);

beforeEach(() => { mk(); eto.rateMap = { 1: { bid: 99.9, ask: 100 } }; });

describe("monitor posizioni", () => {
  const pos = (openRate: number): Position => ({ positionId: "p9", instrumentId: 1, openRate, amount: 100, units: 100 / openRate, isBuy: true });
  it("consulente: stop-loss crea un'idea di vendita e non vende", async () => {
    await store.watch.set("AAA", { symbol: "AAA", instrument_id: 1, active: true });
    eto.positions = [pos(110)]; // bid 99.9 -> -9%
    const out = await monitorPositions(d, await snapshot(d));
    expect(out.join()).toMatch(/idea vendita/);
    expect(eto.closed).toHaveLength(0);
    expect(tg.sent.length).toBe(1);
    // nessun duplicato al giro successivo
    await monitorPositions(d, await snapshot(d));
    expect((await store.listSuggestions(["pending"])).length).toBe(1);
  });
  it("autopilot: stop-loss chiude la posizione", async () => {
    store.settings = { ...store.settings, mode: "autopilot" };
    eto.positions = [pos(110)];
    await monitorPositions(d, await snapshot(d));
    expect(eto.closed).toEqual([["p9", null]]);
  });
  it("kill switch: l'autopilot non chiude (solo avviso/idea)", async () => {
    store.settings = { ...store.settings, mode: "autopilot", kill_switch: true };
    eto.positions = [pos(110)];
    await monitorPositions(d, await snapshot(d));
    expect(eto.closed).toHaveLength(0);
  });
  it("sotto soglia: nessuna azione", async () => {
    eto.positions = [pos(100)];
    expect(await monitorPositions(d, await snapshot(d))).toEqual([]);
  });
});

describe("autopilot acquisti", () => {
  beforeEach(() => { store.settings = { ...store.settings, mode: "autopilot" }; });
  it("compra entro i limiti e registra il trade", async () => {
    await addSugg();
    const out = await autopilotSweep(d);
    expect(out).toHaveLength(1);
    expect(eto.opened).toEqual([[1, 100]]);
    expect(await store.investedToday("2026-07-14", "autopilot")).toBe(100);
  });
  it("rispetta il tetto giornaliero", async () => {
    store.settings = { ...store.settings, max_daily_invest_usd: 120, max_position_usd: 100 };
    await addSugg(); await addSugg({ symbol: "BBB", instrument_id: 2 }); eto.rateMap[2] = { bid: 99.9, ask: 100 };
    await autopilotSweep(d);
    expect(eto.opened.reduce((s, o) => s + o[1], 0)).toBeLessThanOrEqual(120);
  });
  it("margine di acquisto: upside insufficiente -> non compra", async () => {
    await addSugg({ target_price: 104 }); // +4% < 8%
    await autopilotSweep(d);
    expect(eto.opened).toHaveLength(0);
  });
  it("fiducia sotto soglia -> non compra", async () => {
    await addSugg({ confidence: 50 });
    await autopilotSweep(d);
    expect(eto.opened).toHaveLength(0);
  });
  it("prezzo spostato oltre il 3% -> non compra", async () => {
    eto.rateMap[1] = { bid: 105, ask: 105.2 };
    await addSugg();
    await autopilotSweep(d);
    expect(eto.opened).toHaveLength(0);
  });
  it("kill switch e modalita' consulente bloccano tutto", async () => {
    await addSugg();
    store.settings = { ...store.settings, kill_switch: true };
    await autopilotSweep(d);
    store.settings = { ...store.settings, kill_switch: false, mode: "advisor" };
    await autopilotSweep(d);
    expect(eto.opened).toHaveLength(0);
  });
  it("mercato chiuso: niente esecuzione autopilot", async () => {
    await addSugg(); now = SAT;
    await autopilotSweep(d);
    expect(eto.opened).toHaveLength(0);
  });
});

describe("esecuzione manuale", () => {
  it("rispetta il numero di azioni scelto dall'utente", async () => {
    const s = await addSugg();
    const r = await executeSuggestion(d, s.id, { by: "manual", units: 2 });
    expect(r.ok).toBe(true);
    expect(eto.opened[0][1]).toBeCloseTo(200, 0);
  });
  it("mercato chiuso: l'approvazione resta in coda e parte alla riapertura", async () => {
    const s = await addSugg(); now = SAT;
    const r = await executeSuggestion(d, s.id, { by: "manual", units: 1 });
    expect(r.status).toBe("approved");
    expect(eto.opened).toHaveLength(0);
    now = REG;
    await executeApprovedQueue(d);
    expect(eto.opened).toHaveLength(1);
  });
  it("non esegue due volte la stessa idea", async () => {
    const s = await addSugg();
    await executeSuggestion(d, s.id, { by: "manual", units: 1 });
    const r2 = await executeSuggestion(d, s.id, { by: "manual", units: 1 });
    expect(r2.ok).toBe(false);
    expect(eto.opened).toHaveLength(1);
  });
});

describe("tick", () => {
  it("scrive il battito e non si sovrappone", async () => {
    await tick(d);
    expect(await store.kvGet("last_tick")).toBeTruthy();
    await store.kvSet("tick_lock", { ts: now.toISOString() });
    expect((await tick(d)).skipped).toMatch(/in corso/);
  });
});
