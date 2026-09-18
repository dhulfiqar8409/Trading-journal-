import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  timeZone: string;
  displayMode: "R" | "USD";
  createdAt: Date;
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;
  return db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, timeZone: true, displayMode: true, createdAt: true },
  });
});

/** For pages and server actions: redirects to /login when there is no session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export const hasAnyUser = cache(async (): Promise<boolean> => {
  const count = await db.user.count();
  return count > 0;
});
