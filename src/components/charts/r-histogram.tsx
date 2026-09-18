"use client";

import { Bar, BarChart, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { TooltipFrame } from "@/components/charts/tooltip";

interface Bin {
  key: string;
  label: string;
  count: number;
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function RoundedBar({ x = 0, y = 0, width = 0, height = 0, dim = false }: BarShapeProps & { dim?: boolean }) {
  return <Rectangle x={x} y={y} width={width} height={height} fill={chartTheme.accent} fillOpacity={dim ? 0.8 : 1} radius={[4, 4, 0, 0]} />;
}

/** Count of closed trades per R-multiple bin; a single series, so the title carries the legend. */
export function RHistogram({ bins, total }: { bins: Bin[]; total: number }) {
  if (total === 0) return <p className="flex h-40 items-center justify-center text-sm text-muted">Add stops to your trades to see the R distribution.</p>;
  return (
    <div className="h-48 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bins} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke={chartTheme.grid} strokeWidth={1} />
          <XAxis dataKey="label" tick={{ ...chartTheme.tick, fontSize: 10 }} axisLine={{ stroke: chartTheme.axis }} tickLine={false} interval={0} tickFormatter={(l: string) => l.replace(" to ", "…").replace("R", "")} />
          <YAxis allowDecimals={false} tick={chartTheme.tick} axisLine={false} tickLine={false} width={32} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as Bin) : null;
              if (!p) return null;
              return <TooltipFrame title={p.label} rows={[{ label: "Trades", value: `${p.count} of ${total}` }]} />;
            }}
          />
          <Bar dataKey="count" maxBarSize={24} shape={(props: BarShapeProps) => <RoundedBar {...props} />} activeBar={(props: BarShapeProps) => <RoundedBar {...props} dim />} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
