import { apiGuard } from "@/lib/auth";
import { makeTelegram } from "@/lib/deps";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await apiGuard();
  if (denied) return denied;
  const app = process.env.APP_URL?.replace(/\/+$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!app || !secret) return Response.json({ error: "Imposta APP_URL e TELEGRAM_WEBHOOK_SECRET." }, { status: 400 });
  try {
    const tg = makeTelegram();
    await tg.setWebhooks(`${app.startsWith("http") ? app : `https://${app}`}/api/telegram/webhook`, secret);
    const results = await tg.sendDetailed("✅ Trading Advisor collegato. Comandi: /stato · /idee · /stop · /riprendi");
    const failed = results.filter((r) => !r.ok);
    const hint = (e?: string) => /chat not found|can't initiate|blocked|Forbidden/i.test(e ?? "") ? " (apri il bot su Telegram e premi Avvia, poi controlla l'ID)" : "";
    if (failed.length) return Response.json({ error: failed.map((f) => `bot ${f.bot}, chat ${f.chat}: ${f.error}${hint(f.error)}`).join(" | "), sent: results.length - failed.length }, { status: failed.length === results.length ? 500 : 207 });
    return Response.json({ ok: true, sent: results.length });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
}
