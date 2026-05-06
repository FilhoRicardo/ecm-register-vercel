import ExcelJS from "exceljs/dist/exceljs.min.js";
import pptxgen from "pptxgenjs";
import reportTemplateCoverUrl from "../assets/report-template-cover.jpeg";
import reportTemplatePageUrl from "../assets/report-template-page.jpeg";
import savillsLogoUrl from "../assets/savills-logo.svg";
import { downloadBlob } from "./storage.js";
import { kwh, money, slug } from "./format.js";
import { getEcms, getEquipment, getImplementedSavings, getProperties, getTenants } from "./sqlite.js";

export const ECM_REVIEW_HEADERS = [
  "ecm_id",
  "property_id",
  "property_name",
  "ref",
  "title",
  "status",
  "approved",
  "utility_type",
  "investment_eur",
  "energy_saving_kwh",
  "annual_saving_eur",
  "simple_payback_years",
  "what_why",
  "pitfall",
  "action",
  "notes",
  "review_decision",
  "reviewer_comments"
];

const EXCEL_REGISTER_HEADERS = [
  "calculation file reference",
  "Property Name",
  "Property street address",
  "Property Code",
  "Property Typ CRREM",
  "Floor area IPMS II:",
  "Energy consumption before data analysis of EMS \n\nYear 0\n\n[kwh/a]",
  "Energy consumption\n\nYear 1\n\n[kwh/a]",
  "Energy consumption\n\nYear 2\n\n[kwh/a]",
  "Energy consumption before data analysis of EMS \n\nYear 3\n\n[kwh/a]",
  "Project Name",
  "Measure description",
  "Classification of measures",
  "Status of implementation",
  "Investment costs €",
  "Cost savings [€/a]",
  "Energy saving\n[kWh/a]",
  "Justification of the recommendation",
  "Comments",
  "Status",
  "Increasing value",
  "Implementation in the budget year",
  "Fund fee 1%",
  "Expected Completion Date\n\ndd-mm-yyyy",
  "Expected lifetime (20XX)",
  "Savills only comments"
];

const STATUS_OPTIONS = ["Open", "Approved", "In Progress", "Implemented", "Rejected", "On Hold"];
const UTILITY_OPTIONS = ["electricity", "heating", "cooling"];
const REVIEW_DECISIONS = ["Keep", "Update", "Reject", "Implemented", "Needs discussion"];
const PPT_W = 7.5;
const PPT_H = 10.83;
const PPT_DARK = "184A2C";
const PPT_MUTED = "5E755E";
const PPT_LIGHT = "EFF6F0";
const PPT_BORDER = "BACBBE";
const PPT_RED = "CE181E";
let reportTemplateAssets = null;

export async function downloadExcelRegister(db, property = null) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ECM Register";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("ECM Register", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  worksheet.addRow(EXCEL_REGISTER_HEADERS);

  const propertyId = property?.id || null;
  const properties = getProperties(db);
  const propertyLookup = Object.fromEntries(properties.map((item) => [Number(item.id), item]));
  const ecms = getEcms(db, propertyId);

  for (const ecm of ecms) {
    const prop = propertyLookup[Number(ecm.property_id)];
    if (!prop) continue;
    worksheet.addRow([
      ecm.ref || "",
      propertyLabelForExport(prop),
      prop.address || "",
      propertyCodeFromNotes(prop.notes),
      "",
      numberOrNull(prop.total_floor_area),
      "-",
      "-",
      "-",
      "-",
      prop.name || "",
      ecm.title || "",
      ecm.utility_type || "",
      ecm.status || "",
      numberOrNull(ecm.investment_eur),
      numberOrNull(ecm.annual_saving_eur),
      numberOrNull(ecm.energy_saving_kwh),
      ecm.what_why || "",
      excelCommentText(ecm),
      "",
      "",
      "",
      "",
      "",
      "",
      ecm.notes || ""
    ]);
  }

  styleExcelRegister(worksheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = property ? `${slug(property.name)}_ECM_Register.xlsx` : "All_Properties_ECM_Register.xlsx";
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

export async function downloadEcmReviewWorkbook(db, property = null) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ECM Register";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("ECM Review", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  worksheet.addRow(ECM_REVIEW_HEADERS);

  for (const ecm of getEcms(db, property?.id || null)) {
    worksheet.addRow([
      Number(ecm.id),
      Number(ecm.property_id),
      ecm.property_name || "",
      ecm.ref || "",
      ecm.title || "",
      ecm.status || "",
      ecm.approved ? "Yes" : "No",
      ecm.utility_type || "",
      numberOrNull(ecm.investment_eur),
      numberOrNull(ecm.energy_saving_kwh),
      numberOrNull(ecm.annual_saving_eur),
      simplePayback(ecm),
      ecm.what_why || "",
      ecm.pitfall || "",
      ecm.action || "",
      ecm.notes || "",
      "",
      ""
    ]);
  }

  styleReviewWorkbook(worksheet);
  addReviewInstructions(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = property ? `${slug(property.name)}_ECM_Review_Workbook.xlsx` : "All_Properties_ECM_Review_Workbook.xlsx";
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

export async function parseEcmReviewWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.getWorksheet("ECM Review") || workbook.worksheets[0];
  if (!worksheet) throw new Error("No worksheet found in uploaded ECM review workbook.");

  const headers = worksheet.getRow(1).values
    .slice(1)
    .map((value) => String(normalCellValue(value) || "").trim());
  const missing = ["ecm_id", "property_id", "ref", "title"].filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`This workbook is missing required headers: ${missing.join(", ")}`);

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const item = {};
    headers.forEach((header, index) => {
      item[header] = normalCellValue(row.getCell(index + 1).value);
    });
    if (item.ecm_id) rows.push(item);
  }
  return rows;
}

export async function downloadPptxRegister(db, property) {
  if (!property) return;
  const assets = await getReportTemplateAssets();
  const ecms = getEcms(db, property.id);
  const tenants = getTenants(db).filter((row) => row.property_id === property.id);
  const equipment = getEquipment(db).filter((row) => row.property_id === property.id);
  const savings = getImplementedSavings(db, property.id);
  const totals = {
    annualSaving: sum(ecms, "annual_saving_eur"),
    energySaving: sum(ecms, "energy_saving_kwh"),
    investment: sum(ecms, "investment_eur"),
    measuredEnergy: sum(savings, "energy_saving_kwh"),
    measuredCost: sum(savings, "cost_saving_eur")
  };

  const pptx = new pptxgen();
  pptx.defineLayout({ name: "SAVILLS_A4_PORTRAIT", width: PPT_W, height: PPT_H });
  pptx.layout = "SAVILLS_A4_PORTRAIT";
  pptx.author = "ECM Register";
  pptx.company = "Savills";
  pptx.subject = "Energy Conservation Measure Register";
  pptx.title = `${property.name} ECM Register`;
  pptx.lang = "en-GB";
  pptx.theme = {
    headFontFace: "Arial",
    bodyFontFace: "Arial",
    lang: "en-GB"
  };

  let pageNo = 1;
  addCoverSlide(pptx, assets, property);
  pageNo += 1;
  addBuildingSummaryPptSlide(pptx, assets, pageNo, property, tenants, equipment, ecms, totals);
  pageNo += 1;

  for (const chunk of chunks(ecms, 12)) {
    addEcmSummaryPptSlide(pptx, assets, pageNo, property, chunk, ecms.length);
    pageNo += 1;
  }

  ecms.forEach((ecm, index) => {
    addEcmDetailPptSlide(pptx, assets, pageNo, ecm, savings.filter((saving) => Number(saving.ecm_id) === Number(ecm.id)), index + 1, ecms.length);
    pageNo += 1;
  });

  addContactSlide(pptx, assets, pageNo);
  const blob = await pptx.write({ outputType: "blob" });
  downloadBlob(blob, `${slug(property.name)}_ECM_Register.pptx`);
}

function addCoverSlide(pptx, assets, property) {
  const slide = pptx.addSlide();
  slide.addImage({ data: assets.cover, x: 0, y: 0, w: PPT_W, h: PPT_H });
  addLogo(slide, assets.logo, 6.42, 9.78, 0.7, 0.7);
  const now = new Date();
  slide.addText(now.toLocaleDateString("en-GB", { day: "numeric", month: "long" }), {
    x: 0.88, y: 1.26, w: 1.55, h: 0.18, fontFace: "Arial", fontSize: 7, color: PPT_DARK, bold: true
  });
  slide.addText(String(now.getFullYear()), {
    x: 0.88, y: 1.53, w: 1.55, h: 0.18, fontFace: "Arial", fontSize: 7, color: PPT_DARK, bold: true
  });
  slide.addText("Energy Conservation Measure Register", {
    x: 0.88, y: 3.78, w: 5.25, h: 0.75, fontFace: "Arial", fontSize: 23, color: PPT_DARK, bold: true,
    fit: "shrink"
  });
  slide.addText(cleanReportText(property.name), {
    x: 0.88, y: 4.52, w: 5.2, h: 0.35, fontFace: "Arial", fontSize: 12, color: PPT_MUTED, bold: true,
    fit: "shrink"
  });
  slide.addText(cleanReportText(property.address || ""), {
    x: 0.88, y: 4.9, w: 5.2, h: 0.28, fontFace: "Arial", fontSize: 9, color: PPT_MUTED,
    fit: "shrink"
  });
  slide.addText("PREPARED FOR", {
    x: 0.88, y: 5.48, w: 1.8, h: 0.16, fontFace: "Arial", fontSize: 6.5, color: PPT_DARK, bold: true,
    charSpace: 0.7
  });
  slide.addText("Union Energy Monitoring", {
    x: 0.88, y: 5.82, w: 2.7, h: 0.24, fontFace: "Arial", fontSize: 10, color: PPT_DARK, bold: true
  });
}

function addBuildingSummaryPptSlide(pptx, assets, pageNo, property, tenants, equipment, ecms, totals) {
  const slide = addContentSlide(pptx, assets, pageNo, "Building Summary");
  addMetricRow(slide, 1.62, [
    ["ECMs", ecms.length],
    ["Open", ecms.filter((ecm) => ecm.status === "Open").length],
    ["Implemented", ecms.filter((ecm) => ecm.status === "Implemented").length],
    ["Annual saving", `EUR ${money(totals.annualSaving)}`]
  ]);
  addKeyValuePptTable(slide, 0.42, 2.55, 6.28, [
    ["Name", property.name],
    ["Address", property.address],
    ["Total floor area", `${kwh(property.total_floor_area)} m2`],
    ["Electricity cost", `EUR ${Number(property.elec_cost_eur_per_kwh || 0).toFixed(4)}/kWh`],
    ["Heating cost", `EUR ${Number(property.heating_cost_eur_per_kwh || 0).toFixed(4)}/kWh`],
    ["Cooling cost", `EUR ${Number(property.cooling_cost_eur_per_kwh || 0).toFixed(4)}/kWh`],
    ["Registered tenant areas", tenants.length],
    ["Registered equipment", equipment.length],
    ["Total ECM energy saving", `${kwh(totals.energySaving)} kWh/a`],
    ["Total ECM investment", `EUR ${money(totals.investment)}`],
    ["Measured implemented energy saving", `${kwh(totals.measuredEnergy)} kWh`],
    ["Measured implemented cost saving", `EUR ${money(totals.measuredCost)}`]
  ]);
}

function addEcmSummaryPptSlide(pptx, assets, pageNo, property, ecms, totalCount) {
  const slide = addContentSlide(pptx, assets, pageNo, `ECM Summary - ${property.name}`);
  slide.addText(`${ecms.length} of ${totalCount} ECMs shown on this slide`, {
    x: 0.42, y: 1.42, w: 4.7, h: 0.18, fontFace: "Arial", fontSize: 7.5, color: PPT_MUTED
  });
  addPptTable(slide, 0.42, 1.78, 6.55, [
    ["Ref", "ECM", "Status", "Utility", "Saving"],
    ...ecms.map((ecm) => [
      ecm.ref,
      truncate(ecm.title, 82),
      ecm.status,
      ecm.utility_type,
      `EUR ${money(ecm.annual_saving_eur)}`
    ])
  ], [1.1, 2.7, 0.9, 0.85, 1.0], 0.34, 7);
}

function addEcmDetailPptSlide(pptx, assets, pageNo, ecm, ecmSavings, index, totalCount) {
  const slide = addContentSlide(pptx, assets, pageNo, `ECM ${index} of ${totalCount}`);
  slide.addText(cleanReportText(`${ecm.ref} - ${ecm.title}`), {
    x: 0.42, y: 1.35, w: 6.45, h: 0.42, fontFace: "Arial", fontSize: 10, color: PPT_DARK, bold: true,
    fit: "shrink"
  });
  addKeyValuePptTable(slide, 0.42, 1.95, 6.45, [
    ["Status", ecm.status],
    ["Approved", ecm.approved ? "Yes" : "No"],
    ["Utility impacted", ecm.utility_type],
    ["Investment", `EUR ${money(ecm.investment_eur || 0)}`],
    ["Energy saving", `${kwh(ecm.energy_saving_kwh)} kWh/a`],
    ["Annual saving", `EUR ${money(ecm.annual_saving_eur)}`],
    ["Simple payback", simplePayback(ecm) ? `${simplePayback(ecm).toFixed(1)} years` : "-"]
  ], 0.24, 7.2);

  let y = 4.05;
  y = addTextSection(slide, "What & why", ecm.what_why, y, 0.82);
  y = addTextSection(slide, "Pitfall", ecm.pitfall, y, 0.58);
  y = addTextSection(slide, "Action", ecm.action, y, 0.7);

  if (ecmSavings.length) {
    slide.addText("Measured implemented savings", {
      x: 0.42, y, w: 4.5, h: 0.18, fontFace: "Arial", fontSize: 8.5, color: PPT_DARK, bold: true
    });
    y += 0.25;
    addPptTable(slide, 0.42, y, 6.45, [
      ["Start", "End", "kWh", "Unit cost", "EUR"],
      ...ecmSavings.slice(0, 4).map((saving) => [
        saving.start_date,
        saving.end_date,
        kwh(saving.energy_saving_kwh),
        `EUR ${Number(saving.unit_cost_eur_per_kwh || 0).toFixed(4)}/kWh`,
        `EUR ${money(saving.cost_saving_eur)}`
      ])
    ], [0.95, 0.95, 1.1, 1.55, 1.9], 0.28, 6.5);
    const notes = ecmSavings.map((saving) => saving.notes).filter(Boolean).join(" ");
    if (notes) addTextSection(slide, "Measured notes", notes, y + 1.42, 0.58, 120);
  }
}

function addContactSlide(pptx, assets, pageNo) {
  const slide = pptx.addSlide();
  slide.addImage({ data: assets.cover, x: 0, y: 0, w: PPT_W, h: PPT_H });
  addLogo(slide, assets.logo, 6.32, 0.7, 0.7, 0.7);
  addFooter(slide, pageNo);
  slide.addText("Contacts", {
    x: 0.4, y: 6.4, w: 4.98, h: 0.5, fontFace: "Arial", fontSize: 18, bold: true, color: PPT_DARK
  });
  slide.addText("Ricardo Filho\nAssociate Director\nRicardo.filho@savills.ie", {
    x: 0.4, y: 7.33, w: 2.45, h: 1.25, fontFace: "Arial", fontSize: 9, color: PPT_DARK,
    breakLine: false, fit: "shrink"
  });
}

function addContentSlide(pptx, assets, pageNo, title) {
  const slide = pptx.addSlide();
  slide.addImage({ data: assets.page, x: 0, y: 0, w: PPT_W, h: PPT_H });
  addLogo(slide, assets.logo, 6.32, 0.7, 0.7, 0.7);
  slide.addText(cleanReportText(title), {
    x: 0.4, y: 1.04, w: 6.4, h: 0.38, fontFace: "Arial", fontSize: 15, bold: true, color: PPT_DARK,
    fit: "shrink"
  });
  addFooter(slide, pageNo);
  return slide;
}

function addFooter(slide, pageNo) {
  slide.addText("Energy monitoring", {
    x: 0.4, y: 10.58, w: 2.2, h: 0.16, fontFace: "Arial", fontSize: 6.5, bold: true, color: PPT_DARK
  });
  slide.addText(String(pageNo), {
    x: 5.62, y: 10.39, w: 1.7, h: 0.12, fontFace: "Arial", fontSize: 5.5, color: PPT_DARK, align: "right"
  });
}

function addLogo(slide, logo, x, y, w, h) {
  if (logo) slide.addImage({ data: logo, x, y, w, h });
}

function addMetricRow(slide, y, metrics) {
  const gap = 0.12;
  const w = (6.45 - gap * (metrics.length - 1)) / metrics.length;
  metrics.forEach(([label, value], index) => {
    const x = 0.42 + index * (w + gap);
    slide.addShape("rect", {
      x, y, w, h: 0.62,
      fill: { color: "FFFFFF", transparency: 8 },
      line: { color: PPT_BORDER, pt: 0.6 }
    });
    slide.addText(cleanReportText(label), {
      x: x + 0.08, y: y + 0.09, w: w - 0.16, h: 0.13, fontFace: "Arial", fontSize: 5.8, color: PPT_MUTED, bold: true,
      fit: "shrink"
    });
    slide.addText(cleanReportText(value), {
      x: x + 0.08, y: y + 0.28, w: w - 0.16, h: 0.24, fontFace: "Arial", fontSize: 12.5, color: PPT_DARK, bold: true,
      fit: "shrink"
    });
  });
}

function addKeyValuePptTable(slide, x, y, w, rows, rowH = 0.27, fontSize = 7) {
  addPptTable(slide, x, y, w, rows.map(([label, value]) => [label, value]), [1.95, w - 1.95], rowH, fontSize, { firstColBold: true });
}

function addPptTable(slide, x, y, w, rows, colW, rowH = 0.3, fontSize = 7, options = {}) {
  const body = rows.map((row, rowIndex) => row.map((value, colIndex) => ({
    text: cleanReportText(value || "-"),
    options: {
      color: PPT_DARK,
      bold: rowIndex === 0 || (options.firstColBold && colIndex === 0),
      fill: { color: rowIndex === 0 || (options.firstColBold && colIndex === 0) ? PPT_LIGHT : "FFFFFF", transparency: 5 },
      valign: "mid",
      margin: 0.04
    }
  })));
  slide.addTable(body, {
    x, y, w,
    h: Math.max(rowH * rows.length, rowH),
    colW,
    fontFace: "Arial",
    fontSize,
    color: PPT_DARK,
    margin: 0.04,
    border: { type: "solid", color: PPT_BORDER, pt: 0.5 },
    valign: "mid"
  });
}

function addTextSection(slide, title, value, y, h, limit = 240) {
  slide.addText(title, {
    x: 0.42, y, w: 4.5, h: 0.18, fontFace: "Arial", fontSize: 8.5, color: PPT_DARK, bold: true
  });
  slide.addText(truncate(cleanReportText(value || "-"), limit), {
    x: 0.42, y: y + 0.23, w: 6.45, h, fontFace: "Arial", fontSize: 6.8, color: PPT_DARK,
    breakLine: false, fit: "shrink", valign: "top"
  });
  return y + h + 0.42;
}

function truncate(value, limit) {
  const text = cleanReportText(value);
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trim()}...` : text;
}

function chunks(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out.length ? out : [[]];
}

async function getReportTemplateAssets() {
  if (reportTemplateAssets) return reportTemplateAssets;
  const [cover, page, logo] = await Promise.all([
    assetDataUrl(reportTemplateCoverUrl),
    assetDataUrl(reportTemplatePageUrl),
    assetDataUrl(savillsLogoUrl)
  ]);
  reportTemplateAssets = { cover, page, logo };
  return reportTemplateAssets;
}

async function assetDataUrl(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function styleExcelRegister(worksheet) {
  const navy = "FF00286A";
  const lightBlue = "FFDDEBF7";
  const orange = "FFED7D31";
  const grey = "FFA5A5A5";
  const rowGrey = "FFF2F2F2";
  const headerFills = {
    ...rangeObject(2, 4, lightBlue),
    ...rangeObject(5, 6, orange),
    ...rangeObject(7, 10, navy),
    11: "FFD0CECE",
    ...rangeObject(12, 19, navy),
    ...rangeObject(20, 25, orange),
    26: grey
  };
  const border = excelBorder("FFD9D9D9");

  worksheet.getRow(1).height = 112.5;
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const fill = headerFills[colNumber];
    if (fill) cell.fill = solidFill(fill);
    cell.font = { name: "Arial", size: 8, bold: true, color: { argb: fill === navy ? "FFFFFFFF" : "FF000000" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  });

  const widths = [18, 26, 34, 13, 16, 14, 18, 16, 16, 18, 22, 36, 18, 18, 14, 16, 16, 60, 44, 14, 14, 18, 14, 18, 18, 42];
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const maxText = Math.max(...row.values.slice(1).map((value) => String(value || "").length), 1);
    row.height = Math.min(220, Math.max(45, maxText / 2.7));
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: "Arial", size: 8 };
      cell.alignment = { horizontal: "center", vertical: "top", wrapText: true };
      cell.border = border;
      if ([2, 3, 4, 5, 6].includes(colNumber)) cell.fill = solidFill(rowGrey);
    });
    worksheet.getCell(rowNumber, 6).numFmt = '#,##0 "m2"';
    worksheet.getCell(rowNumber, 15).numFmt = '#,##0 "EUR"';
    worksheet.getCell(rowNumber, 16).numFmt = '#,##0.00 "EUR"';
    worksheet.getCell(rowNumber, 17).numFmt = '#,##0 "kWh/a"';
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(worksheet.rowCount, 1), column: EXCEL_REGISTER_HEADERS.length }
  };
}

function styleReviewWorkbook(worksheet) {
  const border = excelBorder("FFD9E2F3");
  const headerFill = "FF1F4E78";
  const reviewFill = "FF70AD47";
  const readonlyFill = "FFE7E6E6";
  const widths = [10, 11, 26, 18, 42, 16, 11, 14, 14, 16, 16, 14, 62, 42, 42, 42, 18, 50];

  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  worksheet.getRow(1).height = 34;
  worksheet.getRow(1).eachCell((cell) => {
    const fill = ["review_decision", "reviewer_comments"].includes(cell.value) ? reviewFill : headerFill;
    cell.fill = solidFill(fill);
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  });

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = 60;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: "Arial", size: 9 };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = border;
      if ([1, 2, 3, 11, 12].includes(colNumber)) cell.fill = solidFill(readonlyFill);
    });
    worksheet.getCell(rowNumber, 9).numFmt = '#,##0 "EUR"';
    worksheet.getCell(rowNumber, 10).numFmt = '#,##0 "kWh/a"';
    worksheet.getCell(rowNumber, 11).numFmt = '#,##0.00 "EUR/a"';
    worksheet.getCell(rowNumber, 12).numFmt = '0.0 "years"';
  }

  const lastRow = Math.max(worksheet.rowCount, 2);
  addListValidation(worksheet, `F2:F${lastRow}`, STATUS_OPTIONS);
  addListValidation(worksheet, `G2:G${lastRow}`, ["Yes", "No"]);
  addListValidation(worksheet, `H2:H${lastRow}`, UTILITY_OPTIONS);
  addListValidation(worksheet, `Q2:Q${lastRow}`, REVIEW_DECISIONS);
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(worksheet.rowCount, 1), column: ECM_REVIEW_HEADERS.length }
  };
}

function addReviewInstructions(workbook) {
  const sheet = workbook.addWorksheet("Instructions");
  const rows = [
    ["Purpose", "Review ECMs outside the app and import this workbook back into the ECM Register."],
    ["Do not change", "Do not edit ecm_id, property_id, or property_name. These identify the existing records."],
    ["Safe to edit", "ref, title, status, approved, utility_type, investment_eur, energy_saving_kwh, what_why, pitfall, action, notes, review_decision, reviewer_comments."],
    ["Calculated fields", "annual_saving_eur and simple_payback_years are exported for review. They are recalculated by the app after import."],
    ["Return process", "Use the Import Reviewed ECM Workbook button in the Reports tab. Matching is done by ecm_id."]
  ];
  sheet.addRows(rows);
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 110;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = solidFill("FF1F4E78");
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  });
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    sheet.getCell(rowNumber, 1).font = { name: "Arial", size: 10, bold: true };
    sheet.getCell(rowNumber, 2).alignment = { wrapText: true, vertical: "top" };
  }
}

function propertyLabelForExport(prop) {
  const code = propertyCodeFromNotes(prop.notes);
  return code ? `${prop.name} (${code})` : prop.name;
}

function propertyCodeFromNotes(notes = "") {
  const match = String(notes || "").match(/property_code:\s*([^\n\r]+)/i);
  return match ? match[1].trim() : "";
}

function excelCommentText(ecm) {
  const parts = [];
  const pitfall = String(ecm.pitfall || "").trim();
  const action = String(ecm.action || "").trim();
  if (pitfall && pitfall !== "Not stated in source.") parts.push(`Pitfall: ${pitfall}`);
  if (action) parts.push(`Action: ${action}`);
  return parts.join("\n\n");
}

function simplePayback(ecm) {
  const annual = Number(ecm.annual_saving_eur || 0);
  const investment = Number(ecm.investment_eur || 0);
  if (!annual || !investment) return null;
  return investment / annual;
}

function addListValidation(worksheet, range, values) {
  worksheet.dataValidations.add(range, {
    type: "list",
    allowBlank: false,
    formulae: [`"${values.join(",")}"`]
  });
}

function rangeObject(start, end, value) {
  const out = {};
  for (let i = start; i <= end; i += 1) out[i] = value;
  return out;
}

function solidFill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function excelBorder(argb) {
  const side = { style: "thin", color: { argb } };
  return { top: side, left: side, bottom: side, right: side };
}

function normalCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return value;
  if ("result" in value) return normalCellValue(value.result);
  if ("text" in value) return value.text;
  if ("richText" in value) return value.richText.map((item) => item.text).join("");
  if ("hyperlink" in value && "text" in value) return value.text;
  return String(value);
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function cleanReportText(value) {
  return String(value ?? "")
    .replace(/[\u20ac]/g, "EUR")
    .replace(/[\u2192]/g, "->")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u00b2\u2082]/g, "2")
    .replace(/[\u00b0]/g, " deg ")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}
