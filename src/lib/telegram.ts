export interface Button { text: string; data: string }

export interface TelegramLike {
  enabled: boolean;
  send(html: string, buttons?: Button[][]): Promise<void>;
  answer(callbackId: string, text: string): Promise<void>;
  edit(chatId: string | number, messageId: number, html: string): Promise<void>;
}

export const parseChatIds = (v: string | undefined | null): string[] => (v ?? "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

export interface Bot { token: string; chatIds: string[] }

export class Telegram implements TelegramLike {
  enabled: boolean;
  private bots: Bot[];
  private origin = 0;
  /** Bot principale + eventuali bot aggiuntivi. Ogni chatId puo' contenere piu' chat separate da virgola. */
  constructor(token: string | undefined, chatId: string | undefined, private f: typeof fetch = fetch, extra: Bot[] = []) {
    const all: Bot[] = [{ token: token ?? "", chatIds: parseChatIds(chatId) }, ...extra];
    this.bots = all; // l'indice resta stabile: 0 = principale, 1 = secondo bot
    this.enabled = this.bots.some((b) => b.token && b.chatIds.length > 0);
  }

  /** Stessa istanza ma con risposte/modifiche dei pulsanti sul bot da cui e' arrivato l'aggiornamento (0 = principale). */
  forBot(index: number): Telegram {
    const t = Object.create(this) as Telegram;
    t.origin = index;
    return t;
  }

  private async call(method: string, body: unknown, token?: string): Promise<unknown> {
    const r = await this.f(`https://api.telegram.org/bot${token ?? this.bots[this.origin]?.token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!r.ok || j.ok === false) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
    return j;
  }

  /** Chiamata per ogni invio fallito verso una singola chat (es. per il registro eventi). */
  onFail?: (info: { bot: number; chat: string; error: string }) => void;

  /** Invia a tutte le chat e restituisce l'esito di ciascuna. */
  async sendDetailed(html: string, buttons?: Button[][]): Promise<Array<{ bot: number; chat: string; ok: boolean; error?: string }>> {
    const reply_markup = buttons ? { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } : undefined;
    const jobs = this.bots.flatMap((b, i) => (b.token ? b.chatIds : []).map(async (chat) => {
      try {
        await this.call("sendMessage", { chat_id: chat, text: html.slice(0, 3900), parse_mode: "HTML", disable_web_page_preview: true, reply_markup }, b.token);
        return { bot: i + 1, chat, ok: true };
      } catch (e) {
        const error = (e as Error).message.replace(/bot\d+:[\w-]+/g, "bot***");
        this.onFail?.({ bot: i + 1, chat, error });
        return { bot: i + 1, chat, ok: false, error };
      }
    }));
    return Promise.all(jobs);
  }

  async send(html: string, buttons?: Button[][]) {
    if (!this.enabled) return;
    const res = await this.sendDetailed(html, buttons);
    if (res.length && res.every((r) => !r.ok)) throw new Error(res[0].error); // errore solo se non arriva a nessuna chat
  }

  async answer(callbackId: string, text: string) {
    if (!this.enabled) return;
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190) });
  }

  async edit(chatId: string | number, messageId: number, html: string) {
    if (!this.enabled) return;
    await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text: html.slice(0, 3900), parse_mode: "HTML", disable_web_page_preview: true });
  }

  /** Collega i webhook di tutti i bot: il principale su /webhook, gli altri su /webhook?bot=N. */
  async setWebhooks(baseUrl: string, secret: string) {
    if (!this.enabled) throw new Error("TELEGRAM_BOT_TOKEN mancante");
    for (const [i, b] of this.bots.entries()) {
      if (!b.token) continue;
      await this.call("setWebhook", { url: i === 0 ? baseUrl : `${baseUrl}?bot=${i + 1}`, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }, b.token);
    }
  }
}
