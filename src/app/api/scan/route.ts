import { apiGuard } from "@/lib/auth";
import { makeDeps } from "@/lib/deps";
import { runScan } from "@/lib/engine";
import { etParts, romeDay } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = await apiGuard();
  if (denied) return denied;
  try {
    const now = new Date();
    const body = (await req.json().catch(() => ({}))) as { scope?: string };
    const slot = body.scope === "EU" ? `${romeDay(now)}@manuale@EU` : `${etParts(now).day}@manuale`;
    const r = await runScan(makeDeps(), slot);
    return Response.json({ ok: true, created: r.created.length, usedClaude: r.usedClaude, skipped: r.skipped, summary: r.summary });
  } catch (e) { return Response.json({ ok: false, message: (e as Error).message }, { status: 500 }); }
}
