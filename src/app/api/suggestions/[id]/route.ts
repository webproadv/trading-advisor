import { apiGuard } from "@/lib/auth";
import { makeDeps } from "@/lib/deps";
import { executeSuggestion, rejectSuggestion } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await apiGuard();
  if (denied) return denied;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "id non valido" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; units?: number };
  try {
    const deps = makeDeps();
    if (body.action === "reject") return Response.json(await rejectSuggestion(deps, id));
    if (body.action === "approve") {
      const units = typeof body.units === "number" && body.units > 0 && Number.isFinite(body.units) ? body.units : undefined;
      return Response.json(await executeSuggestion(deps, id, { by: "manual", units }));
    }
    return Response.json({ error: "azione non valida" }, { status: 400 });
  } catch (e) { return Response.json({ ok: false, message: (e as Error).message }, { status: 500 }); }
}
