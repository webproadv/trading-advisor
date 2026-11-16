import { apiGuard } from "@/lib/auth";
import { makeDeps } from "@/lib/deps";
import { MarketClosedError, buyManual } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const denied = await apiGuard();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { symbol?: string; units?: number };
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return Response.json({ error: "simbolo non valido" }, { status: 400 });
  if (typeof body.units !== "number" || !(body.units > 0) || !Number.isFinite(body.units)) return Response.json({ error: "numero di azioni non valido" }, { status: 400 });
  try {
    return Response.json({ ok: true, message: await buyManual(makeDeps(), symbol, body.units) });
  } catch (e) {
    if (e instanceof MarketClosedError) return Response.json({ ok: false, message: e.message });
    return Response.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}
