import { formatMoney, formatR, pnlClass } from "@/lib/format";

export function Pnl({
  value,
  currency = "USD",
  className = "",
  compact = false,
}: {
  value: number | string | null | undefined;
  currency?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={`num ${pnlClass(value)} ${className}`}>{formatMoney(value, { currency, signed: true, compact })}</span>
  );
}

export function RMultiple({ value, className = "" }: { value: number | string | null | undefined; className?: string }) {
  return <span className={`num ${pnlClass(value)} ${className}`}>{formatR(value)}</span>;
}

export function SideBadge({ side }: { side: "LONG" | "SHORT" }) {
  return (
    <span className={`badge ${side === "LONG" ? "border-accent/40 text-accent-strong" : "border-warn/40 text-warn"}`}>{side}</span>
  );
}

export function StatusBadge({ status }: { status: "OPEN" | "CLOSED" }) {
  return <span className={`badge ${status === "OPEN" ? "border-warn/40 text-warn" : ""}`}>{status === "OPEN" ? "Open" : "Closed"}</span>;
}
