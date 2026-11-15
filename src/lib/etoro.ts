// Client eToro SOLO DEMO. Nessun endpoint del conto reale e' presente in questo file.
import type { Candle, OpenResult, Portfolio, Position, Rate } from "./types";

const BASE = "https://public-api.etoro.com";

export class EtoroError extends Error {
  constructor(msg: string, public status?: number) { super(msg); }
}

// ---------- parsing tollerante (l'API usa sia instrumentId sia instrumentID) ----------
type Json = unknown;

export function* walk(o: Json): Generator<Record<string, Json>> {
  if (Array.isArray(o)) { for (const v of o) yield* walk(v); }
  else if (o && typeof o === "object") {
    yield o as Record<string, Json>;
    for (const v of Object.values(o as Record<string, Json>)) yield* walk(v);
  }
}

export function getk(d: Record<string, Json>, ...names: string[]): Json {
  const low: Record<string, Json> = {};
  for (const [k, v] of Object.entries(d)) low[k.toLowerCase()] = v;
  for (const n of names) {
    const v = low[n.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export function findValue(o: Json, ...names: string[]): Json {
  for (const d of walk(o)) {
    const v = getk(d, ...names);
    if (v !== undefined) return v;
  }
  return undefined;
}

const numOrNull = (v: Json): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function parseCandles(resp: Json): Candle[] {
  const seen = new Set<string>();
  const out: Candle[] = [];
  for (const d of walk(resp)) {
    const t = getk(d, "fromDate");
    const c = numOrNull(getk(d, "close"));
    if (typeof t !== "string" || c === null || seen.has(t)) continue;
    seen.add(t);
    out.push({ t, o: numOrNull(getk(d, "open")) ?? c, h: numOrNull(getk(d, "high")) ?? c, l: numOrNull(getk(d, "low")) ?? c, c });
  }
  return out.sort((a, b) => (a.t < b.t ? -1 : 1));
}

export function parseRates(resp: Json): Record<number, Rate> {
  const out: Record<number, Rate> = {};
  for (const d of walk(resp)) {
    const id = numOrNull(getk(d, "instrumentID"));
    const bid = numOrNull(getk(d, "bid"));
    const ask = numOrNull(getk(d, "ask"));
    if (id !== null && bid !== null && ask !== null) out[id] = { bid, ask };
  }
  return out;
}

/** Portafoglio demo: giacenza ("credit") e posizioni proprie (escluse quelle di copy trading). */
export function parsePortfolio(resp: Json): Portfolio {
  const found = new Map<string, Position>();
  for (const d of walk(resp)) {
    const pid = getk(d, "positionId");
    const iid = numOrNull(getk(d, "instrumentId"));
    if (pid === undefined || iid === null) continue;
    const mirror = getk(d, "mirrorId");
    if (mirror) continue;
    const openRate = numOrNull(getk(d, "openRate"));
    const amount = numOrNull(getk(d, "amount"));
    if (openRate === null || amount === null) continue;
    found.set(String(pid), {
      positionId: String(pid), instrumentId: iid, openRate, amount,
      units: numOrNull(getk(d, "units")), isBuy: getk(d, "isBuy") !== false,
      openDateTime: typeof getk(d, "openDateTime") === "string" ? (getk(d, "openDateTime") as string) : undefined,
    });
  }
  return { cash: numOrNull(findValue(resp, "credit")), positions: [...found.values()] };
}

export function parseSearch(resp: Json, symbol: string): { instrumentId: number; symbol: string; name?: string } | null {
  const want = symbol.toUpperCase();
  for (const d of walk(resp)) {
    const id = numOrNull(getk(d, "instrumentId"));
    if (id === null) continue;
    const syms = Object.entries(d)
      .filter(([k, v]) => /symbol/i.test(k) && typeof v === "string")
      .map(([, v]) => (v as string).toUpperCase());
    const nameVal = getk(d, "displayName", "instrumentDisplayName", "name");
    const name = typeof nameVal === "string" ? nameVal : undefined;
    if (syms.includes(want)) return { instrumentId: id, symbol: want, name };
  }
  return null; // senza corrispondenza esatta del simbolo non si indovina
}

export function parseOpen(resp: Json): OpenResult {
  const pid = findValue(resp, "positionId");
  const oid = findValue(resp, "orderId");
  const px = numOrNull(findValue(resp, "executionPrice"));
  return { positionId: pid !== undefined ? String(pid) : undefined, orderId: oid !== undefined ? String(oid) : undefined, price: px ?? undefined };
}

// ---------- client ----------
export class EtoroClient {
  constructor(
    private apiKey: string,
    private userKey: string,
    private f: typeof fetch = fetch,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private timeoutMs = 15000,
  ) {
    if (!apiKey || !userKey) throw new EtoroError("Mancano ETORO_API_KEY / ETORO_USER_KEY");
  }

  private async req(method: "GET" | "POST", path: string, opts: { params?: Record<string, string>; body?: unknown } = {}): Promise<Json> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
    const retries = 3;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let r: Response;
      try {
        r = await this.f(url.toString(), {
          method,
          headers: {
            "x-api-key": this.apiKey, "x-user-key": this.userKey,
            "x-request-id": crypto.randomUUID(), "Content-Type": "application/json",
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        // un POST andato in timeout puo' essere stato eseguito: mai ritentarlo
        if (method === "GET" && attempt < retries) { await this.sleep(2 ** attempt * 500); continue; }
        throw new EtoroError(`errore di rete ${method} ${path}: ${(e as Error).message}`);
      }
      if (r.status === 429 && attempt < retries) {
        const ra = Number(r.headers.get("Retry-After"));
        await this.sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2 ** attempt * 1000, 20000));
        continue;
      }
      if (r.status >= 500 && method === "GET" && attempt < retries) { await this.sleep(2 ** attempt * 500); continue; }
      const text = await r.text();
      if (!r.ok) throw new EtoroError(`${method} ${path} -> HTTP ${r.status}: ${text.slice(0, 300)}`, r.status);
      try { return text ? JSON.parse(text) : {}; } catch { return { _raw: text }; }
    }
    throw new EtoroError(`${method} ${path}: troppi tentativi`);
  }

  async rates(ids: number[]): Promise<Record<number, Rate>> {
    if (!ids.length) return {};
    const out: Record<number, Rate> = {};
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      Object.assign(out, parseRates(await this.req("GET", "/api/v1/market-data/instruments/rates", { params: { instrumentIds: chunk.join(",") } })));
    }
    return out;
  }

  async candles(id: number, interval: string, count: number): Promise<Candle[]> {
    return parseCandles(await this.req("GET", `/api/v1/market-data/instruments/${id}/history/candles/asc/${interval}/${count}`));
  }

  async search(symbol: string) {
    return parseSearch(await this.req("GET", "/api/v1/market-data/search", { params: { internalSymbolFull: symbol.toUpperCase() } }), symbol);
  }

  async portfolioRaw(): Promise<Json> { return this.req("GET", "/api/v1/trading/info/demo/portfolio"); }
  async portfolio(): Promise<Portfolio> { return parsePortfolio(await this.portfolioRaw()); }

  async openBuy(instrumentId: number, amountUsd: number): Promise<OpenResult> {
    return parseOpen(await this.req("POST", "/api/v2/trading/execution/demo/orders", {
      body: { action: "open", transaction: "buy", instrumentId, orderType: "mkt", amount: amountUsd, orderCurrency: "usd", leverage: 1 },
    }));
  }

  async close(positionId: string | number, instrumentId: number, unitsToDeduct: number | null = null): Promise<void> {
    await this.req("POST", `/api/v1/trading/execution/demo/market-close-orders/positions/${positionId}`, {
      body: { InstrumentId: instrumentId, UnitsToDeduct: unitsToDeduct },
    });
  }
}

export type EtoroLike = Pick<EtoroClient, "rates" | "candles" | "search" | "portfolio" | "openBuy" | "close">;
