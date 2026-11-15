import { NextResponse, type NextRequest } from "next/server";

// Reindirizzamento "di cortesia": la verifica vera della sessione avviene in ogni pagina e in ogni route handler.
const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/api\/cron\//, /^\/api\/telegram\/webhook$/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (!req.cookies.get("ta_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
