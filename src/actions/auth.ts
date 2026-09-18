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
import { changePasswordSchema, loginSchema, profileSchema, setupSchema } from "@/lib/validation";

export async function setupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (await hasAnyUser()) return failure("Setup has already been completed. Sign in instead.");
  const parsed = setupSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { name, email, password, timeZone, token } = parsed.data;
  if (setupTokenRequired(process.env.SETUP_TOKEN) && !setupTokenMatches(token, process.env.SETUP_TOKEN)) {
    return failure("The setup link from the server setup is required.");
  }

  let userId: string;
  try {
    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: {
        name,
        email,
        passwordHash,
        timeZone: timeZone ?? "UTC",
        accounts: { create: { name: "Main", currency: "USD", isDefault: true } },
      },
      select: { id: true },
    });
    userId = user.id;
  } catch (error) {
    console.error("setup failed", error);
    return failure("Could not create the account. Please try again.");
  }
  await setSessionCookie(userId);
  redirect("/");
}

const GENERIC_LOGIN_ERROR = "Invalid email or password.";

/**
 * Sign in with a lockout: five failures within fifteen minutes for an email
 * or for a client address block further attempts for the rest of the window.
 * The response never says whether the email exists.
 */
export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formToObject(formData));
  if (!parsed.success) return failure("Enter your email and password.");
  const { email, password, next } = parsed.data;
  const headerList = await headers();
  const ip = clientIpFrom((name) => headerList.get(name), "unknown");
  const now = new Date();
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);

  // Prune the window's history and look up recent failures for this email and this address.
  await db.loginAttempt.deleteMany({ where: { createdAt: { lt: since } } });
  const recent = await db.loginAttempt.findMany({
    where: { OR: [{ email }, { ip }], createdAt: { gte: since } },
    select: { email: true, ip: true, createdAt: true },
  });
  const byEmail = recent.filter((a) => a.email === email).map((a) => a.createdAt);
  const byIp = recent.filter((a) => a.ip === ip).map((a) => a.createdAt);
  if (isLockedOut(byEmail, now) || isLockedOut(byIp, now)) {
    return failure(GENERIC_LOGIN_ERROR);
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash());
  if (!user || !valid) {
    await db.loginAttempt.create({ data: { email, ip } });
    return failure(GENERIC_LOGIN_ERROR);
  }

  await db.loginAttempt.deleteMany({ where: { OR: [{ email }, { ip }] } });
  await setSessionCookie(user.id);
  redirect(safeRedirectPath(next));
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = changePasswordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);

  const record = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!record || !(await verifyPassword(parsed.data.currentPassword, record.passwordHash))) {
    return failure("Current password is incorrect.", { currentPassword: "Incorrect password" });
  }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword) } });
  return success("Password updated.");
}

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  await db.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/", "layout");
  return success("Settings saved.");
}
