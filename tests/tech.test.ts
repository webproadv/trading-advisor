import { describe, expect, it } from "vitest";
import { adxOf, atrOf, cciOf, emaSeries, macdOf, pivotsOf, techPanel, williamsOf } from "@/lib/indicators";
import type { Candle } from "@/lib/types";

const mk = (closes: number[], range = 1): Candle[] => closes.map((c, i) => ({ t: `2026-01-${String(i + 1).padStart(2, "0")}`, o: c, h: c + range, l: c - range, c }));
const up = Array.from({ length: 80 }, (_, i) => 100 + i);
const down = up.slice().reverse();
const chop = Array.from({ length: 80 }, (_, i) => 100 + (i % 2 ? 1 : -1));

describe("indicatori tecnici", () => {
  it("pivot classici esatti", () => {
    const p = pivotsOf({ t: "x", o: 0, h: 12, l: 8, c: 10 })!;
    expect(p.p).toBeCloseTo(10); expect(p.r1).toBeCloseTo(12); expect(p.s1).toBeCloseTo(8); expect(p.r2).toBeCloseTo(14); expect(p.s2).toBeCloseTo(6);
    expect(pivotsOf(undefined)).toBeNull();
  });
  it("EMA di una serie costante e di una crescente", () => {
    expect(emaSeries(new Array(30).fill(5), 10).at(-1)).toBeCloseTo(5);
    const e = emaSeries(up, 10).at(-1)!;
    expect(e).toBeLessThan(up.at(-1)!); expect(e).toBeGreaterThan(up.at(-10)!);
  });
  it("MACD positivo in salita, negativo in discesa", () => {
    expect(macdOf(up).macd!).toBeGreaterThan(0);
    expect(macdOf(down).macd!).toBeLessThan(0);
    expect(macdOf(up.slice(0, 20)).macd).toBeNull();
  });
  it("ATR di barre con range costante 2 e nessun gap = 2", () => {
    const c = mk(new Array(40).fill(100), 1);
    expect(atrOf(c.map((x) => x.h), c.map((x) => x.l), c.map((x) => x.c))).toBeCloseTo(2);
  });
  it("Williams %R e CCI agli estremi", () => {
    const c = mk(up);
    const hi = c.map((x) => x.h), lo = c.map((x) => x.l), cl = c.map((x) => x.c);
    expect(williamsOf(hi, lo, cl)!).toBeGreaterThan(-20);
    expect(cciOf(hi, lo, cl)!).toBeGreaterThan(100);
    const d = mk(down);
    expect(williamsOf(d.map((x) => x.h), d.map((x) => x.l), d.map((x) => x.c))!).toBeLessThan(-80);
  });
  it("ADX alto in trend, basso nel laterale; +DI > -DI in salita", () => {
    const u = mk(up), ch = mk(chop);
    const a = adxOf(u.map((x) => x.h), u.map((x) => x.l), u.map((x) => x.c));
    expect(a.adx!).toBeGreaterThan(40); expect(a.plusDI!).toBeGreaterThan(a.minusDI!);
    const b = adxOf(ch.map((x) => x.h), ch.map((x) => x.l), ch.map((x) => x.c));
    expect(b.adx!).toBeLessThan(25);
    expect(adxOf([1, 2], [1, 2], [1, 2]).adx).toBeNull();
  });
  it("pannello completo: giudizio e usa il prezzo live", () => {
    const t = techPanel(mk(up), 182, null, "2026-03-01")!;
    expect(t.signals.verdict).not.toBe("sell");
    expect(t.price).toBe(182);
    expect(t.pivots!.p).toBeCloseTo((up.at(-1)! + 1 + up.at(-1)! - 1 + up.at(-1)!) / 3);
    expect(Object.keys(t.signals.detail)).toHaveLength(9);
    const td = techPanel(mk(down), 20, null, "x")!;
    expect(td.signals.verdict).toBe("sell");
    expect(td.stochK!).toBeGreaterThanOrEqual(0); expect(td.stochK!).toBeLessThanOrEqual(100);
    expect(td.stochRsiK!).toBeGreaterThanOrEqual(0); expect(td.stochRsiK!).toBeLessThanOrEqual(100);
  });
  it("in un crollo forte l'ipervenduto non conta come acquisto", () => {
    const t = techPanel(mk(down), 20, null, "x")!;
    expect(t.rsi14!).toBeLessThan(30);
    expect(t.signals.detail.RSI).toBe("neutral");
    expect(t.signals.detail.CCI).toBe("neutral");
    expect(t.signals.buy).toBe(0);
  });
  it("candela di oggi parziale: massimo/minimo si estendono col prezzo live", () => {
    const base = mk(up);
    const partial: Candle = { t: "oggi", o: 180, h: 181, l: 179, c: 180 };
    const t1 = techPanel(base, 190, partial, "x")!;
    const t2 = techPanel(base, 180, partial, "x")!;
    expect(t1.atr14!).toBeGreaterThan(t2.atr14! - 1e-9);
  });
  it("dati insufficienti o prezzo non valido: null", () => {
    expect(techPanel(mk(up.slice(0, 20)), 100, null, "x")).toBeNull();
    expect(techPanel(mk(up), 0, null, "x")).toBeNull();
  });
});
