export interface Button { text: string; data: string }

export interface TelegramLike {
  enabled: boolean;
  send(html: string, buttons?: Button[][]): Promise<void>;
  answer(callbackId: string, text: string): Promise<void>;
  edit(chatId: string | number, messageId: number, html: string): Promise<void>;
}

export class Telegram implements TelegramLike {
  enabled: boolean;
  constructor(private token: string | undefined, private chatId: string | undefined, private f: typeof fetch = fetch) {
    this.enabled = !!token && !!chatId;
  }

  private async call(method: string, body: unknown): Promise<unknown> {
    const r = await this.f(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!r.ok || j.ok === false) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
    return j;
  }

  async send(html: string, buttons?: Button[][]) {
    if (!this.enabled) return;
    await this.call("sendMessage", {
      chat_id: this.chatId, text: html.slice(0, 3900), parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: buttons ? { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } : undefined,
    });
  }

  async answer(callbackId: string, text: string) {
    if (!this.enabled) return;
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190) });
  }

  async edit(chatId: string | number, messageId: number, html: string) {
    if (!this.enabled) return;
    await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text: html.slice(0, 3900), parse_mode: "HTML", disable_web_page_preview: true });
  }

  async setWebhook(url: string, secret: string) {
    if (!this.token) throw new Error("TELEGRAM_BOT_TOKEN mancante");
    return this.call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  }
}
