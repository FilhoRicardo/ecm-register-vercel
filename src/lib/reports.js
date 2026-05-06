import ExcelJS from "exceljs/dist/exceljs.min.js";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
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

export async function downloadWordRegister(db, property) {
  const ecms = getEcms(db, property?.id || null);
  const rows = [
    tableRow(["Ref", "ECM", "Status", "Utility", "Saving EUR/a"], true),
    ...ecms.map((ecm) => tableRow([ecm.ref, ecm.title, ecm.status, ecm.utility_type, `EUR ${money(ecm.annual_saving_eur)}`]))
  ];

  const children = [
    heading(`${property?.name || "All Properties"} ECM Register`),
    para(`Generated ${new Date().toLocaleString()}`),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
    ...ecms.flatMap((ecm) => [
      heading(`${ecm.ref} - ${ecm.title}`, 2),
      para(`Status: ${ecm.status}`),
      para(`Utility: ${ecm.utility_type}`),
      para(`Energy saving: ${kwh(ecm.energy_saving_kwh)} kWh/a`),
      para(`Annual saving: EUR ${money(ecm.annual_saving_eur)}/a`),
      para(`What & why: ${ecm.what_why || "Not stated."}`),
      para(`Pitfall: ${ecm.pitfall || "Not stated in source."}`),
      para(`Action: ${ecm.action || "Not stated."}`)
    ])
  ];

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${slug(property?.name || "All_Properties")}_ECM_Register.docx`);
}

export function downloadPdfRegister(db, property) {
  if (!property) return;

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

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const page = {
    width: doc.internal.pageSize.getWidth(),
    height: doc.internal.pageSize.getHeight(),
    left: 56,
    right: 56,
    top: 72,
    bottom: 62
  };
  let y = page.top;

  const canvas = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(82, 98, 88);
    doc.text("Savills sustainability", 51, 38);
    doc.text(`Page ${doc.internal.getNumberOfPages()}`, page.width - 51, page.height - 34, { align: "right" });
  };

  const addPage = () => {
    doc.addPage();
    y = page.top;
    canvas();
  };

  canvas();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.setTextColor(24, 74, 44);
  doc.text("Energy Conservation Measure Register", page.width / 2, 300, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(75, 90, 80);
  doc.text(cleanPdfText(property.name), page.width / 2, 324, { align: "center" });
  doc.text(cleanPdfText(property.address || ""), page.width / 2, 343, { align: "center" });

  addPage();
  pdfHeading(doc, "Building Summary", page.left, y);
  y += 22;
  y = pdfKeyValueTable(doc, page, y, [
    ["Name", property.name],
    ["Address", property.address],
    ["Total floor area", `${kwh(property.total_floor_area)} m2`],
    ["Electricity cost", `EUR ${Number(property.elec_cost_eur_per_kwh || 0).toFixed(4)}/kWh`],
    ["Heating cost", `EUR ${Number(property.heating_cost_eur_per_kwh || 0).toFixed(4)}/kWh`],
    ["Cooling cost", `EUR ${Number(property.cooling_cost_eur_per_kwh || 0).toFixed(4)}/kWh`],
    ["Registered tenant areas", tenants.length],
    ["Registered equipment", equipment.length],
    ["Registered ECMs", ecms.length],
    ["Total ECM energy saving", `${kwh(totals.energySaving)} kWh/a`],
    ["Total ECM annual saving", `EUR ${money(totals.annualSaving)}`],
    ["Total ECM investment", `EUR ${money(totals.investment)}`],
    ["Measured implemented energy saving", `${kwh(totals.measuredEnergy)} kWh`],
    ["Measured implemented cost saving", `EUR ${money(totals.measuredCost)}`]
  ], addPage);

  y += 14;
  pdfHeading(doc, "ECM Summary", page.left, y);
  y += 20;
  y = pdfTable(doc, page, y, ["Ref", "ECM", "Status", "Utility", "Energy saving", "Annual saving"], ecms.map((ecm) => [
    ecm.ref,
    ecm.title,
    ecm.status,
    ecm.utility_type,
    `${kwh(ecm.energy_saving_kwh)} kWh`,
    `EUR ${money(ecm.annual_saving_eur)}`
  ]), [88, 162, 64, 62, 78, 78], addPage);

  if (savings.length) {
    y += 14;
    pdfHeading(doc, "Implemented Savings Recorded", page.left, y);
    y += 20;
    y = pdfTable(doc, page, y, ["Ref", "ECM", "Utility", "Start", "End", "Measured kWh", "Measured EUR"], savings.map((saving) => [
      saving.ref,
      saving.ecm_title,
      saving.utility_type,
      saving.start_date,
      saving.end_date,
      `${kwh(saving.energy_saving_kwh)} kWh`,
      `EUR ${money(saving.cost_saving_eur)}`
    ]), [78, 125, 58, 70, 70, 70, 62], addPage);
  }

  ecms.forEach((ecm, index) => {
    addPage();
    pdfHeading(doc, `ECM ${index + 1} of ${ecms.length}`, page.left, y);
    y += 22;
    pdfHeading(doc, `${ecm.ref} - ${ecm.title}`, page.left, y, 11);
    y += 24;
    y = pdfKeyValueTable(doc, page, y, [
      ["Status", ecm.status],
      ["Approved", ecm.approved ? "Yes" : "No"],
      ["Utility impacted", ecm.utility_type],
      ["Investment", `EUR ${money(ecm.investment_eur || 0)}`],
      ["Energy saving", `${kwh(ecm.energy_saving_kwh)} kWh/a`],
      ["Annual saving", `EUR ${money(ecm.annual_saving_eur)}`],
      ["Simple payback", simplePayback(ecm) ? `${simplePayback(ecm).toFixed(1)} years` : "-"]
    ], addPage);
    y += 10;

    for (const [label, value] of [["What & why", ecm.what_why], ["Pitfall", ecm.pitfall], ["Action", ecm.action]]) {
      if (!String(value || "").trim()) continue;
      if (y + 60 > page.height - page.bottom) addPage();
      pdfHeading(doc, label, page.left, y, 11);
      y += 17;
      y = pdfParagraph(doc, page, y, value, addPage);
      y += 8;
    }

    const ecmSavings = savings.filter((saving) => Number(saving.ecm_id) === Number(ecm.id));
    if (ecmSavings.length) {
      if (y + 90 > page.height - page.bottom) addPage();
      pdfHeading(doc, "Measured implemented savings", page.left, y, 11);
      y += 18;
      y = pdfTable(doc, page, y, ["Start", "End", "Measured kWh", "Unit cost", "Measured EUR", "Notes"], ecmSavings.map((saving) => [
        saving.start_date,
        saving.end_date,
        `${kwh(saving.energy_saving_kwh)} kWh`,
        `EUR ${Number(saving.unit_cost_eur_per_kwh || 0).toFixed(4)}/kWh`,
        `EUR ${money(saving.cost_saving_eur)}`,
        saving.notes || ""
      ]), [68, 68, 76, 72, 76, 170], addPage);
    }
  });

  doc.save(`${slug(property.name)}_ECM_Register.pdf`);
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

function pdfHeading(doc, text, x, y, size = 14) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  doc.setTextColor(24, 74, 44);
  doc.text(cleanPdfText(text), x, y);
}

function pdfParagraph(doc, page, y, value, addPage) {
  const text = cleanPdfText(value || "-");
  const availableWidth = page.width - page.left - page.right;
  const lines = doc.splitTextToSize(text, availableWidth);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(31, 42, 36);
  for (const line of lines) {
    if (y + 12 > page.height - page.bottom) {
      addPage();
      y = page.top;
    }
    doc.text(line, page.left, y);
    y += 11;
  }
  return y + 4;
}

function pdfKeyValueTable(doc, page, y, rows, addPage) {
  const labelWidth = 170;
  const valueWidth = page.width - page.left - page.right - labelWidth;
  for (const [label, value] of rows) {
    const labelLines = doc.splitTextToSize(cleanPdfText(label), labelWidth - 14);
    const valueLines = doc.splitTextToSize(cleanPdfText(value || "-"), valueWidth - 14);
    const height = Math.max(labelLines.length, valueLines.length) * 11 + 10;
    if (y + height > page.height - page.bottom) {
      addPage();
      y = page.top;
    }
    doc.setDrawColor(220, 226, 222);
    doc.setFillColor(247, 249, 247);
    doc.rect(page.left, y, labelWidth, height, "FD");
    doc.rect(page.left + labelWidth, y, valueWidth, height, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(24, 74, 44);
    doc.text(labelLines, page.left + 7, y + 14);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(31, 42, 36);
    doc.text(valueLines, page.left + labelWidth + 7, y + 14);
    y += height;
  }
  return y;
}

function pdfTable(doc, page, y, headers, rows, widths, addPage) {
  const headerHeight = 22;
  const drawHeader = () => {
    doc.setFillColor(24, 74, 44);
    doc.setDrawColor(24, 74, 44);
    let x = page.left;
    headers.forEach((header, index) => {
      doc.rect(x, y, widths[index], headerHeight, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text(doc.splitTextToSize(cleanPdfText(header), widths[index] - 8), x + 4, y + 13);
      x += widths[index];
    });
    y += headerHeight;
  };
  if (y + headerHeight > page.height - page.bottom) {
    addPage();
    y = page.top;
  }
  drawHeader();

  for (const row of rows.length ? rows : [headers.map(() => "")]) {
    const cellLines = row.map((value, index) => doc.splitTextToSize(cleanPdfText(value || "-"), widths[index] - 8));
    const height = Math.max(...cellLines.map((lines) => lines.length)) * 8.2 + 10;
    if (y + height > page.height - page.bottom) {
      addPage();
      y = page.top;
      drawHeader();
    }
    let x = page.left;
    cellLines.forEach((lines, index) => {
      doc.setDrawColor(220, 226, 222);
      doc.rect(x, y, widths[index], height, "S");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(31, 42, 36);
      doc.text(lines, x + 4, y + 12);
      x += widths[index];
    });
    y += height;
  }
  return y;
}

function heading(text, level = 1) {
  return new Paragraph({
    spacing: { after: level === 1 ? 260 : 160, before: level === 1 ? 0 : 260 },
    children: [new TextRun({ text, bold: true, size: level === 1 ? 34 : 26 })]
  });
}

function para(text) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun(String(text || ""))] });
}

function tableRow(values, header = false) {
  return new TableRow({
    children: values.map((value) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: String(value ?? ""), bold: header })] })]
    }))
  });
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

function cleanPdfText(value) {
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
