import { apiGuard } from "@/lib/auth";
import { makeDeps } from "@/lib/deps";
import { MarketClosedError, closeSymbol } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const denied = await apiGuard();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { instrumentId?: number; units?: number | null };
  if (!Number.isInteger(body.instrumentId)) return Response.json({ error: "instrumentId non valido" }, { status: 400 });
  const units = typeof body.units === "number" && body.units > 0 && Number.isFinite(body.units) ? body.units : null;
  try {
    const msg = await closeSymbol(makeDeps(), body.instrumentId as number, units, "manual", "vendita manuale");
    return Response.json({ ok: true, message: msg });
  } catch (e) {
    if (e instanceof MarketClosedError) return Response.json({ ok: false, message: e.message });
    return Response.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}
