import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PASSWORD_CHANGE_PATH, SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

export interface CurrentUser {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: "ADMIN" | "USER";
  mustChangePassword: boolean;
  sessionVersion: number;
  timeZone: string;
  displayMode: "R" | "USD";
  createdAt: Date;
}

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  sessionVersion: true,
  timeZone: true,
  displayMode: true,
  createdAt: true,
} as const;

/**
 * The account behind this request's session, or null when there is no
 * session, the account is deactivated or deleted, or the token predates the
 * account's last password change or reset. Cached per request.
 */
const loadSessionUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.userId }, select: USER_SELECT });
  if (!user || !user.isActive || user.sessionVersion !== session.sessionVersion) return null;
  const { isActive: _active, ...rest } = user;
  void _active;
  return rest;
});

/**
 * The signed-in user for route handlers, or null. An account that still has
 * to replace its temporary password counts as signed out here, so no data
 * leaves the server before that happens.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await loadSessionUser();
  return user && !user.mustChangePassword ? user : null;
});

/**
 * For pages and server actions: redirects to sign-in without a valid session
 * and to the password page while a temporary password is in force.
 */
export async function requireUser(options: { allowPasswordChange?: boolean } = {}): Promise<CurrentUser> {
  const user = await loadSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPasswordChange) redirect(PASSWORD_CHANGE_PATH);
  return user;
}

/** Admin-only pages and actions; other users get a 404 rather than a hint that the page exists. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound();
  return user;
}

export const hasAnyUser = cache(async (): Promise<boolean> => {
  const count = await db.user.count();
  return count > 0;
});
