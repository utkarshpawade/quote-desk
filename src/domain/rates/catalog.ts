/**
 * Rate-master conventions shared by the seed, services and UI: the commercial parameter codes and
 * the shape of each category's `attributes` JSON (validated with zod wherever it is read).
 */
import { z } from "zod";

export type RateCategory =
  | "MATERIAL"
  | "SCRAP"
  | "BOP"
  | "MACHINE"
  | "PROCESS"
  | "PACKING"
  | "FREIGHT"
  | "COMMERCIAL";

/** Commercial parameters (category COMMERCIAL). Values are versioned like any other rate. */
export const COMMERCIAL = {
  OVERHEAD_PCT: "OVERHEAD_PCT", // % of in-house conversion
  REJECTION_DEFAULT_PCT: "REJECTION_DEFAULT_PCT", // default rejection allowance %
  ICC_RATE_PCT: "ICC_RATE_PCT", // interest % p.a.
  ICC_DAYS: "ICC_DAYS", // inventory days
  MARGIN_BASE_PCT: "MARGIN_BASE_PCT", // default margin at the base (RFQ) volume
  MARGIN_BELOW_PP: "MARGIN_BELOW_PP", // + percentage points for a tier below base
  MARGIN_ABOVE_PP: "MARGIN_ABOVE_PP", // − percentage points for a tier above base (stored negative)
  MARGIN_FLOOR_PCT: "MARGIN_FLOOR_PCT", // warning below this
  APPROVAL_THRESHOLD: "APPROVAL_THRESHOLD", // ₹; above it the sales head must approve
  BATCHES_PER_YEAR: "BATCHES_PER_YEAR",
  SCALE_LOSS_DEFAULT_PCT: "SCALE_LOSS_DEFAULT_PCT", // forging scale loss default
  GST_18: "GST_18",
  GST_5: "GST_5",
} as const;
export type CommercialCode = (typeof COMMERCIAL)[keyof typeof COMMERCIAL];

/** Cost-policy parameters resolve at the basis date; approval policy resolves at submit. */
export const BASIS_DATE_PARAMS: CommercialCode[] = [
  COMMERCIAL.OVERHEAD_PCT,
  COMMERCIAL.REJECTION_DEFAULT_PCT,
  COMMERCIAL.ICC_RATE_PCT,
  COMMERCIAL.ICC_DAYS,
  COMMERCIAL.MARGIN_BASE_PCT,
  COMMERCIAL.MARGIN_BELOW_PP,
  COMMERCIAL.MARGIN_ABOVE_PP,
  COMMERCIAL.BATCHES_PER_YEAR,
  COMMERCIAL.SCALE_LOSS_DEFAULT_PCT,
];
export const SUBMIT_DATE_PARAMS: CommercialCode[] = [
  COMMERCIAL.APPROVAL_THRESHOLD,
  COMMERCIAL.MARGIN_FLOOR_PCT,
  COMMERCIAL.GST_18,
  COMMERCIAL.GST_5,
];

export const MaterialAttributes = z.object({
  grade: z.string(), // canonical grade, e.g. "EN8"
  family: z.enum(["MEDIUM_CARBON", "ALLOY", "CASE_HARDENING", "MICROALLOY", "FREE_CUTTING"]),
  form: z.literal("BAR").default("BAR"),
  /** Other ways customers write the grade: "EN-8", "080M40", "C40". Compared normalized. */
  aliases: z.array(z.string()).default([]),
  turningsScrapCode: z.string(),
  flashScrapCode: z.string(),
});
export type MaterialAttributes = z.infer<typeof MaterialAttributes>;

export const ScrapAttributes = z.object({ kind: z.enum(["TURNINGS", "FLASH"]) });

export const MachineAttributes = z.object({
  machineType: z.string(),
  /** Legacy names used in the old Excel register, e.g. "Ace LT-20", "VMC-2". */
  aliases: z.array(z.string()).default([]),
});

export const ProcessAttributes = z.object({
  /** In-house processes attract overhead; job work (outside) does not. */
  inHouse: z.boolean(),
  aliases: z.array(z.string()).default([]),
  /** PER_KG processes: which weight the rate applies to by default. */
  defaultWeightBasis: z.enum(["GROSS", "FORGED", "NET"]).optional(),
  /** Keywords in drawing notes that call for this process ("INDUCTION HARDEN"). */
  drawingKeywords: z.array(z.string()).default([]),
});
export type ProcessAttributes = z.infer<typeof ProcessAttributes>;

export const FreightAttributes = z.object({ zone: z.string() });

/** Normalizes a grade or alias for comparison: "EN-8" / "en 8" / "En8" → "EN8". */
export function normalizeGrade(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
