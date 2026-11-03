import { describe, expect, it } from "vitest";
import { allowedRfqActions, quoteTransition, rfqTransition, type Action, type RfqStatus } from "./status";

const RFQ_STATUSES: RfqStatus[] = ["ESTIMATING", "IN_APPROVAL", "APPROVED", "SENT", "WON", "LOST", "REGRETTED"];

/** Every RFQ status × action; anything not listed must be refused. */
const ALLOWED: Record<string, RfqStatus> = {
  "ESTIMATING SUBMIT_FOR_APPROVAL": "IN_APPROVAL",
  "ESTIMATING APPROVE_BY_RULE": "APPROVED",
  "ESTIMATING MARK_LOST": "LOST",
  "ESTIMATING REGRET": "REGRETTED",
  "IN_APPROVAL APPROVE": "APPROVED",
  "IN_APPROVAL RETURN": "ESTIMATING",
  "IN_APPROVAL MARK_LOST": "LOST",
  "APPROVED SEND": "SENT",
  "APPROVED MARK_LOST": "LOST",
  "SENT MARK_WON": "WON",
  "SENT MARK_LOST": "LOST",
  "SENT REVISE": "ESTIMATING",
};

const ACTIONS: Action[] = [
  "SUBMIT_FOR_APPROVAL",
  "APPROVE_BY_RULE",
  "APPROVE",
  "RETURN",
  "SEND",
  "MARK_WON",
  "MARK_LOST",
  "REGRET",
  "REVISE",
];

describe("RFQ lifecycle", () => {
  for (const status of RFQ_STATUSES) {
    for (const action of ACTIONS) {
      const expected = ALLOWED[`${status} ${action}`] ?? null;
      it(`${status} + ${action} → ${expected ?? "refused"}`, () => {
        expect(rfqTransition(status, action)).toBe(expected);
      });
    }
  }

  it("closed RFQs allow nothing", () => {
    expect(allowedRfqActions("WON")).toEqual([]);
    expect(allowedRfqActions("LOST")).toEqual([]);
  });
});

describe("quote lifecycle", () => {
  it("only drafts are submitted; returns go back to draft", () => {
    expect(quoteTransition("DRAFT", "SUBMIT_FOR_APPROVAL")).toBe("IN_APPROVAL");
    expect(quoteTransition("IN_APPROVAL", "RETURN")).toBe("DRAFT");
    expect(quoteTransition("APPROVED", "SUBMIT_FOR_APPROVAL")).toBeNull();
    expect(quoteTransition("SENT", "APPROVE")).toBeNull();
  });
});
