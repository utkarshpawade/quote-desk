/**
 * The customer-facing quote, as data. Built from a frozen snapshot (or, for drafts, from the live
 * costing) by the quote service, and rendered twice from this one shape: as the PDF
 * (src/server/pdf) and as the HTML document on the quote page (src/components/quote-document).
 * Every string is display-ready except money/volume fields, which stay raw decimal strings and
 * integers so each renderer formats them the same way (src/lib/format).
 */
import type { LineKey, ToolingMode } from "./costing/types";

export type QuoteDocumentStatus = "DRAFT" | "IN_APPROVAL" | "APPROVED" | "SENT" | "SUPERSEDED";

export interface QuoteDocumentTier {
  volume: number;
  isBase: boolean;
  unitPrice: string; // ₹ ex-GST, 2 dp
  gstAmount: string; // ₹ per piece
  priceInclGst: string;
  annualValue: string; // ex-GST
}

export interface QuoteDocumentBreakupRow {
  key: LineKey;
  label: string;
  /** One value per tier (2 dp strings); negative values carry a leading "-". */
  values: string[];
  emphasis?: "subtotal" | "total";
}

export interface QuoteDocumentPart {
  lineNo: number;
  partNo: string;
  description: string;
  drawing: string | null; // "DRV-GB-2207 rev C"
  material: string; // "20MnCr5 bar"
  hsnCode: string | null;
  gstPct: string; // "18"
  weights: { grossKg: string; forgedKg: string | null; netKg: string };
  tiers: QuoteDocumentTier[];
  breakup: QuoteDocumentBreakupRow[];
  tooling: { mode: ToolingMode; cost: string; amortYears: number | null; note: string | null };
  /** RM settlement basis printed for price-variation clauses. */
  rmBasis: string; // "EN8 bar ₹72.50/kg w.e.f. 01 Oct 2026 · turnings ₹26.00/kg"
}

export interface QuoteDocument {
  status: QuoteDocumentStatus;
  /** "DRAFT" for anything not yet approved; null once approved or sent. */
  watermark: string | null;
  company: {
    name: string;
    addressLines: string[];
    gstin: string;
    email: string;
    phone: string;
  };
  quote: {
    number: string; // QT-2611-014-R0
    revision: number;
    date: string; // display date, "03 Nov 2026"
    validUntil: string;
    basisDate: string; // display date
    /** First 8 hex characters of the snapshot hash; null for drafts. */
    shortHash: string | null;
    engineVersion: string;
  };
  customer: {
    name: string;
    addressLines: string[];
    contactName: string | null;
    contactEmail: string | null;
    customerRef: string | null; // the customer's RFQ number
  };
  rfq: { number: string; subject: string; receivedDate: string };
  parts: QuoteDocumentPart[];
  /** One-time tooling charged separately, summed across parts (₹). */
  separateToolingTotal: string;
  terms: string[];
  /** Every rate version the quote used (the traceability annex). */
  rateBasis: Array<{
    code: string;
    name: string;
    value: string;
    unit: string; // "₹/kg", "₹/h", "%", "days"
    effectiveFrom: string; // display date
  }>;
  signatures: {
    preparedBy: string;
    approvedBy: string | null;
    approvedOn: string | null;
    approvalNote: string | null; // "Approved by rule: ₹18,40,000.00 ≤ ₹25,00,000.00"
  };
}
