import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Pnl } from "@/components/pnl";
import { formatDateKey, formatMoney } from "@/lib/format";
import type { CalendarDTO } from "@/lib/queries/dashboard";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function compact(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)}K`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/** Five intensity steps within each hue; a neutral midpoint for zero. */
function cellStyle(pnl: number, maxAbs: number): React.CSSProperties {
  if (pnl === 0 || maxAbs === 0) return { backgroundColor: "var(--color-surface-3)" };
  const ratio = Math.min(1, Math.abs(pnl) / maxAbs);
  const alpha = 0.28 + 0.62 * ratio;
  const rgb = pnl > 0 ? "18, 168, 132" : "234, 90, 58";
  return { backgroundColor: `rgba(${rgb}, ${alpha.toFixed(2)})` };
}

export function CalendarHeatmap({ calendar, currency, hrefFor }: { calendar: CalendarDTO; currency: string; hrefFor: (month: string) => string }) {
  const [year, month] = calendar.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const byDate = new Map(calendar.days.map((d) => [d.date, d]));
  const maxAbs = calendar.days.reduce((m, d) => Math.max(m, Math.abs(d.pnl)), 0);
  const cells: (number | null)[] = [...Array<null>(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={hrefFor(calendar.prevMonth)} className="btn btn-sm" aria-label="Previous month">
            <ChevronLeftIcon width={16} height={16} />
          </Link>
          <Link href={hrefFor(calendar.nextMonth)} className="btn btn-sm" aria-label="Next month">
            <ChevronRightIcon width={16} height={16} />
          </Link>
          <span className="ml-2 text-sm font-medium">
            {MONTH_NAMES[month - 1]} {year}
          </span>
        </div>
        <p className="text-xs text-muted">
          <Pnl value={calendar.monthPnl} currency={currency} className="font-semibold" /> · {calendar.tradeCount} trades
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted" aria-hidden>
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label={`Daily P&L for ${MONTH_NAMES[month - 1]} ${year}`}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} className="aspect-square" aria-hidden />;
          const key = `${calendar.month}-${String(day).padStart(2, "0")}`;
          const entry = byDate.get(key);
          const label = entry
            ? `${formatDateKey(key)}: ${formatMoney(entry.pnl, { currency, signed: true })} over ${entry.tradeCount} trade${entry.tradeCount === 1 ? "" : "s"}`
            : `${formatDateKey(key)}: no trades`;
          return (
            <div
              key={key}
              role="gridcell"
              tabIndex={0}
              title={label}
              aria-label={label}
              className={`flex aspect-square flex-col items-start justify-between rounded-md border border-line/60 p-1 text-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                entry ? "text-ink" : "bg-canvas text-muted"
              }`}
              style={entry ? cellStyle(entry.pnl, maxAbs) : undefined}
            >
              <span className="leading-none">{day}</span>
              {entry ? <span className="num w-full truncate text-right text-[9px] font-semibold leading-none sm:text-[10px]">{compact(entry.pnl)}</span> : null}
            </div>
          );
        })}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show as table</summary>
        {calendar.days.length ? (
          <table className="table mt-2">
            <thead>
              <tr>
                <th>Day</th>
                <th className="text-right">Trades</th>
                <th className="text-right">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {calendar.days.map((d) => (
                <tr key={d.date}>
                  <td className="num">{formatDateKey(d.date)}</td>
                  <td className="num text-right">{d.tradeCount}</td>
                  <td className="text-right">
                    <Pnl value={d.pnl} currency={currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-xs text-muted">No closed trades this month.</p>
        )}
      </details>
    </div>
  );
}
