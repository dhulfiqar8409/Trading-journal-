import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

const PUBLIC_PATHS = ["/login", "/setup", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|robots.txt).*)"],
};
