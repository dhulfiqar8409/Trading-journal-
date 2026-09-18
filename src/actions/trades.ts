"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { fullCloseNotes, partialCloseNotes, planClose, remainderNotes } from "@/lib/close";
import { db } from "@/lib/db";
import { toDecimal, toPlainString, type Decimal } from "@/lib/decimal";
import { failure, formToObject, success, zodErrorToResult, type ActionResult, type ActionState } from "@/lib/form";
import { expirationInstant, expirationKey, tradeLabel } from "@/lib/options";
import { computeTradeMetrics } from "@/lib/pnl";
import { evaluateCandidate } from "@/lib/queries/rules";
import type { Evaluation, RuleTrade } from "@/lib/rules";
import { dateKeyInZone, fromDateTimeLocalValue } from "@/lib/tz";
import { deleteUploads } from "@/lib/uploads";
import { closeTradeSchema, tradeSchema, type TradeInput } from "@/lib/validation";

type TradeWrite = Omit<Prisma.TradeUncheckedCreateInput, "userId" | "id" | "createdAt" | "updatedAt" | "importHash">;

interface RuleEventWrite {
  ruleId: string;
  status: "FOLLOWED" | "BROKEN" | "OVERRIDDEN";
  justification: string | null;
}

type BuildResult =
  | { ok: true; data: TradeWrite; tagIds: string[]; events: RuleEventWrite[]; draftId: string | null }
  | { ok: false; result: ActionResult };

type EventsResult = { ok: true; events: RuleEventWrite[] } | { ok: false; result: ActionResult };

/** Decimal to the stored string form, eight places at most. */
const dec = (d: Decimal | null): string | null => (d ? d.toDecimalPlaces(8).toFixed() : null);

/**
 * Turns verdicts into rule events, or into the failure that asks for a
 * one-line justification when a rule is broken and none was given. Broken
 * rules become BROKEN, or OVERRIDDEN when the owner marks a deliberate exception.
 */
function eventsOrJustification(verdicts: Evaluation[], input: { justification?: string; overridden: boolean }): EventsResult {
  const broken = verdicts.filter((e) => e.status === "BROKEN");
  if (broken.length > 0 && !input.justification) {
    return {
      ok: false,
      result: failure(
        `This trade breaks ${broken.length} rule${broken.length === 1 ? "" : "s"}. Add a one-line justification to save it anyway.`,
        { justification: "Required when a rule is broken" },
        broken.map((b) => ({ ruleId: b.ruleId, title: b.title, detail: b.detail })),
      ),
    };
  }
  return {
    ok: true,
    events: verdicts.map((e) => ({
      ruleId: e.ruleId,
      status: e.status === "FOLLOWED" ? "FOLLOWED" : input.overridden ? "OVERRIDDEN" : "BROKEN",
      justification: e.status === "FOLLOWED" ? null : (input.justification ?? null),
    })),
  };
}

/**
 * Evaluate the owner's rules for the trade being saved. Deterministic rules
 * use the day's other trades as context; CUSTOM rules come from the form's
 * checkboxes. A broken rule blocks the save until a justification is given.
 */
async function ruleEventsFor(user: CurrentUser, input: TradeInput, data: TradeWrite, tradeId: string | null): Promise<EventsResult> {
  const rules = await db.rule.findMany({ where: { userId: user.id, active: true } });
  if (rules.length === 0) return { ok: true, events: [] };
  const candidate: RuleTrade = {
    id: tradeId ?? "__new__",
    entryAt: data.entryAt as Date,
    exitAt: (data.exitAt as Date | null) ?? null,
    status: data.status ?? "OPEN",
    quantity: String(data.quantity),
    stopPrice: data.stopPrice === null || data.stopPrice === undefined ? null : String(data.stopPrice),
    pnl: data.pnl === null || data.pnl === undefined ? null : String(data.pnl),
    rMultiple: data.rMultiple === null || data.rMultiple === undefined ? null : String(data.rMultiple),
  };
  const deterministic = await evaluateCandidate(user.id, user.timeZone, candidate, rules, tradeId ?? undefined);
  const custom = rules
    .filter((r) => r.kind === "CUSTOM" && input.customRuleIds.includes(r.id))
    .map((r) => ({
      ruleId: r.id,
      title: r.title,
      status: input.customFollowed.includes(r.id) ? ("FOLLOWED" as const) : ("BROKEN" as const),
      detail: "checked by hand",
    }));
  return eventsOrJustification([...deterministic, ...custom], input);
}

async function buildTradeWrite(user: CurrentUser, formData: FormData, tradeId: string | null): Promise<BuildResult> {
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

  // Options: the contract, whose expiration must not come before the entry day (owner's zone).
  const isOption = input.assetClass === "OPTION";
  let expiresAt: Date | null = null;
  if (isOption) {
    expiresAt = input.expiresAt ? expirationInstant(input.expiresAt) : null;
    if (!expiresAt) return { ok: false, result: failure("Enter a valid expiration date.", { expiresAt: "Invalid date" }) };
    if (expirationKey(expiresAt) < dateKeyInZone(entryAt, user.timeZone)) {
      return { ok: false, result: failure("The contract expires before the entry date.", { expiresAt: "Before the entry date" }) };
    }
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

  const data: TradeWrite = {
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
    pnl: dec(metrics.pnl),
    stopPrice: input.stopPrice ?? null,
    targetPrice: input.targetPrice ?? null,
    rMultiple: dec(metrics.rMultiple),
    plannedRisk: dec(metrics.risk),
    optionType: isOption ? (input.optionType ?? null) : null,
    strikePrice: isOption ? (input.strikePrice ?? null) : null,
    expiresAt,
    notes: input.notes,
    rating: input.rating ?? null,
    mistakes: input.mistakes ?? null,
  };

  const events = await ruleEventsFor(user, input, data, tradeId);
  if (!events.ok) return { ok: false, result: events.result };

  return { ok: true, tagIds: ownedTags.map((t) => t.id), data, events: events.events, draftId: input.draftId ?? null };
}

/** Turn a shared screenshot into an attachment of the trade it was captured for. */
async function attachDraft(userId: string, tradeId: string, draftId: string | null): Promise<void> {
  if (!draftId) return;
  const pending = await db.pendingUpload.findFirst({ where: { id: draftId, userId } });
  if (!pending) return;
  await db.$transaction([
    db.attachment.create({ data: { tradeId, filename: pending.filename, storedName: pending.storedName, mimeType: pending.mimeType, size: pending.size } }),
    db.pendingUpload.delete({ where: { id: pending.id } }),
  ]);
}

function revalidateTradeViews(id?: string) {
  revalidatePath("/");
  revalidatePath("/trades");
  revalidatePath("/today");
  revalidatePath("/reports");
  if (id) revalidatePath(`/trades/${id}`);
}

export async function createTradeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const built = await buildTradeWrite(user, formData, null);
  if (!built.ok) return built.result;

  let id: string;
  try {
    const trade = await db.trade.create({
      data: {
        ...built.data,
        userId: user.id,
        tags: { connect: built.tagIds.map((tagId) => ({ id: tagId })) },
        ruleEvents: { create: built.events },
      },
      select: { id: true },
    });
    id = trade.id;
    await attachDraft(user.id, id, built.draftId);
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

  const built = await buildTradeWrite(user, formData, tradeId);
  if (!built.ok) return built.result;

  try {
    await db.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: tradeId },
        data: { ...built.data, tags: { set: built.tagIds.map((tagId) => ({ id: tagId })) } },
      });
      await tx.ruleEvent.deleteMany({ where: { tradeId } });
      if (built.events.length) {
        await tx.ruleEvent.createMany({ data: built.events.map((e) => ({ ...e, tradeId })) });
      }
    });
  } catch (error) {
    console.error("update trade failed", error);
    return failure("Could not save the trade. Check the numbers and try again.");
  }
  revalidateTradeViews(tradeId);
  return success("Trade saved.");
}

/**
 * Closes an open trade from the close sheet. Closing the whole quantity
 * fills in the exit and recomputes the figures in place; closing less splits
 * the trade: the closed part becomes a CLOSED trade of its own (same entry,
 * tags, account, stop and target, a note pointing back) and the original
 * keeps the remainder, open. Rules are evaluated for the part that closes
 * exactly as a save does; hand-checked rules keep their answers.
 */
export async function closeTradeAction(tradeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId: user.id },
    include: { tags: { select: { id: true } }, ruleEvents: { include: { rule: { select: { kind: true } } } } },
  });
  if (!trade) return failure("Trade not found.");
  if (trade.status !== "OPEN") return failure("This trade is already closed.");

  const parsed = closeTradeSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const input = parsed.data;
  const exitAt = fromDateTimeLocalValue(input.exitAt, user.timeZone);
  if (!exitAt) return failure("Enter a valid exit time.", { exitAt: "Invalid date" });
  if (exitAt.getTime() < trade.entryAt.getTime()) return failure("Exit time is before the entry time.", { exitAt: "Must be after entry" });

  const planned = planClose({ quantity: trade.quantity, fees: trade.fees }, { closeQuantity: input.closeQuantity, extraFees: input.extraFees ?? null });
  if (!planned.ok) return failure(planned.error, { [planned.field]: planned.error });
  const plan = planned.plan;

  const base = {
    side: trade.side,
    entryPrice: trade.entryPrice,
    multiplier: trade.multiplier,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice,
  };
  const closedMetrics = computeTradeMetrics({ ...base, quantity: plan.closed.quantity, fees: plan.closed.fees, exitPrice: input.exitPrice });
  const closedData = {
    quantity: plan.closed.quantity,
    fees: plan.closed.fees,
    exitPrice: input.exitPrice,
    exitAt,
    status: "CLOSED" as const,
    pnl: dec(closedMetrics.pnl),
    rMultiple: dec(closedMetrics.rMultiple),
    plannedRisk: dec(closedMetrics.risk),
  };

  const rules = await db.rule.findMany({ where: { userId: user.id, active: true } });
  const candidate: RuleTrade = {
    id: plan.kind === "full" ? trade.id : "__new__",
    entryAt: trade.entryAt,
    exitAt,
    status: "CLOSED",
    quantity: plan.closed.quantity,
    stopPrice: toPlainString(trade.stopPrice),
    pnl: closedData.pnl,
    rMultiple: closedData.rMultiple,
  };
  const verdicts = rules.length ? await evaluateCandidate(user.id, user.timeZone, candidate, rules, trade.id) : [];
  const events = eventsOrJustification(verdicts, input);
  if (!events.ok) return events.result;
  const customEvents: RuleEventWrite[] = trade.ruleEvents
    .filter((e) => e.rule.kind === "CUSTOM")
    .map((e) => ({ ruleId: e.ruleId, status: e.status, justification: e.justification }));

  const label = tradeLabel(trade);
  const total = toDecimal(trade.quantity).toFixed();
  try {
    if (plan.kind === "full") {
      await db.$transaction(async (tx) => {
        await tx.trade.update({ where: { id: trade.id }, data: { ...closedData, notes: fullCloseNotes(trade.notes, input.exitNote) } });
        await tx.ruleEvent.deleteMany({ where: { tradeId: trade.id, rule: { kind: { not: "CUSTOM" } } } });
        if (events.events.length) await tx.ruleEvent.createMany({ data: events.events.map((e) => ({ ...e, tradeId: trade.id })) });
      });
    } else {
      const remainingMetrics = computeTradeMetrics({ ...base, quantity: plan.remaining.quantity, fees: plan.remaining.fees, exitPrice: null });
      const remaining = plan.remaining;
      await db.$transaction(async (tx) => {
        await tx.trade.create({
          data: {
            userId: user.id,
            accountId: trade.accountId,
            symbol: trade.symbol,
            assetClass: trade.assetClass,
            side: trade.side,
            optionType: trade.optionType,
            strikePrice: trade.strikePrice,
            expiresAt: trade.expiresAt,
            entryPrice: trade.entryPrice,
            multiplier: trade.multiplier,
            entryAt: trade.entryAt,
            stopPrice: trade.stopPrice,
            targetPrice: trade.targetPrice,
            rating: trade.rating,
            mistakes: trade.mistakes,
            ...closedData,
            notes: partialCloseNotes({ notes: trade.notes, label, originalId: trade.id, closed: plan.closed.quantity, total, exitNote: input.exitNote }),
            tags: { connect: trade.tags.map((t) => ({ id: t.id })) },
            ruleEvents: { create: [...events.events, ...customEvents] },
          },
        });
        await tx.trade.update({
          where: { id: trade.id },
          data: {
            quantity: remaining.quantity,
            fees: remaining.fees,
            plannedRisk: dec(remainingMetrics.risk),
            notes: remainderNotes({ notes: trade.notes, closed: plan.closed.quantity, total, remaining: remaining.quantity }),
          },
        });
      });
    }
  } catch (error) {
    console.error("close trade failed", error);
    return failure("Could not close the trade. Check the numbers and try again.");
  }
  revalidateTradeViews(trade.id);
  return success(plan.kind === "full" ? `${label} closed.` : `Closed ${plan.closed.quantity} of ${total}; ${plan.remaining.quantity} still open.`);
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
