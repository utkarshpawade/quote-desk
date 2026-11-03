import type { IsoDate } from "@/domain/calendar";
import { formatRfqNumber, periodKey } from "@/domain/numbering";
import type { DbOrTx } from "@/server/db-client";

/**
 * Gap-free document sequences. One atomic upsert allocates the next value — no SELECT … FOR
 * UPDATE (which locks nothing when the month's row does not exist yet) and it works through
 * Neon's transaction pooler. Run it inside the transaction that creates the document so a
 * rolled-back create does not burn a number.
 */
export async function nextSequence(db: DbOrTx, key: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error(`Counter ${key} returned no value`);
  return Number(value);
}

/** Moves a counter forward to at least `atLeast` (used after seeding fixed numbers). */
export async function raiseSequence(db: DbOrTx, key: string, atLeast: number): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, ${atLeast})
    ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", EXCLUDED."value")`;
}

/** Next register number for an RFQ received on an India calendar date, e.g. RFQ-2611-024. */
export async function nextRfqNumber(db: DbOrTx, istDate: IsoDate): Promise<string> {
  const period = periodKey(istDate);
  return formatRfqNumber(period, await nextSequence(db, `RFQ-${period}`));
}
