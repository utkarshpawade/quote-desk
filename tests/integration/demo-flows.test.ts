import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIst, type IsoDate } from "@/domain/calendar";
import { liveVersions } from "@/domain/rates/resolve";
import { canonicalJson } from "@/domain/snapshot";
import { seedDemo, type SeedSummary } from "@/server/seed";
import { importPastQuotes, readSampleImport } from "@/server/services/past-quote-import";
import { assembleQuote, getSnapshotBody, hashSnapshot } from "@/server/services/quote-lifecycle";
import { previewReprice } from "@/server/services/quotes";
import { addRateVersion, voidRateVersion } from "@/server/services/rate-admin";
import { Catalog, refAt } from "@/server/services/rates";
import { createRfq } from "@/server/services/rfqs";
import { createTestDb, databaseAvailable } from "./db";

/**
 * End-to-end service flows on a freshly seeded database (TEST_DATABASE_URL): the seed itself, the
 * rule that a rate change never moves a frozen quote, and the import's idempotency.
 */

const url = process.env.TEST_DATABASE_URL;
const available = await databaseAvailable(url);

describe.skipIf(!available)("demo data, frozen quotes and versioned rates (Postgres)", () => {
  const db = createTestDb(10, url);
  let summary: SeedSummary;
  let head: { id: string; name: string };

  beforeAll(async () => {
    process.env.GROQ_API_KEY = ""; // intake reads by rules; tests never call the network
    summary = await seedDemo(db, { password: "integration-test" });
    head = await db.user.findFirstOrThrow({ where: { role: "SALES_HEAD" }, select: { id: true, name: true } });
  }, 240_000);

  afterAll(() => db.$disconnect());

  /** A submitted or sent quote priced on EN8, and the EN8 version it froze. */
  async function frozenEn8Line() {
    return db.quoteLine.findFirstOrThrow({
      where: { quote: { status: { in: ["IN_APPROVAL", "APPROVED", "SENT"] } }, materialVersion: { rateItem: { code: "MAT-EN8" } } },
      select: { materialVersionId: true, quote: { select: { id: true, number: true, basisDate: true } } },
    });
  }

  it("seeds through the real services: every frozen quote re-assembles to its stored hash", async () => {
    expect(summary).toMatchObject({ rfqs: 23, pastQuotes: 1400, intakes: 2 });
    const quotes = await db.quote.findMany({ where: { status: { in: ["IN_APPROVAL", "APPROVED", "SENT"] } }, select: { id: true, number: true } });
    expect(quotes.length).toBeGreaterThanOrEqual(10);
    for (const q of quotes) {
      const snap = (await getSnapshotBody(db, q.id))!;
      const again = await assembleQuote(db, q.id, snap.body.quote.documentDate);
      expect(hashSnapshot(canonicalJson(again.body)), q.number).toBe(snap.hash);
    }
  });

  it("numbers the next RFQ after the ones the seed used", async () => {
    const customer = await db.customer.findFirstOrThrow({ select: { id: true } });
    const created = await db.$transaction((tx) =>
      createRfq(tx, head, {
        customerId: customer.id,
        customerRef: null,
        subject: "Integration test",
        receivedAt: new Date(),
        dueDate: addDays(todayIst(), 5),
        ownerId: head.id,
        parts: [{ partNo: "IT-1", description: "Test pin" }],
      }),
    );
    expect(created.number).toMatch(/^RFQ-\d{4}-\d{3}$/);
    expect(await db.rfq.count({ where: { number: created.number } })).toBe(1);
  });

  describe("a new EN8 rate", () => {
    let from: IsoDate;
    let before: string;

    beforeAll(async () => {
      const catalog = await Catalog.load(db);
      const en8 = catalog.byCode.get("MAT-EN8")!;
      // A few days ahead, on a day no live version starts (the seed schedules one for the 1st).
      from = addDays(todayIst(), 3);
      while (liveVersions(en8.versions).some((v) => v.effectiveFrom === from)) from = addDays(from, 1);
      before = refAt(en8, addDays(from, -1))!.value;
      expect(await addRateVersion(db, head, { itemId: en8.id, value: "78.00", effectiveFrom: from, note: null, confirmLargeChange: false })).toEqual({ largeChange: false });
    });

    it("resolves by date: the old value the day before, ₹78.00 from its first day", async () => {
      const en8 = (await Catalog.load(db)).byCode.get("MAT-EN8")!;
      expect(refAt(en8, addDays(from, -1))!.value).toBe(before);
      expect(refAt(en8, from)!.value).toBe("78.0000");
    });

    it("leaves every frozen quote exactly as it was", async () => {
      const line = await frozenEn8Line();
      const snap = (await getSnapshotBody(db, line.quote.id))!;
      const again = await assembleQuote(db, line.quote.id, snap.body.quote.documentDate);
      expect(hashSnapshot(canonicalJson(again.body))).toBe(snap.hash);
    });

    it("re-prices a draft moved to the new date, tier by tier", async () => {
      const draft = await db.quote.findFirstOrThrow({ where: { status: "DRAFT", rfq: { number: "RFQ-2611-014" } }, select: { id: true } });
      const preview = await previewReprice(db, draft.id, from);
      expect(preview.changedRates).toContainEqual(expect.objectContaining({ code: "MAT-EN8", after: "78.0000" }));
      const tiers = preview.parts[0]!.tiers;
      expect(tiers.length).toBe(3);
      for (const t of tiers) expect(Number(t.after)).toBeGreaterThan(Number(t.before));
    });

    it("refuses a back-dated version that would move a frozen quote", async () => {
      const line = await frozenEn8Line();
      const basis = line.quote.basisDate.toISOString().slice(0, 10);
      const en8 = (await Catalog.load(db)).byCode.get("MAT-EN8")!;
      await expect(addRateVersion(db, head, { itemId: en8.id, value: "75.00", effectiveFrom: basis, note: "Mill circular backdated", confirmLargeChange: true })).rejects.toThrow(
        /priced on this rate|already starts on this date/,
      );
    });

    it("refuses to void a version a frozen quote uses", async () => {
      const line = await frozenEn8Line();
      await expect(voidRateVersion(db, head, { versionId: line.materialVersionId!, reason: "Entered by mistake" })).rejects.toThrow(/cannot be voided/);
    });
  });

  describe("past-quote import", () => {
    it("adds nothing when the same register is imported again", async () => {
      const result = await importPastQuotes(db, head, await readSampleImport("register"));
      expect(result).toMatchObject({ imported: 0, skipped: 1400, failed: 0 });
    });

    it("imports the clean rows of a file with mistakes, once", async () => {
      const file = await readSampleImport("errors");
      expect(await importPastQuotes(db, head, file)).toMatchObject({ imported: 54, skipped: 1, failed: 5 });
      expect(await importPastQuotes(db, head, file)).toMatchObject({ imported: 0, skipped: 55, failed: 5 });
    });
  });
});
