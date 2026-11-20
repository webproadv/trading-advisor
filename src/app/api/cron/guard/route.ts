import { after } from "next/server";
import { makeDeps } from "@/lib/deps";
import { guardPositions } from "@/lib/engine";
import { safeEqual } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chiamato da Supabase (pg_cron) ogni minuto nelle ore di borsa: controlla stop-loss, trend ribassista a 1/5/10 minuti e uscite overnight.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!secret || secret.length < 16 || !(await safeEqual(given, secret))) return Response.json({ error: "non autorizzato" }, { status: 401 });
  const deps = makeDeps();
  after(async () => {
    try { await guardPositions(deps); }
    catch (e) { await deps.store.logEvent("guard_fatal", { error: (e as Error).message }).catch(() => undefined); }
  });
  return Response.json({ ok: true }, { status: 202 });
}
