import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Serialises the changes that must not race each other: creating the first
 * account and removing, demoting or deactivating an admin. Each one runs in a
 * transaction that first takes a Postgres advisory lock with a fixed id, held
 * until the transaction ends, so two concurrent requests cannot both pass the
 * "no account exists yet" or "another active admin remains" check.
 */
const ACCOUNTS_LOCK_ID = 7_318_119_001;

export type AccountTx = Prisma.TransactionClient;

export async function withAccountLock<T>(work: (tx: AccountTx) => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
  return db.$transaction(
    async (tx) => {
      // $executeRaw: the function returns void, which $queryRaw would refuse to deserialise.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACCOUNTS_LOCK_ID}::bigint)`;
      return work(tx);
    },
    { maxWait: 5_000, timeout: options.timeoutMs ?? 15_000 },
  );
}
