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

// ------------------------------------------------------------------ pannello tecnico completo
export type Sig = "buy" | "sell" | "neutral";
export interface Tech {
  price: number; asOf: string;
  mom10: number | null; mom10Pct: number | null;
  rsi14: number | null; stochK: number | null; stochD: number | null; stochRsiK: number | null; stochRsiD: number | null;
  macd: number | null; macdSignal: number | null; macdHist: number | null;
  adx: number | null; plusDI: number | null; minusDI: number | null;
  willR: number | null; cci20: number | null; atr14: number | null; atrPct: number | null;
  pivots: { p: number; r1: number; r2: number; s1: number; s2: number } | null;
  signals: { buy: number; sell: number; neutral: number; verdict: Sig; detail: Record<string, Sig> };
}

type Num = number | null;
const last = <T>(a: T[]): T | null => (a.length ? a[a.length - 1] : null);
const fin = (x: number | undefined | null): x is number => typeof x === "number" && Number.isFinite(x);

/** EMA: restituisce una serie lunga come l'input (null dove non calcolabile). I null iniziali dell'input sono ammessi. */
export function emaSeries(v: Array<number | null>, n: number): Array<number | null> {
  const out: Array<number | null> = new Array(v.length).fill(null);
  const k = 2 / (n + 1);
  let start = v.findIndex((x) => fin(x));
  if (start < 0 || v.length - start < n) return out;
  let seed = 0;
  for (let i = start; i < start + n; i++) seed += v[i] as number;
  let prev = seed / n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < v.length; i++) { prev = (v[i] as number) * k + prev * (1 - k); out[i] = prev; }
  return out;
}

function smaSeries(v: Array<number | null>, n: number): Array<number | null> {
  return v.map((_, i) => {
    if (i < n - 1) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) { const x = v[j]; if (!fin(x)) return null; s += x; }
    return s / n;
  });
}

export function rsiSeries(closes: number[], n = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function stochOf(hi: number[], lo: number[], cl: Array<number | null>, n: number): Array<number | null> {
  return cl.map((c, i) => {
    if (i < n - 1 || !fin(c)) return null;
    let h = -Infinity, l = Infinity;
    for (let j = i - n + 1; j <= i; j++) { h = Math.max(h, hi[j]); l = Math.min(l, lo[j]); }
    return h === l ? 50 : ((c - l) / (h - l)) * 100;
  });
}

export function macdOf(closes: number[]): { macd: Num; signal: Num; hist: Num } {
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const line = closes.map((_, i) => (fin(e12[i]) && fin(e26[i]) ? (e12[i] as number) - (e26[i] as number) : null));
  const sig = emaSeries(line, 9);
  const m = last(line), s = last(sig);
  return { macd: m, signal: s, hist: fin(m) && fin(s) ? m - s : null };
}

/** ADX, +DI, -DI di Wilder (n=14). Richiede almeno 2n+1 candele. */
export function adxOf(hi: number[], lo: number[], cl: number[], n = 14): { adx: Num; plusDI: Num; minusDI: Num } {
  const len = cl.length;
  if (len < 2 * n + 1) return { adx: null, plusDI: null, minusDI: null };
  const tr: number[] = [], pdm: number[] = [], mdm: number[] = [];
  for (let i = 1; i < len; i++) {
    const up = hi[i] - hi[i - 1], dn = lo[i - 1] - lo[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])));
  }
  let sTR = tr.slice(0, n).reduce((a, b) => a + b, 0), sP = pdm.slice(0, n).reduce((a, b) => a + b, 0), sM = mdm.slice(0, n).reduce((a, b) => a + b, 0);
  const dx: number[] = [];
  let pdi = 0, mdi = 0;
  const calc = () => { pdi = sTR ? (100 * sP) / sTR : 0; mdi = sTR ? (100 * sM) / sTR : 0; const sum = pdi + mdi; dx.push(sum ? (100 * Math.abs(pdi - mdi)) / sum : 0); };
  calc();
  for (let i = n; i < tr.length; i++) {
    sTR = sTR - sTR / n + tr[i]; sP = sP - sP / n + pdm[i]; sM = sM - sM / n + mdm[i];
    calc();
  }
  if (dx.length < n) return { adx: null, plusDI: pdi, minusDI: mdi };
  let adx = dx.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < dx.length; i++) adx = (adx * (n - 1) + dx[i]) / n;
  return { adx, plusDI: pdi, minusDI: mdi };
}

export function atrOf(hi: number[], lo: number[], cl: number[], n = 14): Num {
  if (cl.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < cl.length; i++) tr.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])));
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

export function cciOf(hi: number[], lo: number[], cl: number[], n = 20): Num {
  if (cl.length < n) return null;
  const tp = cl.map((c, i) => (hi[i] + lo[i] + c) / 3);
  const w = tp.slice(-n);
  const mean = w.reduce((a, b) => a + b, 0) / n;
  const dev = w.reduce((a, b) => a + Math.abs(b - mean), 0) / n;
  return dev === 0 ? 0 : (tp[tp.length - 1] - mean) / (0.015 * dev);
}

export function williamsOf(hi: number[], lo: number[], cl: number[], n = 14): Num {
  if (cl.length < n) return null;
  const h = Math.max(...hi.slice(-n)), l = Math.min(...lo.slice(-n));
  return h === l ? -50 : (-100 * (h - cl[cl.length - 1])) / (h - l);
}

/** Pivot classici dalla candela precedente (ultima completata). */
export function pivotsOf(prev: Candle | undefined): Tech["pivots"] {
  if (!prev) return null;
  const p = (prev.h + prev.l + prev.c) / 3;
  return { p, r1: 2 * p - prev.l, r2: p + (prev.h - prev.l), s1: 2 * p - prev.h, s2: p - (prev.h - prev.l) };
}

/**
 * Pannello tecnico in tempo reale: candele giornaliere COMPLETATE + candela di oggi aggiornata col prezzo live.
 * `partial` e' la candela di oggi ancora in corso (se disponibile): ne usiamo apertura/massimo/minimo e sostituiamo la chiusura col prezzo live.
 */
export function techPanel(completed: Candle[], live: number, partial: Candle | null, asOf: string): Tech | null {
  if (completed.length < 40 || !(live > 0)) return null;
  const prev = completed[completed.length - 1];
  const today: Candle = partial
    ? { t: partial.t, o: partial.o, h: Math.max(partial.h, live), l: Math.min(partial.l, live), c: live }
    : { t: asOf, o: prev.c, h: Math.max(prev.c, live), l: Math.min(prev.c, live), c: live };
  const cs = [...completed, today];
  const hi = cs.map((c) => c.h), lo = cs.map((c) => c.l), cl = cs.map((c) => c.c);

  const rs = rsiSeries(cl, 14);
  const rsi14 = last(rs);
  const kRaw = stochOf(hi, lo, cl, 14);
  const k = smaSeries(kRaw, 3), dd = smaSeries(k, 3);
  const rsHi = rs.map((x) => x ?? 0), rsCl = rs;
  const srRaw = stochOf(rsHi, rs.map((x) => x ?? 0), rsCl, 14);
  const srK = smaSeries(srRaw, 3), srD = smaSeries(srK, 3);
  const mac = macdOf(cl);
  const ad = adxOf(hi, lo, cl, 14);
  const atr = atrOf(hi, lo, cl, 14);
  const m10 = cl.length > 10 ? cl[cl.length - 1] - cl[cl.length - 11] : null;
  const m10p = cl.length > 10 && cl[cl.length - 11] > 0 ? (cl[cl.length - 1] / cl[cl.length - 11] - 1) * 100 : null;
  const pv = pivotsOf(prev);
  const will = williamsOf(hi, lo, cl, 14);
  const cci = cciOf(hi, lo, cl, 20);

  const detail: Record<string, Sig> = {};
  const sg = (name: string, v: Sig) => { detail[name] = v; };
  const kk = last(k), dk = last(dd);
  sg("RSI", rsi14 === null ? "neutral" : rsi14 < 30 ? "buy" : rsi14 > 70 ? "sell" : "neutral");
  sg("Stoch", kk === null || dk === null ? "neutral" : kk < 20 && kk > dk ? "buy" : kk > 80 && kk < dk ? "sell" : "neutral");
  const sk = last(srK);
  sg("StochRSI", sk === null ? "neutral" : sk < 20 ? "buy" : sk > 80 ? "sell" : "neutral");
  const eps = live * 1e-9;
  sg("MACD", mac.macd === null || mac.signal === null ? "neutral" : mac.macd - mac.signal > eps ? "buy" : mac.macd - mac.signal < -eps ? "sell" : "neutral");
  sg("ADX", ad.adx === null || ad.plusDI === null || ad.minusDI === null ? "neutral" : ad.adx > 25 && ad.plusDI > ad.minusDI ? "buy" : ad.adx > 25 && ad.minusDI > ad.plusDI ? "sell" : "neutral");
  sg("Williams%R", will === null ? "neutral" : will < -80 ? "buy" : will > -20 ? "sell" : "neutral");
  sg("CCI", cci === null ? "neutral" : cci < -100 ? "buy" : cci > 100 ? "sell" : "neutral");
  sg("Momentum", m10 === null ? "neutral" : m10 > 0 ? "buy" : m10 < 0 ? "sell" : "neutral");
  sg("Pivot", pv === null ? "neutral" : live > pv.p ? "buy" : live < pv.p ? "sell" : "neutral");
  // In un trend forte (ADX > 25) i segnali di ipercomprato/ipervenduto CONTRO il trend non contano: "ipervenduto" in un crollo non e' un acquisto.
  if (ad.adx !== null && ad.plusDI !== null && ad.minusDI !== null && ad.adx > 25) {
    const against: Sig = ad.minusDI > ad.plusDI ? "buy" : "sell";
    for (const k of ["RSI", "Stoch", "StochRSI", "Williams%R", "CCI"]) if (detail[k] === against) detail[k] = "neutral";
  }
  const vals = Object.values(detail);
  const buy = vals.filter((x) => x === "buy").length, sell = vals.filter((x) => x === "sell").length;
  const verdict: Sig = buy - sell >= 3 ? "buy" : sell - buy >= 3 ? "sell" : "neutral";

  return {
    price: live, asOf, mom10: m10, mom10Pct: m10p, rsi14, stochK: kk, stochD: dk, stochRsiK: sk, stochRsiD: last(srD),
    macd: mac.macd, macdSignal: mac.signal, macdHist: mac.hist, adx: ad.adx, plusDI: ad.plusDI, minusDI: ad.minusDI,
    willR: will, cci20: cci, atr14: atr, atrPct: atr !== null ? (atr / live) * 100 : null, pivots: pv,
    signals: { buy, sell, neutral: vals.length - buy - sell, verdict, detail },
  };
}

// ------------------------------------------------------------------ multi-timeframe (30 minuti, 1 ora, 4 ore)
export type Frame = "30m" | "1h" | "4h";
export const FRAMES: Array<{ frame: Frame; interval: string; sec: number; weight: number }> = [
  { frame: "30m", interval: "ThirtyMinutes", sec: 1800, weight: 1 },
  { frame: "1h", interval: "OneHour", sec: 3600, weight: 1.5 },
  { frame: "4h", interval: "FourHours", sec: 14400, weight: 2 },
];
export interface Mtf { asOf: string; frames: Record<Frame, Tech | null> }

/** Verdetto per timeframe e allineamento pesato (-1 = tutti in vendita, +1 = tutti in acquisto). */
export function mtfSummary(m: Mtf | null): { verdicts: Record<Frame, Sig | null>; alignment: number | null } {
  const verdicts = { "30m": null, "1h": null, "4h": null } as Record<Frame, Sig | null>;
  if (!m) return { verdicts, alignment: null };
  let num = 0, den = 0;
  for (const f of FRAMES) {
    const v = m.frames[f.frame]?.signals.verdict ?? null;
    verdicts[f.frame] = v;
    if (v) { num += f.weight * (v === "buy" ? 1 : v === "sell" ? -1 : 0); den += f.weight; }
  }
  return { verdicts, alignment: den ? num / den : null };
}

// ------------------------------------------------------------------ Supertrend ed EMA 9/50 (filtri di ingresso e di uscita intraday)
export interface SupertrendResult { dir: "up" | "down"; line: number }

/** Supertrend classico (ATR di Wilder a n periodi, moltiplicatore m). Restituisce la direzione sull'ultima candela. */
export function supertrendOf(cs: Candle[], n = 10, mult = 3): SupertrendResult | null {
  if (cs.length < n + 2) return null;
  const tr: number[] = [];
  for (let i = 1; i < cs.length; i++) tr.push(Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i - 1].c), Math.abs(cs[i].l - cs[i - 1].c)));
  // atr[i] corrisponde alla candela i (i >= n)
  const atr: Array<number | null> = new Array(cs.length).fill(null);
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  atr[n] = a;
  for (let i = n + 1; i < cs.length; i++) { a = (a * (n - 1) + tr[i - 1]) / n; atr[i] = a; }
  let fu = 0, fl = 0, dir: "up" | "down" = "up", init = false;
  for (let i = n; i < cs.length; i++) {
    const mid = (cs[i].h + cs[i].l) / 2, A = atr[i] as number;
    const bu = mid + mult * A, bl = mid - mult * A;
    if (!init) { fu = bu; fl = bl; dir = cs[i].c >= mid ? "up" : "down"; init = true; continue; }
    const pc = cs[i - 1].c;
    const nfu = bu < fu || pc > fu ? bu : fu;
    const nfl = bl > fl || pc < fl ? bl : fl;
    if (dir === "up" && cs[i].c < nfl) dir = "down";
    else if (dir === "down" && cs[i].c > nfu) dir = "up";
    fu = nfu; fl = nfl;
  }
  return { dir, line: dir === "up" ? fl : fu };
}

export interface TrendState {
  supertrend: "up" | "down"; ema9: number; ema50: number; emaTrend: "up" | "down"; verdict: Sig | null;
  /** Rialzista: Supertrend su, EMA9 sopra EMA50 e nessun giudizio di vendita sugli indicatori. */
  bullish: boolean;
  /** Ribassista: Supertrend giu', EMA9 sotto EMA50 e nessun giudizio di acquisto sugli indicatori. */
  bearish: boolean;
}

/** Stato del trend su un timeframe: candele completate + prezzo live come ultima candela in formazione. */
export function trendState(completed: Candle[], live: number, asOf: string): TrendState | null {
  if (completed.length < 60 || !(live > 0)) return null;
  const prev = completed[completed.length - 1];
  const cs = [...completed, { t: asOf, o: prev.c, h: Math.max(prev.c, live), l: Math.min(prev.c, live), c: live }];
  const st = supertrendOf(cs);
  const cl = cs.map((c) => c.c);
  const e9 = last(emaSeries(cl, 9)), e50 = last(emaSeries(cl, 50));
  if (!st || e9 === null || e50 === null) return null;
  const verdict = techPanel(completed, live, null, asOf)?.signals.verdict ?? null;
  const emaTrend = e9 > e50 ? "up" : "down";
  return {
    supertrend: st.dir, ema9: e9, ema50: e50, emaTrend, verdict,
    bullish: st.dir === "up" && emaTrend === "up" && verdict !== "sell",
    bearish: st.dir === "down" && emaTrend === "down" && verdict !== "buy",
  };
}

/** Potenzialita' di acquisto di un titolo (da -100 a +100): segnali del giudizio giornaliero (circa 60%) e allineamento 30m/1h/4h (circa 40%). */
export function potentialScore(t: Tech | null, m: Mtf | null): number {
  if (!t) return -Infinity;
  return ((t.signals.buy - t.signals.sell) / 9) * 60 + (mtfSummary(m).alignment ?? 0) * 40;
}
