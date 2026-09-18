"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, success, zodErrorToResult, type ActionResult, type ActionState } from "@/lib/form";
import { computeTradeMetrics } from "@/lib/pnl";
import { fromDateTimeLocalValue } from "@/lib/tz";
import { deleteUploads } from "@/lib/uploads";
import { tradeSchema } from "@/lib/validation";

type TradeWrite = Omit<Prisma.TradeUncheckedCreateInput, "userId" | "id" | "createdAt" | "updatedAt" | "importHash">;

type BuildResult = { ok: true; data: TradeWrite; tagIds: string[] } | { ok: false; result: ActionResult };

async function buildTradeWrite(user: CurrentUser, formData: FormData): Promise<BuildResult> {
  const parsed = tradeSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, result: zodErrorToResult(parsed.error) };
  const input = parsed.data;

  const account = await db.account.findFirst({ where: { id: input.accountId, userId: user.id }, select: { id: true } });
  if (!account) return { ok: false, result: failure("Choose a valid account.", { accountId: "Unknown account" }) };

  const entryAt = fromDateTimeLocalValue(input.entryAt, user.timeZone);
  if (!entryAt) return { ok: false, result: failure("Enter a valid entry time.", { entryAt: "Invalid date" }) };

  let exitAt: Date | null = null;
  if (input.exitAt) {
    exitAt = fromDateTimeLocalValue(input.exitAt, user.timeZone);
    if (!exitAt) return { ok: false, result: failure("Enter a valid exit time.", { exitAt: "Invalid date" }) };
  }
  const exitPrice = input.exitPrice ?? null;
  if (exitPrice !== null && !exitAt) exitAt = entryAt;
  if (exitPrice === null) exitAt = null;
  if (exitAt && exitAt.getTime() < entryAt.getTime()) {
    return { ok: false, result: failure("Exit time is before the entry time.", { exitAt: "Must be after entry" }) };
  }

  const multiplier = input.multiplier ?? "1";
  const fees = input.fees ?? "0";
  const metrics = computeTradeMetrics({
    side: input.side,
    quantity: input.quantity,
    entryPrice: input.entryPrice,
    exitPrice,
    multiplier,
    fees,
    stopPrice: input.stopPrice ?? null,
    targetPrice: input.targetPrice ?? null,
  });

  const ownedTags = input.tagIds.length
    ? await db.tag.findMany({ where: { userId: user.id, id: { in: input.tagIds } }, select: { id: true } })
    : [];

  return {
    ok: true,
    tagIds: ownedTags.map((t) => t.id),
    data: {
      accountId: input.accountId,
      symbol: input.symbol,
      assetClass: input.assetClass,
      side: input.side,
      quantity: input.quantity,
      entryPrice: input.entryPrice,
      exitPrice,
      multiplier,
      fees,
      entryAt,
      exitAt,
      status: metrics.status,
      pnl: metrics.pnl ? metrics.pnl.toDecimalPlaces(8).toFixed() : null,
      stopPrice: input.stopPrice ?? null,
      targetPrice: input.targetPrice ?? null,
      rMultiple: metrics.rMultiple ? metrics.rMultiple.toDecimalPlaces(8).toFixed() : null,
      notes: input.notes,
      rating: input.rating ?? null,
      mistakes: input.mistakes ?? null,
    },
  };
}

function revalidateTradeViews(id?: string) {
  revalidatePath("/");
  revalidatePath("/trades");
  if (id) revalidatePath(`/trades/${id}`);
}

export async function createTradeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const built = await buildTradeWrite(user, formData);
  if (!built.ok) return built.result;

  let id: string;
  try {
    const trade = await db.trade.create({
      data: { ...built.data, userId: user.id, tags: { connect: built.tagIds.map((tagId) => ({ id: tagId })) } },
      select: { id: true },
    });
    id = trade.id;
  } catch (error) {
    console.error("create trade failed", error);
    return failure("Could not save the trade. Check the numbers and try again.");
  }
  revalidateTradeViews(id);
  redirect(`/trades/${id}`);
}

export async function updateTradeAction(tradeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const existing = await db.trade.findFirst({ where: { id: tradeId, userId: user.id }, select: { id: true } });
  if (!existing) return failure("Trade not found.");

  const built = await buildTradeWrite(user, formData);
  if (!built.ok) return built.result;

  try {
    await db.trade.update({
      where: { id: tradeId },
      data: { ...built.data, tags: { set: built.tagIds.map((tagId) => ({ id: tagId })) } },
    });
  } catch (error) {
    console.error("update trade failed", error);
    return failure("Could not save the trade. Check the numbers and try again.");
  }
  revalidateTradeViews(tradeId);
  return success("Trade saved.");
}

export async function deleteTradeAction(tradeId: string): Promise<void> {
  const user = await requireUser();
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId: user.id },
    select: { id: true, attachments: { select: { storedName: true } } },
  });
  if (!trade) redirect("/trades");

  await db.trade.delete({ where: { id: trade.id } });
  await deleteUploads(user.id, trade.attachments.map((a) => a.storedName));
  revalidateTradeViews(tradeId);
  redirect("/trades");
}

export async function deleteAttachmentAction(attachmentId: string): Promise<void> {
  const user = await requireUser();
  const attachment = await db.attachment.findFirst({
    where: { id: attachmentId, trade: { userId: user.id } },
    select: { id: true, storedName: true, tradeId: true },
  });
  if (!attachment) return;
  await db.attachment.delete({ where: { id: attachment.id } });
  await deleteUploads(user.id, [attachment.storedName]);
  revalidatePath(`/trades/${attachment.tradeId}`);
}
