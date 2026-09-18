import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { setupTokenMatches, setupTokenRequired } from "@/lib/security";
import { PASSWORD_CHANGE_PATH, SESSION_COOKIE, verifySessionToken, type SessionClaims } from "@/lib/session-token";

const PUBLIC_PATHS = ["/login", "/setup", "/api/health", "/offline", "/share", "/api/share"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const SETUP_DENIED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Setup link required · Darkpools</title><style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#eef1f5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#aeb6c3;font-size:.95rem;line-height:1.5;margin:0}</style></head><body><main><h1>Setup link required</h1><p>This journal is waiting for its admin. Open the setup link printed by the server setup to create the admin account.</p></main></body></html>`;

/** First-run gate: with SETUP_TOKEN configured, /setup only renders for a request carrying the token. */
async function gateSetup(request: NextRequest): Promise<NextResponse | null> {
  if (request.method !== "GET" || !setupTokenRequired(process.env.SETUP_TOKEN)) return null;
  const users = await db.user.count();
  if (users > 0) return NextResponse.redirect(new URL("/login", request.url));
  if (setupTokenMatches(request.nextUrl.searchParams.get("token"), process.env.SETUP_TOKEN)) return null;
  return new NextResponse(SETUP_DENIED_HTML, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** Whether the account behind a well-formed token still accepts it (active, not reset since). */
async function sessionStillValid(session: SessionClaims): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: session.userId }, select: { isActive: true, sessionVersion: true } });
  return !!user && user.isActive && user.sessionVersion === session.sessionVersion;
}

/**
 * Optimistic session check for every route. Pages, server actions and route
 * handlers verify the session against the account themselves; this keeps
 * signed-out visitors from reaching protected pages at all and sends a
 * temporary-password session to the password page first.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublic(pathname)) {
    if (session && (pathname === "/login" || pathname === "/setup")) {
      if (await sessionStillValid(session)) return NextResponse.redirect(new URL("/", request.url));
      // A cookie for a deactivated, reset or deleted account is dropped here so sign-in can proceed.
      const response = (pathname === "/setup" ? await gateSetup(request) : null) ?? NextResponse.next();
      response.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
      return response;
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

  if (session.mustChangePassword && pathname !== PASSWORD_CHANGE_PATH) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Password change required" }, { status: 403 });
    }
    return NextResponse.redirect(new URL(PASSWORD_CHANGE_PATH, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|manifest.webmanifest|sw.js|robots.txt).*)"],
};
