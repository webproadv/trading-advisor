import { apiGuard } from "@/lib/auth";
import { makeDeps } from "@/lib/deps";
import { runScan } from "@/lib/engine";
import { etParts } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const denied = await apiGuard();
  if (denied) return denied;
  try {
    const now = new Date();
    const r = await runScan(makeDeps(), `${etParts(now).day}@manuale`);
    return Response.json({ ok: true, created: r.created.length, usedClaude: r.usedClaude, skipped: r.skipped, summary: r.summary });
  } catch (e) { return Response.json({ ok: false, message: (e as Error).message }, { status: 500 }); }
}
