import type { BudgetDTO } from "@/lib/queries/today";
import { formatMoney } from "@/lib/format";

type Tone = "ok" | "warn" | "over" | "none";

function toneFor(used: number, allowed: number | null): Tone {
  if (allowed === null) return "none";
  if (allowed === 0) return used > 0 ? "over" : "ok";
  const ratio = used / allowed;
  if (ratio >= 1) return "over";
  if (ratio >= 0.7) return "warn";
  return "ok";
}

const FILL: Record<Tone, string> = {
  ok: "bg-accent",
  warn: "bg-warn",
  over: "bg-loss-mark",
  none: "bg-line-strong",
};

export function BudgetBar({
  label,
  used,
  allowed,
  format,
  note,
}: {
  label: string;
  used: number;
  allowed: number | null;
  format: (n: number) => string;
  note?: string;
}) {
  const tone = toneFor(used, allowed);
  const percent = allowed === null ? 0 : allowed === 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / allowed) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-2">{label}</span>
        <span className={`num font-semibold ${tone === "over" ? "text-loss" : tone === "warn" ? "text-warn" : "text-ink"}`}>
          {format(used)}
          {allowed !== null ? <span className="font-normal text-muted"> of {format(allowed)}</span> : <span className="font-normal text-muted"> · no limit</span>}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={allowed ?? undefined}
        aria-valuenow={used}
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${FILL[tone]}`} style={{ width: `${allowed === null ? 0 : percent}%` }} />
      </div>
      {note ? <p className="mt-1 text-[11px] text-muted">{note}</p> : null}
    </div>
  );
}

/** Today's plan budget: trades used and loss used against the plan (or the matching rules). */
export function BudgetBars({ budget, currency }: { budget: BudgetDTO; currency: string }) {
  const useUsd = budget.lossAllowedR === null && budget.lossAllowedUsd !== null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <BudgetBar
        label="Trades today"
        used={budget.tradesUsed}
        allowed={budget.tradesAllowed}
        format={(n) => `${n}`}
        note={budget.tradesSource === "rule" ? "Limit from your rules" : budget.tradesSource === "plan" ? "Limit from today's plan" : "Set a limit in the check-in"}
      />
      {useUsd ? (
        <BudgetBar
          label="Loss today"
          used={budget.lossUsedUsd}
          allowed={budget.lossAllowedUsd}
          format={(n) => formatMoney(n, { currency })}
          note="Limit from your rules"
        />
      ) : (
        <BudgetBar
          label="Loss today"
          used={budget.lossUsedR}
          allowed={budget.lossAllowedR}
          format={(n) => `${n.toFixed(1)}R`}
          note={budget.lossSource === "rule" ? "Limit from your rules" : budget.lossSource === "plan" ? "Limit from today's plan" : "Set a limit in the check-in"}
        />
      )}
    </div>
  );
}
