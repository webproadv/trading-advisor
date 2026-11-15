import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "./session";

export const COOKIE = "ta_session";

export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  return verifySession(token, process.env.SESSION_SECRET);
}

/** Per le pagine: reindirizza al login se la sessione non e' valida. */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthed())) redirect("/login");
}

/** Per le API: risposta 401 se la sessione non e' valida. */
export async function apiGuard(): Promise<Response | null> {
  return (await isAuthed()) ? null : Response.json({ error: "non autorizzato" }, { status: 401 });
}
