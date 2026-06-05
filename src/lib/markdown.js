import { kwh, money, slug, todayIso, utilityCost, yamlQuote } from "./format.js";

export function ecmFilename(ecm, property, sequence = 1) {
  const ecmNumber = String(sequence || 1).padStart(2, "0");
  const dateText = String(ecm.created_at || ecm.updated_at || todayIso()).slice(0, 10).replace(/-/g, "");
  return `ECM${ecmNumber}_${dateText}_${slug(property?.name || ecm.property_name || "Property")}.md`;
}

export function savingFilename(saving) {
  return `${slug(saving.ref || `ECM_${saving.ecm_id}`)}_Implemented_Saving_${saving.start_date}_to_${saving.end_date}.md`;
}

export function meetingFilename(property, reportMonth) {
  return `${reportMonth}_${slug(property?.name || "Property")}_Monthly_ECM_Meeting.md`;
}

export function propertyNotesFilename(property) {
  return `${slug(property?.name || "Property")}.md`;
}

const PROPERTY_FIELDS = [
  ["id", "Database ID"],
  ["name", "Name"],
  ["address", "Address"],
  ["total_floor_area", "Total floor area m2"],
  ["crrem_country", "CRREM country"],
  ["crrem_property_type", "CRREM property type"],
  ["heating_carrier", "Heating carrier"],
  ["cooling_carrier", "Cooling carrier"],
  ["renewable_consumed_kwh", "On-site renewable consumed kWh/a"],
  ["renewable_exported_kwh", "On-site renewable exported kWh/a"],
  ["heating_emission_factor_kgco2e_per_kwh", "Heating emissions factor override"],
  ["cooling_emission_factor_kgco2e_per_kwh", "Cooling emissions factor override"],
  ["elec_cost_eur_per_kwh", "Electricity cost EUR/kWh"],
  ["heating_cost_eur_per_kwh", "Heating cost EUR/kWh"],
  ["cooling_cost_eur_per_kwh", "Cooling cost EUR/kWh"],
  ["notes", "Notes"]
];

const PROPERTY_TABLE_START = "<!-- ecm-register:property-fields:start -->";
const PROPERTY_TABLE_END = "<!-- ecm-register:property-fields:end -->";

export function upsertPropertyFieldsTable(markdown = "", property = {}) {
  const block = buildPropertyFieldsBlock(property);
  const pattern = new RegExp(`${escapeRegExp(PROPERTY_TABLE_START)}[\\s\\S]*?${escapeRegExp(PROPERTY_TABLE_END)}\\n?`);
  if (pattern.test(markdown)) return markdown.replace(pattern, `${block}\n\n`);
  return insertAfterFrontmatter(markdown, `${block}\n\n`);
}

export function buildPropertyNoteMarkdown(property = {}) {
  return upsertPropertyFieldsTable(`# ${property.name || "Property"}\n`, property);
}

export function parsePropertyFieldsTable(markdown = "") {
  const start = markdown.indexOf(PROPERTY_TABLE_START);
  const end = markdown.indexOf(PROPERTY_TABLE_END);
  if (start < 0 || end < start) return null;
  const block = markdown.slice(start, end);
  const out = {};
  for (const line of block.split("\n")) {
    if (line.startsWith("|")) {
      if (line.includes("---") || line.includes("Field") || line.includes("Value")) continue;
      const cells = splitTableRow(line);
      if (cells.length < 2) continue;
      const key = propertyFieldKey(cells[0]);
      if (!key) continue;
      const value = cells[1].trim();
      if (value) out[key] = value;
      continue;
    }
    const bullet = line.match(/^-\s+\*\*(.+?)\*\*:\s*(.*)$/);
    if (!bullet) continue;
    const key = propertyFieldKey(bullet[1]);
    if (!key) continue;
    const value = bullet[2].trim();
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export function propertyNoteIdentity(markdown = "", filename = "") {
  const building = frontmatterValue(markdown, "building");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] || "";
  return [filename.replace(/\.md$/i, ""), building, title].filter(Boolean).join(" ");
}

export function monthlyUsageFilename(property) {
  return `${slug(property?.name || "Property")}_Monthly_Usage.md`;
}

export function adminTrackerFilename(property) {
  return `${slug(property?.name || "Property")}_Admin_Tracker.md`;
}

export function tenantsFilename(property) {
  return `${slug(property?.name || "Property")}_Tenants.md`;
}

export function equipmentFilename(property) {
  return `${slug(property?.name || "Property")}_Equipment.md`;
}

export function buildTenantsMarkdown(property, tenants = []) {
  const rows = tenants.length
    ? tenants.map((tenant) => `- **${bulletValue(tenant.tenant_name)}**
  - Database ID: ${bulletValue(tenant.id)}
  - Location ID: ${bulletValue(tenant.tenant_location_id)}
  - Location label: ${bulletValue(tenant.location_label)}
  - Floor area m2: ${bulletValue(tenant.tenant_floor_area)}
  - Notes: ${bulletValue(tenant.notes)}`).join("\n")
    : "- _No tenant records yet._";

  return `---
record_type: tenants
property: "[[${property?.name || ""}]]"
property_id: ${property?.id || ""}
date_modified: ${yamlQuote(new Date().toISOString())}
tags:
  - ecm
  - tenants
  - union-module-4
---

# ${property?.name || "Property"} - Tenants

${rows}
`;
}

export function parseTenantsMarkdown(markdown = "") {
  return {
    property_id: Number(frontmatterValue(markdown, "property_id") || 0) || null,
    property: cleanWikiLink(frontmatterValue(markdown, "property")),
    rows: parseNestedBulletRecords(markdown).map((record) => ({
      id: numberOrNull(record["Database ID"]),
      tenant_name: record.title,
      tenant_location_id: record["Location ID"] || "",
      location_label: record["Location label"] || "",
      tenant_floor_area: record["Floor area m2"] || "",
      notes: record.Notes || ""
    })).filter((row) => row.tenant_name && !row.tenant_name.startsWith("_No "))
  };
}

export function buildEquipmentMarkdown(property, equipment = []) {
  const rows = equipment.length
    ? equipment.map((item) => `- **${bulletValue(item.equipment_name)}**
  - Database ID: ${bulletValue(item.id)}
  - Tenant: ${bulletValue(item.tenant_name || "Whole property")}
  - Type: ${bulletValue(item.equipment_type)}
  - Brick class: ${bulletValue(item.brick_class)}
  - Utility: ${bulletValue(item.utility_type)}
  - DEXMA location ID: ${bulletValue(item.dexma_location_id)}
  - DEXMA device ID: ${bulletValue(item.dexma_device_id)}
  - Notes: ${bulletValue(item.notes)}`).join("\n")
    : "- _No equipment records yet._";

  return `---
record_type: equipment
property: "[[${property?.name || ""}]]"
property_id: ${property?.id || ""}
date_modified: ${yamlQuote(new Date().toISOString())}
tags:
  - ecm
  - equipment
  - union-module-4
---

# ${property?.name || "Property"} - Equipment

${rows}
`;
}

export function parseEquipmentMarkdown(markdown = "") {
  return {
    property_id: Number(frontmatterValue(markdown, "property_id") || 0) || null,
    property: cleanWikiLink(frontmatterValue(markdown, "property")),
    rows: parseNestedBulletRecords(markdown).map((record) => ({
      id: numberOrNull(record["Database ID"]),
      equipment_name: record.title,
      tenant_name: record.Tenant === "Whole property" ? "" : record.Tenant || "",
      equipment_type: record.Type || "",
      brick_class: record["Brick class"] || "",
      utility_type: record.Utility || "",
      dexma_location_id: record["DEXMA location ID"] || "",
      dexma_device_id: record["DEXMA device ID"] || "",
      notes: record.Notes || ""
    })).filter((row) => row.equipment_name && !row.equipment_name.startsWith("_No "))
  };
}

export function buildAdminTrackerMarkdown(property, records = []) {
  const rows = [...records].sort((a, b) => {
    const yearDiff = Number(a.admin_year || 0) - Number(b.admin_year || 0);
    if (yearDiff) return yearDiff;
    return Number(a.admin_month || 0) - Number(b.admin_month || 0);
  });
  const tableRows = rows.length
    ? rows.map((row) => `| ${adminPeriod(row)} | ${trackerStatusCell(row.docunite_report)} | ${trackerStatusCell(row.ecm_report)} | ${trackerStatusCell(row.pre_meeting_notes)} | ${trackerStatusCell(row.consumption_tracked)} | ${trackerStatusCell(row.meeting_held)} | ${trackerStatusCell(row.post_meeting_notes)} | ${trackerStatusCell(row.status_quo)} | ${escapeTable(row.comments)} |`).join("\n")
    : "| _No admin tracker records yet_ |  |  |  |  |  |  |  |  |";

  return `---
record_type: admin_tracker
property: "[[${property?.name || ""}]]"
property_id: ${property?.id || ""}
date_modified: ${yamlQuote(new Date().toISOString())}
tags:
  - ecm
  - admin-tracker
  - union-module-4
---

# ${property?.name || "Property"} - Admin Tracker

| Month | Docunite report | ECM report | Pre meeting notes | Consumption tracked | Meeting held | Post meeting notes | Status Quo | Comments |
|---|---:|---:|---:|---:|---:|---:|---:|---|
${tableRows}
`;
}

export function parseAdminTrackerMarkdown(markdown = "") {
  return {
    property_id: Number(frontmatterValue(markdown, "property_id") || 0) || null,
    property: cleanWikiLink(frontmatterValue(markdown, "property")),
    rows: parseMarkdownTable(markdown).map((row) => {
      const [year, month] = String(row.Month || "").split("-");
      return {
        admin_year: year,
        admin_month: Number(month || 0) || "",
        docunite_report: parseTrackerStatus(row["Docunite report"]),
        ecm_report: parseTrackerStatus(row["ECM report"]),
        pre_meeting_notes: parseTrackerStatus(row["Pre meeting notes"] || row["Pre Meeting notes"]),
        consumption_tracked: parseTrackerStatus(row["Consumption tracked"]),
        meeting_held: parseTrackerStatus(row["Meeting held"]),
        post_meeting_notes: parseTrackerStatus(row["Post meeting notes"]),
        status_quo: parseTrackerStatus(row["Status Quo"]),
        comments: row.Comments || ""
      };
    }).filter((row) => row.admin_year && row.admin_month)
  };
}

export function buildMonthlyUsageMarkdown(property, usageRows = []) {
  const rows = [...usageRows].sort((a, b) => {
    const monthCompare = String(a.usage_month || "").localeCompare(String(b.usage_month || ""));
    if (monthCompare) return monthCompare;
    return String(a.scope_type || "").localeCompare(String(b.scope_type || ""));
  });
  const tableRows = rows.length
    ? rows.map((row) => {
        const scope = row.scope_type === "tenant" ? row.tenant_name || `Tenant ${row.tenant_id || ""}` : "Landlord";
        return `| ${escapeTable(row.usage_month)} | ${escapeTable(scope)} | ${numberCell(row.electricity_kwh)} | ${numberCell(row.heating_kwh)} | ${numberCell(row.cooling_kwh)} | ${escapeTable(row.notes)} |`;
      }).join("\n")
    : "| _No records yet_ |  |  |  |  |  |";

  return `---
record_type: monthly_usage
property: "[[${property?.name || ""}]]"
property_id: ${property?.id || ""}
date_modified: ${yamlQuote(new Date().toISOString())}
tags:
  - ecm
  - monthly-usage
  - union-module-4
---

# ${property?.name || "Property"} - Monthly Usage

| Month | Scope | Electricity kWh | Heating kWh | Cooling kWh | Notes |
|---|---|---:|---:|---:|---|
${tableRows}
`;
}

export function parseMonthlyUsageMarkdown(markdown = "") {
  return {
    property_id: Number(frontmatterValue(markdown, "property_id") || 0) || null,
    property: cleanWikiLink(frontmatterValue(markdown, "property")),
    rows: parseMarkdownTable(markdown).map((row) => ({
      usage_month: row.Month || "",
      scope: row.Scope || "",
      scope_type: propertyKey(row.Scope) === "landlord" ? "building" : "tenant",
      electricity_kwh: numberOrZero(row["Electricity kWh"]),
      heating_kwh: numberOrZero(row["Heating kWh"]),
      cooling_kwh: numberOrZero(row["Cooling kWh"]),
      notes: row.Notes || ""
    })).filter((row) => row.usage_month && !row.usage_month.startsWith("_No "))
  };
}

export function buildEcmMarkdown(ecm, property, attachments = []) {
  const cost = utilityCost(property, ecm.utility_type);
  const annual = Number(ecm.energy_saving_kwh || 0) * cost;
  const invest = ecm.investment_eur === null || ecm.investment_eur === undefined || ecm.investment_eur === "" ? "" : Number(ecm.investment_eur);
  const attachmentText = attachments.length
    ? attachments.map((item) => `- Original: \`${item.original_filename}\`\n  Saved as: \`${item.relative_path}\``).join("\n")
    : "- No calculation reference attached yet.";

  return `---
record_type: ecm
db_id: ${ecm.id}
project: "[[Project - Union Module 4]]"
property: "[[${property?.name || ""}]]"
property_id: ${ecm.property_id}
ref: ${yamlQuote(ecm.ref)}
title: ${yamlQuote(ecm.title)}
status: ${yamlQuote(ecm.status)}
approved: ${ecm.approved ? "true" : "false"}
utility_type: ${yamlQuote(ecm.utility_type)}
investment_eur: ${invest}
energy_saving_kwh_per_year: ${Number(ecm.energy_saving_kwh || 0).toFixed(2)}
unit_cost_eur_per_kwh: ${cost}
annual_saving_eur_per_year: ${annual.toFixed(2)}
date_created: ${yamlQuote(ecm.created_at || todayIso())}
date_modified: ${yamlQuote(ecm.updated_at || todayIso())}
tags:
  - ecm
  - union-module-4
  - ${ecm.utility_type || "utility"}
---

# ${ecm.ref} - ${ecm.title}

## Summary

| Field | Value |
|---|---:|
| Property | ${property?.name || ""} |
| Status | ${ecm.status || ""} |
| Utility | ${ecm.utility_type || ""} |
| Investment | EUR ${invest === "" ? "Not stated" : money(invest)} |
| Energy saving | ${kwh(ecm.energy_saving_kwh)} kWh/a |
| Unit cost | EUR ${money(cost)}/kWh |
| Annual saving | EUR ${money(annual)}/a |

## What & Why

${ecm.what_why || "Not stated."}

## Pitfall

${ecm.pitfall || "Not stated in source."}

## Action

${ecm.action || "Not stated."}

## Calculation References

${attachmentText}

## Notes

${ecm.notes || "_No additional notes recorded._"}

## Change Log

- ${new Date().toLocaleString()}: Note written by ECM Register.
`;
}

export function parseEcmMarkdown(markdown = "") {
  if (frontmatterValue(markdown, "record_type") !== "ecm") return null;
  const heading = String(markdown || "").match(/^#\s+(.+)$/m)?.[1] || "";
  const headingParts = heading.split(/\s+-\s+/);
  return {
    property_id: Number(frontmatterValue(markdown, "property_id") || 0) || null,
    property: cleanWikiLink(frontmatterValue(markdown, "property")),
    ref: frontmatterValue(markdown, "ref") || headingParts[0] || "",
    title: frontmatterValue(markdown, "title") || headingParts.slice(1).join(" - ") || heading,
    status: frontmatterValue(markdown, "status") || "Open",
    approved: yesNo(frontmatterValue(markdown, "approved")),
    utility_type: frontmatterValue(markdown, "utility_type") || "electricity",
    investment_eur: numberOrNull(frontmatterValue(markdown, "investment_eur")),
    energy_saving_kwh: numberOrNull(frontmatterValue(markdown, "energy_saving_kwh_per_year")),
    what_why: markdownSection(markdown, "What & Why") || "Not stated.",
    pitfall: markdownSection(markdown, "Pitfall") || "Not stated in source.",
    action: markdownSection(markdown, "Action") || "Not stated.",
    notes: emptyNote(markdownSection(markdown, "Notes"))
  };
}

function escapeTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function numberCell(value) {
  return Number(value || 0).toFixed(2);
}

function trackerStatusCell(value) {
  if (value === "na") return "N/A";
  return value === "done" || value === true ? "Done" : "Open";
}

function adminPeriod(row) {
  const year = row.admin_year || "";
  const month = String(row.admin_month || "").padStart(2, "0");
  return year && month ? `${year}-${month}` : "";
}

function buildPropertyFieldsBlock(property) {
  const rows = PROPERTY_FIELDS.map(([key, label]) => `- **${label}**: ${bulletValue(property[key])}`).join("\n");
  return `${PROPERTY_TABLE_START}
## ECM Register Property Fields

${rows}
${PROPERTY_TABLE_END}`;
}

function bulletValue(value) {
  return String(value ?? "").replace(/\n/g, " ").trim();
}

function parseNestedBulletRecords(markdown = "") {
  const rows = [];
  let current = null;
  for (const line of String(markdown || "").split("\n")) {
    const top = line.match(/^-\s+\*\*(.+?)\*\*\s*$/);
    if (top) {
      current = { title: top[1].trim() };
      rows.push(current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s{2,}-\s+([^:]+):\s*(.*)$/);
    if (field) current[field[1].trim()] = field[2].trim();
  }
  return rows;
}

function numberOrNull(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value) {
  const n = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function yesNo(value) {
  return /^(yes|true|done|x|1)$/i.test(String(value || "").trim());
}

function parseTrackerStatus(value) {
  if (/^(n\/a|na|not applicable)$/i.test(String(value || "").trim())) return "na";
  return yesNo(value) ? "done" : "open";
}

function markdownSection(markdown = "", heading = "") {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "im");
  const match = String(markdown || "").match(pattern);
  return match ? match[1].trim() : "";
}

function emptyNote(value = "") {
  const text = String(value || "").trim();
  return /^_?No additional notes recorded\.?_?$/i.test(text) ? "" : text;
}

function propertyKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanWikiLink(value) {
  return String(value || "").replace(/^\[\[|\]\]$/g, "").trim();
}

function parseMarkdownTable(markdown = "") {
  const lines = String(markdown || "").split("\n").filter((line) => line.trim().startsWith("|"));
  const headerIndex = lines.findIndex((line, index) => index + 1 < lines.length && lines[index + 1].includes("---"));
  if (headerIndex < 0) return [];
  const headers = splitTableRow(lines[headerIndex]);
  return lines.slice(headerIndex + 2).map((line) => {
    const cells = splitTableRow(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });
    return row;
  });
}

function insertAfterFrontmatter(markdown, content) {
  const text = String(markdown || "");
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end >= 0) {
      const after = text.indexOf("\n", end + 4);
      const insertAt = after >= 0 ? after + 1 : text.length;
      return `${text.slice(0, insertAt)}\n${content}${text.slice(insertAt).replace(/^\n+/, "")}`;
    }
  }
  return `${content}${text.replace(/^\n+/, "")}`;
}

function splitTableRow(line) {
  const cells = [];
  let current = "";
  let escaped = false;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function propertyFieldKey(label) {
  const normalised = String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const field = PROPERTY_FIELDS.find(([, fieldLabel]) => fieldLabel.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalised);
  return field?.[0] || "";
}

function frontmatterValue(markdown, key) {
  const match = String(markdown || "").match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

export function buildSavingMarkdown(saving, ecm, property) {
  return `---
record_type: implemented_saving
db_id: ${saving.id}
project: "[[Project - Union Module 4]]"
property: "[[${property?.name || ""}]]"
property_id: ${saving.property_id}
ecm_id: ${saving.ecm_id}
ecm_ref: ${yamlQuote(ecm?.ref || saving.ref || "")}
ecm_title: ${yamlQuote(ecm?.title || saving.ecm_title || "")}
utility_type: ${yamlQuote(saving.utility_type)}
period_start: ${yamlQuote(saving.start_date)}
period_end: ${yamlQuote(saving.end_date)}
energy_saving_kwh: ${Number(saving.energy_saving_kwh || 0).toFixed(2)}
unit_cost_eur_per_kwh: ${Number(saving.unit_cost_eur_per_kwh || 0)}
cost_saving_eur: ${Number(saving.cost_saving_eur || 0).toFixed(2)}
date_created: ${yamlQuote(saving.created_at || todayIso())}
date_modified: ${yamlQuote(saving.updated_at || todayIso())}
tags:
  - ecm
  - implemented-savings
  - union-module-4
  - ${saving.utility_type || "utility"}
---

# Implemented Saving - ${ecm?.ref || saving.ref || ""} - ${saving.start_date} to ${saving.end_date}

## Summary

| Field | Value |
|---|---:|
| Property | ${property?.name || ""} |
| ECM | ${ecm?.ref || saving.ref || ""} - ${ecm?.title || saving.ecm_title || ""} |
| Utility | ${saving.utility_type || ""} |
| Period | ${saving.start_date || ""} to ${saving.end_date || ""} |
| Energy saving | ${kwh(saving.energy_saving_kwh)} kWh |
| Unit cost | EUR ${money(saving.unit_cost_eur_per_kwh)}/kWh |
| Cost saving | EUR ${money(saving.cost_saving_eur)} |

## Measurement Notes

${saving.notes || "Not stated."}

## Verification / Evidence

- Baseline and reporting method to be recorded here.
- Supporting calculation files should be linked from the parent ECM record.

## Change Log

- ${new Date().toLocaleString()}: Note written by ECM Register.
`;
}

export function parseSavingMarkdown(markdown = "") {
  if (frontmatterValue(markdown, "record_type") !== "implemented_saving") return null;
  return {
    property_id: Number(frontmatterValue(markdown, "property_id") || 0) || null,
    property: cleanWikiLink(frontmatterValue(markdown, "property")),
    ecm_id: Number(frontmatterValue(markdown, "ecm_id") || 0) || null,
    ecm_ref: frontmatterValue(markdown, "ecm_ref"),
    ecm_title: frontmatterValue(markdown, "ecm_title"),
    utility_type: frontmatterValue(markdown, "utility_type") || "electricity",
    start_date: frontmatterValue(markdown, "period_start"),
    end_date: frontmatterValue(markdown, "period_end"),
    energy_saving_kwh: numberOrZero(frontmatterValue(markdown, "energy_saving_kwh")),
    unit_cost_eur_per_kwh: numberOrZero(frontmatterValue(markdown, "unit_cost_eur_per_kwh")),
    cost_saving_eur: numberOrZero(frontmatterValue(markdown, "cost_saving_eur")),
    notes: emptyNote(markdownSection(markdown, "Measurement Notes"))
  };
}

export function buildMeetingMarkdown({ property, reportMonth, performance, openEcms, preMeeting = "", postMeeting = "", meetingDate }) {
  const currentLabel = performance?.currentLabel || "";
  const previousLabel = performance?.previousLabel || "";
  const perfRows = ["electricity", "heating", "cooling"].map((utility) => {
    const row = performance?.utilities?.[utility] || {};
    const diffText = Number.isFinite(row.percentDiff) ? `${row.percentDiff.toFixed(1)}%` : "";
    return `| ${labelUtility(utility)} | ${kwh(row.current)} | ${kwh(row.previous)} | ${kwh(row.diff)} | ${diffText} |`;
  }).join("\n");
  const ecmRows = openEcms.length
    ? openEcms.map((ecm) => `| ${ecm.ref || ""} | ${ecm.title || ""} | ${ecm.utility_type || ""} | ${kwh(ecm.energy_saving_kwh)} | ${money(ecm.annual_saving_eur)} | ${String(ecm.action || "").replace(/\n/g, " ")} |`).join("\n")
    : "| | No open ECMs | | | | |";

  return `---
record_type: monthly_meeting
date created: ${new Date().toISOString().slice(0, 19).replace("T", " ")}
project: Project - Union Module 4
property: ${property?.name || ""}
meeting date: ${meetingDate || todayIso()}
report month: ${reportMonth}
tags:
  - meeting
  - ecm
  - union-module-4
---

# ${property?.name || ""} Monthly ECM Meeting - ${reportMonth}

## Rolling 12 Month Performance

Current rolling 12 months: **${currentLabel}**  
Previous rolling 12 months: **${previousLabel}**

| Utility | Current 12 months kWh | Previous 12 months kWh | Difference kWh | % diff |
|---|---:|---:|---:|---:|
${perfRows}

## Comments Pre Meeting

${preMeeting || "_Add comments before the meeting._"}

## Open ECMs For Discussion

| Ref | ECM | Utility | Energy saving kWh/a | Annual saving EUR/a | Action |
|---|---|---|---:|---:|---|
${ecmRows}

## Comments Post Meeting

${postMeeting || "_Add comments after the meeting._"}
`;
}

export function extractMeetingSections(markdown = "") {
  return {
    pre: extractMarkdownSection(markdown, "Comments Pre Meeting"),
    post: extractMarkdownSection(markdown, "Comments Post Meeting")
  };
}

export function replaceMeetingSections(markdown = "", sections = {}) {
  let next = replaceMarkdownSection(markdown, "Comments Pre Meeting", sections.pre || "");
  next = replaceMarkdownSection(next, "Comments Post Meeting", sections.post || "");
  return next;
}

function labelUtility(value) {
  if (value === "electricity") return "Electricity";
  if (value === "heating") return "Heating";
  if (value === "cooling") return "Cooling";
  return value || "";
}

function extractMarkdownSection(markdown, heading) {
  const regex = new RegExp(`^## ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\s*$)`, "m");
  const match = String(markdown || "").match(regex);
  if (!match) return "";
  return match[1].trim().replace(/^_(Add comments (before|after) the meeting\\.)_$/i, "");
}

function replaceMarkdownSection(markdown, heading, body) {
  const content = String(body || "").trim() || (heading.includes("Pre") ? "_Add comments before the meeting._" : "_Add comments after the meeting._");
  const regex = new RegExp(`(^## ${escapeRegExp(heading)}\\s*\\n)([\\s\\S]*?)(?=^##\\s+|\\s*$)`, "m");
  if (!regex.test(markdown)) {
    return `${markdown.trim()}\n\n## ${heading}\n\n${content}\n`;
  }
  return markdown.replace(regex, `$1\n${content}\n\n`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
