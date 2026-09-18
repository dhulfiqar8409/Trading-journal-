import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { TradeWithRelations } from "@/lib/serialize";
import { endOfDayInZone, startOfDayInZone } from "@/lib/tz";
import { PAGE_SIZES, type TradeFilterInput } from "@/lib/validation";

export interface TradeListResult {
  trades: TradeWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const relationInclude = {
  account: { select: { id: true, name: true, currency: true } },
  tags: { orderBy: { name: "asc" as const } },
};

function orderFor(sort: NonNullable<TradeFilterInput["sort"]>, dir: "asc" | "desc"): Prisma.TradeOrderByWithRelationInput[] {
  const nullable = { sort: dir, nulls: "last" as const };
  switch (sort) {
    case "symbol":
      return [{ symbol: dir }, { entryAt: "desc" }];
    case "quantity":
      return [{ quantity: dir }, { entryAt: "desc" }];
    case "pnl":
      return [{ pnl: nullable }, { entryAt: "desc" }];
    case "rMultiple":
      return [{ rMultiple: nullable }, { entryAt: "desc" }];
    case "exitAt":
      return [{ exitAt: nullable }, { entryAt: "desc" }];
    case "entryAt":
    default:
      return [{ entryAt: dir }, { createdAt: dir }];
  }
}

export function buildTradeWhere(userId: string, filters: TradeFilterInput, timeZone: string): Prisma.TradeWhereInput {
  const where: Prisma.TradeWhereInput = { userId };
  if (filters.from || filters.to) {
    where.entryAt = {
      ...(filters.from ? { gte: startOfDayInZone(filters.from, timeZone) } : {}),
      ...(filters.to ? { lt: endOfDayInZone(filters.to, timeZone) } : {}),
    };
  }
  if (filters.symbol) where.symbol = { contains: filters.symbol.toUpperCase() };
  if (filters.side) where.side = filters.side;
  if (filters.status) where.status = filters.status;
  if (filters.account) where.accountId = filters.account;
  if (filters.tag) where.tags = { some: { id: filters.tag } };
  return where;
}

export async function listTrades(userId: string, filters: TradeFilterInput, timeZone: string): Promise<TradeListResult> {
  const where = buildTradeWhere(userId, filters, timeZone);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(filters.pageSize ?? 0) ? (filters.pageSize as number) : 25;
  const total = await db.trade.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(filters.page ?? 1, 1), pageCount);
  const trades = await db.trade.findMany({
    where,
    orderBy: orderFor(filters.sort ?? "entryAt", filters.dir ?? "desc"),
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: relationInclude,
  });
  return { trades, total, page, pageSize, pageCount };
}

export async function getTrade(userId: string, id: string): Promise<TradeWithRelations | null> {
  return db.trade.findFirst({
    where: { id, userId },
    include: { ...relationInclude, attachments: { orderBy: { createdAt: "asc" } } },
  });
}

/** Every trade of the user, for CSV export. */
export async function allTrades(userId: string): Promise<TradeWithRelations[]> {
  return db.trade.findMany({ where: { userId }, orderBy: [{ entryAt: "asc" }, { createdAt: "asc" }], include: relationInclude });
}
