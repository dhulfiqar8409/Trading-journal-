/**
 * Trading-rule engine. Deterministic rules are evaluated per trade against
 * the other trades of the same calendar day (in the owner's zone); CUSTOM
 * rules are answered by hand on the trade form.
 */
import { Decimal, toDecimal, toDecimalOrNull, type DecimalInput } from "@/lib/decimal";
import { toWallTime } from "@/lib/tz";

export const RULE_KINDS = [
  "MAX_TRADES_PER_DAY",
  "MAX_DAILY_LOSS_R",
  "MAX_DAILY_LOSS_USD",
  "NO_TRADES_BEFORE",
  "NO_TRADES_AFTER",
  "STOP_REQUIRED",
  "MAX_RISK_PER_TRADE_R",
  "MAX_POSITION_SIZE",
  "CUSTOM",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type RuleEventStatus = "FOLLOWED" | "BROKEN" | "OVERRIDDEN";

export interface RuleLike {
  id: string;
  title: string;
  kind: RuleKind;
  value: DecimalInput | null;
  /** "HH:mm" wall time in the owner's zone. */
  timeValue: string | null;
  active: boolean;
}

export interface RuleTrade {
  id: string;
  entryAt: Date;
  exitAt: Date | null;
  status: "OPEN" | "CLOSED";
  quantity: DecimalInput;
  stopPrice: DecimalInput | null;
  pnl: DecimalInput | null;
  rMultiple: DecimalInput | null;
}

export interface RuleContext {
  timeZone: string;
  /** Every trade of the same calendar day, including the trade being evaluated. */
  dayTrades: RuleTrade[];
}

export type Verdict =
  | { status: "FOLLOWED" | "BROKEN"; detail: string }
  | { status: "NOT_APPLICABLE"; detail: string };

export interface RuleKindInfo {
  label: string;
  description: string;
  parameter: "number" | "time" | "none";
  unit?: string;
  defaultTitle: string;
}

export const RULE_KIND_INFO: Record<RuleKind, RuleKindInfo> = {
  MAX_TRADES_PER_DAY: {
    label: "Max trades per day",
    description: "Broken by every trade opened after the daily count is reached.",
    parameter: "number",
    unit: "trades",
    defaultTitle: "No more than N trades a day",
  },
  MAX_DAILY_LOSS_R: {
    label: "Max daily loss (R)",
    description: "Broken by trades opened after the day's realised loss reached this many R.",
    parameter: "number",
    unit: "R",
    defaultTitle: "Stop trading after losing N R",
  },
  MAX_DAILY_LOSS_USD: {
    label: "Max daily loss (currency)",
    description: "Broken by trades opened after the day's realised loss reached this amount.",
    parameter: "number",
    unit: "currency",
    defaultTitle: "Stop trading after losing N",
  },
  NO_TRADES_BEFORE: {
    label: "No trades before a time",
    description: "Broken by trades entered before this wall-clock time.",
    parameter: "time",
    defaultTitle: "No trades before HH:mm",
  },
  NO_TRADES_AFTER: {
    label: "No trades after a time",
    description: "Broken by trades entered at or after this wall-clock time.",
    parameter: "time",
    defaultTitle: "No trades after HH:mm",
  },
  STOP_REQUIRED: {
    label: "Stop required",
    description: "Broken by trades logged without a stop price.",
    parameter: "none",
    defaultTitle: "Every trade has a stop",
  },
  MAX_RISK_PER_TRADE_R: {
    label: "Max loss per trade (R)",
    description: "Broken by closed trades that lost more than this many R of the planned risk (the stop was not honoured).",
    parameter: "number",
    unit: "R",
    defaultTitle: "Never lose more than N R on a trade",
  },
  MAX_POSITION_SIZE: {
    label: "Max position size",
    description: "Broken by trades larger than this quantity.",
    parameter: "number",
    unit: "units",
    defaultTitle: "Position size at most N",
  },
  CUSTOM: {
    label: "Custom (checked by hand)",
    description: "A checkbox on the trade form; unchecking it needs a justification.",
    parameter: "none",
    defaultTitle: "",
  },
};

export function isDeterministic(kind: RuleKind): boolean {
  return kind !== "CUSTOM";
}

/** Stable chronological order for trades of a day. */
export function sortTrades<T extends { entryAt: Date; id: string }>(trades: T[]): T[] {
  return [...trades].sort((a, b) => a.entryAt.getTime() - b.entryAt.getTime() || a.id.localeCompare(b.id));
}

function isBefore(a: RuleTrade, b: RuleTrade): boolean {
  return a.entryAt.getTime() < b.entryAt.getTime() || (a.entryAt.getTime() === b.entryAt.getTime() && a.id < b.id);
}

function parseTime(value: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function formatAmount(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed();
}

/** Realised result of the day's trades that were closed before this trade was opened. */
function realisedBefore(trade: RuleTrade, ctx: RuleContext, field: "pnl" | "rMultiple"): Decimal {
  let total = new Decimal(0);
  for (const other of ctx.dayTrades) {
    if (other.id === trade.id) continue;
    if (other.status !== "CLOSED" || !other.exitAt) continue;
    if (other.exitAt.getTime() > trade.entryAt.getTime()) continue;
    const v = toDecimalOrNull(other[field]);
    if (v) total = total.plus(v);
  }
  return total;
}

export function evaluateRule(rule: RuleLike, trade: RuleTrade, ctx: RuleContext): Verdict {
  const value = toDecimalOrNull(rule.value);
  switch (rule.kind) {
    case "MAX_TRADES_PER_DAY": {
      if (!value) return { status: "NOT_APPLICABLE", detail: "rule has no limit" };
      const position = ctx.dayTrades.filter((t) => t.id !== trade.id && isBefore(t, trade)).length + 1;
      return position > value.toNumber()
        ? { status: "BROKEN", detail: `trade ${position} of the day, limit ${value.toFixed()}` }
        : { status: "FOLLOWED", detail: `trade ${position} of ${value.toFixed()}` };
    }
    case "MAX_DAILY_LOSS_R": {
      if (!value) return { status: "NOT_APPLICABLE", detail: "rule has no limit" };
      const realised = realisedBefore(trade, ctx, "rMultiple");
      return realised.lessThanOrEqualTo(value.neg())
        ? { status: "BROKEN", detail: `opened after the day was down ${formatAmount(realised.abs())}R (limit ${value.toFixed()}R)` }
        : { status: "FOLLOWED", detail: `day at ${formatAmount(realised)}R before entry` };
    }
    case "MAX_DAILY_LOSS_USD": {
      if (!value) return { status: "NOT_APPLICABLE", detail: "rule has no limit" };
      const realised = realisedBefore(trade, ctx, "pnl");
      return realised.lessThanOrEqualTo(value.neg())
        ? { status: "BROKEN", detail: `opened after the day was down ${formatAmount(realised.abs())} (limit ${value.toFixed()})` }
        : { status: "FOLLOWED", detail: `day at ${formatAmount(realised)} before entry` };
    }
    case "NO_TRADES_BEFORE":
    case "NO_TRADES_AFTER": {
      const limit = parseTime(rule.timeValue);
      if (!limit) return { status: "NOT_APPLICABLE", detail: "rule has no time" };
      const wall = toWallTime(trade.entryAt, ctx.timeZone);
      const minutes = wall.hour * 60 + wall.minute;
      const limitMinutes = limit.hour * 60 + limit.minute;
      const entered = `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
      const broken = rule.kind === "NO_TRADES_BEFORE" ? minutes < limitMinutes : minutes >= limitMinutes;
      return broken
        ? { status: "BROKEN", detail: `entered at ${entered}, ${rule.kind === "NO_TRADES_BEFORE" ? "before" : "after"} ${rule.timeValue}` }
        : { status: "FOLLOWED", detail: `entered at ${entered}` };
    }
    case "STOP_REQUIRED":
      return toDecimalOrNull(trade.stopPrice)
        ? { status: "FOLLOWED", detail: "stop recorded" }
        : { status: "BROKEN", detail: "no stop price" };
    case "MAX_RISK_PER_TRADE_R": {
      if (!value) return { status: "NOT_APPLICABLE", detail: "rule has no limit" };
      const r = toDecimalOrNull(trade.rMultiple);
      if (trade.status !== "CLOSED" || !r) return { status: "NOT_APPLICABLE", detail: "needs a stop and an exit" };
      return r.lessThan(value.neg())
        ? { status: "BROKEN", detail: `lost ${formatAmount(r.abs())}R, limit ${value.toFixed()}R` }
        : { status: "FOLLOWED", detail: `${formatAmount(r)}R` };
    }
    case "MAX_POSITION_SIZE": {
      if (!value) return { status: "NOT_APPLICABLE", detail: "rule has no limit" };
      const qty = toDecimal(trade.quantity);
      return qty.greaterThan(value)
        ? { status: "BROKEN", detail: `size ${qty.toFixed()} above ${value.toFixed()}` }
        : { status: "FOLLOWED", detail: `size ${qty.toFixed()}` };
    }
    case "CUSTOM":
    default:
      return { status: "NOT_APPLICABLE", detail: "checked by hand" };
  }
}

export interface Evaluation {
  ruleId: string;
  title: string;
  status: "FOLLOWED" | "BROKEN";
  detail: string;
}

/** Evaluate every active deterministic rule; rules that do not apply are omitted. */
export function evaluateRules(rules: RuleLike[], trade: RuleTrade, ctx: RuleContext): Evaluation[] {
  const out: Evaluation[] = [];
  for (const rule of rules) {
    if (!rule.active || !isDeterministic(rule.kind)) continue;
    const verdict = evaluateRule(rule, trade, ctx);
    if (verdict.status === "NOT_APPLICABLE") continue;
    out.push({ ruleId: rule.id, title: rule.title, status: verdict.status, detail: verdict.detail });
  }
  return out;
}

/** Human description of a rule's parameter, e.g. "3 trades", "2R", "09:45". */
export function describeRule(rule: Pick<RuleLike, "kind" | "value" | "timeValue">): string {
  const info = RULE_KIND_INFO[rule.kind];
  if (info.parameter === "time") return rule.timeValue ?? "";
  if (info.parameter === "number") {
    const v = toDecimalOrNull(rule.value);
    if (!v) return "";
    return info.unit === "R" ? `${v.toFixed()}R` : `${v.toFixed()} ${info.unit ?? ""}`.trim();
  }
  return "";
}
