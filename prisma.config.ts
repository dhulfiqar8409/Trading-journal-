import type { PrismaConfig } from "prisma/config";

// Prisma does not load .env files on its own. Node 22 can, so pick up a local
// .env when one exists (development) and otherwise rely on the process
// environment (Docker, CI). The type-only import keeps this file free of
// runtime dependencies so the CLI can load it from a minimal production image.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: fine.
}

const config: PrismaConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://invalid:invalid@localhost:5432/invalid",
  },
};

export default config;
