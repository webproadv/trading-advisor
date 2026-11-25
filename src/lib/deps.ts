import { ClaudeAnalyst } from "./claude";
import type { Deps } from "./engine";
import { EtoroClient } from "./etoro";
import { usdPer } from "./fx";
import { SupabaseStore } from "./store";
import { TauricClient } from "./tauric";
import { Telegram, parseChatIds } from "./telegram";

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
  const extra = process.env.TELEGRAM_BOT_TOKEN_2 ? [{ token: process.env.TELEGRAM_BOT_TOKEN_2, chatIds: parseChatIds(process.env.TELEGRAM_CHAT_ID_2) }] : [];
  return new Telegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, fetch, extra);
}
export function makeDeps(): Deps {
  const store = makeStore();
  return {
    store,
    fx: (currency: string) => usdPer(currency, store, new Date()),
    etoro: makeEtoro(),
    tg: (() => { const t = makeTelegram(); t.onFail = (i) => { void store.logEvent("telegram_send_failed", i).catch(() => undefined); }; return t; })(),
    claude: new ClaudeAnalyst(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL || "claude-haiku-5-5"),
    tauric: new TauricClient(process.env.TAURIC_API_KEY),
    now: () => new Date(),
  };
}
