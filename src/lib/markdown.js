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

export function monthlyUsageFilename(property) {
  return `${slug(property?.name || "Property")}_Monthly_Usage.md`;
}

export function adminTrackerFilename(property) {
  return `${slug(property?.name || "Property")}_Admin_Tracker.md`;
}

export function buildAdminTrackerMarkdown(property, records = []) {
  const rows = [...records].sort((a, b) => {
    const yearDiff = Number(a.admin_year || 0) - Number(b.admin_year || 0);
    if (yearDiff) return yearDiff;
    return Number(a.admin_month || 0) - Number(b.admin_month || 0);
  });
  const tableRows = rows.length
    ? rows.map((row) => `| ${adminPeriod(row)} | ${checkbox(row.docunite_report)} | ${checkbox(row.ecm_report)} | ${checkbox(row.status_quo)} | ${checkbox(row.pre_meeting_notes)} | ${checkbox(row.post_meeting_notes)} | ${escapeTable(row.comments)} |`).join("\n")
    : "| _No admin tracker records yet_ |  |  |  |  |  |  |";

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

| Month | Docunite report | ECM report | Status Quo | Pre Meeting notes | Post meeting notes | Comments |
|---|---:|---:|---:|---:|---:|---|
${tableRows}
`;
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

function escapeTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function numberCell(value) {
  return Number(value || 0).toFixed(2);
}

function checkbox(value) {
  return value ? "Yes" : "No";
}

function adminPeriod(row) {
  const year = row.admin_year || "";
  const month = String(row.admin_month || "").padStart(2, "0");
  return year && month ? `${year}-${month}` : "";
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
