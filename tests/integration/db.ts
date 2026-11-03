import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Integration tests run against the real Postgres in .env (docker compose locally, a service
 * container in CI). Suites that re-seed the demo use TEST_DATABASE_URL, a separate database, so
 * they never wipe the data the dev server shows. When no database is reachable the suites skip
 * instead of failing, so unit tests stay runnable anywhere.
 */
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");

export function createTestDb(poolSize = 5, connectionString = process.env.DATABASE_URL) {
  const adapter = new PrismaPg({
    connectionString,
    max: poolSize,
    connectionTimeoutMillis: 3_000,
  });
  return new PrismaClient({ adapter, omit: { storedFile: { data: true } } });
}

export async function databaseAvailable(connectionString = process.env.DATABASE_URL): Promise<boolean> {
  if (!connectionString) return false;
  const db = createTestDb(1, connectionString);
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await db.$disconnect();
  }
}

/** A short unique suffix so parallel test runs never collide on keys or codes. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
