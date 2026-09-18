"use client";

import { useState } from "react";
import { formatMoney, formatR, pnlClass } from "@/lib/format";

type Numberish = number | string | null | undefined;

interface Props {
  pnl: Numberish;
  r: Numberish;
  currency?: string;
  mode: "R" | "USD";
  className?: string;
  /** Text shown in R mode when the trade has no stop. */
  noStopLabel?: string;
  signed?: boolean;
}

/**
 * A P&L figure in the owner's preferred unit; tapping it flips to the other
 * unit. R needs a stop: without one the primary unit is "no stop".
 */
export function PnlFigure({ pnl, r, currency = "USD", mode, className = "", noStopLabel = "no stop", signed = true }: Props) {
  const [flipped, setFlipped] = useState(false);
  const hasR = r !== null && r !== undefined && r !== "";
  const hasPnl = pnl !== null && pnl !== undefined && pnl !== "";
  const showR = (mode === "R") !== flipped;
  const money = formatMoney(pnl, { currency, signed });
  const rText = hasR ? formatR(r) : noStopLabel;
  const primary = showR ? rText : money;
  const secondary = showR ? money : rText;
  const tone = showR && !hasR ? "text-muted" : pnlClass(showR ? (hasR ? r : pnl) : pnl);
  if (!hasPnl && !hasR) return <span className={`num text-ink-2 ${className}`}>—</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFlipped((v) => !v);
      }}
      title={`${secondary} · tap to switch`}
      aria-label={`${primary}, ${secondary}`}
      className={`num inline cursor-pointer rounded px-0.5 text-left transition-colors hover:bg-surface-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${tone} ${className}`}
    >
      {primary}
    </button>
  );
}
