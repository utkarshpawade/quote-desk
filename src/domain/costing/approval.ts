import { dec, money, sum, type DecimalString } from "../money";

/**
 * The approval rule (DESIGN.md §3.4, A-1): a quote needs the sales head when
 *   Σ parts (base-tier unit price × RFQ annual volume) + Σ one-time tooling > threshold.
 * The base tier is pinned to the customer's stated volume, so choosing different extra tiers
 * cannot move a quote under the threshold.
 */

export interface ApprovalPart {
  /** Unit price at the base (RFQ) volume; null while that price is withheld. */
  baseUnitPrice: DecimalString | null;
  baseVolume: number;
  /** One-time tooling charged separately (SEPARATE mode), else "0". */
  separateTooling: DecimalString;
  /** Annual value of every quoted tier (for the information-only exposure figure). */
  tierAnnualValues: Array<DecimalString | null>;
}

export interface ApprovalResult {
  partsValue: DecimalString;
  toolingValue: DecimalString;
  approvalValue: DecimalString;
  /** Σ parts of the largest tier annual value — what the customer could place at most. */
  maxExposure: DecimalString;
  threshold: DecimalString;
  /** False when a part's base price is withheld; the quote then cannot be evaluated or submitted. */
  complete: boolean;
  requiresApproval: boolean;
}

export function evaluateApproval(parts: ApprovalPart[], threshold: DecimalString): ApprovalResult {
  const complete = parts.length > 0 && parts.every((p) => p.baseUnitPrice !== null);
  const partsValue = sum(parts.map((p) => (p.baseUnitPrice === null ? 0 : dec(p.baseUnitPrice).times(p.baseVolume))));
  const toolingValue = sum(parts.map((p) => p.separateTooling));
  const approvalValue = partsValue.plus(toolingValue);
  const maxExposure = sum(
    parts.map((p) => {
      const values = p.tierAnnualValues.filter((v): v is DecimalString => v !== null).map((v) => dec(v));
      return values.length ? values.reduce((a, b) => (b.gt(a) ? b : a)) : 0;
    }),
  );
  return {
    partsValue: money(partsValue),
    toolingValue: money(toolingValue),
    approvalValue: money(approvalValue),
    maxExposure: money(maxExposure),
    threshold: money(threshold),
    complete,
    // Strictly greater: a quote of exactly ₹25,00,000.00 is approved by rule.
    requiresApproval: !complete || approvalValue.gt(threshold),
  };
}
