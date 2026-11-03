import { describe, expect, it } from "vitest";
import { pastConversionPerKg, rmAdjustedPrice } from "./rm-adjust";
import { passesGate, rankSimilar, scoreMatch, THRESHOLD, type Comparable, type Target } from "./score";
import { inputForm, shapeFamily } from "./shape";

const spindle: Target = {
  description: "Rear wheel spindle",
  inputForm: "BAR",
  shapeFamily: "shaft",
  materialGrade: "EN8",
  materialFamily: "MEDIUM_CARBON",
  weightKg: 0.61,
  processHints: ["induction hardening", "thread rolling"],
};

const past = (over: Partial<Comparable>): Comparable => ({
  description: "Front wheel spindle",
  inputForm: "BAR",
  shapeFamily: "shaft",
  materialGrade: "EN8",
  materialFamily: "MEDIUM_CARBON",
  weightKg: 0.58,
  quoteDate: "2025-03-14",
  processes: ["induction hardening", "thread rolling"],
  ...over,
});

describe("shape and input form", () => {
  it.each([
    ["Rear wheel spindle", "shaft"],
    ["Gear blank 42T", "disc"],
    ["Hydraulic lift arm LH", "arm"],
    ["Gearbox housing", "housing"],
    ["Spacer", "other"],
  ])("%s → %s", (description, family) => {
    expect(shapeFamily(description)).toBe(family);
  });

  it("calls a part forged when it has a forged weight or says so", () => {
    expect(inputForm({ hasForgedWeight: true })).toBe("FORGING");
    expect(inputForm({ materialText: "40Cr4 forging" })).toBe("FORGING");
    expect(inputForm({ materialText: "EN8 bright bar" })).toBe("BAR");
  });
});

describe("similar parts", () => {
  it("only compares parts made the same way", () => {
    expect(passesGate(spindle, past({}))).toBe(true);
    expect(passesGate(spindle, past({ inputForm: "FORGING" }))).toBe(false);
    // Same form, different shape and an unrelated name.
    expect(passesGate(spindle, past({ description: "Brake lever", shapeFamily: "arm" }))).toBe(false);
  });

  it("scores the brief's spindle against last year's front wheel spindle, with every component shown", () => {
    const m = scoreMatch(spindle, past({}), "2026-11-03");
    expect(m.components).toMatchObject({ family: 1, material: 1, process: 1, recency: 1 });
    expect(m.components.name).toBeCloseTo(0.75, 1);
    expect(m.components.weight).toBeCloseTo(0.951, 3);
    expect(m.score).toBeGreaterThan(0.85);
  });

  it("leaves unknown information out instead of counting it as a mismatch", () => {
    const noHints = scoreMatch({ ...spindle, processHints: [], weightKg: null }, past({}), "2026-11-03");
    expect(noHints.components.process).toBeNull();
    expect(noHints.components.weight).toBeNull();
    expect(noHints.score).toBeGreaterThan(0.85);
  });

  it("decays with age: full within 24 months, nothing after 48", () => {
    expect(scoreMatch(spindle, past({ quoteDate: "2022-10-01" }), "2026-11-03").components.recency).toBe(0);
    expect(scoreMatch(spindle, past({ quoteDate: "2023-11-03" }), "2026-11-03").components.recency).toBeCloseTo(0.5, 1);
  });

  it("ranks above the threshold only, best first", () => {
    const ranked = rankSimilar(
      spindle,
      [
        past({ description: "Kick start shaft", materialGrade: "C45", materialFamily: "MEDIUM_CARBON", weightKg: 1.2, processes: [] }),
        past({}),
        past({ description: "Pivot pin", materialGrade: "42CrMo4", materialFamily: "ALLOY", weightKg: 2.1, quoteDate: "2023-05-01", processes: [] }),
      ],
      "2026-11-03",
    );
    expect(ranked[0]!.description).toBe("Front wheel spindle");
    expect(ranked.every((r) => r.match.score >= THRESHOLD)).toBe(true);
    expect(ranked.map((r) => r.description)).not.toContain("Pivot pin");
  });
});

describe("RM-adjusted price", () => {
  it("moves a past price by the steel and scrap change", () => {
    // EN8 ₹68 → ₹72.50, turnings ₹24 → ₹26; 0.58 kg gross, 0.45 kg net.
    const r = rmAdjustedPrice({ price: "104.87", grossKg: "0.580", netKg: "0.450", then: { rmRate: "68.00", scrapRate: "24.00" }, now: { rmRate: "72.50", scrapRate: "26.00" } });
    // +4.50 × 0.58 = 2.61; −2.00 × 0.13 = −0.26 → +2.35
    expect(r).toEqual({ value: "107.22", delta: "2.35", estimated: false });
  });

  it("is marked estimated without a net weight and unavailable without a gross weight", () => {
    expect(rmAdjustedPrice({ price: "100.00", grossKg: "1.000", netKg: null, then: { rmRate: "70", scrapRate: "20" }, now: { rmRate: "72", scrapRate: "20" } })).toEqual({ value: "102.00", delta: "2.00", estimated: true });
    expect(rmAdjustedPrice({ price: "100.00", grossKg: null, netKg: null, then: { rmRate: "70", scrapRate: "20" }, now: { rmRate: "72", scrapRate: "20" } })).toBeNull();
  });

  it("derives a past quote's conversion ₹/kg the way the engine does", () => {
    // (104.87 − (0.58 × 68 − 0.13 × 24)) / 0.45 = (104.87 − 36.32) / 0.45
    expect(pastConversionPerKg({ price: "104.87", grossKg: "0.580", netKg: "0.450", then: { rmRate: "68.00", scrapRate: "24.00" } })).toBe("152.33");
  });
});
