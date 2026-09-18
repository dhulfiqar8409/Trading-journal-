"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasAnyUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, safeRedirectPath, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/password";
import { clearSessionCookie, setSessionCookie } from "@/lib/session";
import { changePasswordSchema, loginSchema, profileSchema, setupSchema } from "@/lib/validation";

export async function setupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (await hasAnyUser()) return failure("Setup has already been completed. Sign in instead.");
  const parsed = setupSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { name, email, password, timeZone } = parsed.data;

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

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formToObject(formData));
  if (!parsed.success) return failure("Enter your email and password.");
  const { email, password, next } = parsed.data;

  const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash());
  if (!user || !valid) return failure("Invalid email or password.");

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
