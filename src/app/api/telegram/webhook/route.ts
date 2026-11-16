import { makeDeps } from "@/lib/deps";
import { handleTelegram } from "@/lib/engine";
import { safeEqual } from "@/lib/session";
import type { Telegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const second = new URL(req.url).searchParams.get("bot") === "2";
  const chat = second ? process.env.TELEGRAM_CHAT_ID_2 : process.env.TELEGRAM_CHAT_ID;
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !chat || !(await safeEqual(given, secret))) return Response.json({ error: "non autorizzato" }, { status: 401 });
  const update = await req.json().catch(() => null);
  if (!update) return Response.json({ ok: true });
  const deps = makeDeps();
  deps.tg = (deps.tg as Telegram).forBot(second ? 1 : 0);
  try { await handleTelegram(deps, update, chat); }
  catch (e) { await deps.store.logEvent("telegram_webhook_error", { error: (e as Error).message }).catch(() => undefined); }
  return Response.json({ ok: true }); // sempre 200: Telegram non deve ripetere l'update
}
