import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Never prerender: the check must hit the database on every request.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
