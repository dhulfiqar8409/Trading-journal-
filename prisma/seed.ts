/**
 * Development seed: creates a demo owner with two accounts, a set of tags and
 * about sixty realistic trades over the last four months. Run with `npm run seed`.
 * Refuses to run in production unless SEED_FORCE=1 is set.
 */
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { partialCloseNotes, planClose, remainderNotes } from "../src/lib/close";
import { Decimal } from "../src/lib/decimal";
import { expirationCloseTime, expirationInstant, formatOptionLabel, OPTION_MULTIPLIER } from "../src/lib/options";
import { computeTradeMetrics, type Side } from "../src/lib/pnl";
import { usernameFromEmail } from "../src/lib/users";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
  console.error("Refusing to seed a production database. Set SEED_FORCE=1 to override.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// Deterministic pseudo-random numbers so the seed is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20240912);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

interface Instrument {
  symbol: string;
  assetClass: "STOCK" | "FUTURES" | "CRYPTO" | "OPTION";
  price: number;
  tick: number;
  multiplier: number;
  qty: [number, number];
  fee: number;
  account: "main" | "futures";
}

const INSTRUMENTS: Instrument[] = [
  { symbol: "AAPL", assetClass: "STOCK", price: 228, tick: 0.01, multiplier: 1, qty: [50, 300], fee: 1.0, account: "main" },
  { symbol: "MSFT", assetClass: "STOCK", price: 415, tick: 0.01, multiplier: 1, qty: [20, 120], fee: 1.0, account: "main" },
  { symbol: "NVDA", assetClass: "STOCK", price: 118, tick: 0.01, multiplier: 1, qty: [50, 400], fee: 1.0, account: "main" },
  { symbol: "TSLA", assetClass: "STOCK", price: 246, tick: 0.01, multiplier: 1, qty: [30, 200], fee: 1.0, account: "main" },
  { symbol: "AMD", assetClass: "STOCK", price: 152, tick: 0.01, multiplier: 1, qty: [50, 300], fee: 1.0, account: "main" },
  { symbol: "META", assetClass: "STOCK", price: 520, tick: 0.01, multiplier: 1, qty: [10, 80], fee: 1.0, account: "main" },
  { symbol: "SPY", assetClass: "STOCK", price: 558, tick: 0.01, multiplier: 1, qty: [20, 150], fee: 1.0, account: "main" },
  { symbol: "QQQ", assetClass: "STOCK", price: 475, tick: 0.01, multiplier: 1, qty: [20, 150], fee: 1.0, account: "main" },
  { symbol: "ES", assetClass: "FUTURES", price: 5620, tick: 0.25, multiplier: 50, qty: [1, 3], fee: 4.2, account: "futures" },
  { symbol: "NQ", assetClass: "FUTURES", price: 19500, tick: 0.25, multiplier: 20, qty: [1, 2], fee: 4.2, account: "futures" },
  { symbol: "CL", assetClass: "FUTURES", price: 71.4, tick: 0.01, multiplier: 1000, qty: [1, 2], fee: 4.8, account: "futures" },
  { symbol: "BTCUSD", assetClass: "CRYPTO", price: 58200, tick: 1, multiplier: 1, qty: [0.05, 0.4], fee: 12, account: "main" },
  { symbol: "ETHUSD", assetClass: "CRYPTO", price: 2450, tick: 0.1, multiplier: 1, qty: [0.5, 4], fee: 6, account: "main" },
];

const TAGS = [
  { name: "Momentum", kind: "STRATEGY", color: "#3987e5" },
  { name: "Mean reversion", kind: "STRATEGY", color: "#9085e9" },
  { name: "Trend following", kind: "STRATEGY", color: "#199e70" },
  { name: "Breakout", kind: "SETUP", color: "#12a884" },
  { name: "Pullback", kind: "SETUP", color: "#e0a534" },
  { name: "VWAP reclaim", kind: "SETUP", color: "#d55181" },
  { name: "Gap and go", kind: "SETUP", color: "#3987e5" },
  { name: "FOMO", kind: "MISTAKE", color: "#ea5a3a" },
  { name: "Chased entry", kind: "MISTAKE", color: "#ea5a3a" },
  { name: "Moved stop", kind: "MISTAKE", color: "#ea5a3a" },
  { name: "Oversized", kind: "MISTAKE", color: "#ea5a3a" },
  { name: "Earnings", kind: "CUSTOM", color: "#6b7280" },
  { name: "Pre-market", kind: "CUSTOM", color: "#6b7280" },
] as const;

const NOTES = [
  "Clean **breakout** over the opening range high on rising volume. Took partials at 1R and let the rest run.",
  "Faded the gap fill; price reclaimed VWAP and I entered on the retest.\n\n- Risk defined below the low of day\n- Target was the prior day high",
  "Trend day. Entered on the first pullback to the 9 EMA and trailed the stop under each higher low.",
  "Earnings drift play. Sized down because of the wider stop.",
  "Pre-market runner. Waited for the 5-minute base to resolve before taking the trade.",
  "Range scalp between the overnight high and low.",
  "Second attempt after the first breakout failed. This one held above the level.",
];
const MISTAKES = ["Entered before the confirmation candle closed.", "Moved my stop after the first pullback.", "Size was double the plan.", "Chased the second leg without a base."];

function round(value: number, tick: number): string {
  const d = new Decimal(value).div(tick).round().times(tick);
  return d.toDecimalPlaces(8).toFixed();
}

async function main() {
  const email = process.env.SEED_EMAIL ?? "demo@darkpools.local";
  const username = process.env.SEED_USERNAME ?? usernameFromEmail(email, "demo");
  const password = process.env.SEED_PASSWORD ?? "darkpools-demo";
  const passwordHash = await bcrypt.hash(password, 12);

  // The demo account is an admin so a seeded instance can manage users straight away.
  const user = await db.user.upsert({
    where: { username },
    update: {},
    create: { username, email, passwordHash, name: "Demo Trader", role: "ADMIN", passwordChangedAt: new Date(), timeZone: "America/New_York" },
  });

  // Idempotent: wipe this user's trades, tags and accounts before re-seeding.
  await db.trade.deleteMany({ where: { userId: user.id } });
  await db.tag.deleteMany({ where: { userId: user.id } });
  await db.account.deleteMany({ where: { userId: user.id } });

  const main = await db.account.create({ data: { userId: user.id, name: "Main", broker: "Interactive Brokers", currency: "USD", isDefault: true } });
  const futures = await db.account.create({ data: { userId: user.id, name: "Futures", broker: "Tradovate", currency: "USD" } });
  const accounts = { main: main.id, futures: futures.id };

  const tags = await Promise.all(TAGS.map((t) => db.tag.create({ data: { ...t, userId: user.id } })));
  const byKind = (kind: (typeof TAGS)[number]["kind"]) => tags.filter((t) => t.kind === kind);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let created = 0;
  const total = 62;
  for (let i = 0; i < total; i++) {
    const inst = pick(INSTRUMENTS);
    const side: Side = rand() < 0.65 ? "LONG" : "SHORT";
    // The last five trades are still open and were entered in the past few days.
    const isOpen = i >= total - 5;
    const daysAgo = isOpen ? Math.floor(between(0, 3)) : Math.floor(between(0, 120));
    const entry = new Date(now - daysAgo * dayMs);
    // Trading hours in New York, roughly 09:30-15:30 local (13:30-19:30 UTC in summer).
    entry.setUTCHours(13 + Math.floor(between(0, 6)), Math.floor(between(0, 60)), 0, 0);
    if (entry.getUTCDay() === 0) entry.setUTCDate(entry.getUTCDate() - 2);
    if (entry.getUTCDay() === 6) entry.setUTCDate(entry.getUTCDate() - 1);

    const drift = inst.price * between(-0.03, 0.03);
    const entryPrice = round(inst.price + drift, inst.tick);
    const quantity = inst.assetClass === "FUTURES" ? String(Math.floor(between(inst.qty[0], inst.qty[1] + 1))) : round(between(inst.qty[0], inst.qty[1]), inst.assetClass === "CRYPTO" ? 0.01 : 1);
    const riskPct = between(0.004, 0.012);
    const stopPrice = round(Number(entryPrice) * (side === "LONG" ? 1 - riskPct : 1 + riskPct), inst.tick);
    const targetPrice = round(Number(entryPrice) * (side === "LONG" ? 1 + riskPct * between(1.5, 3) : 1 - riskPct * between(1.5, 3)), inst.tick);
    // Slightly positive expectancy: 55% winners with larger average size.
    const win = rand() < 0.55;
    const rMove = win ? between(0.4, 2.8) : -between(0.3, 1.2);
    // (entry - stop) already carries the side's sign, so one formula covers longs and shorts.
    const exitPrice = isOpen ? null : round(Number(entryPrice) + (Number(entryPrice) - Number(stopPrice)) * rMove, inst.tick);
    const holdMinutes = Math.floor(between(8, 420));
    const exitAt = isOpen ? null : new Date(entry.getTime() + holdMinutes * 60000);
    const fees = new Decimal(inst.fee).times(quantity).times(2).toDecimalPlaces(2).toFixed();

    const metrics = computeTradeMetrics({ side, quantity, entryPrice, exitPrice, multiplier: inst.multiplier, fees, stopPrice, targetPrice });
    const strategy = pick(byKind("STRATEGY"));
    const setup = pick(byKind("SETUP"));
    const tagIds = [strategy.id, setup.id];
    const lost = metrics.pnl ? metrics.pnl.lessThan(0) : false;
    let mistakes: string | null = null;
    if (lost && rand() < 0.5) {
      tagIds.push(pick(byKind("MISTAKE")).id);
      mistakes = pick(MISTAKES);
    }
    if (rand() < 0.2) tagIds.push(pick(byKind("CUSTOM")).id);

    await db.trade.create({
      data: {
        userId: user.id,
        accountId: accounts[inst.account],
        symbol: inst.symbol,
        assetClass: inst.assetClass,
        side,
        quantity,
        entryPrice,
        exitPrice,
        multiplier: String(inst.multiplier),
        fees,
        entryAt: entry,
        exitAt,
        status: metrics.status,
        pnl: metrics.pnl ? metrics.pnl.toDecimalPlaces(8).toFixed() : null,
        rMultiple: metrics.rMultiple ? metrics.rMultiple.toDecimalPlaces(8).toFixed() : null,
        plannedRisk: metrics.risk ? metrics.risk.toDecimalPlaces(8).toFixed() : null,
        stopPrice,
        targetPrice,
        rating: isOpen ? null : Math.min(5, Math.max(1, Math.round(between(1, 5)))),
        notes: pick(NOTES),
        mistakes,
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
    });
    created++;
  }

  // Options: a few contracts on the main account, one expired worthless and one closed in two parts.
  created += await seedOptions(user.id, accounts.main, tagIds(byKind("STRATEGY")[0], byKind("SETUP")[3]), now);

  console.log(`Seeded ${created} trades, ${tags.length} tags and 2 accounts for @${username} (${email})`);
  console.log(`Sign in with username ${username} / ${password}`);
}

const tagIds = (...tags: { id: string }[]) => tags.map((t) => ({ id: t.id }));
const dayMs = 24 * 60 * 60 * 1000;
const dateKeyOf = (date: Date) => date.toISOString().slice(0, 10);

interface OptionSeed {
  symbol: string;
  optionType: "CALL" | "PUT";
  strike: string;
  side: Side;
  contracts: string;
  entryPrice: string;
  /** "expired" closes at zero on expiration day. */
  exit: string | "expired";
  stop: string;
  entryDaysAgo: number;
  daysToExpiry: number;
  holdMinutes: number;
  notes: string;
}

const OPTION_SEEDS: OptionSeed[] = [
  { symbol: "SPY", optionType: "CALL", strike: "450", side: "LONG", contracts: "5", entryPrice: "3.20", exit: "4.10", stop: "2.40", entryDaysAgo: 40, daysToExpiry: 14, holdMinutes: 180, notes: "Bought the pullback into the 20-day and sold into the retest of the highs." },
  { symbol: "AAPL", optionType: "PUT", strike: "220", side: "SHORT", contracts: "3", entryPrice: "2.50", exit: "1.10", stop: "3.50", entryDaysAgo: 33, daysToExpiry: 10, holdMinutes: 3 * 24 * 60, notes: "Sold puts under support after the flush; covered once the bounce was underway." },
  { symbol: "QQQ", optionType: "PUT", strike: "470", side: "LONG", contracts: "2", entryPrice: "5.00", exit: "3.80", stop: "4.00", entryDaysAgo: 25, daysToExpiry: 21, holdMinutes: 240, notes: "Hedge that never worked. The stop was 4.00 and I sat through it." },
  { symbol: "NVDA", optionType: "CALL", strike: "130", side: "LONG", contracts: "4", entryPrice: "0.85", exit: "expired", stop: "0.40", entryDaysAgo: 18, daysToExpiry: 4, holdMinutes: 0, notes: "Lottery ticket into the number. Expired worthless." },
];

function seedEntry(now: number, daysAgo: number): Date {
  const entry = new Date(now - daysAgo * dayMs);
  entry.setUTCHours(14, 5, 0, 0);
  if (entry.getUTCDay() === 0) entry.setUTCDate(entry.getUTCDate() - 2);
  if (entry.getUTCDay() === 6) entry.setUTCDate(entry.getUTCDate() - 1);
  return entry;
}

async function seedOptions(userId: string, accountId: string, tags: { id: string }[], now: number): Promise<number> {
  const timeZone = "America/New_York";
  const multiplier = OPTION_MULTIPLIER;
  let created = 0;
  for (const o of OPTION_SEEDS) {
    const entryAt = seedEntry(now, o.entryDaysAgo);
    const expiresAt = expirationInstant(dateKeyOf(new Date(entryAt.getTime() + o.daysToExpiry * dayMs)));
    if (!expiresAt) throw new Error("bad expiration in seed");
    const expired = o.exit === "expired";
    const exitPrice = expired ? "0" : o.exit;
    const exitAt = expired ? expirationCloseTime(expiresAt, timeZone) : new Date(entryAt.getTime() + o.holdMinutes * 60000);
    const fees = new Decimal("0.65").times(o.contracts).times(expired ? 1 : 2).toFixed();
    const metrics = computeTradeMetrics({ side: o.side, quantity: o.contracts, entryPrice: o.entryPrice, exitPrice, multiplier, fees, stopPrice: o.stop });
    await db.trade.create({
      data: {
        userId,
        accountId,
        symbol: o.symbol,
        assetClass: "OPTION",
        optionType: o.optionType,
        strikePrice: o.strike,
        expiresAt,
        side: o.side,
        quantity: o.contracts,
        entryPrice: o.entryPrice,
        exitPrice,
        multiplier,
        fees,
        entryAt,
        exitAt,
        status: metrics.status,
        pnl: metrics.pnl ? metrics.pnl.toDecimalPlaces(8).toFixed() : null,
        rMultiple: metrics.rMultiple ? metrics.rMultiple.toDecimalPlaces(8).toFixed() : null,
        plannedRisk: metrics.risk ? metrics.risk.toDecimalPlaces(8).toFixed() : null,
        stopPrice: o.stop,
        rating: expired ? 2 : 4,
        notes: o.notes,
        tags: { connect: tags },
      },
    });
    created++;
  }

  // A partial close: 10 TSLA calls bought five days ago, 6 sold two days later, 4 still open.
  const entryAt = seedEntry(now, 5);
  const expiresAt = expirationInstant(dateKeyOf(new Date(entryAt.getTime() + 20 * dayMs)));
  if (!expiresAt) throw new Error("bad expiration in seed");
  const contract = { symbol: "TSLA", assetClass: "OPTION" as const, optionType: "CALL" as const, strikePrice: "250", expiresAt, side: "LONG" as const, entryPrice: "4.00", stopPrice: "3.00", multiplier };
  const label = formatOptionLabel(contract);
  const plan = planClose({ quantity: "10", fees: "13" }, { closeQuantity: "6", extraFees: "3.9" });
  if (!plan.ok || plan.plan.kind !== "partial") throw new Error("seed partial close did not split");
  const { closed, remaining } = plan.plan;
  const notes = "Momentum call position sized for a two-week hold; taking profits in pieces.";
  const remainder = await db.trade.create({
    data: {
      userId,
      accountId,
      ...contract,
      quantity: remaining.quantity,
      fees: remaining.fees,
      entryAt,
      status: "OPEN",
      plannedRisk: computeTradeMetrics({ ...contract, quantity: remaining.quantity, fees: remaining.fees }).risk?.toDecimalPlaces(8).toFixed() ?? null,
      notes: remainderNotes({ notes, closed: closed.quantity, total: "10", remaining: remaining.quantity }),
      tags: { connect: tags },
    },
    select: { id: true },
  });
  const exitAt = new Date(entryAt.getTime() + 2 * dayMs);
  const closedMetrics = computeTradeMetrics({ ...contract, quantity: closed.quantity, fees: closed.fees, exitPrice: "5.20" });
  await db.trade.create({
    data: {
      userId,
      accountId,
      ...contract,
      quantity: closed.quantity,
      fees: closed.fees,
      exitPrice: "5.20",
      entryAt,
      exitAt,
      status: "CLOSED",
      pnl: closedMetrics.pnl?.toDecimalPlaces(8).toFixed() ?? null,
      rMultiple: closedMetrics.rMultiple?.toDecimalPlaces(8).toFixed() ?? null,
      plannedRisk: closedMetrics.risk?.toDecimalPlaces(8).toFixed() ?? null,
      rating: 4,
      notes: partialCloseNotes({ notes, label, originalId: remainder.id, closed: closed.quantity, total: "10", exitNote: "Sold 6 into the gap up." }),
      tags: { connect: tags },
    },
  });
  return created + 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
