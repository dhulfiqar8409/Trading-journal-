/**
 * Edge decay per setup: rolling expectancy in R with a 95% band, and a flag
 * when a setup's rolling expectancy has crossed below zero.
 */
import { Decimal, toDecimalOrNull, type DecimalInput } from "@/lib/decimal";

export interface DecayTrade {
  id: string;
  exitAt: Date | null;
  status: "OPEN" | "CLOSED";
  rMultiple: DecimalInput | null;
  setupIds: string[];
}

export interface DecayPoint {
  index: number;
  t: number;
  tradeId: string;
  mean: number;
  lower: number;
  upper: number;
  n: number;
}

export interface SetupDecay {
  setupId: string;
  name: string;
  tradeCount: number;
  points: DecayPoint[];
  latest: DecayPoint | null;
  crossedBelowZero: boolean;
  suggestion: string | null;
}

export interface DecayOptions {
  window?: number;
  minimum?: number;
}

const Z = 1.96;

/** Mean and the 95% band of a sample (population of one has no band). */
export function meanBand(values: number[]): { mean: number; lower: number; upper: number; n: number } {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
  if (n < 2) return { mean, lower: mean, upper: mean, n };
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const half = (Z * Math.sqrt(variance)) / Math.sqrt(n);
  return { mean, lower: mean - half, upper: mean + half, n };
}

export function edgeDecay(trades: DecayTrade[], setups: { id: string; name: string }[], options: DecayOptions = {}): SetupDecay[] {
  const window = options.window ?? 20;
  const minimum = options.minimum ?? 5;
  const usable = trades
    .filter((t) => t.status === "CLOSED" && t.exitAt && toDecimalOrNull(t.rMultiple) !== null)
    .sort((a, b) => (a.exitAt as Date).getTime() - (b.exitAt as Date).getTime() || a.id.localeCompare(b.id));
  const out: SetupDecay[] = [];
  for (const setup of setups) {
    const mine = usable.filter((t) => t.setupIds.includes(setup.id));
    const rs = mine.map((t) => (toDecimalOrNull(t.rMultiple) as Decimal).toNumber());
    const points: DecayPoint[] = [];
    for (let i = minimum - 1; i < mine.length; i++) {
      const slice = rs.slice(Math.max(0, i - window + 1), i + 1);
      const band = meanBand(slice);
      points.push({ index: i + 1, t: (mine[i].exitAt as Date).getTime(), tradeId: mine[i].id, ...band });
    }
    const latest = points.length ? points[points.length - 1] : null;
    const crossedBelowZero = latest !== null && latest.mean < 0 && points.some((p) => p.mean >= 0);
    out.push({
      setupId: setup.id,
      name: setup.name,
      tradeCount: mine.length,
      points,
      latest,
      crossedBelowZero,
      suggestion: crossedBelowZero
        ? "Rolling expectancy has turned negative. Paper-trade this setup for the next 10 trades before risking money on it again."
        : latest && latest.mean < 0
          ? "Rolling expectancy is negative. Review the last trades before taking this setup again."
          : null,
    });
  }
  out.sort((a, b) => (a.latest?.mean ?? Infinity) - (b.latest?.mean ?? Infinity) || b.tradeCount - a.tradeCount);
  return out;
}
