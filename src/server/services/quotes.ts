import { randomUUID } from "node:crypto";
import type { IsoDate } from "@/domain/calendar";
import { todayIst, toDbDate } from "@/domain/calendar";
import {
  contextFromOptions,
  draftToCostingInput,
  LineDraft,
  type CatalogOption,
  type OperationDraft,
} from "@/domain/costing/draft";
import { computeCosting } from "@/domain/costing/engine";
import { defaultTiers, type MarginLadder } from "@/domain/costing/tiers";
import type { CostingResult, MarginBasis, RateRef } from "@/domain/costing/types";
import { COMMERCIAL } from "@/domain/rates/catalog";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, DbOrTx } from "@/server/db-client";
import { dateStr, isoStr, kgStr, minStr, moneyStr, pctStr } from "@/server/dto";
import { ConflictError, NotFoundError, UserError } from "@/server/errors";
import { Catalog, refAt, type CatalogItem } from "./rates";

/**
 * Draft quotes and costing lines: creating them with sensible defaults from the masters,
 * loading the costing screen, autosaving it, and re-pricing on a new basis date.
 * Submit / approve / send live in quote-lifecycle.ts.
 */

const ACTIVE_GAP_SECONDS = 5 * 60;

// ─── catalog → options ─────────────────────────────────────────────────────────

const OPTION_CATEGORIES = ["MATERIAL", "SCRAP", "BOP", "MACHINE", "PROCESS", "PACKING", "FREIGHT"] as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function optionsAt(catalog: Catalog, date: IsoDate): CatalogOption[] {
  return catalog.items
    .filter((i): i is CatalogItem & { category: CatalogOption["category"] } =>
      (OPTION_CATEGORIES as readonly string[]).includes(i.category),
    )
    .map((item) => {
      const a = item.attributes;
      return {
        id: item.id,
        category: item.category,
        code: item.code,
        name: item.name,
        unit: item.unit,
        ref: refAt(item, date),
        inHouse: item.category === "MACHINE" ? true : a.inHouse === true,
        defaultWeightBasis: (str(a.defaultWeightBasis) as CatalogOption["defaultWeightBasis"]) ?? null,
        turningsScrapItemId: catalog.byCode.get(str(a.turningsScrapCode) ?? "")?.id ?? null,
        flashScrapItemId: catalog.byCode.get(str(a.flashScrapCode) ?? "")?.id ?? null,
        grade: str(a.grade),
        family: str(a.family),
        aliases: Array.isArray(a.aliases) ? a.aliases.filter((x): x is string => typeof x === "string") : [],
      };
    });
}

/** Cost-policy parameters resolved at the basis date. */
export interface BasisParams {
  overheadPct: RateRef | null;
  iccRatePct: RateRef | null;
  iccDays: RateRef | null;
  rejectionDefaultPct: RateRef | null;
  batchesPerYear: RateRef | null;
  scaleLossDefaultPct: RateRef | null;
  ladder: MarginLadder | null;
}

export function basisParams(catalog: Catalog, date: IsoDate): BasisParams {
  const at = (code: string) => catalog.codeAt(code, date);
  const base = at(COMMERCIAL.MARGIN_BASE_PCT);
  const below = at(COMMERCIAL.MARGIN_BELOW_PP);
  const above = at(COMMERCIAL.MARGIN_ABOVE_PP);
  return {
    overheadPct: at(COMMERCIAL.OVERHEAD_PCT),
    iccRatePct: at(COMMERCIAL.ICC_RATE_PCT),
    iccDays: at(COMMERCIAL.ICC_DAYS),
    rejectionDefaultPct: at(COMMERCIAL.REJECTION_DEFAULT_PCT),
    batchesPerYear: at(COMMERCIAL.BATCHES_PER_YEAR),
    scaleLossDefaultPct: at(COMMERCIAL.SCALE_LOSS_DEFAULT_PCT),
    ladder: base && below && above ? { basePct: base.value, belowPp: below.value, abovePp: above.value } : null,
  };
}

const trimDec = (v: string) => v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

// ─── line ⇄ draft ──────────────────────────────────────────────────────────────

type LineWithChildren = Prisma.QuoteLineGetPayload<{
  include: { operations: true; tiers: true };
}>;

/** A stored line as the editable draft (stored version ids → their rate items). */
export function lineToDraft(line: LineWithChildren, catalog: Catalog): LineDraft {
  const itemOf = (versionId: string | null) => catalog.itemOfVersion(versionId)?.id ?? null;
  const ops = [...line.operations].sort((a, b) => a.seq - b.seq);
  return {
    grossWeightKg: kgStr(line.grossWeightKg),
    forgedWeightKg: kgStr(line.forgedWeightKg),
    netWeightKg: kgStr(line.netWeightKg),
    scaleLossPct: pctStr(line.scaleLossPct),
    materialItemId: itemOf(line.materialVersionId),
    packingItemId: itemOf(line.packingVersionId),
    freightItemId: itemOf(line.freightVersionId),
    rejectionPct: pctStr(line.rejectionPct)!,
    batchesPerYear: line.batchesPerYear,
    gstClass: line.gstClass,
    toolingMode: line.toolingMode,
    toolingCost: moneyStr(line.toolingCost)!,
    toolingAmortYears: line.toolingAmortYears,
    toolingNote: line.toolingNote,
    operations: ops
      .filter((o) => o.kind !== "BOP")
      .map((o) => ({
        id: o.id,
        name: o.name,
        itemId: itemOf(o.rateVersionId),
        kind: o.kind as OperationDraft["kind"],
        cycleTimeMin: minStr(o.cycleTimeMin),
        setupMin: minStr(o.setupMin),
        weightBasis: o.weightBasis,
        suggestedFromId: o.suggestedFromId,
        legacyName: o.legacyName,
        confirmed: o.confirmed,
      })),
    bop: ops
      .filter((o) => o.kind === "BOP")
      .map((o) => ({ id: o.id, itemId: itemOf(o.rateVersionId), quantity: kgStr(o.quantity) ?? "1.000" })),
    tiers: [...line.tiers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ volume: t.volume, marginPct: pctStr(t.marginPct)!, isBase: t.isBase })),
    routingConfirmed: line.routingConfirmed,
  };
}

/** Version ids to persist for a draft, resolved at the basis date. */
function resolveVersions(draft: LineDraft, options: CatalogOption[]) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const v = (itemId: string | null) => (itemId ? (byId.get(itemId)?.ref?.versionId ?? null) : null);
  const material = draft.materialItemId ? byId.get(draft.materialItemId) : undefined;
  return {
    materialVersionId: v(draft.materialItemId),
    scrapVersionId: v(material?.turningsScrapItemId ?? null),
    flashScrapVersionId: draft.forgedWeightKg ? v(material?.flashScrapItemId ?? null) : null,
    packingVersionId: v(draft.packingItemId),
    freightVersionId: v(draft.freightItemId),
    op: (itemId: string | null) => v(itemId),
  };
}

// ─── creating drafts ───────────────────────────────────────────────────────────

/** A new line's defaults: the part's accepted values plus the customer's and the masters' defaults. */
export function defaultDraft(args: {
  part: { grossWeightKg: string | null; forgedWeightKg: string | null; netWeightKg: string | null; annualVolume: number | null; materialItemId: string | null; gstClass: "GST_18" | "GST_5" };
  customer: { packingItemId: string | null; freightItemId: string | null };
  params: BasisParams;
}): LineDraft {
  const { part, customer, params } = args;
  const ladder = params.ladder ?? { basePct: "12", belowPp: "2", abovePp: "-1.5" };
  return {
    grossWeightKg: part.grossWeightKg,
    forgedWeightKg: part.forgedWeightKg,
    netWeightKg: part.netWeightKg,
    scaleLossPct: part.forgedWeightKg ? (params.scaleLossDefaultPct ? trimDec(params.scaleLossDefaultPct.value) : "2") : null,
    materialItemId: part.materialItemId,
    packingItemId: customer.packingItemId,
    freightItemId: customer.freightItemId,
    rejectionPct: params.rejectionDefaultPct ? trimDec(params.rejectionDefaultPct.value) : "2",
    batchesPerYear: params.batchesPerYear ? Math.round(Number(params.batchesPerYear.value)) : 12,
    gstClass: part.gstClass,
    toolingMode: "NONE",
    toolingCost: "0",
    toolingAmortYears: null,
    toolingNote: null,
    operations: [],
    bop: [],
    tiers: part.annualVolume ? defaultTiers(part.annualVolume, ladder) : [],
    routingConfirmed: true,
  };
}

/** Writes a draft's lines, operations and tiers (used on create, save, re-price and the seed). */
export async function writeLine(
  tx: DbOrTx,
  lineId: string,
  draft: LineDraft,
  options: CatalogOption[],
  extra: Prisma.QuoteLineUncheckedUpdateManyInput = {},
  expectedLockVersion?: number,
): Promise<number> {
  const versions = resolveVersions(draft, options);
  const where = expectedLockVersion === undefined ? { id: lineId } : { id: lineId, lockVersion: expectedLockVersion };
  const updated = await tx.quoteLine.updateMany({
    where,
    data: {
      grossWeightKg: draft.grossWeightKg,
      forgedWeightKg: draft.forgedWeightKg,
      netWeightKg: draft.netWeightKg,
      scaleLossPct: draft.forgedWeightKg ? draft.scaleLossPct : null,
      materialVersionId: versions.materialVersionId,
      scrapVersionId: versions.scrapVersionId,
      flashScrapVersionId: versions.flashScrapVersionId,
      packingVersionId: versions.packingVersionId,
      freightVersionId: versions.freightVersionId,
      rejectionPct: draft.rejectionPct,
      batchesPerYear: draft.batchesPerYear,
      gstClass: draft.gstClass,
      toolingMode: draft.toolingMode,
      toolingCost: draft.toolingCost,
      toolingAmortYears: draft.toolingMode === "AMORTIZED" ? draft.toolingAmortYears : null,
      toolingNote: draft.toolingNote,
      routingConfirmed: draft.routingConfirmed,
      lockVersion: { increment: 1 },
      ...extra,
    },
  });
  if (updated.count !== 1) throw new ConflictError();

  await tx.quoteOperation.deleteMany({ where: { lineId } });
  const ops: Prisma.QuoteOperationCreateManyInput[] = [
    ...draft.operations.map((op, i) => ({
      id: op.id,
      lineId,
      seq: (i + 1) * 10,
      name: op.name,
      kind: op.kind,
      rateVersionId: versions.op(op.itemId),
      legacyName: op.legacyName,
      cycleTimeMin: op.kind === "MACHINE" ? op.cycleTimeMin : null,
      setupMin: op.kind === "MACHINE" ? op.setupMin : null,
      weightBasis: op.kind === "PROCESS_KG" ? op.weightBasis : null,
      suggestedFromId: op.suggestedFromId,
      confirmed: op.confirmed,
    })),
    ...draft.bop.map((b, i) => ({
      id: b.id,
      lineId,
      seq: 1000 + i,
      name: options.find((o) => o.id === b.itemId)?.name ?? "Bought-out part",
      kind: "BOP" as const,
      rateVersionId: versions.op(b.itemId),
      quantity: b.quantity,
      confirmed: true,
    })),
  ];
  if (ops.length) await tx.quoteOperation.createMany({ data: ops });

  await tx.quoteTier.deleteMany({ where: { lineId } });
  if (draft.tiers.length) {
    await tx.quoteTier.createMany({
      data: draft.tiers.map((t, i) => ({ lineId, sortOrder: i, volume: t.volume, marginPct: t.marginPct, isBase: t.isBase })),
    });
  }
  const line = await tx.quoteLine.findUniqueOrThrow({ where: { id: lineId }, select: { lockVersion: true } });
  return line.lockVersion;
}

/** Quote-level cost parameters stored as QuoteParam rows (basis-date policy). */
async function writeBasisParams(tx: DbOrTx, quoteId: string, params: BasisParams) {
  const rows: Array<[string, RateRef | null]> = [
    [COMMERCIAL.OVERHEAD_PCT, params.overheadPct],
    [COMMERCIAL.ICC_RATE_PCT, params.iccRatePct],
    [COMMERCIAL.ICC_DAYS, params.iccDays],
  ];
  for (const [key, ref] of rows) {
    if (!ref) {
      await tx.quoteParam.deleteMany({ where: { quoteId, key } });
      continue;
    }
    await tx.quoteParam.upsert({
      where: { quoteId_key: { quoteId, key } },
      create: { quoteId, key, rateVersionId: ref.versionId },
      update: { rateVersionId: ref.versionId },
    });
  }
}

/**
 * Creates the draft quote for an RFQ (revision 0, or the next revision), one costing line per part.
 * `copyFrom` carries the lines of a previous revision forward (re-resolved on the new basis date).
 */
export async function createDraftQuote(
  tx: DbOrTx,
  args: { rfqId: string; revision: number; number: string; basisDate: IsoDate; copyFrom?: string },
): Promise<string> {
  const rfq = await tx.rfq.findUniqueOrThrow({
    where: { id: args.rfqId },
    include: { customer: true, parts: { orderBy: { lineNo: "asc" } } },
  });
  const catalog = await Catalog.load(tx);
  const options = optionsAt(catalog, args.basisDate);
  const params = basisParams(catalog, args.basisDate);

  const quote = await tx.quote.create({
    data: {
      rfqId: rfq.id,
      revision: args.revision,
      number: args.number,
      basisDate: toDbDate(args.basisDate),
      marginBasis: rfq.customer.marginBasis,
    },
  });
  await writeBasisParams(tx, quote.id, params);

  const previous = args.copyFrom
    ? await tx.quoteLine.findMany({ where: { quoteId: args.copyFrom }, include: { operations: true, tiers: true } })
    : [];

  for (const part of rfq.parts) {
    const line = await tx.quoteLine.create({
      data: { quoteId: quote.id, rfqPartId: part.id, rejectionPct: "2", batchesPerYear: 12, gstClass: part.gstClass },
    });
    const prior = previous.find((p) => p.rfqPartId === part.id);
    const draft = prior
      ? lineToDraft(prior, catalog)
      : defaultDraft({
          part: {
            grossWeightKg: kgStr(part.grossWeightKg),
            forgedWeightKg: kgStr(part.forgedWeightKg),
            netWeightKg: kgStr(part.netWeightKg),
            annualVolume: part.annualVolume,
            materialItemId: part.materialItemId,
            gstClass: part.gstClass,
          },
          customer: rfq.customer,
          params,
        });
    // Operation ids are primary keys; copies of a previous revision need fresh ones.
    if (prior) {
      draft.operations = draft.operations.map((op) => ({ ...op, id: newRowId() }));
      draft.bop = draft.bop.map((b) => ({ ...b, id: newRowId() }));
    }
    await writeLine(tx, line.id, draft, options);
  }
  return quote.id;
}

/** Client-safe ids for new operation rows (accepted by the LineDraft id pattern). */
export function newRowId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

// ─── the costing screen ────────────────────────────────────────────────────────

export interface ProvenanceView {
  value: string;
  sourceKind: string;
  sourceLabel: string;
  locator: string | null;
  evidence: string | null;
  confidence: string;
  decidedVia: string;
  proposedValue: string | null;
  acceptedBy: string;
  acceptedAt: string;
}

export interface CostingView {
  quote: { id: string; number: string; revision: number; status: string; basisDate: IsoDate; marginBasis: MarginBasis; editable: boolean };
  part: {
    id: string;
    lineNo: number;
    partNo: string;
    description: string;
    drawingNo: string | null;
    drawingRev: string | null;
    materialText: string | null;
    annualVolume: number | null;
    processHints: string[];
    hsnCode: string | null;
  };
  line: { id: string; lockVersion: number; draft: LineDraft; activeSeconds: number };
  options: CatalogOption[];
  params: {
    overheadPct: RateRef | null;
    iccRatePct: RateRef | null;
    iccDays: RateRef | null;
    marginFloorPct: string | null;
    ladder: MarginLadder | null;
  };
  provenance: Record<string, ProvenanceView>;
  pendingReview: number;
  returnNote: string | null;
}

export async function getCostingView(db: DbOrTx, rfqId: string, partId: string): Promise<CostingView> {
  const line = await db.quoteLine.findFirst({
    where: { rfqPartId: partId, quote: { rfqId }, rfqPart: { rfqId } },
    orderBy: { quote: { revision: "desc" } },
    include: {
      operations: true,
      tiers: true,
      quote: { include: { params: true } },
      rfqPart: {
        include: {
          provenances: { include: { acceptedBy: { select: { name: true } } }, orderBy: { acceptedAt: "asc" } },
          _count: { select: { extractedFields: { where: { status: "PENDING" } } } },
        },
      },
    },
  });
  if (!line) throw new NotFoundError("Part");

  const quote = line.quote;
  const basisDate = dateStr(quote.basisDate);
  const catalog = await Catalog.load(db);
  const params = basisParams(catalog, basisDate);
  const part = line.rfqPart;

  return {
    quote: {
      id: quote.id,
      number: quote.number,
      revision: quote.revision,
      status: quote.status,
      basisDate,
      marginBasis: quote.marginBasis,
      editable: quote.status === "DRAFT",
    },
    part: {
      id: part.id,
      lineNo: part.lineNo,
      partNo: part.partNo,
      description: part.description,
      drawingNo: part.drawingNo,
      drawingRev: part.drawingRev,
      materialText: part.materialText,
      annualVolume: part.annualVolume,
      processHints: part.processHints,
      hsnCode: part.hsnCode,
    },
    line: { id: line.id, lockVersion: line.lockVersion, draft: lineToDraft(line, catalog), activeSeconds: line.activeSeconds },
    options: optionsAt(catalog, basisDate),
    params: {
      overheadPct: params.overheadPct,
      iccRatePct: params.iccRatePct,
      iccDays: params.iccDays,
      marginFloorPct: catalog.codeAt(COMMERCIAL.MARGIN_FLOOR_PCT, todayIst())?.value ?? null,
      ladder: params.ladder,
    },
    provenance: Object.fromEntries(
      part.provenances.map((p) => [
        p.fieldKey,
        {
          value: p.value,
          sourceKind: p.sourceKind,
          sourceLabel: p.sourceLabel,
          locator: p.locator,
          evidence: p.evidence,
          confidence: p.confidence,
          decidedVia: p.decidedVia,
          proposedValue: p.proposedValue,
          acceptedBy: p.acceptedBy.name,
          acceptedAt: isoStr(p.acceptedAt),
        },
      ]),
    ),
    pendingReview: part._count.extractedFields,
    returnNote: quote.returnedPartIds.includes(part.id) ? quote.decisionNote : null,
  };
}

/** Computes a stored line exactly as the costing screen does. */
export function computeLine(draft: LineDraft, options: CatalogOption[], params: BasisParams, marginBasis: MarginBasis, marginFloorPct: string | null): CostingResult {
  const ctx = contextFromOptions(options, {
    overheadPct: params.overheadPct,
    iccRatePct: params.iccRatePct,
    iccDays: params.iccDays,
    marginBasis,
  });
  return computeCosting(draftToCostingInput(draft, ctx), { marginFloorPct });
}

/** Autosave from the costing screen. Returns the server's (authoritative) result. */
export async function saveLine(
  db: Db,
  user: { id: string },
  args: { lineId: string; lockVersion: number; draft: unknown },
): Promise<{ lockVersion: number; result: CostingResult; savedAt: string }> {
  const draft = LineDraft.parse(args.draft);
  const line = await db.quoteLine.findUnique({
    where: { id: args.lineId },
    select: { lastActivityAt: true, costingStartedAt: true, quote: { select: { id: true, status: true, basisDate: true, marginBasis: true } } },
  });
  if (!line) throw new NotFoundError("Costing line");
  if (line.quote.status !== "DRAFT") throw new UserError("This quote has been submitted and can no longer be edited.");

  const basisDate = dateStr(line.quote.basisDate);
  const catalog = await Catalog.load(db);
  const options = optionsAt(catalog, basisDate);
  const params = basisParams(catalog, basisDate);

  const now = new Date();
  const gap = line.lastActivityAt ? (now.getTime() - line.lastActivityAt.getTime()) / 1000 : 0;
  const lockVersion = await db.$transaction((tx) =>
    writeLine(
      tx,
      args.lineId,
      draft,
      options,
      {
        lastActivityAt: now,
        costingStartedAt: line.costingStartedAt ?? now,
        activeSeconds: { increment: gap > 0 && gap <= ACTIVE_GAP_SECONDS ? Math.round(gap) : 0 },
      },
      args.lockVersion,
    ),
  );
  const floor = catalog.codeAt(COMMERCIAL.MARGIN_FLOOR_PCT, todayIst())?.value ?? null;
  return { lockVersion, result: computeLine(draft, options, params, line.quote.marginBasis, floor), savedAt: now.toISOString() };
}

// ─── re-pricing ────────────────────────────────────────────────────────────────

export interface RepricePreview {
  basisDate: IsoDate;
  parts: Array<{
    partNo: string;
    description: string;
    tiers: Array<{ volume: number; before: string | null; after: string | null }>;
  }>;
  changedRates: Array<{ code: string; name: string; before: string | null; after: string | null }>;
}

async function loadQuoteForPricing(db: DbOrTx, quoteId: string) {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: {
      rfq: { select: { receivedAt: true } },
      lines: { include: { operations: true, tiers: true, rfqPart: true }, orderBy: { rfqPart: { lineNo: "asc" } } },
    },
  });
  if (!quote) throw new NotFoundError("Quote");
  return quote;
}

/** What changes if the quote is priced on `newDate` (default: today). */
export async function previewReprice(db: DbOrTx, quoteId: string, newDate: IsoDate = todayIst()): Promise<RepricePreview> {
  const quote = await loadQuoteForPricing(db, quoteId);
  const catalog = await Catalog.load(db);
  const oldDate = dateStr(quote.basisDate);
  const before = { options: optionsAt(catalog, oldDate), params: basisParams(catalog, oldDate) };
  const after = { options: optionsAt(catalog, newDate), params: basisParams(catalog, newDate) };

  const changed = new Map<string, { code: string; name: string; before: string | null; after: string | null }>();
  const parts = quote.lines.map((line) => {
    const draft = lineToDraft(line, catalog);
    const a = computeLine(draft, before.options, before.params, quote.marginBasis, null);
    const b = computeLine(draft, after.options, after.params, quote.marginBasis, null);
    const usedItems = [
      draft.materialItemId,
      draft.packingItemId,
      draft.freightItemId,
      ...draft.operations.map((o) => o.itemId),
      ...draft.bop.map((x) => x.itemId),
    ];
    const material = before.options.find((o) => o.id === draft.materialItemId);
    usedItems.push(material?.turningsScrapItemId ?? null, draft.forgedWeightKg ? (material?.flashScrapItemId ?? null) : null);
    for (const itemId of usedItems) {
      if (!itemId) continue;
      const o1 = before.options.find((o) => o.id === itemId);
      const o2 = after.options.find((o) => o.id === itemId);
      if (o1?.ref?.versionId !== o2?.ref?.versionId) {
        changed.set(itemId, { code: o1?.code ?? o2?.code ?? "", name: o1?.name ?? o2?.name ?? "", before: o1?.ref?.value ?? null, after: o2?.ref?.value ?? null });
      }
    }
    return {
      partNo: line.rfqPart.partNo,
      description: line.rfqPart.description,
      tiers: a.tiers.map((t, i) => ({ volume: t.volume, before: t.lines?.unitPrice ?? null, after: b.tiers[i]?.lines?.unitPrice ?? null })),
    };
  });
  for (const key of ["overheadPct", "iccRatePct", "iccDays"] as const) {
    const r1 = before.params[key];
    const r2 = after.params[key];
    if (r1?.versionId !== r2?.versionId) {
      changed.set(key, { code: r1?.code ?? r2?.code ?? key, name: r1?.name ?? r2?.name ?? key, before: r1?.value ?? null, after: r2?.value ?? null });
    }
  }
  return { basisDate: newDate, parts, changedRates: [...changed.values()] };
}

/**
 * Moves a draft to a new basis date: every rate is re-resolved and every line rewritten.
 * Allowed range (A-25): 30 days before the RFQ was received, up to today. A date other than
 * today needs a reason, which the approver sees.
 */
export async function repriceQuote(
  db: Db,
  args: { quoteId: string; basisDate: IsoDate; reason: string | null },
): Promise<void> {
  const quote = await loadQuoteForPricing(db, args.quoteId);
  if (quote.status !== "DRAFT") throw new UserError("Only a draft quote can be re-priced.");
  const today = todayIst();
  const earliest = dateStr(new Date(quote.rfq.receivedAt.getTime() - 30 * 86_400_000));
  if (args.basisDate > today) throw new UserError("The basis date cannot be in the future.");
  if (args.basisDate < earliest) throw new UserError(`The basis date cannot be before ${earliest} (30 days before the RFQ arrived).`);
  if (args.basisDate !== today && !args.reason?.trim()) {
    throw new UserError("Say why the quote is priced on a date other than today — the approver will see it.");
  }

  const catalog = await Catalog.load(db);
  const options = optionsAt(catalog, args.basisDate);
  const params = basisParams(catalog, args.basisDate);
  await db.$transaction(async (tx) => {
    await tx.quote.update({
      where: { id: quote.id },
      data: { basisDate: toDbDate(args.basisDate), basisReason: args.basisDate === today ? null : args.reason!.trim() },
    });
    await writeBasisParams(tx, quote.id, params);
    for (const line of quote.lines) await writeLine(tx, line.id, lineToDraft(line, catalog), options);
  });
}
