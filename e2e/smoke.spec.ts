import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Drives the real app end to end: first-run setup (or login when the owner
 * already exists), creating a trade, the trade list and detail pages, the
 * dashboard, CSV import with de-duplication, a phone-width layout check and
 * the sign-out lock-out.
 */
test.describe.configure({ mode: "serial" });

const email = process.env.E2E_EMAIL ?? "owner@example.com";
const password = process.env.E2E_PASSWORD ?? "correct-horse-battery-staple";
const shotsDir = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "screenshots");
const stamp = Date.now().toString(36).toUpperCase();
const manualSymbol = `E2E${stamp}`;
const csvSymbol = `CSV${stamp}`;
// Each run gets its own day (seconds mapped onto 2024-2025) so single-day dashboard figures only
// contain this run's trade; the cleanup step at the end removes the run's trades again.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const tradeDateObj = new Date(Date.UTC(2024, 0, 1 + (Math.floor(Date.now() / 1000) % 730)));
const tradeDate = tradeDateObj.toISOString().slice(0, 10);
const tradeMonthLabel = `${MONTHS[tradeDateObj.getUTCMonth()]} ${tradeDateObj.getUTCFullYear()}`;

let page: Page;

test.beforeAll(async ({ browser }) => {
  mkdirSync(shotsDir, { recursive: true });
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

async function shot(name: string) {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true });
}

test("first run: create the owner account, or sign in when it exists", async () => {
  await page.goto("/setup");
  await page.waitForURL(/\/(setup|login)(\?.*)?$/);
  if (page.url().includes("/setup")) {
    await shot("01-setup");
    await page.fill("#name", "Owner");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.fill("#confirmPassword", password);
    await page.getByRole("button", { name: "Create account" }).click();
  } else {
    await shot("01-login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await shot("02-dashboard-first");
});

test("create a trade through the UI", async () => {
  await page.goto("/trades/new");
  await page.fill("#symbol", manualSymbol);
  await page.fill("#quantity", "100");
  await page.fill("#entryPrice", "150");
  await page.fill("#exitPrice", "152.5");
  await page.fill("#fees", "1.2");
  await page.fill("#stopPrice", "149");
  await page.fill("#entryAt", `${tradeDate}T09:31`);
  await page.fill("#exitAt", `${tradeDate}T10:05`);
  await page.fill("#notes", "Gap and go on **strong** volume.\n\n- entry at VWAP reclaim\n- exit into resistance");
  await expect(page.getByText("+$248.80")).toBeVisible(); // live preview
  await shot("03-new-trade");
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.waitForURL(/\/trades\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: manualSymbol })).toBeVisible();
  await expect(page.getByText("+$248.80").first()).toBeVisible();
  await expect(page.getByText("+2.49R", { exact: true })).toBeVisible();
  await expect(page.locator("strong", { hasText: "strong" })).toBeVisible(); // markdown rendered
  await shot("04-trade-detail");
});

test("the trade shows in the list and its detail page opens", async () => {
  await page.goto(`/trades?symbol=${manualSymbol}`);
  const link = page.getByRole("link", { name: manualSymbol, exact: true }).first();
  await expect(link).toBeVisible();
  await expect(page.getByText("+$248.80").first()).toBeVisible();
  await shot("05-trades-list");
  await link.click();
  await page.waitForURL(/\/trades\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: manualSymbol })).toBeVisible();
});

test("dashboard shows the P&L and renders charts", async () => {
  await page.goto(`/?range=custom&from=${tradeDate}&to=${tradeDate}`);
  const hero = page.locator("section[aria-label='Net P&L']");
  await expect(hero).toContainText("+$248.80");
  await expect(hero).toContainText("1 closed trade");
  await expect(page.locator("section[aria-label='Key figures']")).toContainText("100%");
  await expect(page.locator(".recharts-surface")).toHaveCount(2);
  await expect(page.locator(".recharts-area-curve")).toHaveCount(1);
  await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(1);
  await expect(page.getByRole("grid", { name: new RegExp(`Daily P&L for ${tradeMonthLabel}`) })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: /\+\$248\.80 over 1 trade/ })).toBeVisible();
  const symbolRow = page.getByRole("row", { name: new RegExp(manualSymbol) }); // top symbols table
  await expect(symbolRow).toContainText("+$248.80");
  await shot("06-dashboard");
});

test("import a small CSV with a duplicate row", async () => {
  const csv = [
    "Symbol,Side,Qty,Entry Price,Exit Price,Entry Time,Exit Time,Commission,Notes",
    `${csvSymbol},Long,10,20,22,2025-09-11 09:30,2025-09-11 10:00,0.5,first`,
    `${csvSymbol},Short,5,30,31,09/11/2025 11:00 AM,09/11/2025 11:30 AM,0.5,second`,
    `${csvSymbol},Long,10,20,22,2025-09-11 09:30,2025-09-11 10:00,0.5,duplicate of first`,
    `${csvSymbol},Long,7,,2025-09-12 09:30,,0,broken row`,
  ].join("\n");
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", { name: "trades.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("4 rows")).toBeVisible();
  await expect(page.locator("#map-symbol")).toHaveValue("Symbol");
  await expect(page.locator("#map-entryAt")).toHaveValue("Entry Time");
  await expect(page.locator("#map-fees")).toHaveValue("Commission");
  await expect(page.getByText("3 rows ready")).toBeVisible();
  await expect(page.getByText("1 with errors")).toBeVisible();
  await shot("07-import-preview");
  await page.getByRole("button", { name: "Import 3 trades" }).click();
  const report = page.getByRole("status");
  await expect(report).toContainText("Import finished");
  await expect(report.locator("li").nth(0)).toContainText("2");
  await expect(report.locator("li").nth(1)).toContainText("1");
  await expect(report.locator("li").nth(2)).toContainText("1");
  await shot("08-import-report");

  // Importing the same file again inserts nothing.
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", { name: "trades.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Import 3 trades" }).click();
  await expect(page.getByRole("status")).toContainText("Import finished");
  await expect(page.getByRole("status").locator("li").nth(0)).toContainText("0");
  await expect(page.getByRole("status").locator("li").nth(1)).toContainText("3");

  await page.goto(`/trades?symbol=${csvSymbol}`);
  await expect(page.getByText("1–2 of 2")).toBeVisible();
  await expect(page.getByText("+$19.50").first()).toBeVisible();
  await expect(page.getByText("-$5.50").first()).toBeVisible();
});

test("phone-width layout has no horizontal scroll", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, url] of [
    ["09-mobile-dashboard", "/?range=all"],
    ["10-mobile-trades", "/trades"],
  ] as const) {
    await page.goto(url);
    await expect(page.locator("nav[aria-label='Main']").last()).toBeVisible();
    const widths = await page.evaluate(() => ({
      scroll: document.scrollingElement?.scrollWidth ?? 0,
      client: document.scrollingElement?.clientWidth ?? 0,
    }));
    expect(widths.scroll, `${url} overflows horizontally`).toBeLessThanOrEqual(widths.client);
    await shot(name);
  }
  await page.goto(`/trades?symbol=${manualSymbol}`);
  await page.getByRole("link", { name: new RegExp(manualSymbol) }).first().click();
  await page.waitForURL(/\/trades\/[a-z0-9]+$/);
  const widths = await page.evaluate(() => ({
    scroll: document.scrollingElement?.scrollWidth ?? 0,
    client: document.scrollingElement?.clientWidth ?? 0,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  await shot("11-mobile-trade-detail");
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("delete this run's trades through the UI", async () => {
  page.on("dialog", (dialog) => dialog.accept());
  for (const symbol of [manualSymbol, csvSymbol]) {
    for (let i = 0; i < 5; i++) {
      await page.goto(`/trades?symbol=${symbol}`);
      const link = page.locator("table a[href^='/trades/']").first();
      if ((await link.count()) === 0) break;
      await link.click();
      await page.waitForURL(/\/trades\/[a-z0-9]+$/);
      await page.getByRole("button", { name: "Delete trade" }).click();
      await page.waitForURL((url) => url.pathname === "/trades");
    }
    await page.goto(`/trades?symbol=${symbol}`);
    await expect(page.getByText("No trades match these filters.")).toBeVisible();
  }
});

test("logging out blocks protected pages and APIs", async () => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Log out" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto("/trades");
  await page.waitForURL(/\/login\?next=%2Ftrades/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const api = await page.request.get("/api/export/trades");
  expect(api.status()).toBe(401);
  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  await shot("12-login-after-logout");
});
