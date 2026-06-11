import { expect, test } from "@playwright/test";
import { CONSOLE_ERROR_ALLOWLIST } from "./console-allowlist.js";

test("sample workspace renders and every desktop nav tab opens", async ({ page }) => {
  const consoleErrors = new Set();
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.add(message.text());
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample data" }).click();

  await expect(page.locator(".sample-banner")).toContainText("Sample data loaded");
  await expect(page.locator(".dashboard-kpi-grid")).toBeVisible();
  await expect(page.locator(".dashboard-kpi-grid .kpi")).not.toHaveCount(0);

  const navButtons = page.locator(".sidebar .nav button");
  const navCount = await navButtons.count();
  expect(navCount).toBeGreaterThan(0);

  for (let index = 0; index < navCount; index += 1) {
    const button = navButtons.nth(index);
    const label = (await button.innerText()).trim();
    await button.click();
    await expect(button, label).toHaveClass(/active/);
    await expect(page.locator("main"), label).toBeVisible();

    const mainTextLength = await page.locator("main").evaluate((main) => main.innerText.trim().length);
    expect(mainTextLength, `${label} rendered non-empty content`).toBeGreaterThan(0);
  }

  const unexpectedErrors = [...consoleErrors].filter((error) => !CONSOLE_ERROR_ALLOWLIST.includes(error));
  expect(unexpectedErrors).toEqual([]);
});
