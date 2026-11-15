// Sessione a cookie firmato (HMAC-SHA256). Funzioni pure, testabili senza Next.
const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

/** Confronto a tempo costante: si confrontano gli HMAC di entrambi i valori. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const k = "ta-compare";
  const [x, y] = await Promise.all([hmac(k, a), hmac(k, b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export async function signSession(secret: string, nowMs = Date.now(), ttlSec = 7 * 86400): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  return `${exp}.${await hmac(secret, `session:${exp}`)}`;
}

export async function verifySession(token: string | undefined, secret: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!token || !secret || secret.length < 32) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < nowMs) return false;
  return safeEqual(sig, await hmac(secret, `session:${exp}`));
}
