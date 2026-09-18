import { PnlFigure } from "@/components/figure";
import { formatPercent } from "@/lib/format";
import type { BreakdownDTO } from "@/lib/queries/dashboard";

export function BreakdownTable({
  rows,
  currency,
  keyLabel,
  empty,
  mode = "USD",
}: {
  rows: BreakdownDTO[];
  currency: string;
  keyLabel: string;
  empty: string;
  mode?: "R" | "USD";
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{keyLabel}</th>
          <th className="text-right">Trades</th>
          <th className="text-right">Win rate</th>
          <th className="text-right">{mode === "R" ? "Net R" : "Net P&L"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="font-medium">{r.key}</td>
            <td className="num text-right text-ink-2">{r.tradeCount}</td>
            <td className="num text-right text-ink-2">{formatPercent(r.winRate, 0)}</td>
            <td className="text-right">
              <PnlFigure pnl={r.netPnl} r={r.rTradeCount ? r.netR : null} currency={currency} mode={mode} noStopLabel="no stops" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
