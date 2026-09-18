import { ImageResponse } from "next/og";
import type { WeekReview } from "@/lib/queries/week";

const size = { width: 1200, height: 630 };

function r(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}R`;
}

function money(v: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, signDisplay: "exceptZero", maximumFractionDigits: 0 }).format(v);
}

/** Server-rendered share image for one week; only inline styles and flex containers, as satori requires. */
export function weekCardImage(week: WeekReview, hideDollars: boolean): ImageResponse {
  const profit = "#2ec39a";
  const loss = "#f3785a";
  const ink = "#eef1f5";
  const muted = "#7b8595";
  const netColor = week.rCount ? (week.netR > 0 ? profit : week.netR < 0 ? loss : ink) : ink;
  const stat = (label: string, value: string, sub: string, color = ink) => (
    <div style={{ display: "flex", flexDirection: "column", width: 250 }}>
      <span style={{ fontSize: 22, color: muted }}>{label}</span>
      <span style={{ fontSize: 64, fontWeight: 700, color, lineHeight: 1.05 }}>{value}</span>
      <span style={{ fontSize: 20, color: muted }}>{sub}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 56,
          backgroundColor: "#0b0d12",
          backgroundImage: "radial-gradient(circle at 10% 0%, rgba(110,99,232,0.45), rgba(11,13,18,0) 55%)",
          color: ink,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 24, color: muted }}>Darkpools · week in review</span>
            <span style={{ fontSize: 44, fontWeight: 700 }}>{week.label}</span>
          </div>
          <span style={{ fontSize: 22, color: muted }}>
            {week.entered} trades · {week.daysTraded} days
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 48 }}>
          {stat("Net R", week.rCount ? r(week.netR) : "—", hideDollars ? `${week.rCount} trades with stops` : money(week.netPnl, week.currency), netColor)}
          {stat("Edge Score", week.edgeScore === null ? "—" : String(week.edgeScore), `last ${week.edgeSample} trades`)}
          {stat("Adherence", week.adherence === null ? "—" : `${Math.round(week.adherence * 100)}%`, `${week.checksTotal} rule checks`)}
          {stat("Win rate", week.winRate === null ? "—" : `${Math.round(week.winRate * 100)}%`, `${week.wins} of ${week.closed} closed`)}
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 44 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: 24, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: 20, color: muted }}>Top setup</span>
            <span style={{ fontSize: 30, fontWeight: 600 }}>{week.topSetup ? `${week.topSetup.name} ${r(week.topSetup.netR)}` : "No setup tags"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: 24, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: 20, color: muted }}>Biggest leak</span>
            <span style={{ fontSize: 30, fontWeight: 600 }}>
              {week.biggestLeak ? `${week.biggestLeak.title}${week.biggestLeak.impactR !== null ? ` ${r(week.biggestLeak.impactR)}` : hideDollars ? "" : ` ${money(week.biggestLeak.impactPnl, week.currency)}`}` : "Nothing stands out"}
            </span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}

export const weekImageSize = size;
