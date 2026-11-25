import type { Settings } from "./types";
import { round2, round4 } from "./format";

export const MIN_ORDER_USD = 10;

export interface SizeInput {
  settings: Settings; price: number; cash: number | null; investedToday: number; openCount: number;
}
export interface SizeResult { amount: number; units: number; reasons: string[] }

/** Importo proposto per un acquisto, rispettando limiti di posizione, giornalieri e giacenza. */
export function sizeBuy(i: SizeInput): SizeResult {
  const reasons: string[] = [];
  const dailyLeft = Math.max(0, i.settings.max_daily_invest_usd - i.investedToday);
  const cashCap = i.cash === null ? Infinity : Math.max(0, i.cash * 0.98);
  let amount = Math.min(i.settings.max_position_usd, dailyLeft, cashCap);
  if (dailyLeft < MIN_ORDER_USD) reasons.push("limite giornaliero di investimento esaurito");
  if (cashCap < MIN_ORDER_USD) reasons.push("giacenza insufficiente");
  if (i.openCount >= i.settings.max_open_positions) reasons.push("numero massimo di posizioni aperte raggiunto");
  amount = Math.floor(amount * 100) / 100;
  if (amount < MIN_ORDER_USD && reasons.length === 0) reasons.push(`importo sotto il minimo di $${MIN_ORDER_USD}`);
  if (!Number.isFinite(i.price) || i.price <= 0) reasons.push("prezzo non valido");
  const units = i.price > 0 ? round4(amount / i.price) : 0;
  return { amount: round2(amount), units, reasons };
}

export function upsidePct(target: number | null, price: number): number | null {
  if (target === null || !(price > 0)) return null;
  return (target / price - 1) * 100;
}

export type ExitReason = "stop_loss" | "take_profit";

/** Uscita per soglie di perdita/guadagno sul prezzo di acquisto (solo posizioni long). */
export function exitDecision(openRate: number, bid: number, s: Pick<Settings, "stop_loss_pct" | "take_profit_pct">): ExitReason | null {
  if (!(openRate > 0) || !(bid > 0)) return null;
  const chg = (bid / openRate - 1) * 100;
  if (chg <= -Math.abs(s.stop_loss_pct)) return "stop_loss";
  if (s.take_profit_pct > 0 && chg >= s.take_profit_pct) return "take_profit";
  return null;
}

export function validateSettings(s: Settings): string[] {
  const e: string[] = [];
  if (!["advisor", "autopilot"].includes(s.mode)) e.push("modalita' non valida");
  const pos = (v: number, n: string) => { if (!(typeof v === "number" && Number.isFinite(v) && v >= 0)) e.push(`${n} non valido`); };
  pos(s.max_daily_invest_usd, "massimo giornaliero"); pos(s.take_profit_pct, "soglia di guadagno");
  pos(s.stop_loss_pct, "soglia di perdita"); pos(s.buy_margin_pct, "margine di acquisto");
  pos(s.max_position_usd, "importo massimo per operazione"); pos(s.max_open_positions, "posizioni massime");
  if (!(s.stop_loss_pct > 0 && s.stop_loss_pct < 100)) e.push("la soglia di perdita deve essere tra 0 e 100 (e' obbligatoria)");
  if (s.max_position_usd > s.max_daily_invest_usd && s.max_daily_invest_usd > 0) e.push("l'importo per operazione supera il massimo giornaliero");
  if (!(s.min_confidence >= 0 && s.min_confidence <= 100)) e.push("fiducia minima tra 0 e 100");
  if (!(s.start_equity >= 0 && s.start_equity <= 1e9)) e.push("capitale iniziale: valore non valido");
  pos(s.trend_exit_min_profit_usd, "profitto minimo per l'uscita su trend"); pos(s.max_overnight_usd, "massimo overnight");
  if (!(Number.isInteger(s.rotation_count) && s.rotation_count >= 0 && s.rotation_count <= 200)) e.push("rotazione: numero di titoli tra 0 (tutti) e 200");
  if (!(Number.isInteger(s.rotation_interval_min) && s.rotation_interval_min >= 5 && s.rotation_interval_min <= 480)) e.push("rotazione: intervallo tra 5 e 480 minuti");
  if (!(s.rotation_target_pct > 0 && s.rotation_target_pct <= 50)) e.push("rotazione: guadagno obiettivo tra 0 e 50%");
  if (!(typeof s.min_reward_risk === "number" && s.min_reward_risk >= 0 && s.min_reward_risk <= 20)) e.push("rapporto guadagno/perdita minimo tra 0 e 20");
  else if (s.min_reward_risk > 0 && s.stop_loss_pct > 0) {
    const need = s.stop_loss_pct * s.min_reward_risk;
    if (s.rotation_target_pct + 1e-9 < need) e.push(`rotazione: il guadagno obiettivo (${s.rotation_target_pct}%) deve essere almeno ${need}% (${s.min_reward_risk} volte la perdita massima ${s.stop_loss_pct}%)`);
    if (s.take_profit_pct > 0 && s.take_profit_pct + 1e-9 < need) e.push(`la soglia di guadagno (${s.take_profit_pct}%) deve essere almeno ${need}% (${s.min_reward_risk} volte la perdita massima ${s.stop_loss_pct}%)`);
  }
  if (!(typeof s.max_daily_loss_eur === "number" && s.max_daily_loss_eur >= 0 && s.max_daily_loss_eur <= 1e7)) e.push("perdita giornaliera massima non valida");
  if (!(Number.isInteger(s.scan_interval_min) && (s.scan_interval_min === 0 || (s.scan_interval_min >= 5 && s.scan_interval_min <= 240)))) e.push("intervallo di scansione: 0 oppure tra 5 e 240 minuti");
  const hm = (v: unknown) => typeof v === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v);
  const mins = (v: string) => Number(v.split(":")[0]) * 60 + Number(v.split(":")[1]);
  if (!hm(s.scan_us_from) || !hm(s.scan_us_to) || !hm(s.scan_eu_from) || !hm(s.scan_eu_to)) e.push("finestre di scansione non valide (HH:MM)");
  else if (mins(s.scan_us_from) > mins(s.scan_us_to) || mins(s.scan_eu_from) > mins(s.scan_eu_to)) e.push("finestre di scansione: l'ora di inizio deve precedere quella di fine");
  const okTimes = (a: unknown) => Array.isArray(a) && a.every((t) => typeof t === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t));
  if (!okTimes(s.scan_times) || !okTimes(s.scan_times_eu)) e.push("orari scansione non validi (HH:MM)");
  return e;
}
