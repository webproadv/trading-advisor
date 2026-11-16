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
