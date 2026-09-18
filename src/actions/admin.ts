"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { hashPassword } from "@/lib/password";
import { deleteUserUploads } from "@/lib/uploads";
import { accountChangeError, generateTemporaryPassword, type AccountChange } from "@/lib/users";
import { adminCreateUserSchema, adminResetPasswordSchema } from "@/lib/validation";
import { USER_ROLES } from "@/lib/validation";

const USERS_PATH = "/admin/users";

/**
 * Admin actions. Every one re-checks the session and the ADMIN role on the
 * server; the admin manages accounts and never touches another user's
 * journal data. The last active admin cannot be removed or demoted, and an
 * admin cannot act on their own account here.
 */

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = adminCreateUserSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { username, name, email, role, password } = parsed.data;

  const clash = await db.user.findFirst({
    where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
    select: { username: true },
  });
  if (clash) {
    return clash.username === username
      ? failure("That username is taken.", { username: "Already in use" })
      : failure("That email belongs to another account.", { email: "Already in use" });
  }

  const temporaryPassword = password ?? generateTemporaryPassword();
  try {
    await db.user.create({
      data: {
        username,
        name,
        email: email ?? null,
        role,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        accounts: { create: { name: "Main", currency: "USD", isDefault: true } },
      },
    });
  } catch (error) {
    console.error("create user failed", error);
    return failure("Could not create the account. Please try again.");
  }
  revalidatePath(USERS_PATH);
  return success(`Account @${username} created. Pass on the temporary password; it is shown only once.`, { username, temporaryPassword });
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = adminResetPasswordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { userId, password } = parsed.data;
  if (userId === admin.id) return failure("Change your own password from Settings.");
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (!target) return failure("That account no longer exists.");

  const temporaryPassword = password ?? generateTemporaryPassword();
  await db.user.update({
    where: { id: target.id },
    data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, sessionVersion: { increment: 1 } },
  });
  revalidatePath(USERS_PATH);
  return success(`Password for @${target.username} reset; their sessions are signed out. Pass on the temporary password; it is shown only once.`, {
    username: target.username,
    temporaryPassword,
  });
}

type Guarded =
  | { ok: false; error: string }
  | { ok: true; admin: CurrentUser; target: { id: string; username: string; role: "ADMIN" | "USER"; isActive: boolean } };

async function guardedTarget(change: AccountChange, userId: string): Promise<Guarded> {
  const admin = await requireAdmin();
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true, isActive: true } });
  if (!target) return { ok: false, error: "That account no longer exists." };
  const activeAdminCount = await db.user.count({ where: { role: "ADMIN", isActive: true } });
  const error = accountChangeError(change, { actorId: admin.id, target, activeAdminCount });
  return error ? { ok: false, error } : { ok: true, admin, target };
}

function userIdFrom(formData: FormData): string | null {
  const value = formData.get("userId");
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

export async function setActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = userIdFrom(formData);
  if (!userId) return failure("Missing account.");
  const active = formData.get("active") === "1";
  if (active) {
    await requireAdmin();
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    if (!target) return failure("That account no longer exists.");
    await db.user.update({ where: { id: target.id }, data: { isActive: true } });
    revalidatePath(USERS_PATH);
    return success(`@${target.username} can sign in again.`);
  }
  const guarded = await guardedTarget("deactivate", userId);
  if (!guarded.ok) return failure(guarded.error);
  // Bumping the version rejects the account's existing sessions at their next request.
  await db.user.update({ where: { id: guarded.target.id }, data: { isActive: false, sessionVersion: { increment: 1 } } });
  revalidatePath(USERS_PATH);
  return success(`@${guarded.target.username} deactivated and signed out.`);
}

export async function setRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = userIdFrom(formData);
  const role = formData.get("role");
  if (!userId || (role !== USER_ROLES[0] && role !== USER_ROLES[1])) return failure("Missing account or role.");
  const guarded = role === "USER" ? await guardedTarget("demote", userId) : await guardedPromotion(userId);
  if (!guarded.ok) return failure(guarded.error);
  if (guarded.target.role === role) return success();
  await db.user.update({ where: { id: guarded.target.id }, data: { role } });
  revalidatePath(USERS_PATH);
  return success(`@${guarded.target.username} is now ${role === "ADMIN" ? "an admin" : "a user"}.`);
}

async function guardedPromotion(userId: string): Promise<Guarded> {
  const admin = await requireAdmin();
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true, isActive: true } });
  if (!target) return { ok: false, error: "That account no longer exists." };
  return { ok: true, admin, target };
}

/** Removes the account with everything it logged: trades, days, rules, tags, links, presets and screenshot files. */
export async function deleteUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = userIdFrom(formData);
  if (!userId) return failure("Missing account.");
  const guarded = await guardedTarget("delete", userId);
  if (!guarded.ok) return failure(guarded.error);
  const { target } = guarded;
  // Trades reference accounts with RESTRICT, so they go first; the user row cascades to the rest.
  await db.$transaction([db.trade.deleteMany({ where: { userId: target.id } }), db.user.delete({ where: { id: target.id } })]);
  await deleteUserUploads(target.id);
  revalidatePath(USERS_PATH);
  return success(`Account @${target.username} and everything it logged are gone.`);
}
