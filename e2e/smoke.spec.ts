import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { isoWeekKeyOfDateKey } from "../src/lib/weeks";

/**
 * Drives the real app end to end: first-run setup (or login when the owner
 * already exists), creating a trade, the trade list and detail pages, the
 * dashboard, CSV import with de-duplication, foreign-origin requests being
 * refused, a phone-width layout check and the sign-out lock-out.
 */
test.describe.configure({ mode: "serial" });

const username = process.env.E2E_USERNAME ?? "owner";
const email = process.env.E2E_EMAIL ?? "owner@example.com";
const password = process.env.E2E_PASSWORD ?? "correct-horse-battery-staple";
/** The server's SETUP_TOKEN, which a production build requires for the first-run page. */
const setupToken = process.env.E2E_SETUP_TOKEN;
const FOREIGN_ORIGIN = "https://kcal.deeapps.net";
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
// The day after carries the closing and option trades, so the dashboard figures of each day stay separate.
const closeDateObj = new Date(tradeDateObj.getTime() + 86_400_000);
const closeDate = closeDateObj.toISOString().slice(0, 10);
const expiryObj = new Date(closeDateObj.getTime() + 7 * 86_400_000);
const expiryKey = expiryObj.toISOString().slice(0, 10);
const closeSymbol = `${manualSymbol}C`;
const optionSymbol = `OPT${stamp}`;
const mobileSymbol = `${manualSymbol}M`;
const yearSuffix = expiryObj.getUTCFullYear() === new Date().getUTCFullYear() ? "" : ` '${String(expiryObj.getUTCFullYear()).slice(-2)}`;
// A thinkorswim Account Statement whose symbols carry this run's stamp, so the de-duplication cannot collide with an earlier run.
const tosSymbol = `TOS${stamp}`;
const tosStatement = readFileSync(path.join(__dirname, "fixtures", "thinkorswim-statement.csv"), "utf8").replace(/\b(AAPL|SPY|TSLA|NVDA|MSFT|QQQ)\b/g, (m) => `${tosSymbol}${m[0]}`);
const optionLabel = `${optionSymbol} 450C ${MONTHS[expiryObj.getUTCMonth()].slice(0, 3)} ${expiryObj.getUTCDate()}${yearSuffix}`;

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

/** The session cookie as a request header; in production it is Secure, which the request API would otherwise drop on plain http. */
async function sessionCookieHeader(): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name.endsWith("darkpools_session"));
  expect(cookie, "session cookie present").toBeTruthy();
  return `${cookie!.name}=${cookie!.value}`;
}

test("first run: create the admin account, or sign in when it exists", async () => {
  await page.goto(setupToken ? `/setup?token=${encodeURIComponent(setupToken)}` : "/setup");
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

test("close an open trade: part of it from the list, the rest from the detail page", async () => {
  await page.goto("/trades/new");
  await page.fill("#symbol", closeSymbol);
  await page.fill("#quantity", "100");
  await page.fill("#entryPrice", "50");
  await page.fill("#stopPrice", "49");
  await page.fill("#entryAt", `${closeDate}T09:31`);
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByText("Open position")).toBeVisible();

  // Forty of the hundred from the list row: the closed part becomes its own row, the rest stays open.
  await page.goto(`/trades?symbol=${closeSymbol}`);
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: `Close ${closeSymbol}` });
  await expect(sheet).toBeVisible();
  await sheet.locator("#close-quantity").fill("40");
  await sheet.locator("#close-exitPrice").fill("52");
  await sheet.locator("#close-exitAt").fill(`${closeDate}T10:00`);
  await sheet.locator("#close-exitNote").fill("Took some off into strength.");
  await expect(sheet).toContainText("+$80.00");
  await shot("27-close-sheet");
  await sheet.getByRole("button", { name: "Close 40 of 100" }).click();
  await expect(sheet).toBeHidden();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  const closedRow = rows.filter({ hasText: "Closed" });
  const openRow = rows.filter({ hasText: "Open" });
  await expect(closedRow).toContainText("40");
  await expect(closedRow.getByRole("button", { name: /\+2\.00R, \+\$80\.00/ })).toBeVisible();
  await expect(openRow).toContainText("60");
  await expect(openRow.getByRole("button", { name: "Close", exact: true })).toBeVisible();

  // The closed part points back to the original.
  await closedRow.getByRole("link", { name: closeSymbol, exact: true }).click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  // The notes render as Markdown and sit in the edit form too, so look at the rendered paragraph.
  await expect(page.locator("p", { hasText: /Partial close of/ })).toBeVisible();
  await expect(page.locator("p", { hasText: "Took some off into strength." })).toBeVisible();

  // The remaining sixty from the detail page's primary button.
  await page.goto(`/trades?symbol=${closeSymbol}&status=OPEN`);
  await page.getByRole("link", { name: closeSymbol, exact: true }).first().click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await expect(page.locator("p", { hasText: "Closed 40 of 100; 60 still open." })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const rest = page.getByRole("dialog", { name: `Close ${closeSymbol}` });
  await expect(rest.locator("#close-quantity")).toHaveValue("60");
  await rest.locator("#close-exitPrice").fill("51");
  await rest.locator("#close-exitAt").fill(`${closeDate}T11:00`);
  await rest.getByRole("button", { name: "Close trade" }).click();
  await expect(rest).toBeHidden();
  await expect(figure("+1.00R, +$60.00").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);

  // Both parts land on the dashboard for that day, and the open-positions tile leads to the open filter.
  await page.goto(`/?range=custom&from=${closeDate}&to=${closeDate}`);
  const hero = page.locator("section[aria-label='Net P&L']");
  await expect(hero.getByRole("button", { name: /\+3\.00R, \+\$140\.00/ })).toBeVisible();
  await expect(hero).toContainText("2 closed trades");
  await expect(page.getByRole("link", { name: /Open positions/ })).toHaveAttribute("href", "/trades?status=OPEN");
  await shot("28-dashboard-after-close");
});

test("an option trade is labelled by its contract and can expire worthless", async () => {
  await page.goto("/trades/new");
  await page.fill("#symbol", optionSymbol);
  await page.selectOption("#assetClass", "OPTION");
  await expect(page.locator("#multiplier")).toHaveValue("100"); // contracts default to 100 shares
  await expect(page.getByText("Contracts", { exact: true })).toBeVisible();
  await page.getByText("Call", { exact: true }).click();
  await page.fill("#strikePrice", "450");
  await page.fill("#expiresAt", expiryKey);
  await page.fill("#quantity", "2");
  await page.fill("#entryPrice", "1.5");
  await page.fill("#stopPrice", "1");
  await page.fill("#entryAt", `${closeDate}T09:45`);
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: optionLabel })).toBeVisible();
  await expect(page.getByText("7d at entry")).toBeVisible();
  await shot("29-option-trade");

  // One tap: the contract closes at zero at 16:00 on expiration day.
  await page.getByRole("button", { name: "Expired worthless" }).click();
  await expect(figure("-3.00R, -$300.00").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await expect(page.getByText(/16:00$/).first()).toBeVisible();

  await page.goto(`/trades?symbol=${optionSymbol}`);
  await expect(page.getByRole("link", { name: optionLabel, exact: true })).toBeVisible();
  await page.goto("/reports");
  const options = page.locator("section[aria-label='Options']");
  await expect(options).toContainText("Calls");
  await expect(options).toContainText("1 to 7 days");
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

test("bulk delete from the trades list", async () => {
  await page.goto(`/trades?symbol=${csvSymbol}`);
  await expect(page.getByText("1–2 of 2")).toBeVisible();
  await page.getByLabel("Select all on this page").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await shot("31-bulk-select");
  await page.getByRole("button", { name: "Delete selected" }).click(); // the confirm() is accepted by the dialog handler
  await page.waitForURL(/deleted=2/);
  await expect(page.getByRole("status")).toContainText("Deleted 2 trades.");
  await expect(page.getByText("No trades match these filters.")).toBeVisible();
});

test("a thinkorswim statement becomes round trips, flags an unmatched close, and the import can be undone", async () => {
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", { name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(tosStatement) });
  await expect(page.getByRole("status").filter({ hasText: "thinkorswim Account Statement detected" })).toBeVisible();
  await expect(page.getByLabel(/An execution/)).toBeChecked();
  await expect(page.locator("#map-posEffect")).toHaveValue("Pos Effect");
  await expect(page.locator("#map-time")).toHaveValue("Exec Time");
  const summary = page.getByTestId("match-summary");
  await expect(summary).toContainText("11 fills → 7 trades (3 closed, 4 open)");
  await expect(summary).toContainText("1 unmatched close");
  const unmatched = page.locator("section[aria-label='Unmatched closes']");
  await expect(unmatched).toContainText(`${tosSymbol}N`);
  await expect(unmatched).toContainText("wider date range");
  const matched = page.locator("table[aria-label='Matched trades']");
  await expect(matched.getByRole("row").filter({ hasText: `${tosSymbol}A` })).toContainText("+$250.00");
  await expect(matched.getByRole("row").filter({ hasText: `${tosSymbol}S 450C` })).toContainText("+$120.00");
  await expect(matched.getByRole("row").filter({ hasText: `${tosSymbol}Q 470P` })).toContainText("OPEN");
  await shot("32-thinkorswim-preview");

  // The unmatched close can be brought in as a closed trade with an unknown entry.
  await unmatched.getByLabel("Import as a closed trade with an unknown entry").check();
  await page.getByRole("button", { name: "Import 8 trades" }).click();
  const report = page.getByRole("status").filter({ hasText: "Import finished" });
  await expect(report.locator("li").nth(0)).toContainText("8");
  await expect(report.locator("li").nth(1)).toContainText("0");

  await page.goto(`/trades?symbol=${tosSymbol}`);
  await expect(page.getByText("1–8 of 8")).toBeVisible();
  await page.goto(`/trades?symbol=${tosSymbol}A`);
  await expect(figure("no stop, +$250.00").first()).toBeVisible();
  await page.goto(`/trades?symbol=${tosSymbol}T`);
  await expect(page.getByText("1–2 of 2")).toBeVisible(); // 100 closed, 100 still open
  await expect(page.locator("table").getByText("Open", { exact: true })).toBeVisible();
  await page.goto(`/trades?symbol=${tosSymbol}N`);
  await page.getByRole("link", { name: `${tosSymbol}N`, exact: true }).click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await expect(page.locator("p", { hasText: /Entry unknown/ })).toBeVisible();

  // The same statement again adds nothing.
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", { name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(tosStatement) });
  await page.getByRole("button", { name: "Import 7 trades" }).click();
  const again = page.getByRole("status").filter({ hasText: "Import finished" });
  await expect(again.locator("li").nth(0)).toContainText("0");
  await expect(again.locator("li").nth(1)).toContainText("7");
  await expect(again).toContainText("1 unmatched close left out");

  // Undoing the first import removes its eight trades; the second import created none.
  const history = page.locator("section[aria-label='Import history']");
  await expect(history).toContainText("8 inserted");
  const batch = history.getByRole("listitem").filter({ hasText: "8 inserted" });
  await expect(batch).toContainText("8 still in the journal");
  await shot("33-import-history");
  await batch.getByRole("button", { name: "Undo import" }).click();
  await expect(history.getByRole("listitem").filter({ hasText: "8 inserted" })).toHaveCount(0);
  await page.goto(`/trades?symbol=${tosSymbol}`);
  await expect(page.getByText("No trades match these filters.")).toBeVisible();
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
    ["34-mobile-import", "/import"],
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

  // The close sheet at phone width: opened from a card, nothing overflows, and it closes the trade.
  await page.goto("/trades/new");
  await page.fill("#symbol", mobileSymbol);
  await page.selectOption("#assetClass", "STOCK"); // the form prefills the last trade's asset class, which may be an option
  await page.fill("#quantity", "10");
  await page.fill("#entryPrice", "20");
  await page.fill("#entryAt", `${closeDate}T12:00`);
  await page.getByRole("button", { name: "Save trade" }).click();
  await page.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await page.goto(`/trades?symbol=${mobileSymbol}`);
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: `Close ${mobileSymbol}` });
  await expect(sheet).toBeVisible();
  const sheetWidths = await page.evaluate(() => ({
    scroll: document.scrollingElement?.scrollWidth ?? 0,
    client: document.scrollingElement?.clientWidth ?? 0,
  }));
  expect(sheetWidths.scroll, "close sheet overflows horizontally").toBeLessThanOrEqual(sheetWidths.client);
  await shot("30-mobile-close-sheet");
  await sheet.locator("#close-exitPrice").fill("21");
  await sheet.getByRole("button", { name: "Close trade" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /\$10\.00/ }).first()).toBeVisible();
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
  await expect(page.locator("section[aria-label='Open positions']")).toContainText("No open positions.");
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
    await stale.first().getByRole("button", { name: "Delete", exact: true }).click();
    await page.waitForTimeout(500);
  }
  await page.selectOption("#new-kind", "STOP_REQUIRED");
  await page.fill("#new-title", `Stop required ${stamp}`);
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Rule added.")).toBeVisible();

  await page.goto("/trades/new");
  await expect(page.locator("section[aria-label='Plan budget']")).toBeVisible();
  await page.fill("#symbol", `${manualSymbol}X`);
  await page.selectOption("#assetClass", "STOCK");
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
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("installable app assets and two-tap capture", async () => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const json = (await manifest.json()) as { share_target?: { action: string }; shortcuts?: unknown[] };
  expect(json.share_target?.action).toBe("/share-target");
  expect(json.shortcuts).toHaveLength(3);
  expect((await page.request.get("/sw.js")).status()).toBe(200);
  expect((await page.request.get("/sw-policy.js")).status()).toBe(200); // imported by the worker, so it must be public too
  expect((await page.request.get("/icons/maskable-512.png")).status()).toBe(200);
  expect((await page.request.get("/offline")).status()).toBe(200); // reachable without a session
  const shareAnon = await page.request.post("/share-target", { multipart: { text: "hello" }, maxRedirects: 0 });
  expect([303, 307]).toContain(shareAnon.status()); // the proxy bounces it before the route does
  expect(shareAnon.headers()["location"]).toContain("/login");
  // The share target accepts a post without an Origin (the installed app's share sheet) but never a foreign one.
  const cookie = await sessionCookieHeader();
  const shareForeign = await page.request.post("/share-target", { multipart: { text: "hello" }, headers: { cookie, origin: FOREIGN_ORIGIN }, maxRedirects: 0 });
  expect(shareForeign.status()).toBe(403);
  const shareOwn = await page.request.post("/share-target", { multipart: { text: `shared ${stamp}` }, headers: { cookie }, maxRedirects: 0 });
  expect(shareOwn.status()).toBe(303);
  expect(shareOwn.headers()["location"]).toContain(`/trades/new?note=shared+${stamp}`);

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

test("state-changing API routes refuse foreign and missing origins", async () => {
  const cookie = await sessionCookieHeader();
  const own = new URL(page.url()).origin;
  const preset = { name: `Origin ${stamp}`, mapping: { symbol: "Symbol" }, options: {} };

  // A signed-in request from a sibling subdomain, or one with no Origin at all, is refused before anything else.
  const foreign = await page.request.post("/api/import/presets", { data: preset, headers: { cookie, origin: FOREIGN_ORIGIN } });
  expect(foreign.status()).toBe(403);
  expect(((await foreign.json()) as { error: string }).error).toContain("Cross-origin");
  const missing = await page.request.post("/api/import/presets", { data: preset, headers: { cookie } });
  expect(missing.status()).toBe(403);
  expect((await page.request.post("/api/import", { data: {}, headers: { cookie, origin: FOREIGN_ORIGIN } })).status()).toBe(403);
  expect((await page.request.post("/api/trades/none/attachments", { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } }, headers: { cookie, origin: FOREIGN_ORIGIN } })).status()).toBe(403);
  // The Referer stands in for a missing Origin, and only the app's own origin passes.
  expect((await page.request.post("/api/import/presets", { data: preset, headers: { cookie, referer: `${FOREIGN_ORIGIN}/import` } })).status()).toBe(403);
  const created = await page.request.post("/api/import/presets", { data: preset, headers: { cookie, origin: own } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await page.request.delete(`/api/import/presets/${id}`, { headers: { cookie, origin: FOREIGN_ORIGIN } })).status()).toBe(403);
  expect((await page.request.delete(`/api/import/presets/${id}`, { headers: { cookie, referer: `${own}/import` } })).status()).toBe(204);
  // Without a session the same-origin request is merely unauthorised: the origin check comes first, the session second.
  expect((await page.request.post("/api/import/presets", { data: preset, headers: { origin: own } })).status()).toBe(401);
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
    await leftover.getByRole("button", { name: "Delete", exact: true }).click();
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

  // They log a trade; the admin wipes their trades after typing the username, and the journal is empty again.
  await them.goto("/trades/new");
  await them.fill("#symbol", `USR${stamp}`);
  await them.fill("#quantity", "5");
  await them.fill("#entryPrice", "10");
  await them.fill("#entryAt", `${closeDate}T13:00`);
  await them.getByRole("button", { name: "Save trade" }).click();
  await them.waitForURL(/\/trades\/(?!new$)[a-z0-9]+$/);
  await page.reload();
  await expect(card).toContainText("Trades");
  await card.getByRole("button", { name: "Delete all trades (1)" }).click();
  await card.getByLabel(/^Type .* to delete/).fill(newUser);
  await card.getByRole("button", { name: "Delete all trades", exact: true }).click();
  await expect(card.getByRole("status")).toContainText(`1 trade of @${newUser} removed`);
  await them.goto("/trades");
  await expect(them.getByText("No trades yet")).toBeVisible();

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
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("listitem", { name: `@${newUser}` })).toHaveCount(0);
  await expect(page.getByRole("listitem", { name: `@${username}` })).toBeVisible();
});

test("delete this run's trades through the UI", async () => {
  for (const symbol of [`${manualSymbol}X`, closeSymbol, optionSymbol, mobileSymbol, manualSymbol, csvSymbol]) {
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

test("logging out blocks protected pages and APIs, and kills a copied cookie", async ({ browser }) => {
  await page.goto("/settings");
  // A copy of the cookie taken before logging out, as a shared device or a thief would have it.
  const copied = (await page.context().cookies()).find((c) => c.name.endsWith("darkpools_session"))!;
  expect(copied).toBeTruthy();
  const copiedHeader = `${copied.name}=${copied.value}`;
  expect((await page.request.get("/api/export/trades", { headers: { cookie: copiedHeader } })).status()).toBe(200);

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

  // The copied cookie is dead as well: logging out moved the account's session version on.
  expect((await page.request.get("/api/export/trades", { headers: { cookie: copiedHeader } })).status()).toBe(401);
  const thief = await browser.newContext();
  await thief.addCookies([{ name: copied.name, value: copied.value, domain: copied.domain, path: copied.path, httpOnly: copied.httpOnly, secure: copied.secure, sameSite: copied.sameSite }]);
  const stolen = await thief.newPage();
  await stolen.goto("/trades");
  await stolen.waitForURL(/\/login/);
  await expect(stolen.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await thief.close();
  await shot("12-login-after-logout");
});
