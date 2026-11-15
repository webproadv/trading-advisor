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

export function etParts(date: Date): EtParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
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
  return tm >= 4 * 60 && tm < 9 * 60 + 30;
}

export function etLabel(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date) + " ET";
}
