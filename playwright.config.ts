import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, run against freshly seeded demo data (they submit and send RFQ-2611-014):
 *   npm run db:reset && npm run test:e2e
 * With BASE_URL set they use that running app; otherwise they start the production build
 * (`npm run build` first) on port 3200.
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3200";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "npx next start --port 3200", url: `${BASE_URL}/login`, timeout: 120_000, reuseExistingServer: !process.env.CI },
});
