import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Integration tests run against the real Postgres in .env (docker compose locally, a service
 * container in CI). When no database is reachable the suites skip instead of failing, so unit
 * tests stay runnable anywhere.
 */
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");

export function createTestDb(poolSize = 5) {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: poolSize,
    connectionTimeoutMillis: 3_000,
  });
  return new PrismaClient({ adapter, omit: { storedFile: { data: true } } });
}

export async function databaseAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const db = createTestDb(1);
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
