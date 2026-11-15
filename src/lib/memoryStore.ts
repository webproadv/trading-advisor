// Store in memoria: usato nei test e per provare la logica senza database.
import type { Store } from "./store";
import {
  DEFAULT_SETTINGS, type EventRec, type NewSuggestion, type NewTrade, type Settings, type Suggestion,
  type SuggStatus, type TradeRec, type WatchItem,
} from "./types";

export class MemoryStore implements Store {
  settings: Settings = { ...DEFAULT_SETTINGS };
  watch = new Map<string, WatchItem>();
  suggestions: Suggestion[] = [];
  trades: TradeRec[] = [];
  events: EventRec[] = [];
  kv = new Map<string, unknown>();
  private seq = 1;

  async getSettings() { return { ...this.settings }; }
  async saveSettings(p: Partial<Settings>) { this.settings = { ...this.settings, ...p }; return { ...this.settings }; }
  async listWatchlist() { return [...this.watch.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)); }
  async upsertWatch(w: WatchItem) { this.watch.set(w.symbol, { ...w }); }
  async removeWatch(symbol: string) { this.watch.delete(symbol); }
  async createSuggestion(s: NewSuggestion): Promise<Suggestion> {
    const full: Suggestion = { ...s, id: this.seq++, created_at: new Date().toISOString(), status: "pending", executed_at: null };
    this.suggestions.unshift(full);
    return { ...full };
  }
  async listSuggestions(statuses?: SuggStatus[], limit = 50) {
    return this.suggestions.filter((s) => !statuses?.length || statuses.includes(s.status)).slice(0, limit).map((s) => ({ ...s }));
  }
  async getSuggestion(id: number) { const s = this.suggestions.find((x) => x.id === id); return s ? { ...s } : null; }
  async updateSuggestion(id: number, patch: Partial<Suggestion>) {
    const s = this.suggestions.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
  }
  async addTrade(t: NewTrade) { this.trades.unshift({ ...t, id: this.seq++, ts: new Date().toISOString() }); }
  async investedToday(day: string, origin: "manual" | "autopilot") {
    return this.trades.filter((t) => t.day === day && t.side === "buy" && t.origin === origin).reduce((s, t) => s + t.amount_usd, 0);
  }
  async recentTrades(limit: number) { return this.trades.slice(0, limit); }
  async tradesOfDay(day: string) { return this.trades.filter((t) => t.day === day); }
  async logEvent(type: string, payload: unknown) { this.events.unshift({ id: this.seq++, ts: new Date().toISOString(), type, payload }); }
  async recentEvents(limit: number) { return this.events.slice(0, limit); }
  async kvGet<T>(key: string) { return (this.kv.has(key) ? (this.kv.get(key) as T) : null); }
  async kvSet(key: string, value: unknown) { this.kv.set(key, value); }
}
