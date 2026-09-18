"use client";

import { Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartTheme, shortDateInZone } from "@/components/charts/chart-theme";
import { TooltipFrame } from "@/components/charts/tooltip";
import type { EdgeScoreDTO } from "@/lib/queries/dashboard";

const SHORT: Record<string, string> = {
  winRate: "Win rate",
  profitFactor: "Profit factor",
  payoff: "Payoff",
  drawdown: "Drawdown",
  recovery: "Recovery",
  consistency: "Consistency",
};

export function EdgeRadar({ edge }: { edge: EdgeScoreDTO }) {
  const data = edge.factors.map((f) => ({ factor: SHORT[f.key] ?? f.label, score: f.score, label: f.label }));
  return (
    <div className="h-56 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke={chartTheme.grid} />
          <PolarAngleAxis dataKey="factor" tick={{ fill: "var(--color-ink-2)", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as (typeof data)[number]) : null;
              if (!p) return null;
              return <TooltipFrame title={p.label} rows={[{ label: "Score", value: `${Math.round(p.score)} / 100` }]} />;
            }}
          />
          <Radar dataKey="score" stroke={chartTheme.accent} strokeWidth={2} fill={chartTheme.accent} fillOpacity={0.12} dot={{ r: 3, fill: chartTheme.accent, stroke: chartTheme.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EdgeTrend({ trend, timeZone }: { trend: EdgeScoreDTO["trend"]; timeZone: string }) {
  if (trend.length < 2) return <p className="text-xs text-muted">The trend appears after a few more closed trades.</p>;
  return (
    <div className="h-16 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Tooltip
            cursor={{ stroke: chartTheme.axis, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload && payload.length ? (payload[0].payload as (typeof trend)[number]) : null;
              if (!p) return null;
              return <TooltipFrame title={`After trade ${p.index} · ${shortDateInZone(p.t, timeZone)}`} rows={[{ label: "Edge Score", value: `${p.score}` }]} />;
            }}
          />
          <Line type="monotone" dataKey="score" stroke={chartTheme.accent} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: chartTheme.accent, stroke: chartTheme.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
