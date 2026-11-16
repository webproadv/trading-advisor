import { describe, expect, it } from "vitest";
import { blendConfidence, quantConfidence } from "@/lib/confidence";
import { analyze, techPanel } from "@/lib/indicators";
import type { Candle } from "@/lib/types";

const mk = (closes: number[], range = 1): Candle[] => closes.map((c, i) => ({ t: `d${i}`, o: c, h: c + range, l: c - range, c }));
// salita con piccoli ritracciamenti (RSI non estremo)
const wavy = Array.from({ length: 120 }, (_, i) => 100 + i * 0.4 + (i % 5 === 0 ? -1.5 : 0.3));
const falling = Array.from({ length: 120 }, (_, i) => 160 - i * 0.5 + (i % 4 === 0 ? 1 : 0));

function inputs(closes: number[], live: number) {
  const c = mk(closes, 0.8);
  return { analysis: analyze(c), tech: techPanel(c, live, null, "x") };
}

describe("fiducia quantitativa", () => {
  it("senza dati: non utilizzabile", () => {
    expect(quantConfidence({ side: "buy", price: 100, target: 110, stop: 95, analysis: null, tech: null }).usable).toBe(false);
  });
  it("acquisto in trend rialzista con buon rischio/rendimento > acquisto in trend ribassista", () => {
    const up = inputs(wavy, wavy.at(-1)!);
    const dn = inputs(falling, falling.at(-1)!);
    const price = wavy.at(-1)!;
    const good = quantConfidence({ side: "buy", price, target: price * 1.15, stop: price * 0.95, ...up });
    const bad = quantConfidence({ side: "buy", price: falling.at(-1)!, target: falling.at(-1)! * 1.15, stop: falling.at(-1)! * 0.95, ...dn });
    expect(good.score).toBeGreaterThan(bad.score + 25);
    expect(good.score).not.toBe(50);
    expect(good.parts.reduce((s, p) => s + p.max, 0)).toBe(95);
  });
  it("rischio/rendimento migliore alza la fiducia", () => {
    const up = inputs(wavy, wavy.at(-1)!);
    const p = wavy.at(-1)!;
    const rr3 = quantConfidence({ side: "buy", price: p, target: p * 1.15, stop: p * 0.95, ...up }).score;
    const rr05 = quantConfidence({ side: "buy", price: p, target: p * 1.02, stop: p * 0.95, ...up }).score;
    expect(rr3).toBeGreaterThan(rr05);
  });
  it("vendita in downtrend con perdita da limitare > vendita in uptrend", () => {
    const dn = inputs(falling, falling.at(-1)!);
    const up = inputs(wavy, wavy.at(-1)!);
    const a = quantConfidence({ side: "sell", price: falling.at(-1)!, target: null, stop: null, ...dn, pnlPct: -4, stopLossPct: 5, takeProfitPct: 10 });
    const b = quantConfidence({ side: "sell", price: wavy.at(-1)!, target: null, stop: null, ...up, pnlPct: 1, stopLossPct: 5, takeProfitPct: 10 });
    expect(a.score).toBeGreaterThan(b.score + 20);
  });
  it("punteggio sempre tra 0 e 100", () => {
    for (const s of [wavy, falling]) for (const side of ["buy", "sell"] as const) {
      const r = quantConfidence({ side, price: s.at(-1)!, target: s.at(-1)! * 2, stop: s.at(-1)! * 0.99, ...inputs(s, s.at(-1)!), pnlPct: 50, takeProfitPct: 10, stopLossPct: 5 });
      expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("combinazione con Claude", () => {
  const q = { score: 80, usable: true, parts: [{ label: "trend", pts: 20, max: 20 }] };
  it("solo regole: tetto 65 (sotto la soglia autopilot di 70)", () => {
    const b = blendConfidence(null, q, true);
    expect(b.confidence).toBe(65);
    expect(b.note).toMatch(/tetto 65/);
  });
  it("con Claude: media dei due, con avviso in caso di forte contrasto", () => {
    expect(blendConfidence(90, q, false).confidence).toBe(85);
    const clash = blendConfidence(95, { ...q, score: 30 }, false);
    expect(clash.confidence).toBe(63);
    expect(clash.note).toMatch(/contrasto/);
  });
  it("senza indicatori usa la fiducia di Claude senza inventare", () => {
    expect(blendConfidence(72, { score: 0, usable: false, parts: [] }, false).confidence).toBe(72);
  });
});
