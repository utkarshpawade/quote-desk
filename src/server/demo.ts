/**
 * Demo-mode settings. The demo password is deliberately public (it is printed in
 * docs/deployment.md for reviewers); it can be overridden with SEED_DEMO_PASSWORD.
 */

export type DemoAccount = {
  email: string;
  name: string;
  roleLabel: string;
  hint: string;
};

export const DEFAULT_DEMO_PASSWORD = "Chakan@2026";

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "rohan.deshpande@companya.example",
    name: "Rohan Deshpande",
    roleLabel: "Estimator",
    hint: "Runs AI intake, costs parts, submits quotes",
  },
  {
    email: "vikram.joshi@companya.example",
    name: "Vikram Joshi",
    roleLabel: "Sales head",
    hint: "Approves quotes above ₹25 lakh, owns rate masters",
  },
];

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function demoPassword(): string {
  return process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
}
