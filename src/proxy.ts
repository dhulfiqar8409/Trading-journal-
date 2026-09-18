import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { setupGate, setupTokenMatches } from "@/lib/security";
import { PASSWORD_CHANGE_PATH, SESSION_COOKIE, sessionCookieAttributes, verifySessionToken, type SessionClaims } from "@/lib/session-token";

const PUBLIC_PATHS = ["/login", "/setup", "/api/health", "/offline", "/share", "/api/share"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const SETUP_PAGE_STYLE = `html{color-scheme:dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#eef1f5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#aeb6c3;font-size:.95rem;line-height:1.5;margin:0}code{color:#eef1f5}`;

function setupPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Darkpools</title><style>${SETUP_PAGE_STYLE}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

const SETUP_DENIED_HTML = setupPage(
  "Setup link required",
  "This journal is waiting for its admin. Open the setup link printed by the server setup to create the admin account.",
);
const SETUP_UNCONFIGURED_HTML = setupPage(
  "Setup unavailable",
  "This server is missing its setup token. Set <code>SETUP_TOKEN</code> to at least 16 characters, restart the server and open the setup link it prints.",
);

function html(body: string, status: number): NextResponse {
  return new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * First-run gate. Once any account exists /setup only redirects to sign-in.
 * Before that, production without a usable SETUP_TOKEN answers 503, and a
 * configured token only renders the page for a request carrying it.
 */
async function gateSetup(request: NextRequest): Promise<NextResponse | null> {
  const gate = setupGate(process.env.SETUP_TOKEN);
  if (request.method !== "GET" || gate === "open") return null;
  const users = await db.user.count();
  if (users > 0) return NextResponse.redirect(new URL("/login", request.url));
  if (gate === "unconfigured") return html(SETUP_UNCONFIGURED_HTML, 503);
  if (setupTokenMatches(request.nextUrl.searchParams.get("token"), process.env.SETUP_TOKEN)) return null;
  return html(SETUP_DENIED_HTML, 403);
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
      response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieAttributes(), maxAge: 0 });
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|manifest.webmanifest|sw.js|sw-policy.js|robots.txt).*)"],
};
