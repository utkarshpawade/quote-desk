import { describe, expect, it } from "vitest";
import { formatQuoteNumber, formatRfqNumber, parseRfqNumber, periodKey } from "./numbering";

describe("document numbering", () => {
  it("formats RFQ numbers like the client's register", () => {
    expect(formatRfqNumber("2611", 14)).toBe("RFQ-2611-014");
    expect(formatRfqNumber("2611", 1234)).toBe("RFQ-2611-1234");
  });

  it("rejects invalid periods and sequences", () => {
    expect(() => formatRfqNumber("26-11", 1)).toThrow();
    expect(() => formatRfqNumber("2611", 0)).toThrow();
  });

  it("round-trips RFQ numbers", () => {
    expect(parseRfqNumber("RFQ-2611-019")).toEqual({ period: "2611", sequence: 19 });
    expect(parseRfqNumber("Q-2611-019")).toBeNull();
  });

  it("derives quote numbers with revision", () => {
    expect(formatQuoteNumber("RFQ-2611-023", 0)).toBe("QT-2611-023-R0");
    expect(formatQuoteNumber("RFQ-2611-023", 2)).toBe("QT-2611-023-R2");
  });

  it("builds the YYMM period key from an India calendar date", () => {
    expect(periodKey("2026-11-03")).toBe("2611");
    expect(periodKey("2027-01-01")).toBe("2701");
    expect(() => periodKey("03/11/2026")).toThrow();
  });
});
