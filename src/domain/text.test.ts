import { describe, expect, it } from "vitest";
import { normalizeText, trigramDice } from "./text";

describe("text similarity", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeText("Rear Wheel-Spindle (LH)")).toBe("rear wheel spindle lh");
  });

  it("scores identical text as 1 and unrelated text near 0", () => {
    expect(trigramDice("Gear blank", "gear  BLANK")).toBe(1);
    expect(trigramDice("Gear blank", "Hydraulic lift arm")).toBeLessThan(0.1);
  });

  it("ranks a sibling part above a part sharing one generic word", () => {
    const spindle = trigramDice("Rear wheel spindle", "Front wheel spindle");
    const lever = trigramDice("Rear wheel spindle", "Gear shift lever");
    expect(spindle).toBeGreaterThan(0.5);
    expect(lever).toBeLessThan(0.2);
  });

  it("handles empty input", () => {
    expect(trigramDice("", "anything")).toBe(0);
  });
});
