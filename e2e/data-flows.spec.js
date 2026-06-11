import { expect, test } from "@playwright/test";
import { activateSampleMode, collectConsoleErrors, expectNoUnexpectedConsoleErrors, openNav } from "./helpers.js";

test("sample monthly usage feeds CRREM and property edits reach Dashboard", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await activateSampleMode(page);

  await openNav(page, "Monthly Usage");
  const usageForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save Landlord Usage" }) });
  await usageForm.locator("input[type='month']").fill("2026-01");
  await usageForm.locator("input[type='number']").nth(0).fill("31111");
  await usageForm.locator("input[type='number']").nth(1).fill("12222");
  await usageForm.locator("input[type='number']").nth(2).fill("933");
  await usageForm.locator("textarea").fill("E2E added landlord row");
  await usageForm.getByRole("button", { name: "Save Landlord Usage" }).click();

  const addedRow = page.locator("tbody tr", { hasText: "2026-01" });
  await expect(addedRow).toContainText("Landlord");
  await expect(addedRow).toContainText("31,111 kWh");
  await expect(addedRow).toContainText("12,222 kWh");

  await openNav(page, "CRREM Plot");
  await expect(page.getByText("Baseline EUI")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Carbon intensity pathway" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Energy intensity pathway" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CRREM input needed" })).toHaveCount(0);

  await openNav(page, "Properties");
  await page.getByRole("cell", { name: /Sample Tower/ }).click();
  const propertyForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save Property" }) });
  await propertyForm.locator("input").first().fill("Sample Tower Renamed");
  await propertyForm.getByRole("button", { name: "Save Property" }).click();

  await openNav(page, "Dashboard");
  await expect(page.getByText("Sample Tower Renamed")).toBeVisible();
  await expect(page.getByText("Sample Tower", { exact: true })).toHaveCount(0);

  expectNoUnexpectedConsoleErrors(consoleErrors);
});
