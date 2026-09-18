import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { isoWeekKeyOfDateKey } from "../src/lib/weeks";

/**
 * Drives the real app end to end: first-run setup (or login when the owner
 * already exists), creating a trade, the trade list and detail pages, the
 * dashboard, CSV import with de-duplication, a phone-width layout check and
 * the sign-out lock-out.
 */
test.describe.configure({ mode: "serial" });

const username = process.env.E2E_USERNAME ?? "owner";
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
const tradeDayLabel = `${MONTHS[tradeDateObj.getUTCMonth()].slice(0, 3)} ${tradeDateObj.getUTCDate()}, ${tradeDateObj.getUTCFullYear()}`;

let page: Page;

test.beforeAll(async ({ browser }) => {
  mkdirSync(shotsDir, { recursive: true });
  page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.accept()); // confirm() prompts on delete buttons
});

test.afterAll(async () => {
  await page.close();
});

async function shot(name: string) {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true });
}

/** A P&L figure button; its accessible name carries both units, e.g. "+2.49R, +$248.80". */
function figure(text: string) {
  return page.getByRole("button", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
}

async function signIn(identifier: string, secret: string) {
  await page.goto("/login");
  await page.fill("#identifier", identifier);
  await page.fill("#password", secret);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("first run: create the admin account, or sign in when it exists", async () => {
  await page.goto("/setup");
  await page.waitForURL(/\/(setup|login)(\?.*)?$/);
  if (page.url().includes("/setup")) {
    await shot("01-setup");
    await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible();
    await page.fill("#username", username);
    await page.fill("#name", "Owner");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.fill("#confirmPassword", password);
    await page.getByRole("button", { name: "Create admin account" }).click();
  } else {
    await shot("01-login");
    await signIn(username, password);
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
  await page.fill("#stopPrice", "149");
  await page.fill("#entryAt", `${tradeDate}T09:31`);
  await page.getByText("More details").click(); // exit, fees and notes live behind the fold
  await page.fill("#exitPrice", "152.5");
  await page.fill("#fees", "1.2");
  await page.fill("#exitAt", `${tradeDate}T10:05`);
  await page.fill("#notes", "Gap and go on **strong** volume.\n\n- entry at VWAP reclaim\n- exit into resistance");
  await expect(page.getByText("+$248.80")).toBeVisible(); // live preview
  await shot("03-new-trade");
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: manualSymbol })).toBeVisible();
  const hero = figure("+2.49R, +$248.80").first();
  await expect(hero).toBeVisible(); // R first…
  await hero.click();
  await expect(figure("+$248.80, +2.49R").first()).toHaveText("+$248.80"); // …dollars one tap away
  await expect(page.getByText("+2.49R", { exact: true })).toBeVisible();
  await expect(page.locator("strong", { hasText: "strong" })).toBeVisible(); // markdown rendered
  await shot("04-trade-detail");
});

test("the trade shows in the list and its detail page opens", async () => {
  await page.goto(`/trades?symbol=${manualSymbol}`);
  const link = page.getByRole("link", { name: manualSymbol, exact: true }).first();
  await expect(link).toBeVisible();
  await expect(figure("+2.49R, +$248.80").first()).toBeVisible();
  await shot("05-trades-list");
  await link.click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: manualSymbol })).toBeVisible();
});

test("dashboard shows the P&L and renders charts", async () => {
  await page.goto(`/?range=custom&from=${tradeDate}&to=${tradeDate}`);
  const hero = page.locator("section[aria-label='Net P&L']");
  await expect(hero.getByRole("button", { name: /\+2\.49R, \+\$248\.80/ })).toBeVisible();
  await expect(hero).toContainText("1 closed trade");
  await expect(page.locator("section[aria-label='Edge Score']")).toBeVisible();
  await expect(page.locator("section[aria-label='What mistakes cost']")).toContainText("Stops honoured");
  await expect(page.locator("section[aria-label='What mistakes cost'] .recharts-line-curve")).toHaveCount(3);
  await expect(page.locator("section[aria-label='Key figures']")).toContainText("100%");
  await expect(page.locator(".recharts-area-curve")).toHaveCount(1);
  await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(1);
  await expect(page.getByRole("grid", { name: new RegExp(`Daily P&L for ${tradeMonthLabel}`) })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: `${tradeDayLabel}: +$248.80 over 1 trade` })).toBeVisible();
  const symbolRow = page.getByRole("row", { name: new RegExp(manualSymbol) }); // top symbols table
  await expect(symbolRow).toContainText("+2.49R");
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
  await expect(figure("no stop, +$19.50").first()).toBeVisible();
  await expect(figure("no stop, -$5.50").first()).toBeVisible();
});

test("phone-width layout has no horizontal scroll", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, url] of [
    ["09-mobile-dashboard", "/?range=all"],
    ["10-mobile-trades", "/trades"],
    ["16-mobile-today", "/today"],
    ["17-mobile-rules", "/rules"],
    ["18-mobile-reports", "/reports"],
    ["22-mobile-week", `/reports/week/${isoWeekKeyOfDateKey(tradeDate)}`],
    ["24-mobile-admin-users", "/admin/users"],
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
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  const widths = await page.evaluate(() => ({
    scroll: document.scrollingElement?.scrollWidth ?? 0,
    client: document.scrollingElement?.clientWidth ?? 0,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  await shot("11-mobile-trade-detail");
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("Today: check-in drives the plan budget bar", async () => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  // A previous run may have saved a check-in already; the form then sits behind "Edit check-in".
  const editCheckIn = page.getByText("Edit check-in");
  if (await editCheckIn.count()) await editCheckIn.click();
  await page.fill("#ci-maxTrades", "3");
  await page.fill("#ci-maxLossR", "2");
  await page.getByRole("radiogroup", { name: "Mood" }).getByText("4").click();
  await page.fill("#ci-sleep", "7.5");
  await page.fill("#ci-focusNote", "Only A setups, no chasing.");
  await page.getByRole("button", { name: /Save check-in|Update check-in/ }).click();
  const checkIn = page.locator("section[aria-label='Check-in']");
  await expect(checkIn).toContainText("Saved");
  await expect(checkIn).toContainText("Max trades 3");
  const budget = page.locator("section[aria-label='Plan budget']");
  await expect(budget).toContainText("of 3");
  await expect(budget).toContainText("of 2.0R");
  await expect(budget.getByRole("meter", { name: "Trades today" })).toHaveAttribute("aria-valuemax", "3");
  await expect(page.getByRole("paragraph").filter({ hasText: "Only A setups, no chasing." })).toBeVisible();
  const editReview = page.getByText("Edit review");
  if (await editReview.count()) await editReview.click();
  await page.fill("#rv-right", "Waited for confirmation.");
  await page.fill("#rv-change", "Size down after two losses.");
  await page.getByRole("button", { name: /Save review|Update review/ }).click();
  const review = page.locator("section[aria-label='Review']");
  await expect(review).toContainText("Waited for confirmation.");
  await expect(review).toContainText("Size down after two losses.");
  await shot("13-today");
});

test("a rule-breaking trade needs a justification and lands in the ledger", async () => {
  await page.goto("/rules");
  // Remove stale rules left behind by interrupted runs so exactly one rule breaks.
  const stale = page.locator("li", { hasText: /Stop required [A-Z0-9]+/ });
  while ((await stale.count()) > 0) {
    await stale.first().getByRole("button", { name: "Delete" }).click();
    await page.waitForTimeout(500);
  }
  await page.selectOption("#new-kind", "STOP_REQUIRED");
  await page.fill("#new-title", `Stop required ${stamp}`);
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Rule added.")).toBeVisible();

  await page.goto("/trades/new");
  await expect(page.locator("section[aria-label='Plan budget']")).toBeVisible();
  await page.fill("#symbol", `${manualSymbol}X`);
  await page.fill("#quantity", "10");
  await page.fill("#entryPrice", "50");
  await page.fill("#entryAt", `${tradeDate}T11:00`);
  await page.getByRole("button", { name: "Save trade" }).click();
  const panel = page.locator("section[aria-label='Rule justification']");
  await expect(panel).toContainText("breaks 1 rule");
  await expect(panel).toContainText(`Stop required ${stamp}`);
  await expect(page).toHaveURL(/\/trades\/new$/);
  await page.fill("#justification", "Scalping the open, mental stop at 49.5");
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  const rules = page.locator("section[aria-label='Rules']");
  await expect(rules).toContainText("Broken");
  await expect(rules).toContainText("Scalping the open, mental stop at 49.5");
  await shot("14-trade-rule-broken");

  await page.goto(`/today?date=${tradeDate}`);
  const events = page.locator("section[aria-label='Rule events']");
  await expect(events).toContainText(`Stop required ${stamp}`);
  await expect(events).toContainText("Scalping the open, mental stop at 49.5");
  await expect(page.locator("section[aria-label='Trades']")).toContainText("1 rule broken");
  await expect(page.locator("section[aria-label='Process streak']")).toContainText("Latest session is missing");

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.locator("section[aria-label='Leak finder']")).toBeVisible();
  await expect(page.locator("section[aria-label='Breakdowns']")).toContainText("Hour of day");
  await expect(page.locator("section[aria-label='State before the open']")).toContainText("Planned vs unplanned");
  await expect(page.locator("section[aria-label='Edge decay']")).toBeVisible();
  await expect(page.locator("section[aria-label='Tilt ledger']")).toContainText("Scalping the open, mental stop at 49.5");
  await shot("15-reports");

  // Pause the rule so later runs and the cleanup are not affected by it.
  await page.goto("/rules");
  const row = page.locator("li", { hasText: `Stop required ${stamp}` });
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
});

test("installable app assets and two-tap capture", async () => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const json = (await manifest.json()) as { share_target?: { action: string }; shortcuts?: unknown[] };
  expect(json.share_target?.action).toBe("/share-target");
  expect(json.shortcuts).toHaveLength(3);
  expect((await page.request.get("/sw.js")).status()).toBe(200);
  expect((await page.request.get("/icons/maskable-512.png")).status()).toBe(200);
  expect((await page.request.get("/offline")).status()).toBe(200); // reachable without a session
  const shareAnon = await page.request.post("/share-target", { multipart: { text: "hello" }, maxRedirects: 0 });
  expect([303, 307]).toContain(shareAnon.status()); // the proxy bounces it before the route does
  expect(shareAnon.headers()["location"]).toContain("/login");

  // The form is prefilled from the last trade, the stop is up front and details are folded away.
  await page.goto("/trades/new");
  await expect(page.locator("#symbol")).toHaveValue(`${manualSymbol}X`);
  await expect(page.locator("#stopPrice")).toBeVisible();
  await expect(page.locator("#notes")).toBeHidden();
  await page.getByText("More details").click();
  await expect(page.locator("#notes")).toBeVisible();
  await shot("19-quick-capture");
});

test("weekly review, share links, import presets and exports", async ({ browser }) => {
  const weekKey = isoWeekKeyOfDateKey(tradeDate);
  await page.goto(`/reports/week/${weekKey}`);
  await expect(page.getByRole("heading", { name: "Week in review" })).toBeVisible();
  const card = page.locator("section[aria-label='Share image']");
  await expect(card).toBeVisible();
  const image = card.locator("img");
  await expect.poll(async () => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Hide dollars" }).click();
  await expect(page).toHaveURL(/hide=1/);
  await shot("20-week-review");

  // A share link works without a session and stops working once revoked.
  await page.getByRole("button", { name: "Create share link" }).click();
  const shareInput = page.getByRole("textbox", { name: "Share link" }).first();
  await expect(shareInput).toBeVisible();
  const url = await shareInput.inputValue();
  expect(url).toMatch(/\/share\/[A-Za-z0-9_-]{16,}$/);
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(url);
  await expect(visitor.getByText("read-only")).toBeVisible();
  await expect(visitor.getByText("Week in review")).toBeVisible();
  await visitor.screenshot({ path: path.join(shotsDir, "21-share-week.png"), fullPage: true });
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByText("No share links yet")).toBeVisible();
  await visitor.goto(url);
  await expect(visitor.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await anon.close();

  // Import mappings can be saved under a broker name and applied again.
  const csv = ["Contract,B/S,Qty,Price,Timestamp", `${csvSymbol}P,Buy,1,100,2025-09-12 09:30`].join("\n");
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", { name: "broker.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.locator("#map-symbol")).toHaveValue("Contract");
  await expect(page.locator("#map-side")).toHaveValue("B/S");
  await expect(page.locator("#map-entryPrice")).toHaveValue("Price");
  await page.fill("#preset-name", `Broker ${stamp}`);
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("status")).toContainText(`Saved “Broker ${stamp}”`);
  await page.selectOption("#map-symbol", "");
  await page.selectOption("#preset-apply", { label: `Broker ${stamp}` });
  await expect(page.locator("#map-symbol")).toHaveValue("Contract");
  await page.getByRole("button", { name: `Delete preset Broker ${stamp}` }).click();
  await expect(page.getByRole("button", { name: `Delete preset Broker ${stamp}` })).toHaveCount(0);

  // Full exports are one request away.
  const exported = await page.evaluate(async () => {
    const all = await fetch("/api/export/all");
    const json = (await all.json()) as { format: string; trades: unknown[]; days: unknown[]; rules: unknown[] };
    const days = await fetch("/api/export/days");
    return { status: all.status, format: json.format, hasTrades: Array.isArray(json.trades), daysStatus: days.status, daysType: days.headers.get("content-type") };
  });
  expect(exported.status).toBe(200);
  expect(exported.format).toBe("darkpools-export");
  expect(exported.hasTrades).toBe(true);
  expect(exported.daysStatus).toBe(200);
  expect(exported.daysType).toContain("text/csv");
});

test("admin creates a user who must replace the temporary password and then sees only an empty journal", async ({ browser }) => {
  const newUser = `e2e-${stamp.toLowerCase()}`;
  const temporaryPassword = `temp-${stamp}-pass`;
  const chosenPassword = `chosen-${stamp}-pass`;

  // The admin creates the account with a typed temporary password, shown once.
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: `@${username}` })).toContainText("(you)");
  // Self-cleaning: accounts left behind by an interrupted run go first.
  while ((await page.getByRole("listitem", { name: /^@e2e-/ }).count()) > 0) {
    const leftover = page.getByRole("listitem", { name: /^@e2e-/ }).first();
    const label = (await leftover.getAttribute("aria-label")) ?? "";
    await leftover.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("listitem", { name: label })).toHaveCount(0);
  }
  await page.fill("#nu-username", newUser);
  await page.fill("#nu-name", "Second Trader");
  await page.getByLabel("Type one now").check();
  await page.fill("#nu-password", temporaryPassword);
  await page.getByRole("button", { name: "Create user" }).click();
  const reveal = page.getByRole("status").filter({ hasText: `Temporary password for @${newUser}` });
  await expect(reveal).toBeVisible();
  await expect(reveal.getByRole("textbox", { name: "Temporary password" })).toHaveValue(temporaryPassword);
  const card = page.getByRole("listitem", { name: `@${newUser}` });
  await expect(card).toContainText("Temporary password");
  await expect(card).toContainText("Never");
  await shot("23-admin-users");

  // The new user signs in elsewhere, is sent to the password page and cannot go anywhere else first.
  const other = await browser.newContext();
  const them = await other.newPage();
  await them.goto("/login");
  await them.fill("#identifier", newUser.toUpperCase()); // usernames are case-insensitive
  await them.fill("#password", temporaryPassword);
  await them.getByRole("button", { name: "Sign in" }).click();
  await them.waitForURL(/\/change-password$/);
  await them.goto("/trades");
  await them.waitForURL(/\/change-password$/);
  expect(await them.evaluate(() => fetch("/api/export/trades").then((r) => r.status))).toBe(403); // the browser sends the cookie
  await them.setViewportSize({ width: 390, height: 844 });
  const widths = await them.evaluate(() => ({
    scroll: document.scrollingElement?.scrollWidth ?? 0,
    client: document.scrollingElement?.clientWidth ?? 0,
  }));
  expect(widths.scroll, "/change-password overflows horizontally").toBeLessThanOrEqual(widths.client);
  await them.screenshot({ path: path.join(shotsDir, "25-mobile-change-password.png"), fullPage: true });
  await them.setViewportSize({ width: 1280, height: 900 });
  await them.fill("#currentPassword", temporaryPassword);
  await them.fill("#newPassword", chosenPassword);
  await them.fill("#confirmPassword", chosenPassword);
  await them.getByRole("button", { name: "Set password and continue" }).click();
  await them.waitForURL((url) => url.pathname === "/");

  // An empty journal of their own, and none of the admin pages.
  await expect(them.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await them.goto("/trades");
  await expect(them.getByText("No trades yet")).toBeVisible();
  await expect(them.locator("nav[aria-label='Main']").first().getByRole("link", { name: "Users" })).toHaveCount(0);
  await them.goto("/admin/users");
  await expect(them.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await them.goto("/settings");
  await expect(them.getByRole("main").getByText(`@${newUser}`)).toBeVisible();
  await expect(them.getByRole("link", { name: "Manage users" })).toHaveCount(0);
  await them.screenshot({ path: path.join(shotsDir, "26-user-settings.png"), fullPage: true });

  // The temporary password no longer works and the chosen one does.
  await them.goto("/settings");
  await them.getByRole("button", { name: "Log out" }).first().click();
  await them.waitForURL(/\/login/);
  await them.fill("#identifier", newUser);
  await them.fill("#password", temporaryPassword);
  await them.getByRole("button", { name: "Sign in" }).click();
  await expect(them.locator("form p[role='alert']")).toContainText("Invalid username or password");
  await them.fill("#password", chosenPassword);
  await them.getByRole("button", { name: "Sign in" }).click();
  await them.waitForURL((url) => url.pathname === "/");

  // Deactivating rejects their session at the next request; deleting removes the account.
  await page.reload();
  await expect(card).toContainText("Second Trader");
  await expect(card).not.toContainText("Temporary password");
  await card.getByRole("button", { name: "Deactivate" }).click();
  await expect(card).toContainText("Inactive");
  await them.goto("/trades");
  await them.waitForURL(/\/login/);
  await them.fill("#identifier", newUser);
  await them.fill("#password", chosenPassword);
  await them.getByRole("button", { name: "Sign in" }).click();
  await expect(them.locator("form p[role='alert']")).toContainText("deactivated");
  await other.close();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("listitem", { name: `@${newUser}` })).toHaveCount(0);
  await expect(page.getByRole("listitem", { name: `@${username}` })).toBeVisible();
});

test("delete this run's trades through the UI", async () => {
  for (const symbol of [`${manualSymbol}X`, manualSymbol, csvSymbol]) {
    for (let i = 0; i < 5; i++) {
      await page.goto(`/trades?symbol=${symbol}`);
      const link = page.locator("table a[href^='/trades/']").first();
      if ((await link.count()) === 0) break;
      await link.click();
      await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
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
  await expect(page.locator("#identifier")).toBeVisible();
  const api = await page.request.get("/api/export/trades");
  expect(api.status()).toBe(401);
  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  await shot("12-login-after-logout");
});
