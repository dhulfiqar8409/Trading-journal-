import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { IMPORT_FIELDS } from "@/lib/csv";
import { db } from "@/lib/db";
import { requireSameOrigin } from "@/lib/origin-guard";

export const dynamic = "force-dynamic";

const presetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200)),
  options: z.object({
    defaultAssetClass: z.string().max(20).optional(),
    defaultMultiplier: z.string().max(32).optional(),
    dayFirst: z.boolean().optional(),
    timeZone: z.string().max(64).optional(),
  }),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const presets = await db.importPreset.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } });
  return NextResponse.json(presets.map((p) => ({ id: p.id, name: p.name, mapping: p.mapping, options: p.options })));
}

/** Saves (or replaces) a column mapping under a broker name. */
export async function POST(request: Request) {
  const refused = requireSameOrigin(request);
  if (refused) return refused;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = presetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid preset" }, { status: 400 });
  const { name, mapping, options } = parsed.data;
  const preset = await db.importPreset.upsert({
    where: { userId_name: { userId: user.id, name } },
    create: { userId: user.id, name, mapping, options },
    update: { mapping, options },
  });
  return NextResponse.json({ id: preset.id, name: preset.name, mapping: preset.mapping, options: preset.options }, { status: 201 });
}
