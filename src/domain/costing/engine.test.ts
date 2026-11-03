import { describe, expect, it } from "vitest";
import { evaluateApproval } from "./approval";
import { computeCosting } from "./engine";
import { gearBlankFixture, liftArmFixture, spindleFixture } from "./fixtures";
import { breakupRows } from "./labels";
import type { CostingInput, CostingResult, LineKey } from "./types";

type Table = Partial<Record<LineKey, [string, string, string]>>;

/** Asserts every listed line, for every tier, to the paisa. */
function expectTable(result: CostingResult, table: Table) {
  expect(result.priceable).toBe(true);
  for (const [key, values] of Object.entries(table) as Array<[LineKey, [string, string, string]]>) {
    const actual = result.tiers.map((t) => t.lines?.[key]);
    expect(actual, key).toEqual(values);
  }
}

const same = (v: string): [string, string, string] => [v, v, v];

describe("golden fixtures (DESIGN.md §3.5–3.7)", () => {
  it("A — rear wheel spindle, EN8 bar-turned, 1,80,000/yr", () => {
    const result = computeCosting(spindleFixture());
    expectTable(result, {
      rawMaterial: same("44.23"), // 0.61 × 72.50 = 44.225 → half-up, not banker's
      scrapCredit: same("-3.64"),
      netMaterial: same("40.59"),
      bop: same("0.00"),
      inHouseProcess: same("51.37"),
      setup: ["0.10", "0.07", "0.05"],
      outsideProcess: same("3.20"),
      conversion: ["54.67", "54.64", "54.62"],
      rejection: ["1.91", "1.90", "1.90"],
      overhead: ["7.72", "7.72", "7.71"],
      icc: same("0.60"),
      mfgCost: ["105.49", "105.45", "105.42"],
      profit: ["14.77", "12.65", "11.07"],
      packing: same("1.80"),
      freight: same("0.56"),
      tooling: same("0.00"),
      unitPrice: ["122.62", "120.46", "118.85"],
      annualValue: ["14714400.00", "21682800.00", "28524000.00"],
      pricePerKg: ["260.89", "256.30", "252.87"],
      conversionPerKg: ["174.53", "169.94", "166.51"],
    });
    expect(result.operations.map((o) => o.costPerPiece)).toEqual(["2.04", "45.33", "4.00", "3.20"]);
    expect(result.operations.map((o) => o.setupPerBatch)).toEqual(["87.50", "637.50", "300.00", null]);
    expect(result.setupPerBatch).toBe("1025.00");
    expect(result.tiers.map((t) => t.batchQty)).toEqual([10_000, 15_000, 20_000]);
    expect(result.weights).toMatchObject({ turningsKg: "0.140", flashKg: null, yieldPct: "77.0" });
  });

  it("B — hydraulic lift arm, 40Cr4 forged in-house, amortized dies", () => {
    const result = computeCosting(liftArmFixture());
    expectTable(result, {
      rawMaterial: same("386.40"),
      scrapCredit: same("-33.27"), // 0.558 × 34 + 0.55 × 26 = 33.272
      netMaterial: same("353.13"),
      inHouseProcess: same("423.62"),
      setup: ["2.24", "1.49", "1.12"],
      outsideProcess: same("95.35"),
      conversion: ["521.21", "520.46", "520.09"],
      rejection: ["17.49", "17.47", "17.46"],
      overhead: ["63.88", "63.77", "63.71"],
      icc: same("5.22"),
      mfgCost: ["960.93", "960.05", "959.61"],
      profit: ["134.53", "115.21", "100.76"],
      packing: same("9.50"),
      freight: same("8.16"),
      tooling: ["25.00", "16.67", "12.50"],
      unitPrice: ["1138.12", "1109.59", "1090.53"],
      annualValue: ["18209920.00", "26630160.00", "34896960.00"],
    });
    expect(result.weights).toMatchObject({ flashKg: "0.558", turningsKg: "0.550", scaleKg: "0.092" });
    expect(result.tiers.map((t) => t.batchQty)).toEqual([1_334, 2_000, 2_667]);
  });

  it("C — gear blank, 20MnCr5 forged, profit on conversion, separate dies", () => {
    const result = computeCosting(gearBlankFixture());
    expectTable(result, {
      rawMaterial: same("133.20"),
      scrapCredit: same("-9.79"),
      netMaterial: same("123.41"),
      inHouseProcess: same("125.13"),
      setup: ["0.31", "0.21", "0.16"],
      outsideProcess: same("32.72"), // phosphating is charged on NET weight
      conversion: ["158.16", "158.06", "158.01"],
      rejection: same("5.63"),
      overhead: ["18.82", "18.80", "18.79"],
      icc: same("1.83"),
      mfgCost: ["307.85", "307.73", "307.67"],
      profit: ["25.09", "22.56", "20.67"], // on in-house conversion only
      packing: same("0.90"),
      freight: same("2.69"),
      tooling: same("0.00"), // separate one-time charge, not in the piece price
      unitPrice: ["336.53", "333.88", "331.93"],
      annualValue: ["13461200.00", "20032800.00", "26554400.00"],
    });
  });

  it("routes all three samples to the sales head", () => {
    const approval = (input: CostingInput, separateTooling = "0") => {
      const r = computeCosting(input);
      const base = r.tiers[r.baseTierIndex!]!;
      return evaluateApproval(
        [{ baseUnitPrice: base.lines!.unitPrice, baseVolume: base.volume, separateTooling, tierAnnualValues: r.tiers.map((t) => t.lines?.annualValue ?? null) }],
        "2500000",
      );
    };
    expect(approval(spindleFixture())).toMatchObject({ approvalValue: "21682800.00", requiresApproval: true });
    expect(approval(liftArmFixture())).toMatchObject({ approvalValue: "26630160.00", requiresApproval: true });
    expect(approval(gearBlankFixture(), "240000")).toMatchObject({ approvalValue: "20272800.00", requiresApproval: true });
  });
});

describe("volume effects", () => {
  it("amortized tooling and setup per piece fall as volume rises", () => {
    const result = computeCosting(liftArmFixture());
    const tooling = result.tiers.map((t) => Number(t.lines!.tooling));
    const setup = result.tiers.map((t) => Number(t.lines!.setup));
    expect(tooling[0]).toBeGreaterThan(tooling[1]!);
    expect(tooling[1]).toBeGreaterThan(tooling[2]!);
    expect(setup[0]).toBeGreaterThan(setup[2]!);
  });

  it("profit on manufacturing cost vs on conversion", () => {
    const mfg = computeCosting(spindleFixture());
    const conv = computeCosting({ ...spindleFixture(), marginBasis: "CONVERSION" });
    // 12 % of in-house conversion (51.37 + 0.07) instead of 12 % of 105.45
    expect(conv.tiers[1]!.lines!.profit).toBe("6.17");
    expect(Number(conv.tiers[1]!.lines!.unitPrice)).toBeLessThan(Number(mfg.tiers[1]!.lines!.unitPrice));
  });
});

describe("validation", () => {
  const codes = (r: CostingResult) => r.issues.map((i) => i.code);

  it("withholds every price when net is more than gross", () => {
    const r = computeCosting({ ...spindleFixture(), netWeightKg: "0.70" });
    expect(r.priceable).toBe(false);
    expect(r.tiers.every((t) => t.lines === null)).toBe(true);
    const issue = r.issues.find((i) => i.code === "NET_GT_GROSS")!;
    expect(issue).toMatchObject({ scope: "part", field: "netWeightKg" });
    expect(issue.message).toBe("Net weight 0.7 kg is more than gross weight 0.61 kg.");
  });

  it("withholds only the tier with a bad margin or duplicate volume", () => {
    const input = spindleFixture();
    input.tiers[0]!.marginPct = "75";
    input.tiers[2]!.volume = 180_000;
    const r = computeCosting(input);
    expect(r.priceable).toBe(true);
    expect(r.tiers.map((t) => t.lines === null)).toEqual([true, false, true]);
    expect(codes(r)).toEqual(expect.arrayContaining(["MARGIN_OUT_OF_RANGE", "VOLUME_DUPLICATE"]));
  });

  it("withholds the price until there is a routing", () => {
    const r = computeCosting({ ...spindleFixture(), operations: [] });
    expect(r.priceable).toBe(false);
    expect(codes(r)).toContain("ROUTING_EMPTY");
  });

  it("blocks an unbound operation and a machine operation without a cycle time", () => {
    const input = spindleFixture();
    input.operations[0] = { ...input.operations[0]!, rate: null };
    input.operations[1] = { ...input.operations[1]!, cycleTimeMin: null };
    const r = computeCosting(input);
    expect(r.priceable).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(["OPERATION_UNBOUND", "CYCLE_TIME_MISSING"]));
    expect(r.issues.find((i) => i.code === "CYCLE_TIME_MISSING")!.field).toBe("operations.op20.cycleTimeMin");
  });

  it("requires a flash scrap rate and a valid forged weight for forged parts", () => {
    expect(codes(computeCosting({ ...liftArmFixture(), flashScrap: null }))).toContain("FLASH_RATE_MISSING");
    expect(codes(computeCosting({ ...liftArmFixture(), forgedWeightKg: "3.00" }))).toContain("FORGED_OUT_OF_RANGE");
    expect(codes(computeCosting({ ...spindleFixture(), operations: [{ ...liftArmFixture().operations[1]! }] }))).toContain(
      "FORGED_BASIS_WITHOUT_FORGED",
    );
  });

  it("requires exactly one base tier and at least two tiers to submit", () => {
    const one = computeCosting({ ...spindleFixture(), tiers: [{ volume: 180_000, marginPct: "12", isBase: true }] });
    expect(one.priceable).toBe(true);
    expect(one.issues.find((i) => i.code === "TIERS_TOO_FEW")).toMatchObject({ scope: "submit", severity: "error" });
    const none = computeCosting({ ...spindleFixture(), tiers: spindleFixture().tiers.map((t) => ({ ...t, isBase: false })) });
    expect(codes(none)).toContain("BASE_TIER_MISSING");
  });

  it("warns, without blocking, about missing packing, a margin below floor and low yield", () => {
    const r = computeCosting({ ...spindleFixture(), packing: null, grossWeightKg: "1.50" }, { marginFloorPct: "11" });
    expect(r.priceable).toBe(true);
    expect(r.tiers[0]!.lines!.packing).toBe("0.00");
    expect(r.issues.filter((i) => i.severity === "warning").map((i) => i.code)).toEqual(
      expect.arrayContaining(["PACKING_MISSING", "MARGIN_BELOW_FLOOR", "YIELD_LOW"]),
    );
    expect(r.issues.find((i) => i.code === "MARGIN_BELOW_FLOOR")!.tierIndex).toBe(2);
  });

  it("flags conversion ₹/kg far from similar past quotes", () => {
    const r = computeCosting(spindleFixture(), { similarMedianConversionPerKg: "120.00" });
    expect(r.issues.find((i) => i.code === "CONVERSION_PER_KG_DEVIATION")?.message).toMatch(/\+42 %/);
  });

  it("rounds inputs to their stored scale before computing", () => {
    const a = computeCosting({ ...spindleFixture(), operations: spindleFixture().operations.map((o) => (o.id === "op20" ? { ...o, cycleTimeMin: "3.2004" } : o)) });
    expect(a.tiers[1]!.lines!.unitPrice).toBe("120.46");
  });
});

describe("breakup rows", () => {
  it("lists lines in print order and hides optional zero lines", () => {
    const rows = breakupRows(computeCosting(spindleFixture()));
    expect(rows.map((r) => r.key)).not.toContain("bop");
    expect(rows.map((r) => r.key)).not.toContain("tooling");
    expect(rows.at(-1)).toMatchObject({ key: "unitPrice", emphasis: "total", values: ["122.62", "120.46", "118.85"] });
  });
});
