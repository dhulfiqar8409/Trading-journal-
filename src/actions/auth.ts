"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasAnyUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, safeRedirectPath, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/password";
import { clientIpFrom, isLockedOut, LOCKOUT_WINDOW_MS, setupTokenMatches, setupTokenRequired } from "@/lib/security";
import { clearSessionCookie, setSessionCookie } from "@/lib/session";
import { PASSWORD_CHANGE_PATH } from "@/lib/session-token";
import { changePasswordSchema, loginSchema, profileSchema, setupSchema } from "@/lib/validation";

/** First run: creates the admin account. Disabled as soon as any account exists. */
export async function setupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (await hasAnyUser()) return failure("Setup has already been completed. Sign in instead.");
  const parsed = setupSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { username, name, email, password, timeZone, token } = parsed.data;
  if (setupTokenRequired(process.env.SETUP_TOKEN) && !setupTokenMatches(token, process.env.SETUP_TOKEN)) {
    return failure("The setup link from the server setup is required.");
  }

  let user: { id: string; sessionVersion: number };
  try {
    const passwordHash = await hashPassword(password);
    user = await db.user.create({
      data: {
        username,
        email: email ?? null,
        name,
        passwordHash,
        role: "ADMIN",
        passwordChangedAt: new Date(),
        lastLoginAt: new Date(),
        timeZone: timeZone ?? "UTC",
        accounts: { create: { name: "Main", currency: "USD", isDefault: true } },
      },
      select: { id: true, sessionVersion: true },
    });
  } catch (error) {
    console.error("setup failed", error);
    return failure("Could not create the account. Please try again.");
  }
  // Two first-run submissions racing each other: only the first one stands.
  if ((await db.user.count({ where: { id: { not: user.id } } })) > 0) {
    await db.user.delete({ where: { id: user.id } });
    return failure("Setup has already been completed. Sign in instead.");
  }
  await setSessionCookie({ userId: user.id, sessionVersion: user.sessionVersion, mustChangePassword: false });
  redirect("/");
}

const GENERIC_LOGIN_ERROR = "Invalid username or password.";

/**
 * Sign in by username (or the account's email) with a lockout: five failures
 * within fifteen minutes for an identifier or for a client address block
 * further attempts for the rest of the window. The response never says
 * whether an account exists.
 */
export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formToObject(formData));
  if (!parsed.success) return failure("Enter your username and password.");
  const { identifier, password, next } = parsed.data;
  const headerList = await headers();
  const ip = clientIpFrom((name) => headerList.get(name), "unknown");
  const now = new Date();
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);

  // Prune the window's history and look up recent failures for this identifier and this address.
  await db.loginAttempt.deleteMany({ where: { createdAt: { lt: since } } });
  const recent = await db.loginAttempt.findMany({
    where: { OR: [{ identifier }, { ip }], createdAt: { gte: since } },
    select: { identifier: true, ip: true, createdAt: true },
  });
  const byIdentifier = recent.filter((a) => a.identifier === identifier).map((a) => a.createdAt);
  const byIp = recent.filter((a) => a.ip === ip).map((a) => a.createdAt);
  if (isLockedOut(byIdentifier, now) || isLockedOut(byIp, now)) {
    return failure(GENERIC_LOGIN_ERROR);
  }

  const user = await db.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { username: identifier },
    select: { id: true, passwordHash: true, isActive: true, sessionVersion: true, mustChangePassword: true },
  });
  const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash());
  if (!user || !valid) {
    await db.loginAttempt.create({ data: { identifier, ip } });
    return failure(GENERIC_LOGIN_ERROR);
  }
  // Only someone holding the right password learns that the account is switched off.
  if (!user.isActive) return failure("This account has been deactivated. Ask the admin to reactivate it.");

  await db.$transaction([
    db.loginAttempt.deleteMany({ where: { OR: [{ identifier }, { ip }] } }),
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
  ]);
  await setSessionCookie({ userId: user.id, sessionVersion: user.sessionVersion, mustChangePassword: user.mustChangePassword });
  redirect(user.mustChangePassword ? PASSWORD_CHANGE_PATH : safeRedirectPath(next));
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

/**
 * Changes the signed-in user's password, from Settings or from the forced
 * first-sign-in page. Every other session of the account is signed out; this
 * one gets a fresh token.
 */
export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser({ allowPasswordChange: true });
  const parsed = changePasswordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const record = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!record || !(await verifyPassword(currentPassword, record.passwordHash))) {
    return failure("Current password is incorrect.", { currentPassword: "Incorrect password" });
  }
  if (newPassword === currentPassword) {
    return failure("Choose a password different from the current one.", { newPassword: "Same as the current password" });
  }
  const updated = await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  await setSessionCookie({ userId: user.id, sessionVersion: updated.sessionVersion, mustChangePassword: false });
  if (user.mustChangePassword) redirect("/");
  return success("Password updated. Other devices have been signed out.");
}

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  await db.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/", "layout");
  return success("Settings saved.");
}
