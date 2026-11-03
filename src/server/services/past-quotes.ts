import { todayIst, type IsoDate } from "@/domain/calendar";
import type { PastRoutingOp } from "@/domain/import/legacy";
import { processHints } from "@/domain/intake/process-hints";
import { dec, money } from "@/domain/money";
import { pastConversionPerKg, rmAdjustedPrice, type RmAdjusted, type RmBasis } from "@/domain/similarity/rm-adjust";
import { median, rankSimilar, type Match, type Target } from "@/domain/similarity/score";
import { inputForm, shapeFamily, type InputForm, type ShapeFamily } from "@/domain/similarity/shape";
import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/server/db-client";
import { dateStr, kgStr, moneyStr } from "@/server/dto";
import { NotFoundError } from "@/server/errors";
import { Catalog, refAt } from "./rates";

/**
 * "What did we quote for a part like this?" — search over the imported register and quotes sent
 * from the app, and the deterministic similar-part ranking used by the costing screen.
 */

export type Outcome = "WON" | "LOST" | "NO_RESPONSE" | "OPEN" | "REGRETTED";

export interface PastQuoteRow {
  id: string;
  source: "LEGACY_IMPORT" | "APP";
  refNo: string;
  quoteDate: IsoDate;
  customerName: string;
  partNo: string;
  description: string;
  materialText: string | null;
  materialGrade: string | null;
  grossWeightKg: string | null;
  netWeightKg: string | null;
  annualVolume: number | null;
  unitPrice: string;
  /** Price per kg of finished weight. */
  pricePerKg: string | null;
  /** The price with today's steel and scrap rates. */
  rmAdjusted: RmAdjusted | null;
  /** Steel and scrap ₹/kg then and now, to explain the adjustment. */
  rm: { then: RmBasis; now: RmBasis } | null;
  conversionPerKg: string | null;
  outcome: Outcome;
  lostReason: string | null;
  estimatorName: string | null;
  routingText: string | null;
  routingOps: PastRoutingOp[];
  inputForm: InputForm | null;
  shapeFamily: ShapeFamily | null;
  /** App quotes link back to their RFQ. */
  rfqId: string | null;
}

const select = {
  id: true,
  source: true,
  refNo: true,
  quoteDate: true,
  customerName: true,
  partNo: true,
  description: true,
  materialText: true,
  materialItemId: true,
  grossWeightKg: true,
  netWeightKg: true,
  annualVolume: true,
  unitPrice: true,
  outcome: true,
  lostReason: true,
  estimatorName: true,
  routingText: true,
  routingOps: true,
  inputForm: true,
  shapeFamily: true,
  quoteLine: { select: { quote: { select: { rfqId: true } } } },
} satisfies Prisma.PastQuoteSelect;

type Selected = Prisma.PastQuoteGetPayload<{ select: typeof select }>;

/** Steel ₹/kg and what its turnings sell for, on a date. */
function rmBasis(catalog: Catalog, materialItemId: string | null, date: IsoDate): RmBasis | null {
  const item = materialItemId ? catalog.byId.get(materialItemId) : undefined;
  if (!item) return null;
  const rm = refAt(item, date);
  const scrapCode = typeof item.attributes.turningsScrapCode === "string" ? item.attributes.turningsScrapCode : null;
  const scrap = scrapCode ? catalog.codeAt(scrapCode, date) : null;
  return rm && scrap ? { rmRate: rm.value, scrapRate: scrap.value } : null;
}

function toRow(q: Selected, catalog: Catalog, today: IsoDate): PastQuoteRow {
  const quoteDate = dateStr(q.quoteDate);
  const gross = kgStr(q.grossWeightKg);
  const net = kgStr(q.netWeightKg);
  const price = moneyStr(q.unitPrice)!;
  const then = rmBasis(catalog, q.materialItemId, quoteDate);
  const now = rmBasis(catalog, q.materialItemId, today);
  const item = q.materialItemId ? catalog.byId.get(q.materialItemId) : undefined;
  return {
    id: q.id,
    source: q.source,
    refNo: q.refNo,
    quoteDate,
    customerName: q.customerName,
    partNo: q.partNo,
    description: q.description,
    materialText: q.materialText,
    materialGrade: typeof item?.attributes.grade === "string" ? item.attributes.grade : null,
    grossWeightKg: gross,
    netWeightKg: net,
    annualVolume: q.annualVolume,
    unitPrice: price,
    pricePerKg: net && dec(net).gt(0) ? money(dec(price).dividedBy(net)) : null,
    rmAdjusted: rmAdjustedPrice({ price, grossKg: gross, netKg: net, then, now }),
    rm: then && now ? { then, now } : null,
    conversionPerKg: pastConversionPerKg({ price, grossKg: gross, netKg: net, then }),
    outcome: q.outcome,
    lostReason: q.lostReason,
    estimatorName: q.estimatorName,
    routingText: q.routingText,
    routingOps: Array.isArray(q.routingOps) ? (q.routingOps as unknown as PastRoutingOp[]) : [],
    inputForm: (q.inputForm as InputForm | null) ?? null,
    shapeFamily: (q.shapeFamily as ShapeFamily | null) ?? null,
    rfqId: q.quoteLine?.quote.rfqId ?? null,
  };
}

// ─── search ───────────────────────────────────────────────────────────────────

export interface PastQuoteFilters {
  q?: string;
  customer?: string;
  outcome?: string;
  material?: string;
  page?: number;
}

export const PAGE_SIZE = 50;

export async function searchPastQuotes(db: DbOrTx, filters: PastQuoteFilters) {
  const words = (filters.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const outcome = ["WON", "LOST", "NO_RESPONSE", "OPEN", "REGRETTED"].includes(filters.outcome ?? "") ? (filters.outcome as Outcome) : undefined;
  // searchText is lower-cased "part no · description · material · customer"; LIKE '%w%' uses
  // the trigram index, and every word must match.
  const where: Prisma.PastQuoteWhereInput = {
    AND: words.map((w) => ({ searchText: { contains: w } })),
    ...(filters.customer ? { customerName: filters.customer } : {}),
    ...(outcome ? { outcome } : {}),
    ...(filters.material ? { materialItemId: filters.material } : {}),
  };
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const [total, rows, catalog] = await Promise.all([
    db.pastQuote.count({ where }),
    db.pastQuote.findMany({ where, select, orderBy: [{ quoteDate: "desc" }, { refNo: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    Catalog.load(db),
  ]);
  const today = todayIst();
  return { rows: rows.map((r) => toRow(r, catalog, today)), total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function pastQuoteFilterOptions(db: DbOrTx) {
  const [customers, materials, outcomes] = await Promise.all([
    db.pastQuote.groupBy({ by: ["customerName"], _count: true, orderBy: { customerName: "asc" } }),
    db.pastQuote.groupBy({ by: ["materialItemId"], _count: true, where: { materialItemId: { not: null } } }),
    db.pastQuote.groupBy({ by: ["outcome"], _count: true }),
  ]);
  const items = await db.rateItem.findMany({ where: { id: { in: materials.map((m) => m.materialItemId!) } }, select: { id: true, attributes: true, name: true } });
  return {
    customers: customers.map((c) => c.customerName),
    materials: items
      .map((i) => ({ id: i.id, grade: String((i.attributes as { grade?: string } | null)?.grade ?? i.name) }))
      .sort((a, b) => a.grade.localeCompare(b.grade)),
    total: outcomes.reduce((n, o) => n + o._count, 0),
    won: outcomes.find((o) => o.outcome === "WON")?._count ?? 0,
  };
}

// ─── similar parts ────────────────────────────────────────────────────────────

export interface SimilarPart extends PastQuoteRow {
  match: Match;
}

export interface SimilarResult {
  target: Target & { partNo: string; rfqNumber: string; rfqId: string; partId: string };
  matches: SimilarPart[];
  /** Median conversion ₹/kg of the matches that have weights and a known material. */
  benchmark: { medianConversionPerKg: string; count: number } | null;
}

/**
 * Similar past parts for an RFQ part, described by its current costing (material, weights) where
 * one exists, else by what the customer sent.
 */
export async function findSimilarForPart(db: DbOrTx, partId: string, limit = 5): Promise<SimilarResult> {
  const part = await db.rfqPart.findUnique({
    where: { id: partId },
    select: {
      id: true,
      partNo: true,
      description: true,
      materialText: true,
      materialItemId: true,
      grossWeightKg: true,
      forgedWeightKg: true,
      netWeightKg: true,
      processHints: true,
      rfq: { select: { id: true, number: true } },
      quoteLines: {
        orderBy: { quote: { revision: "desc" } },
        take: 1,
        select: { materialVersion: { select: { rateItemId: true } }, grossWeightKg: true, forgedWeightKg: true, netWeightKg: true },
      },
    },
  });
  if (!part) throw new NotFoundError("Part");

  const catalog = await Catalog.load(db);
  const line = part.quoteLines[0];
  const materialItemId = line?.materialVersion?.rateItemId ?? part.materialItemId;
  const material = materialItemId ? catalog.byId.get(materialItemId) : undefined;
  const gross = kgStr(line?.grossWeightKg ?? part.grossWeightKg);
  const net = kgStr(line?.netWeightKg ?? part.netWeightKg);
  const forged = line?.forgedWeightKg ?? part.forgedWeightKg;
  const target: SimilarResult["target"] = {
    partId: part.id,
    partNo: part.partNo,
    rfqId: part.rfq.id,
    rfqNumber: part.rfq.number,
    description: part.description,
    inputForm: inputForm({ materialText: part.materialText, description: part.description, hasForgedWeight: Boolean(forged) }),
    shapeFamily: shapeFamily(part.description),
    materialGrade: typeof material?.attributes.grade === "string" ? material.attributes.grade : null,
    materialFamily: typeof material?.attributes.family === "string" ? material.attributes.family : null,
    weightKg: gross ? Number(gross) : net ? Number(net) : null,
    processHints: part.processHints,
  };

  const candidates = await db.pastQuote.findMany({
    where: { inputForm: target.inputForm, NOT: { quoteLine: { is: { rfqPartId: part.id } } } },
    select,
  });
  const today = todayIst();
  const rows = new Map<string, PastQuoteRow>();
  const comparable = candidates.map((c) => {
    const row = toRow(c, catalog, today);
    rows.set(row.id, row);
    const item = c.materialItemId ? catalog.byId.get(c.materialItemId) : undefined;
    const opsText = [...row.routingOps.flatMap((op) => [op.name, op.legacyName ?? ""]), row.routingText ?? ""].join(" | ");
    return {
      id: row.id,
      description: row.description,
      quoteDate: row.quoteDate,
      inputForm: row.inputForm,
      shapeFamily: row.shapeFamily,
      materialGrade: row.materialGrade,
      materialFamily: typeof item?.attributes.family === "string" ? item.attributes.family : null,
      weightKg: row.grossWeightKg ? Number(row.grossWeightKg) : row.netWeightKg ? Number(row.netWeightKg) : null,
      processes: processHints(opsText),
    };
  });
  const matches = rankSimilar(target, comparable, today, limit).map((r) => ({ ...rows.get(r.id)!, match: r.match }));
  const conversions = matches.map((r) => r.conversionPerKg).filter((v): v is string => v !== null).map(Number);
  const mid = median(conversions);
  return {
    target,
    matches,
    benchmark: mid !== null && conversions.length >= 3 ? { medianConversionPerKg: mid.toFixed(2), count: conversions.length } : null,
  };
}

/** For the past-quote drawer: one row by id. */
export async function getPastQuote(db: DbOrTx, id: string): Promise<PastQuoteRow> {
  const row = await db.pastQuote.findUnique({ where: { id }, select });
  if (!row) throw new NotFoundError("Past quote");
  return toRow(row, await Catalog.load(db), todayIst());
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  WON: "Won",
  LOST: "Lost",
  NO_RESPONSE: "No response",
  OPEN: "Open",
  REGRETTED: "Regretted",
};

// ─── costing screen ───────────────────────────────────────────────────────────

export interface RoutingSuggestion {
  id: string;
  refNo: string;
  description: string;
  materialGrade: string | null;
  grossWeightKg: string | null;
  customerName: string;
  outcome: Outcome;
  quoteDate: IsoDate;
  score: number;
  ops: PastRoutingOp[];
}

export interface SimilarForCosting {
  href: string;
  count: number;
  benchmark: { medianConversionPerKg: string; count: number } | null;
  /** The best matches that recorded a routing, to start the costing from. */
  suggestions: RoutingSuggestion[];
  /** Past quote id → its quote no., for operations already copied from one. */
  labels: Record<string, string>;
}

export async function similarForCosting(db: DbOrTx, partId: string, copiedFrom: string[]): Promise<SimilarForCosting> {
  const { matches, benchmark } = await findSimilarForPart(db, partId, 5);
  const labels: Record<string, string> = Object.fromEntries(matches.map((m) => [m.id, m.refNo]));
  const missing = [...new Set(copiedFrom)].filter((id) => !labels[id]);
  if (missing.length) {
    for (const q of await db.pastQuote.findMany({ where: { id: { in: missing } }, select: { id: true, refNo: true } })) labels[q.id] = q.refNo;
  }
  return {
    href: `/past-quotes?similar=${partId}`,
    count: matches.length,
    benchmark,
    suggestions: matches
      .filter((m) => m.routingOps.length > 0)
      .slice(0, 3)
      .map((m) => ({
        id: m.id,
        refNo: m.refNo,
        description: m.description,
        materialGrade: m.materialGrade,
        grossWeightKg: m.grossWeightKg,
        customerName: m.customerName,
        outcome: m.outcome,
        quoteDate: m.quoteDate,
        score: m.match.score,
        ops: m.routingOps,
      })),
    labels,
  };
}
