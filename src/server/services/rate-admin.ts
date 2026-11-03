import { todayIst, toDbDate, type IsoDate } from "@/domain/calendar";
import type { RateCategory } from "@/domain/rates/catalog";
import { checkNewVersion, checkVoid, liveWindows, needsConfirmation, resolveAt } from "@/domain/rates/resolve";
import type { Db, DbOrTx } from "@/server/db-client";
import { dateStr } from "@/server/dto";
import { NotFoundError, UserError } from "@/server/errors";
import { recordAudit } from "./audit";
import { loadCatalog, type CatalogItem } from "./rates";

/**
 * Rate masters: what the table and the history drawer show, and the only two ways a rate
 * changes — add a version or void one — both guarded by the traceability invariant.
 */

interface Usage {
  quotes: number;
  frozen: number;
}

/** How many quotes reference each rate version, and how many of those are frozen. */
async function versionUsage(db: DbOrTx): Promise<Map<string, Usage>> {
  const rows = await db.$queryRaw<Array<{ versionId: string; quotes: bigint; frozen: bigint }>>`
    WITH refs AS (
      SELECT l."materialVersionId" AS v, q.id AS quote_id, q.status FROM "QuoteLine" l JOIN "Quote" q ON q.id = l."quoteId"
      UNION ALL SELECT l."scrapVersionId", q.id, q.status FROM "QuoteLine" l JOIN "Quote" q ON q.id = l."quoteId"
      UNION ALL SELECT l."flashScrapVersionId", q.id, q.status FROM "QuoteLine" l JOIN "Quote" q ON q.id = l."quoteId"
      UNION ALL SELECT l."packingVersionId", q.id, q.status FROM "QuoteLine" l JOIN "Quote" q ON q.id = l."quoteId"
      UNION ALL SELECT l."freightVersionId", q.id, q.status FROM "QuoteLine" l JOIN "Quote" q ON q.id = l."quoteId"
      UNION ALL SELECT o."rateVersionId", q.id, q.status FROM "QuoteOperation" o JOIN "QuoteLine" l ON l.id = o."lineId" JOIN "Quote" q ON q.id = l."quoteId"
      UNION ALL SELECT p."rateVersionId", q.id, q.status FROM "QuoteParam" p JOIN "Quote" q ON q.id = p."quoteId"
    )
    SELECT v AS "versionId",
           count(DISTINCT quote_id) AS quotes,
           count(DISTINCT quote_id) FILTER (WHERE status <> 'DRAFT') AS frozen
    FROM refs WHERE v IS NOT NULL GROUP BY v`;
  return new Map(rows.map((r) => [r.versionId, { quotes: Number(r.quotes), frozen: Number(r.frozen) }]));
}

/** Basis dates of frozen quotes that use any version of an item (for the back-dating check). */
async function frozenUses(db: DbOrTx, versionIds: string[]): Promise<{ basisDates: IsoDate[]; versionIds: Set<string> }> {
  if (versionIds.length === 0) return { basisDates: [], versionIds: new Set() };
  const rows = await db.$queryRaw<Array<{ basisDate: Date; versionId: string }>>`
    WITH refs AS (
      SELECT l."materialVersionId" AS v, l."quoteId" FROM "QuoteLine" l
      UNION ALL SELECT l."scrapVersionId", l."quoteId" FROM "QuoteLine" l
      UNION ALL SELECT l."flashScrapVersionId", l."quoteId" FROM "QuoteLine" l
      UNION ALL SELECT l."packingVersionId", l."quoteId" FROM "QuoteLine" l
      UNION ALL SELECT l."freightVersionId", l."quoteId" FROM "QuoteLine" l
      UNION ALL SELECT o."rateVersionId", l."quoteId" FROM "QuoteOperation" o JOIN "QuoteLine" l ON l.id = o."lineId"
      UNION ALL SELECT p."rateVersionId", p."quoteId" FROM "QuoteParam" p
    )
    SELECT DISTINCT q."basisDate" AS "basisDate", refs.v AS "versionId"
    FROM refs JOIN "Quote" q ON q.id = refs."quoteId"
    WHERE refs.v = ANY(${versionIds}) AND q.status <> 'DRAFT'`;
  return { basisDates: rows.map((r) => dateStr(r.basisDate)), versionIds: new Set(rows.map((r) => r.versionId)) };
}

export interface RateRow {
  id: string;
  code: string;
  name: string;
  unit: CatalogItem["unit"];
  category: RateCategory;
  attributes: Record<string, unknown>;
  current: { value: string; effectiveFrom: IsoDate } | null;
  next: { value: string; effectiveFrom: IsoDate } | null;
  versions: Array<CatalogItem["versions"][number] & { effectiveTo: IsoDate | null; quotes: number; frozen: number }>;
  quotes: number;
}

export async function listRateMaster(db: DbOrTx, category: RateCategory, asOf: IsoDate): Promise<RateRow[]> {
  const [items, usage] = await Promise.all([loadCatalog(db, { categories: [category] }), versionUsage(db)]);
  return items.map((item) => {
    const current = resolveAt(item.versions, asOf);
    const windows = new Map(liveWindows(item.versions).map((w) => [w.version.id, w.effectiveTo]));
    const next = item.versions.filter((v) => v.voidedAt === null && v.effectiveFrom > asOf).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
    const versions = [...item.versions]
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt))
      .map((v) => ({ ...v, effectiveTo: windows.get(v.id) ?? null, quotes: usage.get(v.id)?.quotes ?? 0, frozen: usage.get(v.id)?.frozen ?? 0 }));
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      category: item.category,
      attributes: item.attributes,
      current: current ? { value: current.value, effectiveFrom: current.effectiveFrom } : null,
      next: next ? { value: next.value, effectiveFrom: next.effectiveFrom } : null,
      versions,
      quotes: versions.reduce((acc, v) => acc + v.quotes, 0),
    };
  });
}

export async function addRateVersion(
  db: Db,
  user: { id: string; name: string },
  input: { itemId: string; value: string; effectiveFrom: IsoDate; note: string | null; confirmLargeChange: boolean },
): Promise<{ largeChange: boolean }> {
  const [item] = (await loadCatalog(db, { includeInactive: true })).filter((i) => i.id === input.itemId);
  if (!item) throw new NotFoundError("Rate");
  const today = todayIst();
  const value = Number(input.value);
  const signed = item.code === "MARGIN_ABOVE_PP";
  if (!Number.isFinite(value) || (!signed && value <= 0) || Math.abs(value) >= 1e9) {
    throw new UserError("Enter a rate greater than zero.", { value: "Must be more than 0" });
  }
  if (input.effectiveFrom < today && !input.note?.trim()) {
    throw new UserError("A version that starts in the past needs a note saying why (for example, the mill circular date).", { note: "Required for back-dated versions" });
  }

  const frozen = await frozenUses(db, item.versions.map((v) => v.id));
  const check = checkNewVersion({ versions: item.versions, effectiveFrom: input.effectiveFrom, today, frozenBasisDates: frozen.basisDates });
  if (!check.ok) throw new UserError(check.reason, { effectiveFrom: check.reason });

  const previous = resolveAt(item.versions, input.effectiveFrom);
  if (needsConfirmation(previous?.value ?? null, input.value) && !input.confirmLargeChange) {
    return { largeChange: true };
  }

  await db.$transaction(async (tx) => {
    const created = await tx.rateVersion.create({
      data: { rateItemId: item.id, value: input.value, effectiveFrom: toDbDate(input.effectiveFrom), note: input.note?.trim() || null, createdById: user.id },
    });
    await recordAudit(tx, {
      actorId: user.id,
      entityType: "RateVersion",
      entityId: created.id,
      action: "rate.version_added",
      summary: `${user.name} set ${item.code} to ${input.value} from ${input.effectiveFrom}${previous ? ` (was ${Number(previous.value)})` : ""}`,
    });
  });
  return { largeChange: false };
}

export async function voidRateVersion(db: Db, user: { id: string; name: string }, input: { versionId: string; reason: string }): Promise<{ draftsAffected: number }> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new UserError("Say why this version is void.", { reason: "Required" });
  const version = await db.rateVersion.findUnique({ where: { id: input.versionId }, include: { rateItem: { select: { code: true } } } });
  if (!version) throw new NotFoundError("Rate version");
  const frozen = await frozenUses(db, [version.id]);
  const check = checkVoid({
    version: { id: version.id, effectiveFrom: dateStr(version.effectiveFrom), value: version.value.toString(), voidedAt: version.voidedAt?.toISOString() ?? null },
    frozenVersionIds: frozen.versionIds,
  });
  if (!check.ok) throw new UserError(check.reason);

  const usage = (await versionUsage(db)).get(version.id);
  await db.$transaction(async (tx) => {
    await tx.rateVersion.update({ where: { id: version.id }, data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason } });
    await recordAudit(tx, {
      actorId: user.id,
      entityType: "RateVersion",
      entityId: version.id,
      action: "rate.version_voided",
      summary: `${user.name} voided ${version.rateItem.code} ${version.value.toString()} from ${dateStr(version.effectiveFrom)} — “${reason}”`,
    });
  });
  // Drafts that priced on it pick up the live version on their next save and are refused at
  // submit until re-priced (stale-rate check), so nothing is sent on a voided rate.
  return { draftsAffected: usage?.quotes ?? 0 };
}
