import type { Candle } from "@/lib/types";

const BASE = Date.parse("2026-07-14T00:00:00Z");
/** Serie di candele in salita (dir 1) o discesa (dir -1) che finisce a endPrice, ben prima di "adesso" (nessuna candela in formazione). */
export function trendCandles(dir: 1 | -1, endPrice = 100, n = 150, stepSec = 600): Candle[] {
  const step = endPrice * 0.003;
  const start = endPrice - dir * (n - 1) * step;
  return Array.from({ length: n }, (_, i) => {
    const c = start + dir * i * step, o = c - dir * step;
    return { t: new Date(BASE - (n - i) * stepSec * 1000).toISOString(), o, h: Math.max(o, c) + step * 0.2, l: Math.min(o, c) - step * 0.2, c };
  });
}
