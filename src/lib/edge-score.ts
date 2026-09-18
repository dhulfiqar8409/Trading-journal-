/**
 * Edge Score: a 0-100 composite over a rolling window of closed trades.
 * Six factors, each scaled 0-100 between documented anchors, averaged.
 *
 *  factor        0 at            100 at         note
 *  win rate      20%             70%            share of closed trades with P&L > 0
 *  profit factor 0.5             3.0            gross profit / |gross loss|; no losses = 100
 *  payoff        0.5             3.0            average win / |average loss|; no losses = 100, no wins = 0
 *  drawdown      dd = gross      dd = 0         max drawdown as a share of gross profit
 *  recovery      0               5              net P&L / max drawdown; no drawdown and net > 0 = 100
 *  consistency   best day = 60%  best day = 10% share of net P&L from the best day (net <= 0 = 0)
 */
import { Decimal, toDecimal, ZERO, type DecimalInput } from "@/lib/decimal";
import { dateKeyInZone } from "@/lib/tz";

export interface ScoreTrade {
  id: string;
  exitAt: Date;
  pnl: DecimalInput;
}

export interface FactorScore {
  key: "winRate" | "profitFactor" | "payoff" | "drawdown" | "recovery" | "consistency";
  label: string;
  /** Underlying ratio (0-1 for win rate and shares, otherwise a plain ratio); null when undefined. */
  raw: number | null;
  score: number;
}

export interface EdgeScore {
  score: number | null;
  factors: FactorScore[];
  sampleSize: number;
  window: number;
  minimum: number;
  /** True when fewer than `minimum` closed trades exist. */
  insufficient: boolean;
}

export interface EdgeScoreOptions {
  window?: number;
  minimum?: number;
  timeZone?: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const scale = (value: number, zeroAt: number, fullAt: number) => clamp(((value - zeroAt) / (fullAt - zeroAt)) * 100);

function sortClosed(trades: ScoreTrade[]): ScoreTrade[] {
  return [...trades].sort((a, b) => a.exitAt.getTime() - b.exitAt.getTime() || a.id.localeCompare(b.id));
}

export function scoreWindow(trades: ScoreTrade[], timeZone = "UTC"): FactorScore[] {
  let wins = 0;
  let losses = 0;
  let grossProfit = ZERO;
  let grossLoss = ZERO;
  let cumulative = ZERO;
  let peak = ZERO;
  let maxDrawdown = ZERO;
  const days = new Map<string, Decimal>();
  for (const t of trades) {
    const pnl = toDecimal(t.pnl);
    if (pnl.greaterThan(0)) {
      wins++;
      grossProfit = grossProfit.plus(pnl);
    } else if (pnl.lessThan(0)) {
      losses++;
      grossLoss = grossLoss.plus(pnl);
    }
    cumulative = cumulative.plus(pnl);
    if (cumulative.greaterThan(peak)) peak = cumulative;
    const dd = peak.minus(cumulative);
    if (dd.greaterThan(maxDrawdown)) maxDrawdown = dd;
    const key = dateKeyInZone(t.exitAt, timeZone);
    days.set(key, (days.get(key) ?? ZERO).plus(pnl));
  }
  const n = trades.length;
  const net = grossProfit.plus(grossLoss);
  const absLoss = grossLoss.abs();

  const winRate = n ? wins / n : null;
  const profitFactor = absLoss.isZero() ? (grossProfit.greaterThan(0) ? Infinity : null) : grossProfit.div(absLoss).toNumber();
  const avgWin = wins ? grossProfit.div(wins) : null;
  const avgLoss = losses ? absLoss.div(losses) : null;
  const payoff = avgWin && avgLoss ? avgWin.div(avgLoss).toNumber() : avgWin && !avgLoss ? Infinity : null;
  const drawdownShare = grossProfit.greaterThan(0) ? maxDrawdown.div(grossProfit).toNumber() : null;
  const recovery = maxDrawdown.isZero() ? (net.greaterThan(0) ? Infinity : null) : net.div(maxDrawdown).toNumber();
  let bestDayShare: number | null = null;
  if (net.greaterThan(0) && days.size) {
    let best = ZERO;
    for (const v of days.values()) if (v.greaterThan(best)) best = v;
    bestDayShare = best.div(net).toNumber();
  }

  return [
    { key: "winRate", label: "Win rate", raw: winRate, score: winRate === null ? 0 : scale(winRate, 0.2, 0.7) },
    { key: "profitFactor", label: "Profit factor", raw: profitFactor === Infinity ? null : profitFactor, score: profitFactor === null ? 0 : profitFactor === Infinity ? 100 : scale(profitFactor, 0.5, 3) },
    { key: "payoff", label: "Payoff ratio", raw: payoff === Infinity ? null : payoff, score: payoff === null ? 0 : payoff === Infinity ? 100 : scale(payoff, 0.5, 3) },
    { key: "drawdown", label: "Drawdown control", raw: drawdownShare, score: drawdownShare === null ? 0 : scale(1 - drawdownShare, 0, 1) },
    { key: "recovery", label: "Recovery factor", raw: recovery === Infinity ? null : recovery, score: recovery === null ? 0 : recovery === Infinity ? 100 : scale(recovery, 0, 5) },
    { key: "consistency", label: "Consistency", raw: bestDayShare, score: bestDayShare === null ? 0 : scale(0.6 - bestDayShare, 0, 0.5) },
  ];
}

export function edgeScore(trades: ScoreTrade[], options: EdgeScoreOptions = {}): EdgeScore {
  const window = options.window ?? 50;
  const minimum = options.minimum ?? 10;
  const sorted = sortClosed(trades);
  const recent = sorted.slice(-window);
  const insufficient = recent.length < minimum;
  const factors = scoreWindow(recent, options.timeZone ?? "UTC");
  const score = insufficient ? null : Math.round(factors.reduce((acc, f) => acc + f.score, 0) / factors.length);
  return { score, factors, sampleSize: recent.length, window, minimum, insufficient };
}

export interface TrendPoint {
  index: number;
  t: number;
  score: number;
}

/** The score as it stood after every `step`-th closed trade (and the last one). */
export function edgeScoreTrend(trades: ScoreTrade[], options: EdgeScoreOptions & { step?: number } = {}): TrendPoint[] {
  const window = options.window ?? 50;
  const minimum = options.minimum ?? 10;
  const step = Math.max(1, options.step ?? 5);
  const sorted = sortClosed(trades);
  const out: TrendPoint[] = [];
  for (let i = minimum; i <= sorted.length; i++) {
    if (i !== sorted.length && (i - minimum) % step !== 0) continue;
    const slice = sorted.slice(Math.max(0, i - window), i);
    const factors = scoreWindow(slice, options.timeZone ?? "UTC");
    out.push({ index: i, t: sorted[i - 1].exitAt.getTime(), score: Math.round(factors.reduce((acc, f) => acc + f.score, 0) / factors.length) });
  }
  return out;
}
