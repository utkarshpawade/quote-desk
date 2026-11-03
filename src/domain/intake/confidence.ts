import type { IsoDate } from "../calendar";
import type { FieldType } from "./fields";
import { parseAnnualVolume, parseDate, parseWeightKg } from "./normalize";

/**
 * Deterministic confidence (DESIGN.md §5.3). The model's own confidence is never used:
 *   HIGH   — found verbatim in the source, read without interpretation, plausible, in the master
 *   MEDIUM — grounded but interpreted (unit conversion, per-month × 12, alias, ambiguous date),
 *            read from an image transcription, or by the rule-based fallback
 *   LOW    — not found in the source, implausible, unknown to the master, or in conflict
 * The reason is always given in words.
 */

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type Mode = "AI" | "RULES" | "PARSER";

/** Whitespace-, case- and digit-grouping-insensitive "does the evidence occur in the source". */
export function isGrounded(evidence: string | null | undefined, source: string): boolean {
  if (!evidence) return false;
  const norm = (s: string) =>
    s
      .replace(/^L\d{3}:\s?/gm, "")
      .toLowerCase()
      .replace(/[“”"'‘’`]/g, "")
      .replace(/(\d),(?=\d)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  const e = norm(evidence);
  return e.length > 0 && norm(source).includes(e);
}

/** Re-reads the evidence with the field's parser: the value must actually follow from it. */
export function evidenceSupports(type: FieldType, value: string, evidence: string): boolean {
  switch (type) {
    case "weightKg": {
      const p = parseWeightKg(evidence);
      return p !== null && Number(p.value) === Number(value);
    }
    case "volume": {
      const p = parseAnnualVolume(evidence);
      return p !== null && p.value === Number(value);
    }
    case "date": {
      const p = parseDate(evidence);
      return p !== null && p.value === value;
    }
    default: {
      const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      return strip(evidence).includes(strip(value)) || strip(value).includes(strip(evidence));
    }
  }
}

export interface Plausibility {
  ok: boolean;
  reason?: string;
}

/** Ranges outside which a value is almost certainly misread (A-24). */
export function checkPlausible(type: FieldType, value: string, context: { receivedDate?: IsoDate } = {}): Plausibility {
  if (type === "weightKg") {
    const n = Number(value);
    return n >= 0.01 && n <= 500 ? { ok: true } : { ok: false, reason: `${n} kg is outside 0.01–500 kg` };
  }
  if (type === "volume") {
    const n = Number(value);
    return n >= 100 && n <= 5_000_000 ? { ok: true } : { ok: false, reason: `${n.toLocaleString("en-IN")} a year is outside 100–50,00,000` };
  }
  if (type === "date" && context.receivedDate) {
    if (value < context.receivedDate) return { ok: false, reason: "due before the RFQ was received" };
    const limit = new Date(new Date(`${context.receivedDate}T00:00:00Z`).getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
    if (value > limit) return { ok: false, reason: "more than 120 days after receipt" };
  }
  return { ok: true };
}

export function rateConfidence(input: {
  mode: Mode;
  fromImage: boolean;
  grounded: boolean;
  notes: string[];
  plausible: Plausibility;
  /** null when no master applies; false when the value is unknown to it. */
  inMaster: boolean | null;
}): { confidence: Confidence; reason: string } {
  if (!input.grounded) return { confidence: "LOW", reason: "not found in the source" };
  if (!input.plausible.ok) return { confidence: "LOW", reason: input.plausible.reason ?? "implausible value" };
  if (input.inMaster === false) return { confidence: "LOW", reason: "not in the rate master" };
  const reasons = [...input.notes];
  if (input.fromImage) reasons.push("read from an image");
  if (input.mode === "RULES") reasons.push("rule-based reading");
  if (reasons.length) return { confidence: "MEDIUM", reason: reasons.join("; ") };
  return { confidence: "HIGH", reason: input.mode === "PARSER" ? "read from the cell" : "found verbatim" };
}
