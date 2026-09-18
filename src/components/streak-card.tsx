import Link from "next/link";
import type { StreakDTO } from "@/lib/queries/streaks";

/** Quiet process streak: sessions fully journaled and rule-compliant, whatever the P&L. */
export function StreakCard({ data, compact = false }: { data: StreakDTO; compact?: boolean }) {
  const { streak, badges } = data;
  return (
    <section className="card card-pad" aria-label="Process streak">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Process streak</h2>
        {!compact ? (
          <Link href="/reports" className="text-xs text-accent hover:text-accent-strong">
            Reports
          </Link>
        ) : null}
      </div>
      <div className="mt-2 flex items-end gap-3">
        <p className="text-4xl font-semibold leading-none">{streak.current}</p>
        <p className="pb-0.5 text-xs text-muted">
          session{streak.current === 1 ? "" : "s"} in a row fully journaled and on the rules
          <br />
          best {streak.best} · {streak.sessions} session{streak.sessions === 1 ? "" : "s"} logged
        </p>
      </div>
      {streak.latestMissing.length ? (
        <p className="mt-2 text-xs text-warn">Latest session is missing: {streak.latestMissing.join(", ")}.</p>
      ) : streak.sessions ? (
        <p className="mt-2 text-xs text-muted">Check-in, review and a tag on every trade keep it going. Green days do not count for anything here.</p>
      ) : (
        <p className="mt-2 text-xs text-muted">Log a trade, check in and review the day to start.</p>
      )}
      {badges.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <li key={b.key} className="badge">
              {b.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
