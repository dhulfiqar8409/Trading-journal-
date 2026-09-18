-- CreateEnum
CREATE TYPE "DisplayMode" AS ENUM ('R', 'USD');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('MAX_TRADES_PER_DAY', 'MAX_DAILY_LOSS_R', 'MAX_DAILY_LOSS_USD', 'NO_TRADES_BEFORE', 'NO_TRADES_AFTER', 'STOP_REQUIRED', 'MAX_RISK_PER_TRADE_R', 'MAX_POSITION_SIZE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RuleEventStatus" AS ENUM ('FOLLOWED', 'BROKEN', 'OVERRIDDEN');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "plannedRisk" DECIMAL(20,8);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayMode" "DisplayMode" NOT NULL DEFAULT 'R';

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "value" DECIMAL(20,8),
    "timeValue" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEvent" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" "RuleEventStatus" NOT NULL,
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Day" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "maxTrades" INTEGER,
    "maxLossR" DECIMAL(20,8),
    "allowedSetupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "focusNote" TEXT,
    "mood" INTEGER,
    "sleepHours" DECIMAL(4,1),
    "focus" INTEGER,
    "energy" INTEGER,
    "checkedInAt" TIMESTAMP(3),
    "wentRight" TEXT,
    "wentWrong" TEXT,
    "oneChange" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "dayTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Day_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rule_userId_idx" ON "Rule"("userId");

-- CreateIndex
CREATE INDEX "RuleEvent_ruleId_idx" ON "RuleEvent"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleEvent_tradeId_ruleId_key" ON "RuleEvent"("tradeId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "Day_userId_date_key" ON "Day"("userId", "date");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvent" ADD CONSTRAINT "RuleEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleEvent" ADD CONSTRAINT "RuleEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Day" ADD CONSTRAINT "Day_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
