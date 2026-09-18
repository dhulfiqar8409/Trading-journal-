#!/usr/bin/env node
// Applies pending migrations from prisma/migrations/*/migration.sql to PostgreSQL and
// records them in "_prisma_migrations" exactly as `prisma migrate deploy` does, so the
// Prisma CLI (and its 250 MB dependency tree) never has to ship in the production bundle.
// Uses only the `pg` package the application already bundles.
//
// Usage: DATABASE_URL=postgresql://... node prisma/deploy-migrations.mjs
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = process.env.MIGRATIONS_DIR ?? join(here, "migrations");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// Prisma Migrate takes this advisory lock while it works; sharing it keeps the two tools
// from ever running at the same time.
const ADVISORY_LOCK_ID = 72707369;

const TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

function readLocalMigrations() {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort()
    .map((name) => {
      const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

let exitCode = 0;
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);
  await client.query(TABLE_DDL);

  const { rows } = await client.query(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at, migration_name',
  );
  const recorded = new Map(rows.map((row) => [row.migration_name, row]));
  const local = readLocalMigrations();

  const problems = [];
  for (const [name, row] of recorded) {
    if (row.rolled_back_at) continue;
    const migration = local.find((m) => m.name === name);
    if (!migration) problems.push(`migration ${name} is recorded in the database but missing locally`);
    else if (row.finished_at === null) problems.push(`migration ${name} failed earlier; resolve it before deploying`);
    else if (row.checksum !== migration.checksum) problems.push(`migration ${name} was modified after it was applied`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    exitCode = 1;
  } else {
    const pending = local.filter((m) => {
      const row = recorded.get(m.name);
      return !row || row.rolled_back_at;
    });
    console.log(`${local.length} migrations found in ${migrationsDir}, ${pending.length} pending`);
    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ($1, $2, $3, now(), now(), 1)',
          [randomUUID(), migration.checksum, migration.name],
        );
        await client.query("COMMIT");
        console.log(`applied ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`migration ${migration.name} failed and was rolled back: ${error.message}`);
        exitCode = 1;
        break;
      }
    }
    if (exitCode === 0) console.log(pending.length > 0 ? "All migrations have been applied." : "No pending migrations to apply.");
  }
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
  } catch {
    // Connection may already be gone; the lock is released with it.
  }
  await client.end();
}
process.exit(exitCode);
