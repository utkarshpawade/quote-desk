import "server-only";
import { createPrismaClient, type Db } from "./db-client";

// One client per server instance; reused across hot reloads in development.
const globalForDb = globalThis as unknown as { quoteDeskDb?: Db };

export const db: Db = globalForDb.quoteDeskDb ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForDb.quoteDeskDb = db;

export type { Db };
