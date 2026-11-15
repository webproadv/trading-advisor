import { apiGuard } from "@/lib/auth";
import { makeStore } from "@/lib/deps";
import { validateSettings } from "@/lib/risk";
import { pickSettings } from "@/lib/settingsInput";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await apiGuard();
  if (denied) return denied;
  const patch = pickSettings(await req.json().catch(() => ({})));
  try {
    const store = makeStore();
    const next = { ...(await store.getSettings()), ...patch };
    const errors = validateSettings(next);
    if (errors.length) return Response.json({ ok: false, errors }, { status: 400 });
    await store.saveSettings(patch);
    await store.logEvent("settings", patch);
    return Response.json({ ok: true, settings: next });
  } catch (e) { return Response.json({ ok: false, errors: [(e as Error).message] }, { status: 500 }); }
}
