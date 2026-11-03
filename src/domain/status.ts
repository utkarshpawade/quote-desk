/**
 * RFQ and quote lifecycles (DESIGN.md §7) as transition tables. Services apply a transition with
 * a compare-and-set update, so two people acting at once can never both succeed.
 */

export type RfqStatus = "ESTIMATING" | "IN_APPROVAL" | "APPROVED" | "SENT" | "WON" | "LOST" | "REGRETTED";
export type QuoteStatus = "DRAFT" | "IN_APPROVAL" | "APPROVED" | "SENT" | "SUPERSEDED";
export type CloseReason =
  | "PRICE"
  | "LEAD_TIME"
  | "TECHNICAL"
  | "LATE_REPLY"
  | "CUSTOMER_CANCELLED"
  | "INCUMBENT_RETAINED"
  | "CAPACITY"
  | "OTHER";

export type Action =
  | "SUBMIT_FOR_APPROVAL"
  | "APPROVE_BY_RULE"
  | "APPROVE"
  | "RETURN"
  | "SEND"
  | "MARK_WON"
  | "MARK_LOST"
  | "REGRET"
  | "REVISE";

const RFQ: Partial<Record<Action, Partial<Record<RfqStatus, RfqStatus>>>> = {
  SUBMIT_FOR_APPROVAL: { ESTIMATING: "IN_APPROVAL" },
  APPROVE_BY_RULE: { ESTIMATING: "APPROVED" },
  APPROVE: { IN_APPROVAL: "APPROVED" },
  RETURN: { IN_APPROVAL: "ESTIMATING" },
  SEND: { APPROVED: "SENT" },
  MARK_WON: { SENT: "WON" },
  MARK_LOST: { ESTIMATING: "LOST", IN_APPROVAL: "LOST", APPROVED: "LOST", SENT: "LOST" },
  REGRET: { ESTIMATING: "REGRETTED" },
  REVISE: { SENT: "ESTIMATING" },
};

const QUOTE: Partial<Record<Action, Partial<Record<QuoteStatus, QuoteStatus>>>> = {
  SUBMIT_FOR_APPROVAL: { DRAFT: "IN_APPROVAL" },
  APPROVE_BY_RULE: { DRAFT: "APPROVED" },
  APPROVE: { IN_APPROVAL: "APPROVED" },
  RETURN: { IN_APPROVAL: "DRAFT" },
  SEND: { APPROVED: "SENT" },
};

export function rfqTransition(status: RfqStatus, action: Action): RfqStatus | null {
  return RFQ[action]?.[status] ?? null;
}

export function quoteTransition(status: QuoteStatus, action: Action): QuoteStatus | null {
  return QUOTE[action]?.[status] ?? null;
}

export function allowedRfqActions(status: RfqStatus): Action[] {
  return (Object.keys(RFQ) as Action[]).filter((a) => rfqTransition(status, a) !== null);
}

export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === "DRAFT";
}

export function isRfqOpen(status: RfqStatus): boolean {
  return status === "ESTIMATING" || status === "IN_APPROVAL" || status === "APPROVED" || status === "SENT";
}

export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = {
  ESTIMATING: "Estimating",
  IN_APPROVAL: "Awaiting approval",
  APPROVED: "Ready to send",
  SENT: "Sent",
  WON: "Won",
  LOST: "Lost",
  REGRETTED: "Regretted",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Draft",
  IN_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  SENT: "Sent",
  SUPERSEDED: "Superseded",
};

/** CSS colour token per status (always shown next to the word, never alone). */
export const RFQ_STATUS_COLOR: Record<RfqStatus, string> = {
  ESTIMATING: "var(--color-st-estimating)",
  IN_APPROVAL: "var(--color-st-approval)",
  APPROVED: "var(--color-st-approved)",
  SENT: "var(--color-st-sent)",
  WON: "var(--color-st-won)",
  LOST: "var(--color-st-lost)",
  REGRETTED: "var(--color-st-muted)",
};

export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  PRICE: "Price",
  LEAD_TIME: "Lead time",
  TECHNICAL: "Technical",
  LATE_REPLY: "Late reply (missed due date)",
  CUSTOMER_CANCELLED: "Customer cancelled",
  INCUMBENT_RETAINED: "Incumbent retained",
  CAPACITY: "Capacity",
  OTHER: "Other",
};
