import { marketOf } from "./time";
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Dollari con il simbolo davanti: $1.234,56 / -$8,64 (non "1.234,56 USD"). */
export function usd(n: number | null | undefined): string {
  return money(n, "USD");
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/d";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function num(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/d";
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits }).format(n);
}

/** Escape per Telegram parse_mode=HTML. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

const SYM: Record<string, string> = { USD: "$", EUR: "€", CHF: "CHF " };
/** Numero con simbolo di valuta SEMPRE davanti: $1.234,56 · €14,20 · CHF 9,10 · -€3,00. */
export function money(n: number | null | undefined, currency: string, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/d";
  const body = new Intl.NumberFormat("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: "always" }).format(Math.abs(n));
  const neg = n < 0 && Math.abs(n) >= 0.5 * 10 ** -digits;
  return `${neg ? "-" : ""}${SYM[currency] ?? `${currency} `}${body}`;
}

/** Prezzo di un titolo nella sua valuta di quotazione (USD, EUR, CHF), simbolo davanti. */
export function fmtPrice(symbol: string, n: number | null | undefined): string {
  return money(n, marketOf(symbol).currency);
}
