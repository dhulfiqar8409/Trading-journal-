"use client";

import { useEffect, useRef, useState } from "react";

const DURATION = 700;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Progress from 0 to 1 over the roll-up duration, once, on mount. Returns 1
 * immediately when the viewer prefers reduced motion.
 */
export function useRollUp(active = true): number {
  const [progress, setProgress] = useState(() => (active ? 0 : 1));
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setTimeout(() => setProgress(1), 0);
      return () => window.clearTimeout(id);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setProgress(easeOutCubic(t));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [active]);
  return progress;
}

/** A plain number that rolls up from zero when it first appears. */
export function RollUp({ value, className = "", decimals = 0 }: { value: number; className?: string; decimals?: number }) {
  const progress = useRollUp();
  const shown = value * progress;
  return (
    <span className={`num ${className}`} aria-label={value.toFixed(decimals)}>
      {shown.toFixed(decimals)}
    </span>
  );
}
