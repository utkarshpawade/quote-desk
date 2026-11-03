import { expect, test, type Browser, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * The main flow across both roles, on seeded demo data, plus a 360 px layout check of every
 * screen. Re-seed before running: the first test submits and sends RFQ-2611-014.
 */

const PASSWORD = process.env.SEED_DEMO_PASSWORD || "Chakan@2026";
const ESTIMATOR = "rohan.deshpande@companya.example";
const SALES_HEAD = "vikram.joshi@companya.example";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/rfqs/);
}

async function openRfq(page: Page, number: string) {
  await page.goto(`/rfqs?view=all&q=${number}`);
  await page.getByRole("link", { name: number }).first().click();
  await page.waitForURL(/\/rfqs\/[^/?]+$/);
}

async function newPage(browser: Browser, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  return context.newPage();
}

test.describe.configure({ mode: "serial" });

test("estimator submits, sales head approves and sends, and the PDF carries the price", async ({ browser }) => {
  const estimator = await newPage(browser);
  await signIn(estimator, ESTIMATOR);
  await openRfq(estimator, "RFQ-2611-014");
  const submit = estimator.getByRole("button", { name: "Submit quote" });
  await expect(submit, "RFQ-2611-014 must still be a draft: re-seed with npm run db:reset").toBeEnabled();
  await submit.click();
  await expect(estimator.getByText(/is above ₹25 lakh, so it goes to the sales head/)).toBeVisible();
  await estimator.context().close();

  const head = await newPage(browser);
  await signIn(head, SALES_HEAD);
  await openRfq(head, "RFQ-2611-014");
  await head.getByRole("link", { name: "Review & approve" }).click();
  await head.waitForURL(/\/quotes\//);
  await head.getByRole("button", { name: "Approve", exact: true }).click();
  await head.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(head.getByText("Approved — you can send it now.")).toBeVisible();
  await head.getByRole("button", { name: "Send to customer" }).click();
  await head.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click();
  await expect(head.getByText("Quote sent (mock email).")).toBeVisible();

  const quoteId = new URL(head.url()).pathname.split("/").pop()!;
  const res = await head.request.get(`/api/quotes/${quoteId}/pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await res.body())), { mergePages: true });
  expect(text).toContain("QT-2611-014-R0");
  expect(text).toContain("₹");
  // Fixture A's unit price at the RFQ volume (1,80,000 a year), to the paisa.
  expect(text).toContain("120.46");
  await head.context().close();
});

test("every screen fits a 360 px phone without sideways scrolling", async ({ browser }) => {
  const page = await newPage(browser, { width: 360, height: 740 });
  const overflowing: string[] = [];
  const check = async (label: string) => {
    await page.waitForLoadState("networkidle");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 0) overflowing.push(`${label} (+${wide}px)`);
  };

  await page.goto("/login");
  await check("/login");
  await signIn(page, SALES_HEAD);

  for (const path of ["/rfqs", "/rfqs?view=all", "/intake/new", "/rates", "/rates?category=COMMERCIAL", "/past-quotes", "/imports"]) {
    await page.goto(path);
    await check(path);
  }

  await openRfq(page, "RFQ-2611-019");
  await check("RFQ workspace");
  await page.getByRole("link", { name: /^1 · / }).first().click();
  await page.waitForURL(/\/parts\//);
  await check("part costing");
  const partUrl = page.url();

  await page.goto(`/past-quotes?similar=${partUrl.split("/parts/")[1]}`);
  await check("similar past parts");

  await openRfq(page, "RFQ-2611-019");
  await page.getByRole("link", { name: "Review & approve" }).click();
  await page.waitForURL(/\/quotes\//);
  await check("quote approval");

  await page.goto("/rfqs");
  await page.locator('a[href^="/intake/"]').first().click();
  await page.waitForURL(/\/intake\//);
  await check("intake review");

  expect(overflowing).toEqual([]);
});
