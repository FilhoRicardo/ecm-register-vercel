import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoUnexpectedConsoleErrors, openNav } from "./helpers.js";

const gateHints = [
  [
    "Monthly Usage",
    "This tab needs the Property Notes, Tenant Notes and Monthly Usage folders."
  ],
  [
    "Reports",
    "This tab needs the Property Notes, ECM Notes, Implemented Savings Notes, Monthly Usage, Tenant Notes and Equipment Notes folders."
  ],
  [
    "Benchmark",
    "This tab needs the Property Notes and Monthly Usage folders."
  ]
];

test("gated tabs name their required folders", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/");

  for (const [tab, hint] of gateHints) {
    await openNav(page, tab);
    await expect(page.getByRole("heading", { name: "Setup Required" })).toBeVisible();
    await expect(page.getByText(hint)).toBeVisible();
  }

  expectNoUnexpectedConsoleErrors(consoleErrors);
});
