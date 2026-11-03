/**
 * Captures the key screens at desktop and phone sizes (for design review and the TDD).
 *   npx tsx scripts/screenshots.ts [outDir] [filter]
 * Needs the app running (BASE_URL, default http://localhost:3100) on seeded demo data.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.argv[2] ?? "docs/screens";
const FILTER = process.argv[3];
const PASSWORD = process.env.SEED_DEMO_PASSWORD || "Chakan@2026";

const ESTIMATOR = "rohan.deshpande@companya.example";
const SALES_HEAD = "vikram.joshi@companya.example";

type Shot = { name: string; user: string | null; go: (page: Page) => Promise<void>; fullPage?: boolean };

async function openRfq(page: Page, number: string) {
  await page.goto(`${BASE}/rfqs?view=all&q=${number}`);
  await page.getByRole("link", { name: number }).first().click();
  await page.waitForLoadState("networkidle");
}

const SHOTS: Shot[] = [
  { name: "login", user: null, go: async (p) => void (await p.goto(`${BASE}/login`)) },
  { name: "register-estimator", user: ESTIMATOR, go: async (p) => void (await p.goto(`${BASE}/rfqs`)) },
  { name: "register-sales-head", user: SALES_HEAD, go: async (p) => void (await p.goto(`${BASE}/rfqs`)) },
  { name: "workspace-019", user: SALES_HEAD, go: (p) => openRfq(p, "RFQ-2611-019"), fullPage: true },
  { name: "rates-materials", user: SALES_HEAD, go: async (p) => void (await p.goto(`${BASE}/rates`)) },
  {
    name: "rates-history",
    user: SALES_HEAD,
    go: async (p) => {
      await p.goto(`${BASE}/rates`);
      await p.getByRole("button", { name: "MAT-EN8", exact: true }).click();
      await p.getByRole("dialog").waitFor();
    },
  },
  {
    name: "quote-019",
    user: SALES_HEAD,
    go: async (p) => {
      await openRfq(p, "RFQ-2611-019");
      await p.getByRole("link", { name: "Review & approve" }).click();
      await p.waitForURL(/\/quotes\//);
    },
    fullPage: true,
  },
  {
    name: "costing-014",
    user: ESTIMATOR,
    go: async (p) => {
      await openRfq(p, "RFQ-2611-014");
      await p.getByRole("link", { name: "1 · Rear wheel spindle" }).click();
      await p.waitForURL(/\/parts\//);
      await p.waitForLoadState("networkidle");
    },
    fullPage: true,
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const viewport of [
    { label: "desktop", width: 1440, height: 900 },
    { label: "laptop", width: 1366, height: 768 },
    { label: "phone", width: 390, height: 844 },
  ]) {
    for (const shot of SHOTS.filter((s) => !FILTER || s.name.includes(FILTER))) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.label === "phone" ? 2 : 1 });
      const page = await context.newPage();
      if (shot.user) {
        await page.goto(`${BASE}/login`);
        await page.fill("#email", shot.user);
        await page.fill("#password", PASSWORD);
        await page.click("button[type=submit]");
        await page.waitForURL(/\/rfqs/, { timeout: 60_000 });
      }
      await shot.go(page);
      await page.waitForLoadState("networkidle");
      const file = path.join(OUT, `${shot.name}-${viewport.label}.png`);
      await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      console.log(`${file}${overflow ? "  ⚠ horizontal overflow" : ""}`);
      await context.close();
    }
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
