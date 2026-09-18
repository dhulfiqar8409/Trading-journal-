import type { Account, Attachment, Day, Rule, RuleEvent, Tag, Trade } from "@/generated/prisma/client";
import { toNumber, toPlainString } from "@/lib/decimal";

export interface TagDTO {
  id: string;
  name: string;
  kind: Tag["kind"];
  color: string;
}

export interface AttachmentDTO {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface RuleDTO {
  id: string;
  title: string;
  kind: Rule["kind"];
  value: string | null;
  timeValue: string | null;
  active: boolean;
  createdAt: string;
}

export interface RuleEventDTO {
  id: string;
  ruleId: string;
  ruleTitle: string;
  ruleKind: Rule["kind"];
  status: RuleEvent["status"];
  justification: string | null;
}

export interface DayDTO {
  id: string;
  date: string;
  maxTrades: number | null;
  maxLossR: string | null;
  allowedSetupIds: string[];
  focusNote: string | null;
  mood: number | null;
  sleepHours: number | null;
  focus: number | null;
  energy: number | null;
  checkedInAt: string | null;
  wentRight: string | null;
  wentWrong: string | null;
  oneChange: string | null;
  reviewedAt: string | null;
  dayTags: string[];
}

export interface TradeDTO {
  id: string;
  accountId: string;
  accountName: string;
  currency: string;
  symbol: string;
  assetClass: Trade["assetClass"];
  side: Trade["side"];
  status: Trade["status"];
  quantity: string;
  entryPrice: string;
  exitPrice: string | null;
  multiplier: string;
  fees: string;
  entryAt: string;
  exitAt: string | null;
  pnl: number | null;
  pnlExact: string | null;
  rMultiple: number | null;
  plannedRisk: number | null;
  stopPrice: string | null;
  targetPrice: string | null;
  notes: string;
  rating: number | null;
  mistakes: string | null;
  importHash: string | null;
  tags: TagDTO[];
  attachments: AttachmentDTO[];
  ruleEvents: RuleEventDTO[];
  createdAt: string;
  updatedAt: string;
}

export type RuleEventWithRule = RuleEvent & { rule: Pick<Rule, "title" | "kind"> };

export type TradeWithRelations = Trade & {
  account: Pick<Account, "id" | "name" | "currency">;
  tags: Tag[];
  attachments?: Attachment[];
  ruleEvents?: RuleEventWithRule[];
};

export function serializeRule(rule: Rule): RuleDTO {
  return {
    id: rule.id,
    title: rule.title,
    kind: rule.kind,
    value: toPlainString(rule.value),
    timeValue: rule.timeValue,
    active: rule.active,
    createdAt: rule.createdAt.toISOString(),
  };
}

export function serializeRuleEvent(event: RuleEventWithRule): RuleEventDTO {
  return {
    id: event.id,
    ruleId: event.ruleId,
    ruleTitle: event.rule.title,
    ruleKind: event.rule.kind,
    status: event.status,
    justification: event.justification,
  };
}

export function serializeDay(day: Day): DayDTO {
  return {
    id: day.id,
    date: day.date,
    maxTrades: day.maxTrades,
    maxLossR: toPlainString(day.maxLossR),
    allowedSetupIds: day.allowedSetupIds,
    focusNote: day.focusNote,
    mood: day.mood,
    sleepHours: toNumber(day.sleepHours),
    focus: day.focus,
    energy: day.energy,
    checkedInAt: day.checkedInAt ? day.checkedInAt.toISOString() : null,
    wentRight: day.wentRight,
    wentWrong: day.wentWrong,
    oneChange: day.oneChange,
    reviewedAt: day.reviewedAt ? day.reviewedAt.toISOString() : null,
    dayTags: day.dayTags,
  };
}

export function serializeTag(tag: Tag): TagDTO {
  return { id: tag.id, name: tag.name, kind: tag.kind, color: tag.color };
}

export function serializeAttachment(a: Attachment): AttachmentDTO {
  return { id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt.toISOString() };
}

/** Decimals become exact strings (inputs) or numbers (charts); dates become ISO strings. */
export function serializeTrade(trade: TradeWithRelations): TradeDTO {
  return {
    id: trade.id,
    accountId: trade.accountId,
    accountName: trade.account.name,
    currency: trade.account.currency,
    symbol: trade.symbol,
    assetClass: trade.assetClass,
    side: trade.side,
    status: trade.status,
    quantity: toPlainString(trade.quantity) ?? "0",
    entryPrice: toPlainString(trade.entryPrice) ?? "0",
    exitPrice: toPlainString(trade.exitPrice),
    multiplier: toPlainString(trade.multiplier) ?? "1",
    fees: toPlainString(trade.fees) ?? "0",
    entryAt: trade.entryAt.toISOString(),
    exitAt: trade.exitAt ? trade.exitAt.toISOString() : null,
    pnl: toNumber(trade.pnl),
    pnlExact: toPlainString(trade.pnl),
    rMultiple: toNumber(trade.rMultiple),
    plannedRisk: toNumber(trade.plannedRisk),
    stopPrice: toPlainString(trade.stopPrice),
    targetPrice: toPlainString(trade.targetPrice),
    notes: trade.notes,
    rating: trade.rating,
    mistakes: trade.mistakes,
    importHash: trade.importHash,
    tags: trade.tags.map(serializeTag),
    attachments: (trade.attachments ?? []).map(serializeAttachment),
    ruleEvents: (trade.ruleEvents ?? []).map(serializeRuleEvent),
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
}
