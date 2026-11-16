import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memoryStore";
import { runScan, type Deps } from "@/lib/engine";
import type { Candle, Portfolio, Rate } from "@/lib/types";

const NOW = new Date("2026-07-14T12:30:00Z"); // 08:30 ET, premarket USA
const base = Array.from({ length: 126 }, (_, i) => 100 + i * 0.4 + (i % 5 === 0 ? -1.5 : 0.3));
const wavy = [...base, ...Array.from({ length: 4 }, (_, i) => base.at(-1)! - (i + 1) * 0.8)]; // salita con ritracciamento finale
const candles: Candle[] = wavy.map((c, i) => ({ t: new Date(NOW.getTime() - (130 - i) * 86400_000).toISOString(), o: c, h: c + 0.8, l: c - 0.8, c }));

const etoro = {
  async rates(ids: number[]) { const o: Record<number, Rate> = {}; for (const i of ids) o[i] = { bid: wavy.at(-1)! - 0.05, ask: wavy.at(-1)! }; return o; },
  async candles() { return candles; },
  async search() { return null; },
  async portfolio(): Promise<Portfolio> { return { cash: 5000, positions: [] }; },
  async openBuy() { return {}; },
  async close() {},
};
const tg = { enabled: false, send: async () => {}, answer: async () => {}, edit: async () => {} };

describe("scansione: fiducia calcolata", () => {
  it("senza Claude le idee da regole non hanno il 50 fisso e sono sotto 70", async () => {
    const store = new MemoryStore();
    store.watch.set("AAA", { symbol: "AAA", instrument_id: 1, active: true });
    const d: Deps = { store, etoro: etoro as never, tg, claude: { enabled: false, analyze: async () => ({ summary: "", ideas: [], sources: [] }) }, now: () => NOW };
    const r = await runScan(d, "2026-07-14@08:00");
    expect(r.created.length).toBe(1);
    const s = r.created[0];
    expect(s.confidence).not.toBe(50);
    expect(s.confidence).toBeLessThanOrEqual(65);
    expect(s.rationale).toMatch(/Fiducia \d+\/100/);
    expect(await store.kvGet("tech:AAA")).toBeTruthy();
  });
  it("con Claude: media tra la sua fiducia e quella quantitativa", async () => {
    const store = new MemoryStore();
    store.watch.set("AAA", { symbol: "AAA", instrument_id: 1, active: true });
    const claude = { enabled: true, analyze: async () => ({ summary: "ok", sources: [], ideas: [
      { symbol: "AAA", side: "buy" as const, confidence: 95, target_price: wavy.at(-1)! * 1.15, stop_price: wavy.at(-1)! * 0.95, rationale: "test", source_urls: [] }] }) };
    const d: Deps = { store, etoro: etoro as never, tg, claude, now: () => NOW };
    const r = await runScan(d, "2026-07-14@08:00");
    const s = r.created[0];
    expect(s.confidence).toBeLessThan(95);
    expect(s.confidence).toBeGreaterThan(50);
    expect(s.rationale).toMatch(/media tra Claude \(95\)/);
  });
});

describe("aggiornamento ogni 15 minuti", () => {
  it("aggiorna gli indicatori, ricalcola la fiducia e rispetta l'intervallo", async () => {
    const { refreshSweep } = await import("@/lib/engine");
    const store = new MemoryStore();
    store.watch.set("AAA", { symbol: "AAA", instrument_id: 1, active: true });
    const claude = { enabled: true, analyze: async () => ({ summary: "ok", sources: [], ideas: [
      { symbol: "AAA", side: "buy" as const, confidence: 95, target_price: wavy.at(-1)! * 1.15, stop_price: wavy.at(-1)! * 0.95, rationale: "t", source_urls: [] }] }) };
    let t = NOW.getTime();
    const d: Deps = { store, etoro: etoro as never, tg, claude, now: () => new Date(t) };
    const r = await runScan(d, "2026-07-14@08:00");
    const id = r.created[0].id;
    await store.updateSuggestion(id, { confidence: 1 }); // valore vecchio da correggere
    const out = await refreshSweep(d, "US");
    expect(out[0]).toMatch(/1 titoli aggiornati, 1 fiducie/);
    expect((await store.getSuggestion(id))!.confidence).toBeGreaterThan(1);
    expect(await refreshSweep(d, "US")).toEqual([]); // troppo presto
    t += 15 * 60_000;
    expect((await refreshSweep(d, "US")).length).toBe(1);
    expect(await refreshSweep(d, "EU")).toEqual([]); // nessun titolo europeo in watchlist
  });
});

describe("timeframe intraday", () => {
  it("salva 30m/1h/4h, marca le idee intraday e l'autopilot non le esegue", async () => {
    const { autopilotSweep } = await import("@/lib/engine");
    const store = new MemoryStore();
    store.watch.set("AAA", { symbol: "AAA", instrument_id: 1, active: true });
    let bought = 0;
    const px = wavy.at(-1)!;
    const claude = { enabled: true, analyze: async () => ({ summary: "ok", sources: [], ideas: [
      { symbol: "AAA", side: "buy" as const, confidence: 95, horizon: "intraday" as const, target_price: px * 1.025, stop_price: px * 0.99, rationale: "rottura", source_urls: [] }] }) };
    const d: Deps = { store, etoro: { ...etoro, openBuy: async () => { bought++; return {}; } } as never, tg, claude, now: () => NOW };
    await store.saveSettings({ mode: "autopilot", min_confidence: 10 });
    const r = await runScan(d, "2026-07-14@08:00");
    expect(await store.kvGet("mtf:AAA")).toBeTruthy();
    expect(r.created.length).toBe(1);
    const s = r.created[0];
    expect(s.rationale).toMatch(/INTRADAY/);
    expect(new Date(s.expires_at).getTime() - NOW.getTime()).toBeLessThanOrEqual(6 * 3600_000);
    expect(r.created[0].rationale).toMatch(/timeframe 30m\/1h\/4h/);
    await autopilotSweep({ ...d, now: () => new Date("2026-07-14T15:00:00Z") });
    expect(bought).toBe(0);
  });
});

describe("vendita manuale e orari di mercato", () => {
  it("un titolo europeo si vende a Borsa italiana aperta anche se gli USA sono chiusi", async () => {
    const { closeSymbol, MarketClosedError } = await import("@/lib/engine");
    const mk = (iso: string, symbol: string) => {
      const store = new MemoryStore();
      store.watch.set(symbol, { symbol, instrument_id: 2, active: true });
      let closed = 0;
      const e = { ...etoro,
        rates: async () => ({ 2: { bid: 10, ask: 10.1 } }),
        portfolio: async (): Promise<Portfolio> => ({ cash: 100, positions: [{ positionId: "p1", instrumentId: 2, openRate: 9, amount: 90, units: 10, isBuy: true, openDateTime: "2026-07-01T00:00:00Z" }] }),
        close: async () => { closed++; } };
      const d: Deps = { store, etoro: e as never, tg, claude: { enabled: false, analyze: async () => ({ summary: "", ideas: [], sources: [] }) }, now: () => new Date(iso), fx: async () => 1.1 } as Deps;
      return { d, closed: () => closed };
    };
    const eu = mk("2026-07-14T07:30:00Z", "ENI.MI"); // 09:30 Roma, 03:30 New York
    await closeSymbol(eu.d, 2, null, "manual", "t");
    expect(eu.closed()).toBe(1);
    const us = mk("2026-07-14T07:30:00Z", "AAPL");
    await expect(closeSymbol(us.d, 2, null, "manual", "t")).rejects.toBeInstanceOf(MarketClosedError);
    const euClosed = mk("2026-07-14T16:30:00Z", "ENI.MI"); // 18:30 Roma
    await expect(closeSymbol(euClosed.d, 2, null, "manual", "t")).rejects.toThrow(/europeo chiuso/);
  });
});

describe("acquisto manuale dalla pagina Analisi", () => {
  it("compra a mercato aperto entro la giacenza e registra l'operazione", async () => {
    const { buyManual, MarketClosedError } = await import("@/lib/engine");
    const mk = (iso: string, cash: number) => {
      const store = new MemoryStore();
      store.watch.set("AAPL", { symbol: "AAPL", instrument_id: 5, active: true });
      const bought: number[] = [];
      const e = { ...etoro, rates: async () => ({ 5: { bid: 99.9, ask: 100 } }), portfolio: async (): Promise<Portfolio> => ({ cash, positions: [] }),
        openBuy: async (_id: number, amount: number) => { bought.push(amount); return { positionId: "x1", price: 100 }; } };
      const d: Deps = { store, etoro: e as never, tg, claude: { enabled: false, analyze: async () => ({ summary: "", ideas: [], sources: [] }) }, now: () => new Date(iso) } as Deps;
      return { d, store, bought };
    };
    const open = mk("2026-07-14T15:00:00Z", 1000); // 11:00 ET, USA aperti
    expect(await buyManual(open.d, "AAPL", 2.5)).toMatch(/Acquisto eseguito.*\$250,00/);
    expect(open.bought).toEqual([250]);
    expect((await open.store.recentTrades(5))[0]).toMatchObject({ side: "buy", origin: "manual", symbol: "AAPL" });
    const poor = mk("2026-07-14T15:00:00Z", 100);
    await expect(buyManual(poor.d, "AAPL", 2)).rejects.toThrow(/giacenza insufficiente/);
    await expect(buyManual(poor.d, "AAPL", 0.01)).rejects.toThrow(/sotto il minimo/);
    await expect(buyManual(poor.d, "NOPE", 1)).rejects.toThrow(/watchlist/);
    const closed = mk("2026-07-14T07:30:00Z", 1000);
    await expect(buyManual(closed.d, "AAPL", 1)).rejects.toBeInstanceOf(MarketClosedError);
    expect(closed.bought.length).toBe(0);
  });
});
