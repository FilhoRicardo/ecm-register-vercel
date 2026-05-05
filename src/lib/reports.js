import * as XLSX from "xlsx";
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
