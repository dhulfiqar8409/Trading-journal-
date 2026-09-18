"use client";

import { Bar, BarChart, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { TooltipFrame } from "@/components/charts/tooltip";
import type { WeeklyAdherenceDTO } from "@/lib/queries/reports";
import { isoWeekLabel } from "@/lib/weeks";

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function RoundedBar({ x = 0, y = 0, width = 0, height = 0, dim = false }: BarShapeProps & { dim?: boolean }) {
  return <Rectangle x={x} y={y} width={width} height={height} fill={chartTheme.accent} fillOpacity={dim ? 0.8 : 1} radius={[4, 4, 0, 0]} />;
}

/** Share of rule checks followed per ISO week; one series, so the title carries the legend. */
export function WeeklyAdherenceChart({ weeks }: { weeks: WeeklyAdherenceDTO[] }) {
  const data = weeks.map((w) => ({ ...w, percent: w.adherence === null ? null : Math.round(w.adherence * 100) }));
  if (data.length === 0) return <p className="flex h-40 items-center justify-center text-sm text-muted">No rule checks recorded yet.</p>;
  return (
    <div className="h-44 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={chartTheme.grid} strokeWidth={1} />
          <XAxis dataKey="week" tickFormatter={(w: string) => w.slice(5)} tick={chartTheme.tick} axisLine={{ stroke: chartTheme.axis }} tickLine={false} minTickGap={16} />
          <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v: number) => `${v}%`} tick={chartTheme.tick} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as (typeof data)[number]) : null;
              if (!p) return null;
              return (
                <TooltipFrame
                  title={isoWeekLabel(p.week)}
                  rows={[
                    { label: "Adherence", value: p.percent === null ? "—" : `${p.percent}%` },
                    { label: "Checks followed", value: `${p.followed} of ${p.total}` },
                    { label: "Clean trades", value: `${p.cleanTrades} of ${p.tradeCount}` },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="percent" maxBarSize={24} shape={(props: BarShapeProps) => <RoundedBar {...props} />} activeBar={(props: BarShapeProps) => <RoundedBar {...props} dim />} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
