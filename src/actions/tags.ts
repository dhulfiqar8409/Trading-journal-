"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure, formToObject, success, zodErrorToResult, type ActionState } from "@/lib/form";
import { tagSchema } from "@/lib/validation";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

function revalidate() {
  revalidatePath("/tags");
  revalidatePath("/trades");
  revalidatePath("/");
}

export async function createTagAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = tagSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await db.tag.create({ data: { ...parsed.data, userId: user.id } });
  } catch (error) {
    if (isUniqueViolation(error)) return failure("A tag with that name already exists.", { name: "Already exists" });
    console.error("create tag failed", error);
    return failure("Could not create the tag.");
  }
  revalidate();
  return success("Tag created.");
}

export async function updateTagAction(tagId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = tagSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const existing = await db.tag.findFirst({ where: { id: tagId, userId: user.id }, select: { id: true } });
  if (!existing) return failure("Tag not found.");
  try {
    await db.tag.update({ where: { id: tagId }, data: parsed.data });
  } catch (error) {
    if (isUniqueViolation(error)) return failure("A tag with that name already exists.", { name: "Already exists" });
    console.error("update tag failed", error);
    return failure("Could not save the tag.");
  }
  revalidate();
  return success("Tag saved.");
}

export async function deleteTagAction(tagId: string): Promise<void> {
  const user = await requireUser();
  await db.tag.deleteMany({ where: { id: tagId, userId: user.id } });
  revalidate();
}
