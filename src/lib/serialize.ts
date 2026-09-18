import type { Account, Attachment, Tag, Trade } from "@/generated/prisma/client";
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
  stopPrice: string | null;
  targetPrice: string | null;
  notes: string;
  rating: number | null;
  mistakes: string | null;
  importHash: string | null;
  tags: TagDTO[];
  attachments: AttachmentDTO[];
  createdAt: string;
  updatedAt: string;
}

export type TradeWithRelations = Trade & {
  account: Pick<Account, "id" | "name" | "currency">;
  tags: Tag[];
  attachments?: Attachment[];
};

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
    stopPrice: toPlainString(trade.stopPrice),
    targetPrice: toPlainString(trade.targetPrice),
    notes: trade.notes,
    rating: trade.rating,
    mistakes: trade.mistakes,
    importHash: trade.importHash,
    tags: trade.tags.map(serializeTag),
    attachments: (trade.attachments ?? []).map(serializeAttachment),
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
}
