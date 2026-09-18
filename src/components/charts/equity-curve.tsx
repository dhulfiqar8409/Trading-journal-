"use client";

import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme, compactMoney, shortDateInZone } from "@/components/charts/chart-theme";
import { TooltipFrame, toneOf } from "@/components/charts/tooltip";
import type { EquityPointDTO } from "@/lib/queries/dashboard";
import { formatMoney, formatR } from "@/lib/format";

interface Props {
  points: EquityPointDTO[];
  currency: string;
  timeZone: string;
  mode?: "R" | "USD";
}

export function EquityCurve({ points, currency, timeZone, mode = "USD" }: Props) {
  if (points.length === 0) {
    return <p className="flex h-56 items-center justify-center text-sm text-muted">No closed trades in this range.</p>;
  }
  const inR = mode === "R";
  const key = inR ? "cumulativeR" : "cumulative";
  const fmt = (v: number) => (inR ? formatR(v) : formatMoney(v, { currency, signed: true }));
  const last = points[points.length - 1];
  const data =
    points.length === 1
      ? [{ ...points[0], t: points[0].t - 1, cumulative: 0, cumulativeR: 0, pnl: 0, r: 0, symbol: "", tradeId: "start" }, ...points]
      : points;

  return (
    <div className="h-64 w-full min-w-0 overflow-hidden sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="equityWash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartTheme.accent} stopOpacity={0.18} />
              <stop offset="100%" stopColor={chartTheme.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={chartTheme.grid} strokeWidth={1} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => shortDateInZone(t, timeZone)}
            tick={chartTheme.tick}
            axisLine={{ stroke: chartTheme.axis }}
            tickLine={false}
            minTickGap={40}
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
            cursor={{ stroke: chartTheme.axis, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as EquityPointDTO) : null;
              if (!p || p.tradeId === "start") return null;
              return (
                <TooltipFrame
                  title={`${shortDateInZone(p.t, timeZone)} · ${p.symbol}`}
                  rows={
                    inR
                      ? [
                          { label: "Cumulative", value: formatR(p.cumulativeR), tone: toneOf(p.cumulativeR) },
                          { label: "Trade", value: p.r === null ? "no stop" : formatR(p.r), tone: p.r === null ? null : toneOf(p.r) },
                          { label: "In currency", value: formatMoney(p.cumulative, { currency, signed: true }), tone: toneOf(p.cumulative) },
                        ]
                      : [
                          { label: "Cumulative", value: formatMoney(p.cumulative, { currency, signed: true }), tone: toneOf(p.cumulative) },
                          { label: "Trade", value: formatMoney(p.pnl, { currency, signed: true }), tone: toneOf(p.pnl) },
                        ]
                  }
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey={key}
            stroke={chartTheme.accent}
            strokeWidth={2}
            fill="url(#equityWash)"
            dot={false}
            activeDot={{ r: 4, fill: chartTheme.accent, stroke: chartTheme.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <ReferenceDot
            x={last.t}
            y={inR ? last.cumulativeR : last.cumulative}
            r={4}
            fill={chartTheme.accent}
            stroke={chartTheme.surface}
            strokeWidth={2}
            label={{
              value: fmt(inR ? last.cumulativeR : last.cumulative),
              position: "left",
              offset: 10,
              fill: "var(--color-ink)",
              fontSize: 11,
              fontWeight: 600,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
