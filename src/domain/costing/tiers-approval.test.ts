import { describe, expect, it } from "vitest";
import { evaluateApproval, type ApprovalPart } from "./approval";
import { defaultTiers, roundVolume } from "./tiers";

const ladder = { basePct: "12", belowPp: "2", abovePp: "-1.5" };
const volumes = (base: number) => defaultTiers(base, ladder).map((t) => t.volume);

describe("default volume tiers", () => {
  it.each([
    [180_000, [120_000, 180_000, 240_000]],
    [60_000, [40_000, 60_000, 80_000]],
    [24_000, [16_000, 24_000, 32_000]],
    [37_000, [25_000, 37_000, 49_000]],
    [1_500, [1_000, 1_500, 2_000]],
    [1_200, [800, 1_200, 1_600]],
    [1_000, [700, 1_000, 1_300]],
    [600, [400, 600, 800]],
    [250, [200, 250, 300]],
    [100, [100]], // both extras round onto the base volume and are dropped
  ])("base %i → %j", (base, expected) => {
    expect(volumes(base)).toEqual(expected);
  });

  it("keeps the RFQ volume exact and marks it as base", () => {
    const tiers = defaultTiers(18_350, ladder);
    expect(tiers.find((t) => t.isBase)?.volume).toBe(18_350);
  });

  it("applies the margin ladder", () => {
    expect(defaultTiers(180_000, ladder).map((t) => t.marginPct)).toEqual(["14.000", "12.000", "10.500"]);
  });

  it("rounds to two significant figures from 10,000 up", () => {
    expect(roundVolume(49_333)).toBe(49_000);
    expect(roundVolume(9_949)).toBe(9_900);
  });
});

describe("approval rule (₹25 lakh, strictly greater)", () => {
  const part = (baseUnitPrice: string, baseVolume: number, extra: Partial<ApprovalPart> = {}): ApprovalPart => ({
    baseUnitPrice,
    baseVolume,
    separateTooling: "0",
    tierAnnualValues: [],
    ...extra,
  });

  it("approves exactly ₹25,00,000.00 by rule", () => {
    const r = evaluateApproval([part("250.00", 10_000)], "2500000");
    expect(r).toMatchObject({ approvalValue: "2500000.00", requiresApproval: false, complete: true });
  });

  it("sends ₹25,00,000.01 to the sales head", () => {
    // 2,500,000.01 = 0.01 × 1 + 250.00 × 10,000 across two parts
    const r = evaluateApproval([part("250.00", 10_000), part("0.01", 1)], "2500000");
    expect(r).toMatchObject({ approvalValue: "2500000.01", requiresApproval: true });
  });

  it("uses the base (RFQ) volume, so extra tiers below it cannot dodge approval", () => {
    // Spindle: ₹120.46 × 1,80,000 even if the other tiers were tiny.
    const r = evaluateApproval(
      [part("120.46", 180_000, { tierAnnualValues: ["24660.00", "21682800.00", "25000.00"] })],
      "2500000",
    );
    expect(r).toMatchObject({ approvalValue: "21682800.00", requiresApproval: true, maxExposure: "21682800.00" });
  });

  it("counts one-time tooling charged separately", () => {
    const r = evaluateApproval([part("100.00", 10_000, { separateTooling: "1600000" })], "2500000");
    expect(r).toMatchObject({ partsValue: "1000000.00", toolingValue: "1600000.00", requiresApproval: true });
  });

  it("cannot approve by rule while a part's price is withheld", () => {
    const r = evaluateApproval([part("10.00", 100), { ...part("0", 100), baseUnitPrice: null }], "2500000");
    expect(r).toMatchObject({ complete: false, requiresApproval: true });
  });
});
