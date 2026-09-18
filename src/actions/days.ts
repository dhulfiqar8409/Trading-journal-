"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formToObject, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { checkInSchema, reviewSchema } from "@/lib/validation";

function revalidate() {
  revalidatePath("/today");
  revalidatePath("/reports");
  revalidatePath("/");
}

export async function saveCheckInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = checkInSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { date, allowedSetupIds, ...rest } = parsed.data;
  const ownedSetups = allowedSetupIds.length
    ? (await db.tag.findMany({ where: { userId: user.id, id: { in: allowedSetupIds } }, select: { id: true } })).map((t) => t.id)
    : [];
  const data = {
    maxTrades: rest.maxTrades ?? null,
    maxLossR: rest.maxLossR ?? null,
    allowedSetupIds: ownedSetups,
    focusNote: rest.focusNote ?? null,
    mood: rest.mood ?? null,
    focus: rest.focus ?? null,
    energy: rest.energy ?? null,
    sleepHours: rest.sleepHours ?? null,
  };
  await db.day.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { userId: user.id, date, ...data, checkedInAt: new Date() },
    update: { ...data, checkedInAt: new Date() },
  });
  revalidate();
  return success("Check-in saved.");
}

export async function saveReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = reviewSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { date, wentRight, wentWrong, oneChange, dayTags } = parsed.data;
  const data = { wentRight: wentRight ?? null, wentWrong: wentWrong ?? null, oneChange: oneChange ?? null, dayTags, reviewedAt: new Date() };
  await db.day.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { userId: user.id, date, ...data },
    update: data,
  });
  revalidate();
  return success("Review saved.");
}
