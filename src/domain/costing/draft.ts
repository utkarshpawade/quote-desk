import { z } from "zod";
import type { CostingInput, MarginBasis, OperationKind, RateRef } from "./types";

/**
 * What the costing screen edits and autosaves: rate items are referenced by item id; the server
 * (and the browser, for instant feedback) resolve them to versions at the quote's basis date with
 * the same pure function, `draftToCostingInput`, so both always compute the same numbers.
 */

const decimal = z
  .string()
  .trim()
  .max(20)
  .regex(/^-?\d+(\.\d+)?$/, "Enter a number");

/** Empty input means "not entered yet". */
const optionalDecimal = z.preprocess((v) => (v === "" || v === undefined ? null : v), decimal.nullable());

const id = z.string().regex(/^[A-Za-z0-9_-]{6,40}$/, "Invalid id");

export const OperationDraft = z.object({
  id,
  name: z.string().trim().max(120),
  itemId: id.nullable(),
  kind: z.enum(["MACHINE", "PROCESS_KG", "PROCESS_PC"]),
  cycleTimeMin: optionalDecimal,
  setupMin: optionalDecimal,
  weightBasis: z.enum(["GROSS", "FORGED", "NET"]).nullable(),
  /** Past quote this operation was copied from (routing suggestion). */
  suggestedFromId: id.nullable(),
  /** Name as written in that past quote, when it could not be bound to a work centre. */
  legacyName: z.string().max(120).nullable(),
  confirmed: z.boolean(),
});
export type OperationDraft = z.infer<typeof OperationDraft>;

export const BopDraft = z.object({
  id,
  itemId: id.nullable(),
  quantity: decimal,
});
export type BopDraft = z.infer<typeof BopDraft>;

export const TierDraft = z.object({
  volume: z.number().int().min(0).max(100_000_000),
  marginPct: decimal,
  isBase: z.boolean(),
});
export type TierDraft = z.infer<typeof TierDraft>;

export const LineDraft = z.object({
  grossWeightKg: optionalDecimal,
  forgedWeightKg: optionalDecimal,
  netWeightKg: optionalDecimal,
  scaleLossPct: optionalDecimal,
  materialItemId: id.nullable(),
  packingItemId: id.nullable(),
  freightItemId: id.nullable(),
  rejectionPct: decimal,
  batchesPerYear: z.number().int().min(1).max(365),
  gstClass: z.enum(["GST_18", "GST_5"]),
  toolingMode: z.enum(["NONE", "SEPARATE", "AMORTIZED"]),
  toolingCost: decimal,
  toolingAmortYears: z.number().int().min(1).max(10).nullable(),
  toolingNote: z.string().trim().max(200).nullable(),
  operations: z.array(OperationDraft).max(30),
  bop: z.array(BopDraft).max(20),
  tiers: z.array(TierDraft).max(3),
  routingConfirmed: z.boolean(),
});
export type LineDraft = z.infer<typeof LineDraft>;

/** What the mapping needs to know about each rate item. */
export interface ItemInfo {
  ref: RateRef | null;
  /** Processes: in-house (attracts overhead) or job work. Machines are always in-house. */
  inHouse: boolean;
  /** Materials: the scrap items their turnings and flash are sold as. */
  turningsScrapItemId?: string | null;
  flashScrapItemId?: string | null;
}

export interface DraftContext {
  item(itemId: string | null): ItemInfo | null;
  overheadPct: RateRef | null;
  iccRatePct: RateRef | null;
  iccDays: RateRef | null;
  marginBasis: MarginBasis;
}

export function operationKindForUnit(unit: RateRef["unit"]): OperationKind {
  return unit === "PER_HOUR" ? "MACHINE" : unit === "PER_KG" ? "PROCESS_KG" : "PROCESS_PC";
}

/** A rate item as offered in the costing screen, with its rate resolved at the basis date. */
export interface CatalogOption {
  id: string;
  category: "MATERIAL" | "SCRAP" | "BOP" | "MACHINE" | "PROCESS" | "PACKING" | "FREIGHT";
  code: string;
  name: string;
  unit: RateRef["unit"];
  /** Null when no version is in force on the basis date. */
  ref: RateRef | null;
  inHouse: boolean;
  defaultWeightBasis: "GROSS" | "FORGED" | "NET" | null;
  turningsScrapItemId: string | null;
  flashScrapItemId: string | null;
  /** Materials: canonical grade and family, for matching and similarity. */
  grade: string | null;
  family: string | null;
  /** Other names (legacy machine names, grade aliases) for search. */
  aliases: string[];
}

/** Builds the mapping context from catalog options — used identically by browser and server. */
export function contextFromOptions(
  options: CatalogOption[],
  params: Pick<DraftContext, "overheadPct" | "iccRatePct" | "iccDays" | "marginBasis">,
): DraftContext {
  const byId = new Map(options.map((o) => [o.id, o]));
  return {
    ...params,
    item(itemId) {
      const o = itemId ? byId.get(itemId) : undefined;
      return o
        ? { ref: o.ref, inHouse: o.inHouse, turningsScrapItemId: o.turningsScrapItemId, flashScrapItemId: o.flashScrapItemId }
        : null;
    },
  };
}

export function draftToCostingInput(draft: LineDraft, ctx: DraftContext): CostingInput {
  const material = ctx.item(draft.materialItemId);
  const forged = draft.forgedWeightKg;
  return {
    grossWeightKg: draft.grossWeightKg,
    forgedWeightKg: forged,
    netWeightKg: draft.netWeightKg,
    scaleLossPct: forged ? draft.scaleLossPct : null,
    material: material?.ref ?? null,
    turningsScrap: ctx.item(material?.turningsScrapItemId ?? null)?.ref ?? null,
    flashScrap: forged ? (ctx.item(material?.flashScrapItemId ?? null)?.ref ?? null) : null,
    bop: draft.bop.map((b) => {
      const info = ctx.item(b.itemId);
      return { id: b.id, name: info?.ref?.name ?? "Bought-out part", rate: info?.ref ?? null, quantity: b.quantity };
    }),
    operations: draft.operations.map((op, i) => {
      const info = ctx.item(op.itemId);
      return {
        id: op.id,
        seq: (i + 1) * 10,
        name: op.name || info?.ref?.name || op.legacyName || "Operation",
        kind: op.kind,
        rate: info?.ref ?? null,
        inHouse: op.kind === "MACHINE" ? true : (info?.inHouse ?? false),
        cycleTimeMin: op.kind === "MACHINE" ? op.cycleTimeMin : null,
        setupMin: op.kind === "MACHINE" ? op.setupMin : null,
        weightBasis: op.kind === "PROCESS_KG" ? op.weightBasis : null,
      };
    }),
    rejectionPct: draft.rejectionPct,
    overheadPct: ctx.overheadPct,
    iccRatePct: ctx.iccRatePct,
    iccDays: ctx.iccDays,
    packing: ctx.item(draft.packingItemId)?.ref ?? null,
    freight: ctx.item(draft.freightItemId)?.ref ?? null,
    tooling: { mode: draft.toolingMode, cost: draft.toolingCost, amortYears: draft.toolingAmortYears },
    batchesPerYear: draft.batchesPerYear,
    marginBasis: ctx.marginBasis,
    tiers: draft.tiers.map((t) => ({ volume: t.volume, marginPct: t.marginPct, isBase: t.isBase })),
  };
}
