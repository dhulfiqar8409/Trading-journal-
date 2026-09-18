import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_DAYS, signSessionToken } from "@/lib/session-token";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await signSessionToken(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
