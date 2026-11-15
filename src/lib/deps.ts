import { ClaudeAnalyst } from "./claude";
import type { Deps } from "./engine";
import { EtoroClient } from "./etoro";
import { SupabaseStore } from "./store";
import { Telegram } from "./telegram";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

export function makeStore() {
  return new SupabaseStore(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"));
}
export function makeEtoro() {
  return new EtoroClient(need("ETORO_API_KEY"), need("ETORO_USER_KEY"));
}
export function makeTelegram() {
  return new Telegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
}
export function makeDeps(): Deps {
  return {
    store: makeStore(),
    etoro: makeEtoro(),
    tg: makeTelegram(),
    claude: new ClaudeAnalyst(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"),
    now: () => new Date(),
  };
}
