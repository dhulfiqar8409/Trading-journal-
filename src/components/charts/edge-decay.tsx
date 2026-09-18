"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme, shortDateInZone } from "@/components/charts/chart-theme";
import { TooltipFrame, toneOf } from "@/components/charts/tooltip";
import { formatR } from "@/lib/format";
import type { SetupDecayDTO } from "@/lib/queries/reports";

/** Rolling expectancy in R for one setup, with the 95% band as a wash around the line. */
export function EdgeDecayChart({ setup, timeZone }: { setup: SetupDecayDTO; timeZone: string }) {
  if (setup.points.length === 0) return <p className="flex h-32 items-center justify-center text-xs text-muted">Needs more closed trades with stops.</p>;
  const data = setup.points.map((p) => ({ ...p, band: [p.lower, p.upper] as [number, number] }));
  return (
    <div className="h-36 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={chartTheme.grid} strokeWidth={1} />
          <XAxis dataKey="index" tick={chartTheme.tick} axisLine={{ stroke: chartTheme.axis }} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => `${v}R`} tick={chartTheme.tick} axisLine={false} tickLine={false} width={40} />
          <ReferenceLine y={0} stroke={chartTheme.axis} strokeWidth={1} />
          <Tooltip
            cursor={{ stroke: chartTheme.axis, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as (typeof data)[number]) : null;
              if (!p) return null;
              return (
                <TooltipFrame
                  title={`Trade ${p.index} · ${shortDateInZone(p.t, timeZone)}`}
                  rows={[
                    { label: "Rolling expectancy", value: formatR(p.mean), tone: toneOf(p.mean) },
                    { label: "95% band", value: `${formatR(p.lower)} to ${formatR(p.upper)}` },
                    { label: "Trades in window", value: `${p.n}` },
                  ]}
                />
              );
            }}
          />
          <Area type="monotone" dataKey="band" stroke="none" fill={chartTheme.accent} fillOpacity={0.12} isAnimationActive={false} />
          <Line type="monotone" dataKey="mean" stroke={chartTheme.accent} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: chartTheme.accent, stroke: chartTheme.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
