import { expect, test } from "@playwright/test";
import { activateSampleMode, collectConsoleErrors, expectNoUnexpectedConsoleErrors, openNav } from "./helpers.js";

test("sample mode resets to setup-gated state on refresh", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await activateSampleMode(page);
  await page.reload();

  await expect(page.locator(".sample-banner")).toHaveCount(0);
  await expect(page.getByText("Setup required").first()).toBeVisible();

  await openNav(page, "Dashboard");
  await expect(page.getByRole("heading", { name: "Setup Required" })).toBeVisible();
  await expect(page.getByText("This tab needs the Property Notes, Tenant Notes, Equipment Notes, ECM Notes, Implemented Savings Notes, Monthly Usage and Admin Tracker folders.")).toBeVisible();

  expectNoUnexpectedConsoleErrors(consoleErrors);
});

test("double-clicking sample mode is idempotent", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample data" }).dblclick();
  await expect(page.locator(".sample-banner")).toHaveCount(1);
  await expect(page.locator(".dashboard-kpi-grid .kpi").filter({ hasText: "Monthly usage records" }).locator(".value")).toHaveText("27");
  await expect(page.locator(".dashboard-admin-table tbody tr")).toHaveCount(2);

  expectNoUnexpectedConsoleErrors(consoleErrors);
});
