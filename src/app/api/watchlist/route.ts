import { apiGuard } from "@/lib/auth";
import { makeEtoro, makeStore } from "@/lib/deps";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await apiGuard();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { symbol?: string };
  const symbol = (body.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return Response.json({ ok: false, message: "Simbolo non valido." }, { status: 400 });
  try {
    const found = await makeEtoro().search(symbol);
    if (!found) return Response.json({ ok: false, message: `${symbol} non trovato su eToro (controlla il simbolo).` });
    await makeStore().upsertWatch({ symbol, instrument_id: found.instrumentId, name: found.name ?? null, active: true });
    return Response.json({ ok: true, message: `${symbol} aggiunto (instrumentId ${found.instrumentId}).` });
  } catch (e) { return Response.json({ ok: false, message: (e as Error).message }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  const denied = await apiGuard();
  if (denied) return denied;
  const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase() ?? "";
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return Response.json({ ok: false, message: "Simbolo non valido." }, { status: 400 });
  try { await makeStore().removeWatch(symbol); return Response.json({ ok: true }); }
  catch (e) { return Response.json({ ok: false, message: (e as Error).message }, { status: 500 }); }
}
