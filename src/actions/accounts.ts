"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { accountSchema } from "@/lib/validation";

function revalidate() {
  revalidatePath("/accounts");
  revalidatePath("/trades");
  revalidatePath("/");
}

export async function createAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = accountSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { isDefault, ...data } = parsed.data;
  const count = await db.account.count({ where: { userId: user.id } });
  const makeDefault = isDefault || count === 0;
  await db.$transaction(async (tx) => {
    if (makeDefault) await tx.account.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await tx.account.create({ data: { ...data, broker: data.broker ?? null, isDefault: makeDefault, userId: user.id } });
  });
  revalidate();
  return success("Account created.");
}

export async function updateAccountAction(accountId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = accountSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const existing = await db.account.findFirst({ where: { id: accountId, userId: user.id }, select: { id: true, isDefault: true } });
  if (!existing) return failure("Account not found.");
  const { isDefault, ...data } = parsed.data;
  await db.$transaction(async (tx) => {
    if (isDefault) await tx.account.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await tx.account.update({
      where: { id: accountId },
      data: { ...data, broker: data.broker ?? null, isDefault: isDefault || existing.isDefault },
    });
  });
  revalidate();
  return success("Account saved.");
}

export async function deleteAccountAction(accountId: string): Promise<ActionState> {
  const user = await requireUser();
  const account = await db.account.findFirst({
    where: { id: accountId, userId: user.id },
    select: { id: true, _count: { select: { trades: true } } },
  });
  if (!account) return failure("Account not found.");
  if (account._count.trades > 0) return failure("This account still has trades. Move or delete them first.");
  await db.account.delete({ where: { id: accountId } });
  revalidate();
  return success("Account deleted.");
}
