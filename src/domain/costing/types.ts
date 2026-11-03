/**
 * Contract of the costing engine (DESIGN.md §3). Everything here is plain data so a costing can be
 * computed in the browser, on the server, and re-computed from a frozen snapshot.
 *
 * Decimal values are strings ("72.5000", "0.610"); volumes, batch sizes and years are integers.
 * Dates are India calendar dates "YYYY-MM-DD".
 */
import type { DecimalString } from "../money";

/** Bumped whenever a formula or rounding rule changes; stored in every snapshot. */
export const ENGINE_VERSION = "1.0.0";

export type RateUnit = "PER_KG" | "PER_HOUR" | "PER_PIECE" | "PERCENT" | "RUPEES" | "COUNT" | "DAYS";

/** A rate version as resolved at the quote's basis date. */
export interface RateRef {
  versionId: string;
  itemId: string;
  code: string;
  name: string;
  unit: RateUnit;
  value: DecimalString;
  effectiveFrom: string;
}

export type OperationKind = "MACHINE" | "PROCESS_KG" | "PROCESS_PC";
export type WeightBasis = "GROSS" | "FORGED" | "NET";
export type MarginBasis = "MFG_COST" | "CONVERSION";
export type ToolingMode = "NONE" | "SEPARATE" | "AMORTIZED";

export interface OperationInput {
  id: string;
  seq: number;
  name: string;
  kind: OperationKind;
  /** Null while an operation copied from a past part is not bound to a current work centre. */
  rate: RateRef | null;
  /** Machine operations are always in-house; processes carry the rate item's flag. */
  inHouse: boolean;
  /** MACHINE: minutes per piece. */
  cycleTimeMin: DecimalString | null;
  /** MACHINE: minutes per batch. */
  setupMin: DecimalString | null;
  /** PROCESS_KG: which weight the ₹/kg applies to. */
  weightBasis: WeightBasis | null;
}

export interface BopInput {
  id: string;
  name: string;
  rate: RateRef | null;
  quantity: DecimalString;
}

export interface TierInput {
  volume: number;
  marginPct: DecimalString;
  /** The tier at the RFQ annual volume (exactly one per costing once it has tiers). */
  isBase: boolean;
}

export interface CostingInput {
  grossWeightKg: DecimalString | null;
  /** Optional: forged weight after trimming (forged parts only). */
  forgedWeightKg: DecimalString | null;
  netWeightKg: DecimalString | null;
  /** Optional: % of gross lost as scale in forging (no resale value). Null → 0. */
  scaleLossPct: DecimalString | null;
  material: RateRef | null;
  /** Machining turnings (₹/kg). */
  turningsScrap: RateRef | null;
  /** Forging flash and end-bits (₹/kg); required when a forged weight is given. */
  flashScrap: RateRef | null;
  bop: BopInput[];
  operations: OperationInput[];
  rejectionPct: DecimalString;
  overheadPct: RateRef | null;
  /** ICC = interest % p.a. × days / 365 on material + BOP. */
  iccRatePct: RateRef | null;
  iccDays: RateRef | null;
  /** ₹/pc; null when not chosen yet (warning, treated as 0). */
  packing: RateRef | null;
  /** ₹/kg of net weight; null when not chosen yet (warning, treated as 0). */
  freight: RateRef | null;
  tooling: { mode: ToolingMode; cost: DecimalString; amortYears: number | null };
  batchesPerYear: number;
  marginBasis: MarginBasis;
  tiers: TierInput[];
}

/** Optional context that only produces warnings. */
export interface CostingContext {
  marginFloorPct?: DecimalString | null;
  /** Median conversion ₹/kg of the most similar past quotes (RM-adjusted), if known. */
  similarMedianConversionPerKg?: DecimalString | null;
}

export type LineKey =
  | "rawMaterial"
  | "scrapCredit"
  | "netMaterial"
  | "bop"
  | "inHouseProcess"
  | "setup"
  | "outsideProcess"
  | "conversion"
  | "rejection"
  | "overhead"
  | "icc"
  | "mfgCost"
  | "profit"
  | "packing"
  | "freight"
  | "tooling"
  | "unitPrice"
  | "annualValue"
  | "pricePerKg"
  | "conversionPerKg";

export type IssueSeverity = "error" | "warning";

/**
 * - part: blocks every tier's price
 * - tier: blocks one tier's price (tierIndex set)
 * - submit: allowed while editing, blocks submit
 * - warning severity never blocks anything
 */
export type IssueScope = "part" | "tier" | "submit";

export interface CostingIssue {
  code: string;
  severity: IssueSeverity;
  scope: IssueScope;
  /** Input path the issue belongs to, e.g. "netWeightKg", "operations.<id>.cycleTimeMin", "tiers.1.volume". */
  field?: string;
  tierIndex?: number;
  message: string;
}

export interface TierResult {
  volume: number;
  isBase: boolean;
  marginPct: DecimalString;
  /** ceil(volume / batchesPerYear) */
  batchQty: number;
  /** Null when this tier's price is withheld by a part- or tier-level error. Money lines 2 dp. */
  lines: Record<LineKey, DecimalString> | null;
}

export interface OperationResult {
  id: string;
  /** ₹/pc rounded to the paisa (run cost, per-kg or per-piece); null if it cannot be computed. */
  costPerPiece: DecimalString | null;
  /** MACHINE only: ₹ per batch (2 dp), before amortization. */
  setupPerBatch: DecimalString | null;
}

export interface BopResult {
  id: string;
  costPerPiece: DecimalString | null;
}

export interface CostingResult {
  engineVersion: string;
  /** False when any part-level error exists (every tier withheld). */
  priceable: boolean;
  /** All issues: part, tier (with tierIndex), submit, and warnings. */
  issues: CostingIssue[];
  weights: {
    flashKg: DecimalString | null;
    turningsKg: DecimalString | null;
    scaleKg: DecimalString | null;
    /** net / gross × 100, 1 dp */
    yieldPct: DecimalString | null;
  };
  operations: OperationResult[];
  bop: BopResult[];
  /** Σ machine setup per batch, 2 dp. */
  setupPerBatch: DecimalString | null;
  tiers: TierResult[];
  baseTierIndex: number | null;
}
