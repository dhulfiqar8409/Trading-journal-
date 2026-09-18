import Link from "next/link";
import type { ResolvedRange } from "@/lib/queries/dashboard";
import { withParams } from "@/lib/search-params";

const PRESETS: { key: string; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

export function RangeSelector({ range, current }: { range: ResolvedRange; current: Record<string, string> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Date range">
        {PRESETS.map((p) => {
          const active = range.key === p.key;
          return (
            <Link
              key={p.key}
              href={`/${withParams(current, { range: p.key, from: null, to: null })}`}
              aria-current={active ? "true" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"}`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>
      <details className="relative" open={range.key === "custom"}>
        <summary
          className={`btn btn-sm cursor-pointer list-none ${range.key === "custom" ? "border-accent text-ink" : ""}`}
        >
          Custom
        </summary>
        <form method="get" className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3 sm:absolute sm:left-0 sm:z-10 sm:mt-1">
          <input type="hidden" name="range" value="custom" />
          {current.month ? <input type="hidden" name="month" value={current.month} /> : null}
          <div>
            <label htmlFor="r-from" className="label">
              From
            </label>
            <input id="r-from" type="date" name="from" defaultValue={range.fromKey ?? ""} className="input" />
          </div>
          <div>
            <label htmlFor="r-to" className="label">
              To
            </label>
            <input id="r-to" type="date" name="to" defaultValue={range.toKey ?? ""} className="input" />
          </div>
          <button type="submit" className="btn btn-primary btn-sm">
            Apply
          </button>
        </form>
      </details>
      <span className="text-sm text-muted">{range.label}</span>
    </div>
  );
}
