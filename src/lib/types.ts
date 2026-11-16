export type Mode = "advisor" | "autopilot";
export type Side = "buy" | "sell";
export type SuggStatus = "pending" | "approved" | "rejected" | "executed" | "expired" | "failed";

export interface Settings {
  mode: Mode;                       // advisor = decidi tu; autopilot = opero io entro i limiti
  kill_switch: boolean;             // blocca ogni operazione automatica
  max_daily_invest_usd: number;     // massimo investito dall'autopilot in un giorno (USD)
  take_profit_pct: number;          // soglia di guadagno per vendere (%)
  stop_loss_pct: number;            // soglia di perdita per vendere (%)
  buy_margin_pct: number;           // margine per comprare: upside minimo stimato verso il target (%)
  max_position_usd: number;         // importo massimo per singola operazione
  max_open_positions: number;
  min_confidence: number;           // fiducia minima (0-100) per l'autopilot
  auto_follow_sell_ideas: boolean;  // l'autopilot vende anche su idee di vendita (non solo soglie)
  scan_interval_min: number;        // scansione automatica con Claude ogni N minuti (0 = solo orari fissi)
  scan_times: string[];             // orari "HH:MM" (ora di New York), giorni di borsa USA
  scan_times_eu: string[];          // orari "HH:MM" (ora italiana), giorni di borsa europei
  alerts_enabled: boolean;
  allow_discovery: boolean;         // Claude puo' proporre titoli fuori dalla watchlist
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "advisor",
  kill_switch: false,
  max_daily_invest_usd: 300,
  take_profit_pct: 10,
  stop_loss_pct: 5,
  buy_margin_pct: 8,
  max_position_usd: 150,
  max_open_positions: 5,
  min_confidence: 70,
  auto_follow_sell_ideas: false,
  scan_interval_min: 15,
  scan_times: ["08:00", "10:00", "14:00"],
  scan_times_eu: ["08:30", "11:00", "15:00"],
  alerts_enabled: true,
  allow_discovery: true,
};

export interface WatchItem { symbol: string; instrument_id: number; name?: string | null; active: boolean }

export interface SourceRef { title: string; url: string }

export interface NewSuggestion {
  symbol: string; instrument_id: number; side: Side; units: number; amount_usd: number;
  price_ref: number; target_price: number | null; stop_price: number | null; confidence: number;
  rationale: string; sources: SourceRef[]; origin: "scan" | "monitor"; expires_at: string;
}
export interface Suggestion extends NewSuggestion {
  id: number; created_at: string; status: SuggStatus; executed_at?: string | null; result?: unknown;
}

export interface NewTrade {
  day: string; symbol: string; instrument_id: number; side: Side; amount_usd: number; units: number | null;
  price: number | null; position_id: string | null; origin: "manual" | "autopilot"; suggestion_id: number | null;
  note?: string; pnl_usd?: number | null;
}
export interface TradeRec extends NewTrade { id: number; ts: string }
export interface EventRec { id: number; ts: string; type: string; payload: unknown }

export interface Candle { t: string; o: number; h: number; l: number; c: number }
export interface Rate { bid: number; ask: number }
export interface Position {
  positionId: string; instrumentId: number; openRate: number; amount: number; units: number | null;
  isBuy: boolean; openDateTime?: string;
}
export interface Portfolio { cash: number | null; positions: Position[] }
export interface OpenResult { positionId?: string; orderId?: string; price?: number }
