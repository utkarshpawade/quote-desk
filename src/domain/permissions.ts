/**
 * Who may do what (DESIGN.md §2). Pure so it can be unit tested and shared by server guards
 * and the UI (which only hides what the server would refuse anyway).
 *
 * Segregation of duties (A-13): estimators cost and submit; the sales head approves and owns the
 * rate masters. Nobody approves their own costing because the two roles never overlap.
 */

export type Role = "ESTIMATOR" | "SALES_HEAD";

export type Permission =
  | "rfq.view"
  | "rfq.create"
  | "rfq.close" // mark won / lost / regretted, reassign owner
  | "intake.run"
  | "costing.edit"
  | "quote.submit"
  | "quote.approve"
  | "quote.send" // estimators additionally need to own the RFQ (checked in the service)
  | "rates.manage"
  | "import.run"
  | "demo.reset";

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  ESTIMATOR: new Set<Permission>([
    "rfq.view",
    "rfq.create",
    "rfq.close",
    "intake.run",
    "costing.edit",
    "quote.submit",
    "quote.send",
    "import.run",
  ]),
  SALES_HEAD: new Set<Permission>([
    "rfq.view",
    "rfq.create",
    "rfq.close",
    "intake.run",
    "quote.approve",
    "quote.send",
    "rates.manage",
    "import.run",
    "demo.reset",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export const ROLE_LABEL: Record<Role, string> = {
  ESTIMATOR: "Estimator",
  SALES_HEAD: "Sales head",
};
