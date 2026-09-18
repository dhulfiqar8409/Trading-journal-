-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- AlterTable: account fields. "username" is filled in below before it becomes required.
ALTER TABLE "User"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Existing accounts get a username derived from the email local part: lowercase, allowed
-- characters only, 3-32 characters, duplicates numbered. The oldest account becomes the admin.
WITH base AS (
  SELECT "id", "createdAt",
         left(lower(regexp_replace(split_part("email", '@', 1), '[^A-Za-z0-9._-]', '', 'g')), 32) AS candidate
  FROM "User"
), padded AS (
  SELECT "id", "createdAt",
         CASE WHEN length(candidate) >= 3 THEN candidate ELSE 'user-' || left("id", 8) END AS candidate
  FROM base
), numbered AS (
  SELECT "id", candidate, row_number() OVER (PARTITION BY candidate ORDER BY "createdAt", "id") AS n
  FROM padded
)
UPDATE "User" u
SET "username" = CASE WHEN n = 1 THEN candidate ELSE left(candidate, 32 - length(n::text) - 1) || '-' || n END
FROM numbered
WHERE numbered."id" = u."id";

UPDATE "User" SET "role" = 'ADMIN'
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt", "id" LIMIT 1);

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Login attempts are keyed by whatever was typed (username or email).
ALTER TABLE "LoginAttempt" RENAME COLUMN "email" TO "identifier";
ALTER INDEX "LoginAttempt_email_createdAt_idx" RENAME TO "LoginAttempt_identifier_createdAt_idx";
