import { Pnl } from "@/components/pnl";
import { formatPercent } from "@/lib/format";
import type { BreakdownDTO } from "@/lib/queries/dashboard";

export function BreakdownTable({ rows, currency, keyLabel, empty }: { rows: BreakdownDTO[]; currency: string; keyLabel: string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{keyLabel}</th>
          <th className="text-right">Trades</th>
          <th className="text-right">Win rate</th>
          <th className="text-right">Net P&L</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="font-medium">{r.key}</td>
            <td className="num text-right text-ink-2">{r.tradeCount}</td>
            <td className="num text-right text-ink-2">{formatPercent(r.winRate, 0)}</td>
            <td className="text-right">
              <Pnl value={r.netPnl} currency={currency} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
