"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { evaluateRules, isDeterministic } from "@/lib/rules";
import { toRuleLike, toRuleTrade } from "@/lib/queries/rules";
import { endOfDayInZone, startOfDayInZone } from "@/lib/tz";
import { justificationSchema, ruleSchema } from "@/lib/validation";

function revalidate() {
  revalidatePath("/rules");
  revalidatePath("/today");
  revalidatePath("/trades");
  revalidatePath("/reports");
  revalidatePath("/");
}

export async function createRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = ruleSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { title, kind, value, timeValue, active } = parsed.data;
  await db.rule.create({ data: { userId: user.id, title, kind, value: value ?? null, timeValue: timeValue ?? null, active } });
  revalidate();
  return success("Rule added.");
}

export async function updateRuleAction(ruleId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = ruleSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const existing = await db.rule.findFirst({ where: { id: ruleId, userId: user.id }, select: { id: true } });
  if (!existing) return failure("Rule not found.");
  const { title, kind, value, timeValue, active } = parsed.data;
  await db.rule.update({ where: { id: ruleId }, data: { title, kind, value: value ?? null, timeValue: timeValue ?? null, active } });
  revalidate();
  return success("Rule saved.");
}

export async function toggleRuleAction(ruleId: string): Promise<void> {
  const user = await requireUser();
  const rule = await db.rule.findFirst({ where: { id: ruleId, userId: user.id }, select: { id: true, active: true } });
  if (!rule) return;
  await db.rule.update({ where: { id: rule.id }, data: { active: !rule.active } });
  revalidate();
}

export async function deleteRuleAction(ruleId: string): Promise<void> {
  const user = await requireUser();
  await db.rule.deleteMany({ where: { id: ruleId, userId: user.id } });
  revalidate();
}

/**
 * Re-evaluate every deterministic rule for the trades of one day. Existing
 * justifications survive as long as the rule is still broken; rules that no
 * longer apply lose their event.
 */
export async function recheckDayAction(dateKey: string): Promise<void> {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
  const [rules, trades] = await Promise.all([
    db.rule.findMany({ where: { userId: user.id, active: true } }),
    db.trade.findMany({
      where: { userId: user.id, entryAt: { gte: startOfDayInZone(dateKey, user.timeZone), lt: endOfDayInZone(dateKey, user.timeZone) } },
      include: { ruleEvents: true },
    }),
  ]);
  const ruleLikes = rules.map(toRuleLike);
  const dayTrades = trades.map(toRuleTrade);
  const deterministicIds = rules.filter((r) => isDeterministic(r.kind)).map((r) => r.id);

  await db.$transaction(async (tx) => {
    for (const trade of trades) {
      const evaluations = evaluateRules(ruleLikes, toRuleTrade(trade), { timeZone: user.timeZone, dayTrades });
      const applicable = new Set(evaluations.map((e) => e.ruleId));
      await tx.ruleEvent.deleteMany({
        where: { tradeId: trade.id, ruleId: { in: deterministicIds.filter((id) => !applicable.has(id)) } },
      });
      for (const evaluation of evaluations) {
        const existing = trade.ruleEvents.find((e) => e.ruleId === evaluation.ruleId);
        const status =
          evaluation.status === "FOLLOWED" ? "FOLLOWED" : existing?.status === "OVERRIDDEN" ? "OVERRIDDEN" : "BROKEN";
        const justification = evaluation.status === "FOLLOWED" ? null : (existing?.justification ?? null);
        await tx.ruleEvent.upsert({
          where: { tradeId_ruleId: { tradeId: trade.id, ruleId: evaluation.ruleId } },
          create: { tradeId: trade.id, ruleId: evaluation.ruleId, status, justification },
          update: { status, justification },
        });
      }
    }
  });
  revalidate();
}

export async function justifyEventAction(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = justificationSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const event = await db.ruleEvent.findFirst({ where: { id: eventId, trade: { userId: user.id } }, select: { id: true, status: true } });
  if (!event) return failure("Event not found.");
  if (event.status === "FOLLOWED") return failure("This rule was followed; nothing to justify.");
  await db.ruleEvent.update({
    where: { id: event.id },
    data: { justification: parsed.data.justification, status: parsed.data.overridden ? "OVERRIDDEN" : "BROKEN" },
  });
  revalidate();
  return success("Justification saved.");
}
