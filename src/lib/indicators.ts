import type { Candle } from "./types";

export function sma(v: number[], n: number, end = v.length): number | null {
  if (n <= 0 || end < n) return null;
  let s = 0;
  for (let i = end - n; i < end; i++) s += v[i];
  return s / n;
}

/** RSI di Wilder. */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export interface Analysis {
  last: number; lastDate: string; sma20: number | null; sma50: number | null; rsi14: number | null;
  mom20Pct: number | null; distSma20Pct: number | null; trend: "up" | "down" | "flat"; score: number;
}

export function analyze(candles: Candle[]): Analysis | null {
  if (candles.length < 21) return null;
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const mom = closes.length > 20 ? (last / closes[closes.length - 21] - 1) * 100 : null;
  const dist = s20 ? (last / s20 - 1) * 100 : null;
  let trend: Analysis["trend"] = "flat";
  if (s20 !== null && s50 !== null) trend = s20 > s50 && last > s50 ? "up" : s20 < s50 && last < s50 ? "down" : "flat";
  let score = 0;
  if (trend === "up") score += 2;
  if (trend === "down") score -= 2;
  if (r !== null) {
    if (r >= 35 && r <= 55) score += 1;       // ritracciamento sano
    if (r > 75) score -= 2;                    // ipercomprato
    if (r < 25) score += 0.5;                  // ipervenduto (rimbalzo possibile)
  }
  if (mom !== null && mom > 0 && mom < 15) score += 1;
  if (mom !== null && mom > 25) score -= 1;    // corsa troppo estesa
  return { last, lastDate: candles[candles.length - 1].t, sma20: s20, sma50: s50, rsi14: r, mom20Pct: mom,
    distSma20Pct: dist, trend, score };
}

/** Situazione favorevole all'acquisto: trend rialzista, ritracciamento vicino alla media a 20 giorni, RSI non tirato. */
export function favorableBuy(a: Pick<Analysis, "trend" | "rsi14" | "sma20" | "sma50">, livePrice: number): boolean {
  if (a.trend !== "up" || a.rsi14 === null || !a.sma20 || !a.sma50) return false;
  const dist = (livePrice / a.sma20 - 1) * 100;
  return livePrice > a.sma50 && a.rsi14 >= 35 && a.rsi14 <= 55 && dist >= -3 && dist <= 1.5;
}

/** Segnale di debolezza su un titolo in portafoglio: sotto media 20 con trend in rottura, oppure ipercomprato estremo. */
export function favorableSell(a: Pick<Analysis, "rsi14" | "sma20" | "sma50">, livePrice: number): boolean {
  if (a.rsi14 !== null && a.rsi14 > 78) return true;
  return !!a.sma20 && !!a.sma50 && livePrice < a.sma20 && a.sma20 < a.sma50;
}
