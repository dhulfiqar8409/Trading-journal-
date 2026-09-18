import { PnlFigure } from "@/components/figure";
import { formatPercent } from "@/lib/format";
import type { BucketDTO } from "@/lib/queries/reports";

export function BucketTable({
  rows,
  currency,
  label,
  mode,
  empty = "Not enough data yet.",
}: {
  rows: BucketDTO[];
  currency: string;
  label: string;
  mode: "R" | "USD";
  empty?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{label}</th>
          <th className="text-right">Trades</th>
          <th className="text-right">Win rate</th>
          <th className="text-right">Expectancy</th>
          <th className="text-right">{mode === "R" ? "Net R" : "Net P&L"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.key}>
            <td className="font-medium">{b.label}</td>
            <td className="num text-right text-ink-2">{b.tradeCount}</td>
            <td className="num text-right text-ink-2">{formatPercent(b.winRate, 0)}</td>
            <td className="text-right">
              <PnlFigure pnl={b.expectancy} r={b.expectancyR} currency={currency} mode={mode} noStopLabel="no stops" />
            </td>
            <td className="text-right">
              <PnlFigure pnl={b.netPnl} r={b.rCount ? b.netR : null} currency={currency} mode={mode} noStopLabel="no stops" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
