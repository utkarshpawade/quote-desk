import { afterAll, describe, expect, it } from "vitest";
import { createTestDb, databaseAvailable, uniqueSuffix } from "../../../tests/integration/db";
import { nextRfqNumber, nextSequence, raiseSequence } from "./counters";

const available = await databaseAvailable();

describe.skipIf(!available)("document counters (Postgres)", () => {
  const db = createTestDb(12);
  const key = `TEST-${uniqueSuffix()}`;

  afterAll(async () => {
    await db.counter.deleteMany({ where: { key: { startsWith: key } } });
    await db.$disconnect();
  });

  it("hands out distinct consecutive numbers under concurrent use", async () => {
    const values = await Promise.all(
      Array.from({ length: 20 }, () => db.$transaction((tx) => nextSequence(tx, key))),
    );
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("can be raised past numbers that were seeded, never lowered", async () => {
    const seeded = `${key}-seeded`;
    await raiseSequence(db, seeded, 23);
    await raiseSequence(db, seeded, 5);
    expect(await nextSequence(db, seeded)).toBe(24);
  });

  it("formats RFQ numbers from the India calendar month", async () => {
    // Uses a far-future period so it never touches real data.
    const first = await nextRfqNumber(db, "2099-12-31");
    expect(first).toMatch(/^RFQ-9912-\d{3,}$/);
    await db.counter.deleteMany({ where: { key: "RFQ-9912" } });
  });
});
