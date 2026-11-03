import { describe, expect, it } from "vitest";
import { checkNewVersion, checkVoid, liveWindows, needsConfirmation, resolveAt, type VersionLike } from "./resolve";

const v = (id: string, effectiveFrom: string, value: string, voidedAt: string | null = null): VersionLike => ({
  id,
  effectiveFrom,
  value,
  voidedAt,
});

const en8 = [v("v1", "2026-04-01", "68.00"), v("v2", "2026-10-01", "72.50"), v("v3", "2026-12-01", "74.00")];

describe("resolving a rate on a date", () => {
  it("finds the version in force", () => {
    expect(resolveAt(en8, "2026-03-31")).toBeNull();
    expect(resolveAt(en8, "2026-04-01")?.id).toBe("v1");
    expect(resolveAt(en8, "2026-11-03")?.id).toBe("v2");
    expect(resolveAt(en8, "2026-12-01")?.id).toBe("v3");
  });

  it("ignores voided versions", () => {
    const withTypo = [...en8, v("typo", "2026-11-03", "725.00", "2026-11-03T05:00:00Z")];
    expect(resolveAt(withTypo, "2026-11-03")?.id).toBe("v2");
  });

  it("derives each version's last day", () => {
    expect(liveWindows(en8).map((w) => w.effectiveTo)).toEqual(["2026-09-30", "2026-11-30", null]);
  });
});

describe("the traceability invariant", () => {
  const today = "2026-11-03";

  it("always allows a future-dated version", () => {
    expect(checkNewVersion({ versions: en8, effectiveFrom: "2026-11-15", today, frozenBasisDates: ["2026-11-03"] })).toEqual({ ok: true });
  });

  it("allows back-dating when no frozen quote priced inside the affected window", () => {
    // Loading ERP history: a version from 1 Jul only governs until the next one (1 Oct).
    expect(checkNewVersion({ versions: en8, effectiveFrom: "2026-07-01", today, frozenBasisDates: ["2026-10-20"] })).toEqual({ ok: true });
  });

  it("refuses a back-date that would re-price a frozen quote", () => {
    const check = checkNewVersion({ versions: en8, effectiveFrom: "2026-10-15", today, frozenBasisDates: ["2026-10-20", "2026-09-01"] });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/latest basis 2026-10-20/);
  });

  it("corrects a same-day typo by voiding then re-adding the date", () => {
    const typo = v("typo", today, "725.00");
    const versions = [...en8, typo];
    expect(checkNewVersion({ versions, effectiveFrom: today, today, frozenBasisDates: [] }).ok).toBe(false);
    expect(checkVoid({ version: typo, frozenVersionIds: new Set() })).toEqual({ ok: true });
    const afterVoid = [...en8, { ...typo, voidedAt: "2026-11-03T06:00:00Z" }];
    expect(checkNewVersion({ versions: afterVoid, effectiveFrom: today, today, frozenBasisDates: [] })).toEqual({ ok: true });
  });

  it("never voids a version a frozen quote uses", () => {
    expect(checkVoid({ version: en8[1]!, frozenVersionIds: new Set(["v2"]) }).ok).toBe(false);
  });

  it("asks for confirmation on a change of more than 20 %", () => {
    expect(needsConfirmation("72.50", "725.00")).toBe(true);
    expect(needsConfirmation("72.50", "75.00")).toBe(false);
    expect(needsConfirmation(null, "72.50")).toBe(false);
  });
});
