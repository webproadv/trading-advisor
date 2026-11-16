import { marketOf } from "./time";
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Dollari con il simbolo davanti: $1.234,56 / -$8,64 (non "1.234,56 USD"). */
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/d";
  const body = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n < 0 && Math.abs(n) >= 0.005 ? "-" : ""}$${body}`;
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

/** Prezzo di un titolo nella sua valuta di quotazione (USD, EUR, CHF). */
export function fmtPrice(symbol: string, n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/d";
  const cur = marketOf(symbol).currency;
  if (cur === "USD") return usd(n);
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: cur }).format(n);
}
