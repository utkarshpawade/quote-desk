import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dec } from "../money";
import { computeCosting, normalizeCostingInput } from "./engine";
import { spindleFixture } from "./fixtures";
import type { CostingInput, OperationInput, RateRef } from "./types";

/**
 * Properties that must hold for any valid costing, not just the fixtures: the printed lines add
 * up, volume never makes a piece dearer through setup or tooling, and a stored costing recomputes
 * identically.
 */

const decimal = (min: number, max: number, dp: number) =>
  fc.integer({ min: Math.round(min * 10 ** dp), max: Math.round(max * 10 ** dp) }).map((n) => (n / 10 ** dp).toFixed(dp));

const rate = (code: string, unit: RateRef["unit"], value: string): RateRef => ({
  versionId: `v-${code}`,
  itemId: `i-${code}`,
  code,
  name: code,
  unit,
  value,
  effectiveFrom: "2026-10-01",
});

const operation = fc.oneof(
  fc.record({ cycle: decimal(0.05, 60, 3), setup: decimal(0, 240, 3), hourRate: decimal(200, 5000, 2) }).map(
    ({ cycle, setup, hourRate }): Omit<OperationInput, "id" | "seq"> => ({
      name: "Machine",
      kind: "MACHINE",
      rate: rate("MC", "PER_HOUR", hourRate),
      inHouse: true,
      cycleTimeMin: cycle,
      setupMin: setup,
      weightBasis: null,
    }),
  ),
  fc.record({ perKg: decimal(1, 80, 2), inHouse: fc.boolean(), basis: fc.constantFrom("GROSS" as const, "NET" as const) }).map(
    ({ perKg, inHouse, basis }): Omit<OperationInput, "id" | "seq"> => ({
      name: "Per kg",
      kind: "PROCESS_KG",
      rate: rate("PK", "PER_KG", perKg),
      inHouse,
      cycleTimeMin: null,
      setupMin: null,
      weightBasis: basis,
    }),
  ),
  fc.record({ perPc: decimal(0.1, 50, 2), inHouse: fc.boolean() }).map(
    ({ perPc, inHouse }): Omit<OperationInput, "id" | "seq"> => ({
      name: "Per piece",
      kind: "PROCESS_PC",
      rate: rate("PP", "PER_PIECE", perPc),
      inHouse,
      cycleTimeMin: null,
      setupMin: null,
      weightBasis: null,
    }),
  ),
);

const costingInput: fc.Arbitrary<CostingInput> = fc
  .record({
    net: decimal(0.05, 20, 3),
    extra: decimal(0.01, 10, 3),
    rm: decimal(40, 200, 2),
    scrap: decimal(5, 39, 2),
    ops: fc.array(operation, { minLength: 1, maxLength: 6 }),
    volumes: fc.uniqueArray(fc.integer({ min: 100, max: 2_000_000 }), { minLength: 2, maxLength: 3 }),
    margin: decimal(-5, 40, 3),
    rejection: decimal(0, 10, 3),
    tooling: fc.constantFrom("NONE" as const, "SEPARATE" as const, "AMORTIZED" as const),
    toolingCost: decimal(0, 2_000_000, 2),
    basis: fc.constantFrom("MFG_COST" as const, "CONVERSION" as const),
    batches: fc.integer({ min: 1, max: 52 }),
  })
  .map((g) => {
    const base = spindleFixture();
    const sorted = [...g.volumes].sort((a, b) => a - b);
    return {
      ...base,
      netWeightKg: g.net,
      grossWeightKg: dec(g.net).plus(g.extra).toFixed(3),
      material: rate("RM", "PER_KG", g.rm),
      turningsScrap: rate("SC", "PER_KG", g.scrap),
      operations: g.ops.map((op, i) => ({ ...op, id: `op${i}`, seq: (i + 1) * 10 })),
      rejectionPct: g.rejection,
      tooling: { mode: g.tooling, cost: g.toolingCost, amortYears: g.tooling === "AMORTIZED" ? 3 : null },
      marginBasis: g.basis,
      batchesPerYear: g.batches,
      tiers: sorted.map((volume, i) => ({ volume, marginPct: g.margin, isBase: i === 0 })),
    };
  });

const twoDp = /^-?\d+\.\d{2}$/;

describe("costing engine properties", () => {
  it("prints a breakup that adds up exactly, with no line beyond the paisa", () => {
    fc.assert(
      fc.property(costingInput, (input) => {
        const result = computeCosting(input);
        expect(result.priceable).toBe(true);
        for (const tier of result.tiers) {
          const l = tier.lines!;
          for (const value of Object.values(l)) expect(value).toMatch(twoDp);
          const d = (k: keyof typeof l) => dec(l[k]);
          expect(d("netMaterial").eq(d("rawMaterial").plus(d("scrapCredit")))).toBe(true);
          expect(d("conversion").eq(d("inHouseProcess").plus(d("setup")).plus(d("outsideProcess")))).toBe(true);
          expect(
            d("mfgCost").eq(
              d("netMaterial").plus(d("bop")).plus(d("conversion")).plus(d("rejection")).plus(d("overhead")).plus(d("icc")),
            ),
          ).toBe(true);
          expect(
            d("unitPrice").eq(d("mfgCost").plus(d("profit")).plus(d("packing")).plus(d("freight")).plus(d("tooling"))),
          ).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never makes setup or amortized tooling per piece dearer at a higher volume", () => {
    fc.assert(
      fc.property(costingInput, (input) => {
        const tiers = computeCosting(input).tiers;
        for (let i = 1; i < tiers.length; i++) {
          expect(Number(tiers[i]!.lines!.setup)).toBeLessThanOrEqual(Number(tiers[i - 1]!.lines!.setup));
          expect(Number(tiers[i]!.lines!.tooling)).toBeLessThanOrEqual(Number(tiers[i - 1]!.lines!.tooling));
        }
      }),
      { numRuns: 300 },
    );
  });

  it("recomputes identically after a save/reload round trip", () => {
    fc.assert(
      fc.property(costingInput, (input) => {
        const stored = JSON.parse(JSON.stringify(normalizeCostingInput(input))) as CostingInput;
        expect(computeCosting(stored)).toEqual(computeCosting(input));
      }),
      { numRuns: 200 },
    );
  });
});
