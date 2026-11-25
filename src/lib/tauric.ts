// Tauric (tauric.ai): notizie e sintesi AI per titoli USA, tramite API REST con chiave (TAURIC_API_KEY, lato server).
export interface TauricContext {
  headline: string | null;
  bullets: Array<{ text: string; polarity: string; event: string }>;
  watch: string[];
  news: Array<{ title: string; publisher: string; time: string; sentiment: string; impact: string }>;
  generatedAt: string | null;
}
export interface TauricLike { enabled: boolean; context(symbol: string): Promise<TauricContext | null> }

const BASE = "https://api.tauric.ai";

export class TauricClient implements TauricLike {
  enabled: boolean;
  constructor(private apiKey: string | undefined, private f: typeof fetch = fetch, private timeoutMs = 6000) { this.enabled = !!apiKey; }

  private async get(path: string): Promise<unknown | null> {
    const res = await this.f(`${BASE}${path}`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404 || res.status === 409) return null; // titolo non coperto o ambiguo
    if (!res.ok) throw new Error(`Tauric HTTP ${res.status}`);
    return res.json();
  }

  /** Sintesi notizie del titolo (digest AI) e ultimi articoli. Null se il titolo non e' coperto. */
  async context(symbol: string): Promise<TauricContext | null> {
    if (!this.apiKey) return null;
    const sym = encodeURIComponent(symbol);
    const [dg, nw] = await Promise.all([
      this.get(`/v1/securities/${sym}/digest`).catch(() => null),
      this.get(`/v1/news?instrument=${encodeURIComponent(`security:${symbol}`)}&limit=5`).catch(() => null),
    ]);
    return parseTauric(dg, nw);
  }
}

export function parseTauric(dg: unknown, nw: unknown): TauricContext | null {
  const c = ((dg ?? {}) as { content?: Record<string, unknown>; generated_at?: string }).content ?? {};
  const bullets = (Array.isArray(c.bullets) ? c.bullets : []).slice(0, 6).map((b) => {
    const x = b as Record<string, unknown>;
    return { text: String(x.text ?? "").slice(0, 280), polarity: String(x.polarity ?? "neutral"), event: String(x.event_type ?? "") };
  }).filter((b) => b.text);
  const news = (((nw ?? {}) as { data?: unknown[] }).data ?? []).slice(0, 5).map((a) => {
    const x = a as Record<string, unknown>; const an = (x.annotations ?? {}) as Record<string, unknown>;
    return { title: String(x.title ?? "").slice(0, 160), publisher: String(x.publisher ?? ""), time: String(x.article_time ?? ""), sentiment: String(an.sentiment ?? ""), impact: String(an.impact ?? "") };
  }).filter((a) => a.title);
  if (!bullets.length && !news.length && !c.headline) return null;
  return {
    headline: typeof c.headline === "string" ? c.headline.slice(0, 200) : null, bullets,
    watch: (Array.isArray(c.watch_items) ? c.watch_items : []).slice(0, 3).map((w) => String(w).slice(0, 200)),
    news, generatedAt: (dg as { generated_at?: string } | null)?.generated_at ?? null,
  };
}
