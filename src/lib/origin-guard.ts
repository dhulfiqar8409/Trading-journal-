import "server-only";
import { NextResponse } from "next/server";
import { originAllowed } from "@/lib/origin";

/**
 * Same-origin check for state-changing route handlers (the framework already
 * applies one to server actions). The Origin header, or failing that the
 * Referer, must name this app: APP_ORIGIN when set, otherwise the request's
 * Host with the scheme the reverse proxy forwards. Returns the 403 to send,
 * or null when the request may proceed.
 *
 * `allowMissing` is for the share target only: the installed app's share
 * sheet posts a top-level form, and a browser that sends no Origin with it
 * must still be served. A foreign origin is refused either way.
 */
export function requireSameOrigin(request: Request, options: { allowMissing?: boolean } = {}): NextResponse | null {
  const get = (name: string) => request.headers.get(name);
  if (originAllowed(get, process.env.APP_ORIGIN, options)) return null;
  return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
}
