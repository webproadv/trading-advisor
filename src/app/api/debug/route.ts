import { apiGuard } from "@/lib/auth";
import { makeEtoro, makeStore } from "@/lib/deps";
import { parsePortfolio } from "@/lib/etoro";

export const dynamic = "force-dynamic";

// Diagnostica: mostra la risposta GREZZA del portafoglio demo e come l'app la interpreta (nessuna chiave viene mostrata).
export async function GET() {
  const denied = await apiGuard();
  if (denied) return denied;
  try {
    const etoro = makeEtoro();
    const raw = await etoro.portfolioRaw();
    const watch = (await makeStore().listWatchlist()).slice(0, 3);
    const rates = watch.length ? await etoro.rates(watch.map((w) => w.instrument_id)) : {};
    return Response.json({ parsed: parsePortfolio(raw), rates, rawText: JSON.stringify(raw).slice(0, 20000) });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
}
