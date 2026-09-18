import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_DAYS, sessionCookieAttributes, signSessionToken, type SessionClaims } from "@/lib/session-token";

export async function setSessionCookie(claims: SessionClaims): Promise<void> {
  const token = await signSessionToken(claims);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...sessionCookieAttributes(), maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieAttributes(), maxAge: 0 });
}
