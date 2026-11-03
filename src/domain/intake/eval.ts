import type { IsoDate } from "../calendar";
import { normalizeGrade } from "../rates/catalog";
import { normalizeText } from "../text";
import type { Confidence, Mode } from "./confidence";
import { numberLines, unwrapForwarded } from "./email";
import { mergeCandidates, partNoKey, UNMATCHED, type Candidate, type Proposal } from "./merge";
import type { MaterialOption } from "./normalize";
import { toCandidate, type RawValue, type SourceInfo } from "./read";
import { readByRules } from "./rules";

/**
 * Scoring for the intake eval (npm run eval:intake). What matters is not only how often a value
 * is right, but what happens when it is wrong: a wrong value shown as Low, as a conflict or not
 * filled in at all costs the estimator a look; a wrong value filled in at Medium or High is the
 * one that can reach a quote.
 */

export interface ExpectedPart {
  partNo?: string | null;
  description?: string | null;
  material?: string | null;
  annualVolume?: number | null;
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
}

export interface EvalCase {
  id: string;
  title: string;
  text: string;
  expected: { customerRef?: string | null; dueDate?: string | null; parts: ExpectedPart[] };
}

/**
 * correct — the right value is filled in · flagged — wrong or unsure, but shown as Low, a conflict
 * or left for the estimator · silent — a wrong value filled in at Medium/High · missed — nothing
 * read · held — correctly left empty · invented — a value the email does not give, filled in.
 */
export type Outcome = "correct" | "flagged" | "silent" | "missed" | "held" | "invented";

export interface FieldResult {
  caseId: string;
  part: number | null;
  field: string;
  expected: string | number | null;
  proposed: string | null;
  confidence: Confidence | null;
  outcome: Outcome;
}

const RFQ_FIELDS = ["customerRef", "dueDate"] as const;
const PART_FIELDS = ["partNo", "description", "material", "annualVolume", "grossWeightKg", "netWeightKg"] as const;

function same(field: string, expected: string | number, value: string): boolean {
  if (typeof expected === "number") return Math.abs(Number(value) - expected) < 1e-6;
  // An unknown grade is kept as written ("SCM440 (JIS)"); the grade itself must be there.
  if (field === "material") return normalizeGrade(value).startsWith(normalizeGrade(expected));
  return normalizeText(value) === normalizeText(expected);
}

function judge(field: string, expected: string | number | null, proposals: Proposal[]): Omit<FieldResult, "caseId" | "part" | "field" | "expected"> {
  const filled = proposals.filter((p) => p.proposedValue !== null);
  const confident = filled.find((p) => p.confidence !== "LOW");
  if (expected === null) {
    return confident
      ? { outcome: "invented", proposed: confident.proposedValue, confidence: confident.confidence }
      : { outcome: "held", proposed: null, confidence: null };
  }
  const right = filled.find((p) => same(field, expected, p.proposedValue!));
  if (right) return { outcome: "correct", proposed: right.proposedValue, confidence: right.confidence };
  if (proposals.length === 0) return { outcome: "missed", proposed: null, confidence: null };
  if (confident) return { outcome: "silent", proposed: confident.proposedValue, confidence: confident.confidence };
  const shown = proposals[0]!;
  return { outcome: "flagged", proposed: shown.proposedValue ?? shown.candidates[0]?.value ?? null, confidence: shown.confidence };
}

export function scoreCase(c: EvalCase, proposals: Proposal[]): FieldResult[] {
  const results: FieldResult[] = [];
  for (const field of RFQ_FIELDS) {
    if (!(field in c.expected)) continue;
    const expected = c.expected[field] ?? null;
    results.push({ caseId: c.id, part: null, field, expected, ...judge(field, expected, proposals.filter((p) => p.partKey === "" && p.fieldKey === field)) });
  }
  const single = c.expected.parts.length === 1;
  c.expected.parts.forEach((part, index) => {
    const key = part.partNo ? partNoKey(part.partNo) : null;
    for (const field of PART_FIELDS) {
      if (!(field in part)) continue;
      const expected = part[field] ?? null;
      const forField = proposals.filter((p) => p.fieldKey === field && p.partKey !== "");
      // With one part every reading belongs to it; with several, only those placed on it count,
      // and readings left unmatched can at best be flagged.
      const placed = single ? forField : forField.filter((p) => p.partKey === key);
      let verdict = judge(field, expected, placed);
      if (!single && verdict.outcome === "missed" && forField.some((p) => p.partKey === UNMATCHED)) {
        verdict = { outcome: "flagged", proposed: forField.find((p) => p.partKey === UNMATCHED)!.proposedValue, confidence: "LOW" };
      }
      results.push({ caseId: c.id, part: index, field, expected, ...verdict });
    }
  });
  return results;
}

export interface EvalSummary {
  /** Fields the email gives. */
  fields: number;
  correct: number;
  flagged: number;
  silent: number;
  missed: number;
  /** Fields the email does not give. */
  absent: number;
  held: number;
  invented: number;
}

export function summarize(results: FieldResult[]): EvalSummary {
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  return {
    fields: results.filter((r) => r.expected !== null).length,
    correct: count("correct"),
    flagged: count("flagged"),
    silent: count("silent"),
    missed: count("missed"),
    absent: results.filter((r) => r.expected === null).length,
    held: count("held"),
    invented: count("invented"),
  };
}

/** The email as intake stores it: forwarded mail unwrapped, lines numbered. */
export function emailText(c: EvalCase): string {
  const forwarded = unwrapForwarded(c.text);
  return numberLines(forwarded ? forwarded.body : c.text);
}

/** Readings → scored candidates → proposals, exactly as the intake service does. */
export function proposalsFor(c: EvalCase, raw: RawValue[], mode: Mode, ctx: { materials: MaterialOption[]; receivedDate: IsoDate }): Proposal[] {
  const source: SourceInfo = { id: c.id, kind: "EMAIL", label: c.title, text: emailText(c), mode };
  return mergeCandidates(raw.map((v) => toCandidate(v, source, ctx)).filter((x): x is Candidate => x !== null));
}

export function readCaseByRules(c: EvalCase, ctx: { materials: MaterialOption[]; receivedDate: IsoDate }): Proposal[] {
  return proposalsFor(c, readByRules(emailText(c), "EMAIL"), "RULES", ctx);
}
