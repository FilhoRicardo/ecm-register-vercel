import { expect } from "@playwright/test";
import { CONSOLE_ERROR_ALLOWLIST } from "./console-allowlist.js";

export function collectConsoleErrors(page) {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  return consoleErrors;
}

export function expectNoUnexpectedConsoleErrors(consoleErrors) {
  const unexpectedErrors = consoleErrors.filter((error) => !CONSOLE_ERROR_ALLOWLIST.includes(error));
  expect(unexpectedErrors).toEqual([]);
}

export async function activateSampleMode(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample data" }).click();
  await expect(page.locator(".sample-banner")).toContainText("Sample data loaded");
}

export async function openNav(page, label) {
  await page.locator(".sidebar .nav").getByRole("button", { name: label }).click();
  await expect(page.locator(".sidebar .nav").getByRole("button", { name: label })).toHaveClass(/active/);
}
