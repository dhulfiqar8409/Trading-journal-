import { expect, test } from "@playwright/test";

/**
 * The production setup guard: a production server without a usable
 * SETUP_TOKEN must answer 503 on /setup and say what is missing, instead of
 * offering the form to whoever finds the fresh deployment first. Run it
 * against a production build started without SETUP_TOKEN on an empty
 * database; it is skipped unless E2E_SETUP_GUARD is set.
 */
test.skip(!process.env.E2E_SETUP_GUARD, "set E2E_SETUP_GUARD=1 against a production server that has no SETUP_TOKEN and no accounts");

test("/setup answers 503 and names the missing token", async ({ page, request }) => {
  const direct = await request.get("/setup");
  expect(direct.status()).toBe(503);
  expect(direct.headers()["cache-control"]).toContain("no-store");
  expect(await direct.text()).toContain("missing its setup token");
  // A token in the URL changes nothing: there is none to compare it with.
  expect((await request.get("/setup?token=anything")).status()).toBe(503);

  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Setup unavailable" })).toBeVisible();
  await expect(page.getByText("SETUP_TOKEN", { exact: true })).toBeVisible();
  await expect(page.locator("#username")).toHaveCount(0);

  // Without an account, sign-in still points at setup, which stays closed; the rest of the app stays locked.
  const login = await request.get("/login", { maxRedirects: 0 });
  expect([303, 307]).toContain(login.status());
  expect(login.headers()["location"]).toContain("/setup");
  const trades = await request.get("/trades", { maxRedirects: 0 });
  expect([303, 307]).toContain(trades.status());
  expect(trades.headers()["location"]).toContain("/login");
  expect((await request.get("/api/health")).status()).toBe(200);
});
