/**
 * Process streaks: consecutive sessions that were fully journaled and
 * rule-compliant, regardless of P&L. Badges are quiet and never reward a
 * run of green days.
 */
import { Decimal, toDecimal, type DecimalInput } from "@/lib/decimal";

export interface SessionInput {
  /** "YYYY-MM-DD" in the owner's zone; one entry per day with at least one trade. */
  date: string;
  tradeCount: number;
  allTagged: boolean;
  checkedIn: boolean;
  reviewed: boolean;
  ruleBroken: boolean;
  /** Day has a plan (max trades or max loss set before the open). */
  planned: boolean;
  /** Trades and loss stayed within that plan. */
  withinPlan: boolean;
  pnl: DecimalInput;
}

export interface StreakSummary {
  current: number;
  best: number;
  /** What ended the current run, when the latest session did not qualify. */
  latestMissing: string[];
  sessions: number;
}

export interface Badge {
  key: string;
  label: string;
  count: number;
  threshold: number;
}

export function isFullyJournaled(s: SessionInput): boolean {
  return s.checkedIn && s.reviewed && s.allTagged;
}

export function qualifies(s: SessionInput): boolean {
  return isFullyJournaled(s) && !s.ruleBroken;
}

export function missingFor(s: SessionInput): string[] {
  const missing: string[] = [];
  if (!s.checkedIn) missing.push("check-in");
  if (!s.reviewed) missing.push("review");
  if (!s.allTagged) missing.push("tags on every trade");
  if (s.ruleBroken) missing.push("a rule was broken");
  return missing;
}

export function processStreak(sessions: SessionInput[]): StreakSummary {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  let best = 0;
  let run = 0;
  for (const s of sorted) {
    run = qualifies(s) ? run + 1 : 0;
    if (run > best) best = run;
  }
  let current = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (!qualifies(sorted[i])) break;
    current++;
  }
  const latest = sorted[sorted.length - 1];
  return { current, best, latestMissing: latest ? missingFor(latest) : [], sessions: sorted.length };
}

const THRESHOLDS = [5, 10, 25, 50, 100];

function highestReached(count: number): number | null {
  let reached: number | null = null;
  for (const t of THRESHOLDS) if (count >= t) reached = t;
  return reached;
}

/** Earned badges: the highest threshold reached for each quiet, process-based count. */
export function badges(sessions: SessionInput[]): Badge[] {
  const redReviewed = sessions.filter((s) => toDecimal(s.pnl).lessThan(0) && s.reviewed).length;
  const onPlan = sessions.filter((s) => s.planned && s.withinPlan && !s.ruleBroken).length;
  const journaled = sessions.filter(isFullyJournaled).length;
  const out: Badge[] = [];
  const add = (key: string, count: number, label: (n: number) => string) => {
    const t = highestReached(count);
    if (t !== null) out.push({ key, label: label(t), count, threshold: t });
  };
  add("red-reviewed", redReviewed, (n) => `${n} red days fully reviewed`);
  add("on-plan", onPlan, (n) => `${n} sessions on plan`);
  add("journaled", journaled, (n) => `${n} sessions fully journaled`);
  return out;
}

export function netOf(sessions: SessionInput[]): Decimal {
  return sessions.reduce((acc, s) => acc.plus(toDecimal(s.pnl)), new Decimal(0));
}
