import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { stat } from "node:fs/promises";
import { activateSampleMode, collectConsoleErrors, expectNoUnexpectedConsoleErrors, openNav } from "./helpers.js";

test("sample reports export Excel and PPTX downloads", async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page);

  await activateSampleMode(page);
  await openNav(page, "Reports");

  const [excelDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Excel - Selected Property" }).click()
  ]);
  const excelPath = testInfo.outputPath(excelDownload.suggestedFilename());
  await excelDownload.saveAs(excelPath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const worksheet = workbook.getWorksheet("ECM Register");
  expect(worksheet).toBeTruthy();
  expect(worksheet.rowCount).toBeGreaterThan(1);

  const [pptxDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PPTX Report - Selected Property" }).click()
  ]);
  const pptxPath = testInfo.outputPath(pptxDownload.suggestedFilename());
  await pptxDownload.saveAs(pptxPath);
  const { size } = await stat(pptxPath);
  expect(size).toBeGreaterThan(10 * 1024);
  expect(pptxPath).toMatch(/\.pptx$/);

  expectNoUnexpectedConsoleErrors(consoleErrors);
});
