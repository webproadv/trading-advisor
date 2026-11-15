import { COOKIE } from "@/lib/auth";
import { makeStore } from "@/lib/deps";
import { safeEqual, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret || secret.length < 32) return Response.json({ error: "Server non configurato (APP_PASSWORD / SESSION_SECRET)." }, { status: 500 });

  let store: ReturnType<typeof makeStore> | null = null;
  try { store = makeStore(); } catch { store = null; }
  const now = Date.now();
  const lock = store ? await store.kvGet<{ count: number; until: number }>("login_fail").catch(() => null) : null;
  if (lock && lock.until > now) return Response.json({ error: "Troppi tentativi. Riprova tra qualche minuto." }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const ok = typeof body.password === "string" && (await safeEqual(body.password, password));
  if (!ok) {
    const count = (lock?.count ?? 0) + 1;
    if (store) await store.kvSet("login_fail", { count, until: count >= 8 ? now + 15 * 60_000 : 0 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ error: "Password errata." }, { status: 401 });
  }
  if (store) await store.kvSet("login_fail", { count: 0, until: 0 }).catch(() => undefined);
  const token = await signSession(secret);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 86400}${secure}` },
  });
}
