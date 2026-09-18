"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme, compactMoney, shortDateInZone } from "@/components/charts/chart-theme";
import { TooltipFrame, toneOf } from "@/components/charts/tooltip";
import { formatMoney, formatR } from "@/lib/format";
import type { CurvePointDTO } from "@/lib/queries/dashboard";

const SERIES = [
  { key: "actual", label: "Actual", color: "#3987e5" },
  { key: "mistakesRemoved", label: "Mistakes removed", color: "#d55181" },
  { key: "stopsHonoured", label: "Stops honoured", color: "#c98500" },
] as const;

interface Props {
  points: CurvePointDTO[];
  currency: string;
  timeZone: string;
  mode: "R" | "USD";
}

/** One chart, three cumulative curves; the crosshair tooltip is the scrubber and lists all three values. */
export function ThreeCurvesChart({ points, currency, timeZone, mode }: Props) {
  if (points.length === 0) return <p className="flex h-56 items-center justify-center text-sm text-muted">No closed trades in this range.</p>;
  const suffix = mode === "R" ? "R" : "";
  const keyFor = (k: (typeof SERIES)[number]["key"]) => (mode === "R" ? (`${k}R` as const) : k);
  const fmt = (v: number) => (mode === "R" ? formatR(v) : formatMoney(v, { currency, signed: true }));
  const data = points.length === 1 ? [{ ...points[0], t: points[0].t - 1, actual: 0, mistakesRemoved: 0, stopsHonoured: 0, actualR: 0, mistakesRemovedR: 0, stopsHonouredR: 0, tradeId: "start" }, ...points] : points;
  return (
    <div className="h-64 w-full min-w-0 overflow-hidden sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
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
            tickFormatter={(v: number) => (mode === "R" ? `${v}${suffix}` : compactMoney(v, currency))}
            tick={chartTheme.tick}
            axisLine={false}
            tickLine={false}
            width={mode === "R" ? 44 : 64}
          />
          <ReferenceLine y={0} stroke={chartTheme.axis} strokeWidth={1} />
          <Tooltip
            cursor={{ stroke: chartTheme.axis, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as CurvePointDTO) : null;
              if (!p || p.tradeId === "start") return null;
              return (
                <TooltipFrame
                  title={`${shortDateInZone(p.t, timeZone)} · ${p.symbol}${p.removed ? " · mistake" : ""}${p.capped ? " · stop blown" : ""}`}
                  rows={SERIES.map((s) => {
                    const v = p[keyFor(s.key)];
                    return { label: s.label, value: fmt(v), tone: toneOf(v) };
                  })}
                />
              );
            }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            iconType="plainline"
            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
            formatter={(value: string) => <span style={{ color: "var(--color-ink-2)" }}>{value}</span>}
          />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={keyFor(s.key)}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: s.color, stroke: chartTheme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
