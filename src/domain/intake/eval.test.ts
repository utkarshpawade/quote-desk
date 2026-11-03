import { describe, expect, it } from "vitest";
import { SEED_ITEMS } from "@/server/seed/catalog";
import { EVAL_CASES, RECEIVED } from "../../../tests/fixtures/intake-eval";
import { readCaseByRules, scoreCase, summarize, type EvalCase } from "./eval";
import type { Proposal } from "./merge";

const materials = SEED_ITEMS.filter((i) => i.category === "MATERIAL").map((i) => ({
  id: i.code,
  grade: String(i.attributes?.grade),
  aliases: (i.attributes?.aliases as string[] | undefined) ?? [],
}));
const ctx = { materials, receivedDate: RECEIVED };

describe("intake eval scoring", () => {
  const c: EvalCase = { id: "x", title: "x", text: "", expected: { dueDate: "2026-11-13", parts: [{ annualVolume: 30_000, material: null, grossWeightKg: 0.61, netWeightKg: 0.48 }] } };
  const proposal = (fieldKey: string, value: string | null, confidence: Proposal["confidence"], partKey = "P1"): Proposal => ({
    partKey: fieldKey === "dueDate" ? "" : partKey,
    partLabel: null,
    fieldKey,
    proposedValue: value,
    confidence,
    reason: "",
    conflict: value === null,
    agreed: false,
    candidates: [],
    sortOrder: 0,
  });

  it("separates a wrong value shown as Low from one filled in with confidence", () => {
    const results = scoreCase(c, [
      proposal("dueDate", "2026-11-13", "HIGH"),
      proposal("annualVolume", "300000", "MEDIUM"), // wrong and confident: silent
      proposal("material", "EN8", "HIGH"), // the email gives no material: invented
      proposal("grossWeightKg", "0.650", "LOW"), // wrong but flagged
      // netWeightKg not read at all: missed
    ]);
    expect(Object.fromEntries(results.map((r) => [r.field, r.outcome]))).toEqual({
      dueDate: "correct",
      annualVolume: "silent",
      material: "invented",
      grossWeightKg: "flagged",
      netWeightKg: "missed",
    });
    expect(summarize(results)).toEqual({ fields: 4, correct: 1, flagged: 1, silent: 1, missed: 1, absent: 1, held: 0, invented: 1 });
  });

  it("counts an unresolved conflict as flagged, and an empty absent field as held back", () => {
    const results = scoreCase(c, [proposal("annualVolume", null, "LOW"), proposal("material", null, "LOW")]);
    expect(results.find((r) => r.field === "annualVolume")!.outcome).toBe("flagged");
    expect(results.find((r) => r.field === "material")!.outcome).toBe("held");
  });
});

describe("rule-based reading on the eval set", () => {
  const results = EVAL_CASES.flatMap((c) => scoreCase(c, readCaseByRules(c, ctx)));
  const s = summarize(results);

  it("never fills in a wrong or invented value", () => {
    expect(results.filter((r) => r.outcome === "silent" || r.outcome === "invented")).toEqual([]);
  });

  it("reads at least half of what the emails say (a floor against regressions)", () => {
    expect(s.correct / s.fields).toBeGreaterThanOrEqual(0.55);
  });

  it("ignores the injected instruction and keeps the volume the email states", () => {
    const injected = results.find((r) => r.caseId === "06-injection" && r.field === "annualVolume")!;
    expect(injected).toMatchObject({ outcome: "correct", proposed: "30000" });
  });
});
