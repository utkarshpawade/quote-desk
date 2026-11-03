import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Creates a Prisma client on the node-postgres adapter. Used by the app singleton (`db.ts`)
 * and by scripts (seed, sample-data) that run outside Next.js.
 *
 * File contents (bytea) are omitted from every query by default so a list of files can never
 * pull megabytes of drawings by accident; the download route opts back in explicitly.
 */
export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 15_000 });
  return new PrismaClient({ adapter, omit: { storedFile: { data: true } } });
}

export type Db = ReturnType<typeof createPrismaClient>;

/** The client inside an interactive transaction. */
export type Tx = Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

/** Services accept either, so they compose inside a caller's transaction. */
export type DbOrTx = Db | Tx;
