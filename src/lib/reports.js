import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { downloadBlob } from "./storage.js";
import { kwh, money, slug } from "./format.js";
import { getEcms, getEquipment, getImplementedSavings, getMonthlyUsage, getProperties, getTenants } from "./sqlite.js";

export function downloadExcelRegister(db, property = null) {
  const wb = XLSX.utils.book_new();
  const properties = property ? [property] : getProperties(db);
  const propertyId = property?.id || null;
  const ecms = getEcms(db, propertyId);
  const tenants = getTenants(db).filter((row) => !propertyId || row.property_id === propertyId);
  const equipment = getEquipment(db).filter((row) => !propertyId || row.property_id === propertyId);
  const usage = getMonthlyUsage(db, propertyId);
  const savings = getImplementedSavings(db, propertyId);

  addSheet(wb, "Properties", properties);
  addSheet(wb, "ECMs", ecms.map((row) => ({
    Property: row.property_name,
    Ref: row.ref,
    ECM: row.title,
    Status: row.status,
    Approved: row.approved ? "Yes" : "No",
    Utility: row.utility_type,
    "Investment EUR": row.investment_eur,
    "Energy Saving kWh/a": row.energy_saving_kwh,
    "Annual Saving EUR/a": row.annual_saving_eur,
    "What & why": row.what_why,
    Pitfall: row.pitfall,
    Action: row.action,
    Notes: row.notes
  })));
  addSheet(wb, "Tenants", tenants);
  addSheet(wb, "Equipment", equipment);
  addSheet(wb, "Monthly Usage", usage);
  addSheet(wb, "Implemented Savings", savings);

  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const filename = property ? `${slug(property.name)}_ECM_Register.xlsx` : "All_Properties_ECM_Register.xlsx";
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

export async function downloadWordRegister(db, property) {
  const ecms = getEcms(db, property?.id || null);
  const rows = [
    tableRow(["Ref", "ECM", "Status", "Utility", "Saving EUR/a"], true),
    ...ecms.map((ecm) => tableRow([ecm.ref, ecm.title, ecm.status, ecm.utility_type, money(ecm.annual_saving_eur)]))
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
  const ecms = getEcms(db, property?.id || null);
  const tenants = getTenants(db).filter((row) => !property?.id || row.property_id === property.id);
  const equipment = getEquipment(db).filter((row) => !property?.id || row.property_id === property.id);
  const savings = getImplementedSavings(db, property?.id || null);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const page = { width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight(), margin: 46 };
  let y = 54;

  const addPage = () => {
    doc.addPage();
    y = 54;
    footer();
  };
  const ensure = (height = 40) => {
    if (y + height > page.height - 54) addPage();
  };
  const text = (value, size = 10, bold = false, color = [31, 42, 36]) => {
    ensure(size * 2.4);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(value || "-"), page.width - page.margin * 2);
    doc.text(lines, page.margin, y);
    y += lines.length * (size + 4) + 5;
  };
  const rule = () => {
    ensure(18);
    doc.setDrawColor(24, 74, 44);
    doc.line(page.margin, y, page.width - page.margin, y);
    y += 18;
  };
  const kv = (label, value) => text(`${label}: ${value || "-"}`, 9, false);
  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 124, 113);
    doc.text("ECM Register", page.margin, page.height - 26);
    doc.text(String(doc.internal.getNumberOfPages()), page.width - page.margin, page.height - 26, { align: "right" });
  };

  footer();
  text(`${property?.name || "All Properties"} ECM Register`, 22, true, [24, 74, 44]);
  text(`Generated ${new Date().toLocaleString()}`, 9, false, [96, 112, 100]);
  rule();
  if (property) {
    kv("Address", property.address);
    kv("Total floor area", `${money(property.total_floor_area)} m2`);
    kv("Electricity cost", `EUR ${money(property.elec_cost_eur_per_kwh)}/kWh`);
    kv("Heating cost", `EUR ${money(property.heating_cost_eur_per_kwh)}/kWh`);
    kv("Cooling cost", `EUR ${money(property.cooling_cost_eur_per_kwh)}/kWh`);
    rule();
  }
  text("Summary", 15, true, [24, 74, 44]);
  kv("Tenants", tenants.length);
  kv("Equipment", equipment.length);
  kv("ECMs", ecms.length);
  kv("Open ECMs", ecms.filter((ecm) => ecm.status === "Open").length);
  kv("Implemented ECMs", ecms.filter((ecm) => ecm.status === "Implemented").length);
  kv("Implemented measured savings records", savings.length);
  rule();
  text("ECM Register", 15, true, [24, 74, 44]);
  for (const ecm of ecms) {
    ensure(110);
    text(`${ecm.ref} - ${ecm.title}`, 12, true, [20, 54, 35]);
    kv("Status", ecm.status);
    kv("Utility", ecm.utility_type);
    kv("Energy saving", `${kwh(ecm.energy_saving_kwh)} kWh/a`);
    kv("Annual saving", `EUR ${money(ecm.annual_saving_eur)}/a`);
    text(`Action: ${ecm.action || "Not stated."}`, 9);
    rule();
  }
  doc.save(`${slug(property?.name || "All_Properties")}_ECM_Register.pdf`);
}

function addSheet(wb, name, data) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length ? data : [{}]), name.slice(0, 31));
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
