import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { setupTokenMatches, setupTokenRequired } from "@/lib/security";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

const PUBLIC_PATHS = ["/login", "/setup", "/api/health", "/offline", "/share", "/api/share"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const SETUP_DENIED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Setup link required · Darkpools</title><style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#eef1f5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#aeb6c3;font-size:.95rem;line-height:1.5;margin:0}</style></head><body><main><h1>Setup link required</h1><p>This journal is waiting for its owner. Open the setup link printed by the server setup to create the account.</p></main></body></html>`;

/** First-run gate: with SETUP_TOKEN configured, /setup only renders for a request carrying the token. */
async function gateSetup(request: NextRequest): Promise<NextResponse | null> {
  if (request.method !== "GET" || !setupTokenRequired(process.env.SETUP_TOKEN)) return null;
  const users = await db.user.count();
  if (users > 0) return NextResponse.redirect(new URL("/login", request.url));
  if (setupTokenMatches(request.nextUrl.searchParams.get("token"), process.env.SETUP_TOKEN)) return null;
  return new NextResponse(SETUP_DENIED_HTML, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * Optimistic session check for every route. Pages, server actions and route
 * handlers verify the session again themselves; this only keeps signed-out
 * visitors from reaching protected pages at all.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublic(pathname)) {
    if (session && (pathname === "/login" || pathname === "/setup")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    if (pathname === "/setup") {
      const denied = await gateSetup(request);
      if (denied) return denied;
    }
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|manifest.webmanifest|sw.js|robots.txt).*)"],
};
