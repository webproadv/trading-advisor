// Punteggio di fiducia (0-100) calcolato dai dati quantitativi: trend, 9 indicatori, ADX, RSI, MACD, pivot,
// rapporto rischio/rendimento e volatilita'. Serve a sostituire il valore fisso 50 delle idee da regole
// e a correggere (non sostituire) la fiducia dichiarata da Claude.
import type { Analysis, Tech } from "./indicators";

export interface ConfInput {
  side: "buy" | "sell";
  price: number;
  target: number | null;
  stop: number | null;
  analysis: Analysis | null;
  tech: Tech | null;
  /** P/L % della posizione (solo vendite). */
  pnlPct?: number | null;
  takeProfitPct?: number;
  stopLossPct?: number;
}
export interface ConfResult { score: number; parts: Array<{ label: string; pts: number; max: number }>; usable: boolean }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function quantConfidence(i: ConfInput): ConfResult {
  const { analysis: a, tech: t } = i;
  const parts: ConfResult["parts"] = [];
  const add = (label: string, pts: number, max: number) => parts.push({ label, pts: Math.round(pts * 10) / 10, max });
  if (!a && !t) return { score: 0, parts, usable: false };
  const buy = i.side === "buy";

  // 1) trend giornaliero (medie 20/50)
  const trendPts = !a ? 8 : buy ? (a.trend === "up" ? 20 : a.trend === "flat" ? 8 : 0) : (a.trend === "down" ? 20 : a.trend === "flat" ? 8 : 0);
  add("trend", trendPts, 20);

  // 2) voti dei 9 indicatori
  if (t) {
    const net = (buy ? 1 : -1) * (t.signals.buy - t.signals.sell);
    add("indicatori", clamp(12.5 + net * 1.4, 0, 25), 25);
  } else add("indicatori", 12.5, 25);

  // 3) forza del trend (ADX) nella direzione dell'idea
  let adxPts = 4;
  if (t && t.adx !== null && t.plusDI !== null && t.minusDI !== null && t.adx > 25) {
    const dirOk = buy ? t.plusDI > t.minusDI : t.minusDI > t.plusDI;
    adxPts = dirOk ? 10 : 0;
  }
  add("forza trend", adxPts, 10);

  // 4) RSI
  const r = t?.rsi14 ?? a?.rsi14 ?? null;
  let rsiPts = 4;
  if (r !== null) {
    if (buy) rsiPts = r >= 40 && r <= 60 ? 8 : r >= 30 && r < 40 ? 6 : r > 60 && r <= 70 ? 4 : r < 30 ? 3 : 0;
    else rsiPts = r > 70 ? 8 : r > 60 ? 6 : r >= 40 ? 3 : 0;
  }
  add("RSI", rsiPts, 8);

  // 5) MACD
  const h = t?.macdHist ?? null;
  add("MACD", h === null ? 3 : (buy ? h > 0 : h < 0) ? 7 : 0, 7);

  // 6) prezzo rispetto al pivot
  const p = t?.pivots?.p ?? null;
  add("pivot", p === null ? 2 : (buy ? i.price > p : i.price < p) ? 5 : 0, 5);

  if (buy) {
    // 7) rischio/rendimento (stop mancante: 2 x ATR)
    const atr = t?.atr14 ?? null;
    const stop = i.stop && i.stop < i.price ? i.stop : atr ? i.price - 2 * atr : null;
    let rrPts = 0;
    if (i.target && stop && i.target > i.price) {
      const rr = (i.target - i.price) / (i.price - stop);
      rrPts = rr >= 3 ? 15 : rr >= 2 ? 11 : rr >= 1.5 ? 7 : rr >= 1 ? 3 : 0;
    }
    add("rischio/rendimento", rrPts, 15);
    // 8) volatilita': target dentro il rumore giornaliero = poco credibile
    const ap = t?.atrPct ?? null;
    let volPts = 2;
    if (ap !== null) {
      volPts = ap < 4 ? 5 : ap < 8 ? 2 : 0;
      if (i.target && i.price > 0 && ((i.target / i.price - 1) * 100) < 1.5 * ap) volPts -= 5;
    }
    add("volatilita'", volPts, 5);
  } else {
    // 7) vendita: gestione del capitale (guadagno da incassare o perdita da limitare)
    const pnl = i.pnlPct ?? null;
    let capPts = 0;
    if (pnl !== null) {
      if (i.takeProfitPct && pnl >= i.takeProfitPct * 0.7) capPts = 10;
      else if (i.stopLossPct && pnl <= -i.stopLossPct * 0.5) capPts = 10;
      else if (pnl > 0) capPts = 4;
    }
    add("capitale", capPts, 10);
  }

  const max = parts.reduce((s, x) => s + x.max, 0);
  const sum = parts.reduce((s, x) => s + x.pts, 0);
  return { score: Math.round(clamp((sum / max) * 100, 0, 100)), parts, usable: true };
}

export interface Blended { confidence: number; note: string }

/**
 * Fiducia finale. Con analisi di Claude: media tra la sua fiducia e quella quantitativa (se in forte contrasto lo segnala).
 * Solo regole (nessuna lettura di notizie): vale la fiducia quantitativa, con tetto 65 — sotto la soglia di default dell'autopilot (70).
 */
export function blendConfidence(claudeConf: number | null, q: ConfResult, ruleOnly: boolean): Blended {
  const detail = q.parts.map((x) => `${x.label} ${x.pts}/${x.max}`).join(", ");
  if (!q.usable) return { confidence: claudeConf ?? 40, note: "Fiducia: indicatori tecnici non disponibili." };
  if (ruleOnly || claudeConf === null) {
    const c = Math.min(65, q.score);
    return { confidence: c, note: `Fiducia ${c}/100 da regole tecniche (tetto 65 senza lettura di notizie): ${detail}.` };
  }
  const c = Math.round(0.5 * claudeConf + 0.5 * q.score);
  const clash = Math.abs(claudeConf - q.score) > 35 ? " ATTENZIONE: analisi di Claude e indicatori tecnici in forte contrasto." : "";
  return { confidence: c, note: `Fiducia ${c}/100 = media tra Claude (${claudeConf}) e indicatori (${q.score}: ${detail}).${clash}` };
}
