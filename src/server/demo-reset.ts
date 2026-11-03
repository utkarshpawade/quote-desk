import { timingSafeEqual } from "node:crypto";
import type { Db } from "./db-client";
import { demoPassword, isDemoMode } from "./demo";
import { UserError } from "./errors";
import { seedDemo, type SeedSummary } from "./seed";

/**
 * Puts the hosted demo back to its starting data — nightly by cron, or by the sales head after a
 * review session. People and their sessions are kept, so nobody is signed out.
 */

let running = false;

export async function resetDemo(db: Db): Promise<SeedSummary> {
  if (!isDemoMode()) throw new UserError("Resetting is only available on the demo.");
  // One reset at a time per instance; a second click while one runs is refused, not queued.
  if (running) throw new UserError("A reset is already running.");
  running = true;
  try {
    return await seedDemo(db, { password: demoPassword(), keepUsers: true });
  } finally {
    running = false;
  }
}

/** Checks Vercel Cron's `Authorization: Bearer <CRON_SECRET>` in constant time. */
export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
