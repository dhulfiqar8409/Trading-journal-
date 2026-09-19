"use server";

import { revalidatePath } from "next/cache";
import { withAccountLock, type AccountTx } from "@/lib/account-lock";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { hashPassword } from "@/lib/password";
import { deleteUploads, deleteUserUploads } from "@/lib/uploads";
import { accountChangeError, generateTemporaryPassword, normalizeUsername, type AccountChange } from "@/lib/users";
import { adminCreateUserSchema, adminResetPasswordSchema } from "@/lib/validation";
import { USER_ROLES } from "@/lib/validation";

const USERS_PATH = "/admin/users";

/**
 * Admin actions. Every one re-checks the session and the ADMIN role on the
 * server; the admin manages accounts and never touches another user's
 * journal data. The last active admin cannot be removed or demoted, and an
 * admin cannot act on their own account here. Changes that could remove the
 * last admin run under the account lock, so two of them cannot both pass
 * the check.
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

type Target = { id: string; username: string; role: "ADMIN" | "USER"; isActive: boolean };
type Guarded = { ok: false; error: string } | { ok: true; target: Target };

const TARGET_SELECT = { id: true, username: true, role: true, isActive: true } as const;

/** The account to change, looked up inside the locked transaction so the admin count it is checked against cannot move. */
async function guardedTarget(tx: AccountTx, change: AccountChange, actorId: string, userId: string): Promise<Guarded> {
  const target = await tx.user.findUnique({ where: { id: userId }, select: TARGET_SELECT });
  if (!target) return { ok: false, error: "That account no longer exists." };
  const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
  const error = accountChangeError(change, { actorId, target, activeAdminCount });
  return error ? { ok: false, error } : { ok: true, target };
}

function userIdFrom(formData: FormData): string | null {
  const value = formData.get("userId");
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

export async function setActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = userIdFrom(formData);
  if (!userId) return failure("Missing account.");
  const active = formData.get("active") === "1";
  const admin = await requireAdmin();
  if (active) {
    const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    if (!target) return failure("That account no longer exists.");
    await db.user.update({ where: { id: target.id }, data: { isActive: true } });
    revalidatePath(USERS_PATH);
    return success(`@${target.username} can sign in again.`);
  }
  const result = await withAccountLock(async (tx) => {
    const guarded = await guardedTarget(tx, "deactivate", admin.id, userId);
    if (!guarded.ok) return guarded;
    // Bumping the version rejects the account's existing sessions at their next request.
    await tx.user.update({ where: { id: guarded.target.id }, data: { isActive: false, sessionVersion: { increment: 1 } } });
    return guarded;
  });
  if (!result.ok) return failure(result.error);
  revalidatePath(USERS_PATH);
  return success(`@${result.target.username} deactivated and signed out.`);
}

export async function setRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = userIdFrom(formData);
  const role = formData.get("role");
  if (!userId || (role !== USER_ROLES[0] && role !== USER_ROLES[1])) return failure("Missing account or role.");
  const admin = await requireAdmin();
  const result = await withAccountLock(async (tx) => {
    // Promotions cannot remove an admin, so only demotions go through the last-admin rule.
    const guarded = role === "USER" ? await guardedTarget(tx, "demote", admin.id, userId) : await plainTarget(tx, userId);
    if (!guarded.ok) return guarded;
    if (guarded.target.role !== role) await tx.user.update({ where: { id: guarded.target.id }, data: { role } });
    return guarded;
  });
  if (!result.ok) return failure(result.error);
  if (result.target.role === role) return success();
  revalidatePath(USERS_PATH);
  return success(`@${result.target.username} is now ${role === "ADMIN" ? "an admin" : "a user"}.`);
}

async function plainTarget(tx: AccountTx, userId: string): Promise<Guarded> {
  const target = await tx.user.findUnique({ where: { id: userId }, select: TARGET_SELECT });
  return target ? { ok: true, target } : { ok: false, error: "That account no longer exists." };
}

/**
 * Wipes one account's trades (with their screenshots, files, rule events and
 * import history) and nothing else: days, rules, tags and the account stay.
 * The admin types the username to confirm.
 */
export async function deleteUserTradesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const userId = userIdFrom(formData);
  if (!userId) return failure("Missing account.");
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (!target) return failure("That account no longer exists.");
  const typed = normalizeUsername(String(formData.get("confirmUsername") ?? ""));
  if (typed !== target.username) return failure(`Type ${target.username} exactly to confirm.`, { confirmUsername: "Does not match the username" });
  const attachments = await db.attachment.findMany({ where: { trade: { userId: target.id } }, select: { storedName: true } });
  const [deleted] = await db.$transaction([db.trade.deleteMany({ where: { userId: target.id } }), db.importBatch.deleteMany({ where: { userId: target.id } })]);
  await deleteUploads(target.id, attachments.map((a) => a.storedName));
  revalidatePath(USERS_PATH);
  revalidatePath("/");
  revalidatePath("/trades");
  return success(`${deleted.count} trade${deleted.count === 1 ? "" : "s"} of @${target.username} removed. Days, rules and tags stay.`);
}

/** Removes the account with everything it logged: trades, days, rules, tags, links, presets and screenshot files. */
export async function deleteUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = userIdFrom(formData);
  if (!userId) return failure("Missing account.");
  const admin = await requireAdmin();
  const result = await withAccountLock(
    async (tx) => {
      const guarded = await guardedTarget(tx, "delete", admin.id, userId);
      if (!guarded.ok) return guarded;
      // Trades reference accounts with RESTRICT, so they go first; the user row cascades to the rest.
      await tx.trade.deleteMany({ where: { userId: guarded.target.id } });
      await tx.user.delete({ where: { id: guarded.target.id } });
      return guarded;
    },
    { timeoutMs: 60_000 },
  );
  if (!result.ok) return failure(result.error);
  await deleteUserUploads(result.target.id);
  revalidatePath(USERS_PATH);
  return success(`Account @${result.target.username} and everything it logged are gone.`);
}
