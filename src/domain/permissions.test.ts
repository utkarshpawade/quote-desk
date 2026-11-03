import { describe, expect, it } from "vitest";
import { can, type Permission, type Role } from "./permissions";

const table: Array<[Permission, boolean, boolean]> = [
  // permission,        estimator, sales head
  ["rfq.view", true, true],
  ["rfq.create", true, true],
  ["rfq.close", true, true],
  ["intake.run", true, true],
  ["costing.edit", true, false],
  ["quote.submit", true, false],
  ["quote.approve", false, true],
  ["quote.send", true, true],
  ["rates.manage", false, true],
  ["import.run", true, true],
  ["demo.reset", false, true],
];

describe("permission matrix", () => {
  it.each(table)("%s → estimator %s, sales head %s", (permission, estimator, salesHead) => {
    expect(can("ESTIMATOR", permission)).toBe(estimator);
    expect(can("SALES_HEAD", permission)).toBe(salesHead);
  });

  it("never lets one role both edit a costing and approve it", () => {
    for (const role of ["ESTIMATOR", "SALES_HEAD"] as Role[]) {
      expect(can(role, "costing.edit") && can(role, "quote.approve")).toBe(false);
    }
  });
});
