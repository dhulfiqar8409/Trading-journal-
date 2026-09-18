"use client";

import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme, compactMoney, shortDateKey } from "@/components/charts/chart-theme";
import { TooltipFrame, toneOf } from "@/components/charts/tooltip";
import type { DailyPointDTO } from "@/lib/queries/dashboard";
import { formatDateKey, formatMoney, formatR } from "@/lib/format";

interface Props {
  days: DailyPointDTO[];
  currency: string;
  mode?: "R" | "USD";
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number | [number, number];
}

/** Bars grow from the zero baseline: rounded only at the data end, coloured by sign. */
function SignedBar({ x = 0, y = 0, width = 0, height = 0, value = 0, dim = false }: BarShapeProps & { dim?: boolean }) {
  const amount = Array.isArray(value) ? value[1] - value[0] : value;
  const positive = amount >= 0;
  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill={positive ? chartTheme.profit : chartTheme.loss}
      fillOpacity={dim ? 0.8 : 1}
      radius={positive ? [4, 4, 0, 0] : [0, 0, 4, 4]}
    />
  );
}

export function DailyPnlBars({ days, currency, mode = "USD" }: Props) {
  if (days.length === 0) {
    return <p className="flex h-56 items-center justify-center text-sm text-muted">No closed trades in this range.</p>;
  }
  const inR = mode === "R";
  return (
    <div className="h-56 w-full min-w-0 overflow-hidden sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={days} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke={chartTheme.grid} strokeWidth={1} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDateKey}
            tick={chartTheme.tick}
            axisLine={{ stroke: chartTheme.axis }}
            tickLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v: number) => (inR ? `${v}R` : compactMoney(v, currency))}
            tick={chartTheme.tick}
            axisLine={false}
            tickLine={false}
            width={inR ? 44 : 64}
          />
          <ReferenceLine y={0} stroke={chartTheme.axis} strokeWidth={1} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as DailyPointDTO) : null;
              if (!p) return null;
              return (
                <TooltipFrame
                  title={formatDateKey(p.date)}
                  rows={[
                    { label: "Net R", value: formatR(p.r), tone: toneOf(p.r) },
                    { label: "Net P&L", value: formatMoney(p.pnl, { currency, signed: true }), tone: toneOf(p.pnl) },
                    { label: "Trades", value: String(p.tradeCount) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey={inR ? "r" : "pnl"}
            maxBarSize={24}
            shape={(props: BarShapeProps) => <SignedBar {...props} />}
            activeBar={(props: BarShapeProps) => <SignedBar {...props} dim />}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
