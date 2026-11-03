import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatINR,
  formatINRCompact,
  formatInteger,
  formatNumber,
  formatPercent,
} from "./format";

describe("Indian number formatting", () => {
  it("groups rupees in lakh/crore style with paise", () => {
    expect(formatINR("12345678.9")).toBe("₹1,23,45,678.90");
    expect(formatINR(122.61)).toBe("₹122.61");
  });

  it("formats decimal strings exactly (no float drift)", () => {
    expect(formatNumber("0.105", 2)).toBe("0.11");
    expect(formatNumber("1.005", 2)).toBe("1.01");
  });

  it("formats volumes as whole numbers", () => {
    expect(formatInteger(180000)).toBe("1,80,000");
  });

  it("compacts annual values into lakh and crore", () => {
    expect(formatINRCompact("22069800")).toBe("₹2.21 Cr");
    expect(formatINRCompact("2500000")).toBe("₹25.00 L");
    expect(formatINRCompact("2500100")).toBe("₹25.00 L");
    expect(formatINRCompact("84500")).toBe("₹84,500");
  });

  it("trims trailing zeros in percentages", () => {
    expect(formatPercent("12.000")).toBe("12%");
    expect(formatPercent("1.500")).toBe("1.5%");
  });

  it("formats dates day-month-year in India time", () => {
    // 20:00 UTC on 2 Nov is 01:30 on 3 Nov in Kolkata.
    expect(formatDate("2026-11-02T20:00:00Z")).toBe("03 Nov 2026");
  });
});
