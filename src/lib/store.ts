import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_SETTINGS, type EventRec, type NewSuggestion, type NewTrade, type Settings, type Suggestion,
  type SuggStatus, type TradeRec, type WatchItem,
} from "./types";

export interface Store {
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  listWatchlist(): Promise<WatchItem[]>;
  upsertWatch(w: WatchItem): Promise<void>;
  removeWatch(symbol: string): Promise<void>;
  createSuggestion(s: NewSuggestion): Promise<Suggestion>;
  listSuggestions(statuses?: SuggStatus[], limit?: number): Promise<Suggestion[]>;
  getSuggestion(id: number): Promise<Suggestion | null>;
  updateSuggestion(id: number, patch: Partial<Suggestion>): Promise<void>;
  addTrade(t: NewTrade): Promise<void>;
  investedToday(day: string, origin: "manual" | "autopilot"): Promise<number>;
  recentTrades(limit: number): Promise<TradeRec[]>;
  tradesOfDay(day: string): Promise<TradeRec[]>;
  logEvent(type: string, payload: unknown): Promise<void>;
  recentEvents(limit: number): Promise<EventRec[]>;
  kvGet<T = unknown>(key: string): Promise<T | null>;
  kvSet(key: string, value: unknown): Promise<void>;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase (${what}): ${res.error.message}`);
  return res.data as T;
}

export class SupabaseStore implements Store {
  private db: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async getSettings(): Promise<Settings> {
    const r = await this.db.from("settings").select("data").eq("id", 1).maybeSingle();
    return { ...DEFAULT_SETTINGS, ...((must(r, "settings")?.data as Partial<Settings>) ?? {}) };
  }
  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...patch };
    must(await this.db.from("settings").upsert({ id: 1, data: next, updated_at: new Date().toISOString() }), "saveSettings");
    return next;
  }
  async listWatchlist(): Promise<WatchItem[]> {
    return must(await this.db.from("watchlist").select("*").order("symbol"), "watchlist") as WatchItem[];
  }
  async upsertWatch(w: WatchItem) {
    must(await this.db.from("watchlist").upsert({ symbol: w.symbol, instrument_id: w.instrument_id, name: w.name ?? null, active: w.active }), "upsertWatch");
  }
  async removeWatch(symbol: string) {
    must(await this.db.from("watchlist").delete().eq("symbol", symbol), "removeWatch");
  }
  async createSuggestion(s: NewSuggestion): Promise<Suggestion> {
    return must(await this.db.from("suggestions").insert(s).select().single(), "createSuggestion") as Suggestion;
  }
  async listSuggestions(statuses?: SuggStatus[], limit = 50): Promise<Suggestion[]> {
    let q = this.db.from("suggestions").select("*").order("created_at", { ascending: false }).limit(limit);
    if (statuses?.length) q = q.in("status", statuses);
    return must(await q, "listSuggestions") as Suggestion[];
  }
  async getSuggestion(id: number): Promise<Suggestion | null> {
    return (must(await this.db.from("suggestions").select("*").eq("id", id).maybeSingle(), "getSuggestion") as Suggestion | null) ?? null;
  }
  async updateSuggestion(id: number, patch: Partial<Suggestion>) {
    must(await this.db.from("suggestions").update(patch).eq("id", id), "updateSuggestion");
  }
  async addTrade(t: NewTrade) { must(await this.db.from("trades").insert(t), "addTrade"); }
  async investedToday(day: string, origin: "manual" | "autopilot"): Promise<number> {
    const rows = must(await this.db.from("trades").select("amount_usd").eq("day", day).eq("side", "buy").eq("origin", origin), "investedToday") as Array<{ amount_usd: number }>;
    return rows.reduce((s, r) => s + Number(r.amount_usd), 0);
  }
  async recentTrades(limit: number): Promise<TradeRec[]> {
    return must(await this.db.from("trades").select("*").order("ts", { ascending: false }).limit(limit), "recentTrades") as TradeRec[];
  }
  async tradesOfDay(day: string): Promise<TradeRec[]> {
    return must(await this.db.from("trades").select("*").eq("day", day).order("ts"), "tradesOfDay") as TradeRec[];
  }
  async logEvent(type: string, payload: unknown) { must(await this.db.from("events").insert({ type, payload }), "logEvent"); }
  async recentEvents(limit: number): Promise<EventRec[]> {
    return must(await this.db.from("events").select("*").order("ts", { ascending: false }).limit(limit), "recentEvents") as EventRec[];
  }
  async kvGet<T>(key: string): Promise<T | null> {
    const r = must(await this.db.from("kv").select("value").eq("key", key).maybeSingle(), "kvGet") as { value: T } | null;
    return r ? r.value : null;
  }
  async kvSet(key: string, value: unknown) {
    must(await this.db.from("kv").upsert({ key, value, updated_at: new Date().toISOString() }), "kvSet");
  }
}
