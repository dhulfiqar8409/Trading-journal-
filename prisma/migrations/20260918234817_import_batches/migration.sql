-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('TRADES', 'EXECUTIONS');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "importBatchId" TEXT;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mode" "ImportMode" NOT NULL DEFAULT 'TRADES',
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_userId_createdAt_idx" ON "ImportBatch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_importBatchId_idx" ON "Trade"("importBatchId");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
