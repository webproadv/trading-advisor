// Cambio valuta -> USD (BCE tramite frankfurter.dev), con cache e ripiego sull'ultimo valore noto.
import type { Store } from "./store";

const TTL_MS = 6 * 3600_000;
const STALE_MAX_MS = 5 * 86400_000;

export async function usdPer(currency: string, store: Store, now: Date, f: typeof fetch = fetch): Promise<number> {
  if (currency === "USD") return 1;
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`valuta non valida: ${currency}`);
  const key = `fx:${currency}`;
  const cached = await store.kvGet<{ rate: number; ts: string }>(key);
  const age = cached ? now.getTime() - new Date(cached.ts).getTime() : Infinity;
  if (cached && age < TTL_MS) return cached.rate;
  try {
    const res = await f(`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=USD`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rate = ((await res.json()) as { rates?: { USD?: number } }).rates?.USD;
    if (typeof rate !== "number" || !(rate > 0.2 && rate < 5)) throw new Error("cambio fuori range");
    await store.kvSet(key, { rate, ts: now.toISOString() });
    return rate;
  } catch (e) {
    if (cached && age < STALE_MAX_MS) return cached.rate; // meglio un cambio di ieri che bloccare le operazioni
    throw new Error(`cambio ${currency}/USD non disponibile (${(e as Error).message})`);
  }
}
