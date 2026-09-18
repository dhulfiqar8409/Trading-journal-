/** Results bucketed by how the owner felt before the open, and planned versus unplanned days. */
import { bucketBy, type Bucket, type BreakdownTrade } from "@/lib/breakdowns";
import { dateKeyInZone } from "@/lib/tz";

export interface DayState {
  date: string;
  mood: number | null;
  sleepHours: number | null;
  focus: number | null;
  energy: number | null;
  checkedIn: boolean;
  hasPlan: boolean;
}

export type StateDimension = "mood" | "focus" | "energy" | "sleep";

const SCALE_LABELS: Record<number, string> = { 1: "1 · low", 2: "2", 3: "3", 4: "4", 5: "5 · high" };

export function sleepBucket(hours: number): { key: string; label: string; order: number } {
  if (hours < 6) return { key: "lt6", label: "Under 6h", order: 0 };
  if (hours < 7) return { key: "6-7", label: "6–7h", order: 1 };
  if (hours < 8) return { key: "7-8", label: "7–8h", order: 2 };
  return { key: "8plus", label: "8h or more", order: 3 };
}

/** Bucket closed trades by the state recorded for their entry day; days without that reading are skipped. */
export function bucketByState(trades: BreakdownTrade[], days: DayState[], timeZone: string, dimension: StateDimension): Bucket[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return bucketBy(trades, (t) => {
    const day = byDate.get(dateKeyInZone(t.entryAt, timeZone));
    if (!day) return null;
    if (dimension === "sleep") {
      if (day.sleepHours === null) return null;
      return sleepBucket(day.sleepHours);
    }
    const value = day[dimension];
    if (value === null) return null;
    return { key: String(value), label: SCALE_LABELS[value] ?? String(value), order: value };
  });
}

/** Days with a check-in plan versus days without one. */
export function plannedVsUnplanned(trades: BreakdownTrade[], days: DayState[], timeZone: string): Bucket[] {
  const planned = new Set(days.filter((d) => d.hasPlan).map((d) => d.date));
  return bucketBy(trades, (t) =>
    planned.has(dateKeyInZone(t.entryAt, timeZone))
      ? { key: "planned", label: "Planned days", order: 0 }
      : { key: "unplanned", label: "Unplanned days", order: 1 },
  );
}
