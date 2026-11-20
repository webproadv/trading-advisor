// Calendario e sessioni del mercato USA (ora di New York). Festivita' da NYSE (comunicato 23/12/2025).
const TZ = "America/New_York";

const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]); // chiusura 13:00 ET
export const CALENDAR_LAST_YEAR = 2027; // oltre questo anno il calendario va aggiornato

export interface EtParts { day: string; minutes: number; dow: number; year: number }

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(date: Date): EtParts { return partsIn(TZ, date); }

function partsIn(tz: string, date: Date): EtParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  const hh = Number(p.hour) % 24;
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: hh * 60 + Number(p.minute),
    dow: WD[p.weekday],
    year: Number(p.year),
  };
}

export type Session = "closed" | "premarket" | "regular" | "afterhours";

export interface SessionInfo { session: Session; day: string; tradingDay: boolean; minutes: number; calendarStale: boolean }

export function isTradingDay(e: EtParts): boolean {
  return e.dow !== 0 && e.dow !== 6 && !HOLIDAYS.has(e.day);
}

export function sessionOf(date: Date): SessionInfo {
  const e = etParts(date);
  const tradingDay = isTradingDay(e);
  const calendarStale = e.year > CALENDAR_LAST_YEAR;
  let session: Session = "closed";
  if (tradingDay) {
    const close = EARLY_CLOSE.has(e.day) ? 13 * 60 : 16 * 60;
    if (e.minutes >= 4 * 60 && e.minutes < 9 * 60 + 30) session = "premarket";
    else if (e.minutes >= 9 * 60 + 30 && e.minutes < close) session = "regular";
    else if (e.minutes >= close && e.minutes < 20 * 60) session = "afterhours";
  }
  return { session, day: e.day, tradingDay, minutes: e.minutes, calendarStale };
}

/** Scansioni "dovute": orario ET raggiunto da non piu' di windowMin minuti (recupero se un tick salta). */
export function dueScanSlots(times: string[], date: Date, windowMin = 120): string[] {
  const e = etParts(date);
  if (!isTradingDay(e)) return [];
  const out: string[] = [];
  for (const t of times) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) continue;
    const tm = Number(m[1]) * 60 + Number(m[2]);
    if (e.minutes >= tm && e.minutes < tm + windowMin) out.push(`${e.day}@${t}`);
  }
  return out;
}

export function isPremarketSlot(slot: string): boolean {
  const t = slot.split("@")[1] ?? "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return false;
  const tm = Number(m[1]) * 60 + Number(m[2]);
  if (slot.endsWith("@EU")) return tm >= 4 * 60 && tm < 9 * 60;
  return tm >= 4 * 60 && tm < 9 * 60 + 30;
}

export function etLabel(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date) + " ET";
}


// ------------------------------------------------------------------ Europa (ora di Roma/CET)
// Tutte le borse supportate (Milano, Madrid, Francoforte, Parigi, Amsterdam, Bruxelles, Lisbona, Vienna, Helsinki, Zurigo)
// negoziano 09:00-17:30 in ora CET. Calendario SEMPLIFICATO: si considera chiuso nei giorni in cui chiude almeno una di esse.
const TZ_EU = "Europe/Rome";
const EU_HOLIDAYS = new Set([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-24", "2026-12-25", "2026-12-31",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-12-24", "2027-12-31",
]);
const CH_EXTRA = new Set(["2026-01-02", "2026-05-14", "2026-05-25", "2027-05-06", "2027-05-17"]); // Zurigo (SIX)

export type Group = "US" | "EU";
export interface MarketInfo { group: Group; currency: string }
const EU_SUFFIX: Record<string, string> = {
  MI: "EUR", MC: "EUR", DE: "EUR", PA: "EUR", AS: "EUR", BR: "EUR", LS: "EUR", VI: "EUR", HE: "EUR", SW: "CHF",
};
export const EU_SUFFIXES = Object.keys(EU_SUFFIX);

/** Mercato di un simbolo eToro dal suffisso di borsa (ENI.MI, SAN.MC, BMW.DE...). Senza suffisso = USA. */
export function marketOf(symbol: string): MarketInfo {
  const m = /\.([A-Za-z]{1,3})$/.exec(symbol.trim());
  const cur = m ? EU_SUFFIX[m[1].toUpperCase()] : undefined;
  return cur ? { group: "EU", currency: cur } : { group: "US", currency: "USD" };
}

export function euSessionOf(date: Date, swiss = false): SessionInfo {
  const e = partsIn(TZ_EU, date);
  const tradingDay = e.dow !== 0 && e.dow !== 6 && !EU_HOLIDAYS.has(e.day) && !(swiss && CH_EXTRA.has(e.day));
  let session: Session = "closed";
  if (tradingDay) {
    if (e.minutes >= 8 * 60 && e.minutes < 9 * 60) session = "premarket"; // pre-apertura
    else if (e.minutes >= 9 * 60 && e.minutes < 17 * 60 + 30) session = "regular";
  }
  return { session, day: e.day, tradingDay, minutes: e.minutes, calendarStale: e.year > CALENDAR_LAST_YEAR };
}

/** Sessione del mercato su cui quota il simbolo. */
export function sessionFor(symbol: string, date: Date): SessionInfo {
  const m = marketOf(symbol);
  return m.group === "US" ? sessionOf(date) : euSessionOf(date, m.currency === "CHF");
}
export const isRegularFor = (symbol: string, date: Date) => sessionFor(symbol, date).session === "regular";

/** Giorno di calendario a Roma: base del tetto giornaliero di investimento (comune a USA ed Europa). */
export const romeDay = (date: Date) => partsIn(TZ_EU, date).day;

export function dueScanSlotsEu(times: string[], date: Date, windowMin = 120): string[] {
  const e = partsIn(TZ_EU, date);
  if (!euSessionOf(date).tradingDay) return [];
  const out: string[] = [];
  for (const t of times) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) continue;
    const tm = Number(m[1]) * 60 + Number(m[2]);
    if (e.minutes >= tm && e.minutes < tm + windowMin) out.push(`${e.day}@${t}@EU`);
  }
  return out;
}

/** Slot di scansione automatica ogni `interval` minuti: USA da premarket 08:00 ET alla chiusura, Europa da pre-apertura 08:00 alla chiusura. */
export function autoScanSlots(interval: number, date: Date): string[] {
  if (!(interval >= 1)) return [];
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const out: string[] = [];
  const us = sessionOf(date);
  if ((us.session === "premarket" || us.session === "regular") && us.minutes >= 8 * 60) out.push(`${us.day}@${hhmm(Math.floor(us.minutes / interval) * interval)}`);
  const eu = euSessionOf(date);
  if ((eu.session === "premarket" || eu.session === "regular") && eu.minutes >= 8 * 60) out.push(`${eu.day}@${hhmm(Math.floor(eu.minutes / interval) * interval)}@EU`);
  return out;
}

export const scopeOfSlot = (slot: string): Group => (slot.endsWith("@EU") ? "EU" : "US");

export function euLabel(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", { timeZone: TZ_EU, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) + " ora italiana";
}

/** La sessione successiva e' domani (non weekend ne' festivo)? Serve per gli acquisti "overnight": mai prima di un fine settimana o di un festivo. */
export function nextDayTrades(group: Group, date: Date, swiss = false): boolean {
  const t = new Date(date.getTime() + 24 * 3600_000);
  return group === "US" ? isTradingDay(etParts(t)) : euSessionOf(t, swiss).tradingDay;
}
