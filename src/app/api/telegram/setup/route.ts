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
    await tg.setWebhook(`${app.startsWith("http") ? app : `https://${app}`}/api/telegram/webhook`, secret);
    await tg.send("✅ Trading Advisor collegato. Comandi: /stato · /idee · /stop · /riprendi");
    return Response.json({ ok: true });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
}
