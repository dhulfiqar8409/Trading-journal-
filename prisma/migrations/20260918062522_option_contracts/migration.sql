-- CreateEnum
CREATE TYPE "OptionType" AS ENUM ('CALL', 'PUT');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "optionType" "OptionType",
ADD COLUMN     "strikePrice" DECIMAL(20,8);
