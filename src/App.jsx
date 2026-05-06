import { useEffect, useMemo, useState } from "react";
import {
  databaseHealth,
  deleteEcm,
  deleteEquipment,
  deleteMonthlyUsage,
  deleteProperty,
  deleteTenant,
  getAttachments,
  getEcms,
  getEquipment,
  getImplementedSavings,
  getMonthlyUsage,
  getPortfolio,
  getProperties,
  getTenants,
  insertAttachment,
  openDatabaseFromFile,
  openDatabaseFromHandle,
  runSelect,
  saveDatabase,
  setEcmObsidianFilename,
  setSavingObsidianFilename,
  tableCount,
  upsertEcm,
  upsertEquipment,
  upsertImplementedSaving,
  upsertMonthlyUsage,
  upsertProperty,
  upsertTenant
} from "./lib/sqlite.js";
import { downloadBlob, ensurePermission, idbGet, idbSet, permissionState, supportsFileSystemAccess, writeFile } from "./lib/storage.js";
import { listMarkdownFiles, routeCalculationFile, writeTextIntoFolder } from "./lib/files.js";
import { buildEcmMarkdown, buildMeetingMarkdown, buildSavingMarkdown, ecmFilename, extractMeetingSections, meetingFilename, replaceMeetingSections, savingFilename } from "./lib/markdown.js";
import { downloadEcmReviewWorkbook, downloadExcelRegister, downloadPdfRegister, downloadWordRegister, parseEcmReviewWorkbook } from "./lib/reports.js";
import { EQUIPMENT_TYPE_TO_BRICK_CLASS, kwh, money, todayIso, utilityCost } from "./lib/format.js";

const FOLDERS = [
  { key: "database", label: "Database Folder", required: true },
  { key: "ecmNotes", label: "ECM Notes Folder", required: true },
  { key: "savingNotes", label: "Implemented Savings Notes Folder", required: true },
  { key: "meetingNotes", label: "Monthly Meeting Notes Folder", required: true },
  { key: "calculationFiles", label: "Calculation Files Folder", required: true },
  { key: "reports", label: "Reports Folder", required: false },
  { key: "imports", label: "Imports Folder", required: false }
];

const NAV = [
  ["setup", "⚙️ Setup"],
  ["dashboard", "🎯 Dashboard"],
  ["properties", "🏢 Properties"],
  ["tenants", "👥 Tenants & Equipment"],
  ["ecms", "⚡ ECMs"],
  ["savings", "💶 Implemented Savings"],
  ["usage", "📊 Monthly Usage"],
  ["meetings", "📝 Monthly Meetings"],
  ["reports", "📤 Reports"],
  ["database", "🧪 SQLite Lab"],
  ["admin", "🛡️ Database Admin"]
];

const EMPTY_ECM = {
  property_id: "",
  ref: "",
  title: "",
  status: "Open",
  approved: false,
  utility_type: "electricity",
  investment_eur: "",
  energy_saving_kwh: "",
  what_why: "",
  pitfall: "Not stated in source.",
  action: "",
  notes: ""
};

const EMPTY_PROPERTY = {
  name: "",
  address: "",
  total_floor_area: "",
  elec_cost_eur_per_kwh: "0.12",
  heating_cost_eur_per_kwh: "0.09",
  cooling_cost_eur_per_kwh: "0.12",
  notes: ""
};

const EMPTY_TENANT = {
  property_id: "",
  tenant_name: "",
  tenant_floor_area: "",
  location_label: "",
  notes: ""
};

const EMPTY_EQUIPMENT = {
  property_id: "",
  tenant_id: "",
  equipment_name: "",
  equipment_type: "Air Handling Unit",
  brick_class: "brick:AHU",
  utility_type: "electricity",
  notes: ""
};

export default function App() {
  const [active, setActive] = useState("setup");
  const [handles, setHandles] = useState({});
  const [folderStatuses, setFolderStatuses] = useState({});
  const [db, setDb] = useState(null);
  const [dbFileHandle, setDbFileHandle] = useState(null);
  const [data, setData] = useState(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedEcmId, setSelectedEcmId] = useState("");
  const [propertyForm, setPropertyForm] = useState(EMPTY_PROPERTY);
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT);
  const [equipmentForm, setEquipmentForm] = useState(EMPTY_EQUIPMENT);
  const [ecmForm, setEcmForm] = useState(EMPTY_ECM);
  const [calcFile, setCalcFile] = useState(null);
  const [savingForm, setSavingForm] = useState(defaultSavingForm());
  const [usageForm, setUsageForm] = useState(defaultUsageForm());
  const [meetingForm, setMeetingForm] = useState({ property_id: "", report_month: todayIso().slice(0, 7), meeting_date: todayIso(), pre: "" });
  const [meetingFiles, setMeetingFiles] = useState([]);
  const [selectedMeetingName, setSelectedMeetingName] = useState("");
  const [meetingDraft, setMeetingDraft] = useState({ pre: "", post: "" });
  const [sqlText, setSqlText] = useState("SELECT * FROM ecms LIMIT 20");
  const [sqlRows, setSqlRows] = useState([]);
  const [toast, setToast] = useState("");
  const [setupError, setSetupError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!data?.properties?.length) return;
    const first = data.properties[0]?.id || "";
    setSelectedPropertyId((prev) => prev || first);
    setMeetingForm((prev) => ({ ...prev, property_id: prev.property_id || first }));
    setEcmForm((prev) => ({ ...prev, property_id: prev.property_id || first }));
    setTenantForm((prev) => ({ ...prev, property_id: prev.property_id || first }));
    setEquipmentForm((prev) => ({ ...prev, property_id: prev.property_id || first }));
    setUsageForm((prev) => ({ ...prev, property_id: prev.property_id || first }));
  }, [data?.properties]);

  const properties = data?.properties || [];
  const selectedProperty = properties.find((item) => item.id === Number(selectedPropertyId)) || properties[0] || null;
  const filteredEcms = useMemo(() => {
    if (!data?.ecms) return [];
    return selectedProperty ? data.ecms.filter((ecm) => ecm.property_id === selectedProperty.id) : data.ecms;
  }, [data, selectedProperty]);
  const implementedEcms = useMemo(() => (data?.ecms || []).filter((ecm) => ecm.status === "Implemented"), [data]);
  const ready = Boolean(db && dbFileHandle);

  async function boot() {
    const next = {};
    const statuses = {};
    for (const def of FOLDERS) {
      const handle = await idbGet(`folder_${def.key}`);
      if (!handle) continue;
      try {
        next[def.key] = handle;
        statuses[def.key] = await permissionState(handle, "readwrite");
      } catch {
        // Keep boot resilient; user can reconfigure the folder.
      }
    }
    setHandles(next);
    setFolderStatuses(statuses);
    if (next.database && statuses.database === "granted") await openDatabaseFolder(next.database);
  }

  async function configureFolder(key) {
    try {
      setSetupError("");
      if (!supportsFileSystemAccess()) {
        notify("Use Chrome or Microsoft Edge. This browser does not support local folder access.");
        return;
      }
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await idbSet(`folder_${key}`, handle);
      setHandles((prev) => ({ ...prev, [key]: handle }));
      setFolderStatuses((prev) => ({ ...prev, [key]: "granted" }));
      notify("Folder configured.");
    } catch (error) {
      if (error?.name === "AbortError") return;
      setSetupError(error.message || String(error));
      notify("Folder setup failed.");
    }
  }

  async function openDatabaseFolder(folderHandle) {
    try {
      setBusy(true);
      setSetupError("");
      if (!folderHandle) throw new Error("Select the Database Folder first.");
      const databaseGranted = await ensurePermission(folderHandle, "readwrite");
      const statuses = { database: databaseGranted ? "granted" : await permissionState(folderHandle, "readwrite") };
      for (const [key, handle] of Object.entries(handles)) {
        if (!handle || key === "database") continue;
        statuses[key] = await permissionState(handle, "readwrite");
      }
      setFolderStatuses((prev) => ({ ...prev, ...statuses }));
      if (statuses.database !== "granted") throw new Error("Database folder permission was not granted.");
      const fileHandle = await folderHandle.getFileHandle("ecm_register.db", { create: true });
      const nextDb = await openDatabaseFromHandle(fileHandle);
      setDb(nextDb);
      setDbFileHandle(fileHandle);
      const nextData = getPortfolio(nextDb);
      setData(nextData);
      setActive("dashboard");
      notify(`Workspace loaded: ${nextData.properties.length} properties, ${nextData.ecms.length} ECMs.`);
    } catch (error) {
      setSetupError(error.message || String(error));
      notify("Database load failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importDatabase() {
    try {
      setBusy(true);
      setSetupError("");
      if (!handles.database) throw new Error("Configure the Database Folder first.");
      const databaseGranted = await ensurePermission(handles.database, "readwrite");
      setFolderStatuses((prev) => ({ ...prev, database: databaseGranted ? "granted" : "denied" }));
      if (!databaseGranted) throw new Error("Database folder permission was not granted.");
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: "SQLite database", accept: { "application/octet-stream": [".db", ".sqlite", ".sqlite3"], "application/vnd.sqlite3": [".db", ".sqlite", ".sqlite3"] } }]
      });
      const file = await fileHandle.getFile();
      const importedDb = await openDatabaseFromFile(file);
      const target = await handles.database.getFileHandle("ecm_register.db", { create: true });
      await saveDatabase(importedDb, target);
      setDb(importedDb);
      setDbFileHandle(target);
      const nextData = getPortfolio(importedDb);
      setData(nextData);
      setSelectedPropertyId(nextData.properties[0]?.id ? String(nextData.properties[0].id) : "");
      setEcmForm((prev) => ({ ...prev, property_id: nextData.properties[0]?.id ? String(nextData.properties[0].id) : "" }));
      setMeetingForm((prev) => ({ ...prev, property_id: nextData.properties[0]?.id ? String(nextData.properties[0].id) : "" }));
      setTenantForm((prev) => ({ ...prev, property_id: nextData.properties[0]?.id ? String(nextData.properties[0].id) : "" }));
      setEquipmentForm((prev) => ({ ...prev, property_id: nextData.properties[0]?.id ? String(nextData.properties[0].id) : "" }));
      setUsageForm((prev) => ({ ...prev, property_id: nextData.properties[0]?.id ? String(nextData.properties[0].id) : "" }));
      setActive("dashboard");
      notify(`Database imported: ${nextData.properties.length} properties, ${nextData.ecms.length} ECMs.`);
    } catch (error) {
      if (error?.name === "AbortError") return;
      setSetupError(error.message || String(error));
      notify("Database import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function persist(message = "Saved.") {
    await saveDatabase(db, dbFileHandle);
    setData(getPortfolio(db));
    notify(message);
  }

  async function saveProperty(event) {
    event.preventDefault();
    const id = upsertProperty(db, { ...propertyForm, id: propertyForm.id || null });
    setPropertyForm(EMPTY_PROPERTY);
    setSelectedPropertyId(String(id));
    await persist("Property saved.");
  }

  async function removeProperty(id) {
    if (!window.confirm("Delete this property and all linked tenants, equipment, ECMs and usage records?")) return;
    deleteProperty(db, id);
    setPropertyForm(EMPTY_PROPERTY);
    await persist("Property deleted.");
  }

  async function saveTenant(event) {
    event.preventDefault();
    upsertTenant(db, { ...tenantForm, id: tenantForm.id || null, property_id: Number(tenantForm.property_id) });
    setTenantForm({ ...EMPTY_TENANT, property_id: selectedPropertyId || tenantForm.property_id });
    await persist("Tenant saved.");
  }

  async function removeTenant(id) {
    if (!window.confirm("Delete this tenant/location record?")) return;
    deleteTenant(db, id);
    setTenantForm({ ...EMPTY_TENANT, property_id: selectedPropertyId });
    await persist("Tenant deleted.");
  }

  async function saveEquipment(event) {
    event.preventDefault();
    upsertEquipment(db, {
      ...equipmentForm,
      id: equipmentForm.id || null,
      property_id: Number(equipmentForm.property_id),
      tenant_id: equipmentForm.tenant_id ? Number(equipmentForm.tenant_id) : null
    });
    setEquipmentForm({ ...EMPTY_EQUIPMENT, property_id: selectedPropertyId || equipmentForm.property_id });
    await persist("Equipment saved.");
  }

  async function removeEquipment(id) {
    if (!window.confirm("Delete this equipment record?")) return;
    deleteEquipment(db, id);
    setEquipmentForm({ ...EMPTY_EQUIPMENT, property_id: selectedPropertyId });
    await persist("Equipment deleted.");
  }

  async function saveUsage(event) {
    event.preventDefault();
    upsertMonthlyUsage(db, {
      ...usageForm,
      id: usageForm.id || null,
      property_id: Number(usageForm.property_id),
      tenant_id: usageForm.scope_type === "tenant" && usageForm.tenant_id ? Number(usageForm.tenant_id) : null
    });
    setUsageForm({ ...defaultUsageForm(), property_id: selectedPropertyId || usageForm.property_id });
    await persist("Monthly usage saved.");
  }

  async function removeUsage(id) {
    if (!window.confirm("Delete this monthly usage record?")) return;
    deleteMonthlyUsage(db, id);
    await persist("Monthly usage deleted.");
  }

  async function syncObsidianNotes() {
    if (!handles.ecmNotes || !handles.savingNotes) {
      notify("Configure ECM Notes and Implemented Savings Notes folders first.");
      return;
    }
    setBusy(true);
    try {
      const ecmPermission = await ensurePermission(handles.ecmNotes, "readwrite");
      const savingPermission = await ensurePermission(handles.savingNotes, "readwrite");
      setFolderStatuses((prev) => ({
        ...prev,
        ecmNotes: ecmPermission ? "granted" : "denied",
        savingNotes: savingPermission ? "granted" : "denied"
      }));
      if (!ecmPermission || !savingPermission) throw new Error("Obsidian note folder permissions were not granted.");
      const propertiesNow = getProperties(db);
      const ecmsNow = getEcms(db);
      for (const ecm of ecmsNow) {
        const property = propertiesNow.find((item) => item.id === ecm.property_id);
        const attachments = getAttachments(db, ecm.id);
        const filename = ecm.obsidian_filename || ecmFilename(ecm);
        await writeTextIntoFolder(handles.ecmNotes, filename, buildEcmMarkdown(ecm, property, attachments));
        setEcmObsidianFilename(db, ecm.id, filename);
      }
      const savingsNow = getImplementedSavings(db);
      for (const saving of savingsNow) {
        const ecm = ecmsNow.find((item) => item.id === saving.ecm_id);
        const property = propertiesNow.find((item) => item.id === saving.property_id);
        const filename = saving.obsidian_filename || savingFilename({ ...saving, ...ecm });
        await writeTextIntoFolder(handles.savingNotes, filename, buildSavingMarkdown(saving, ecm, property));
        setSavingObsidianFilename(db, saving.id, filename);
      }
      await persist(`Synced ${ecmsNow.length} ECM notes and ${savingsNow.length} implemented-savings notes to Obsidian.`);
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createDatabaseBackup() {
    const filename = `ecm_register_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    const handle = await handles.database.getFileHandle(filename, { create: true });
    await saveDatabase(db, handle);
    notify(`Backup created: ${filename}`);
  }

  function downloadDatabaseFile() {
    downloadBlob(new Blob([db.export()], { type: "application/octet-stream" }), "ecm_register.db");
  }

  async function saveEcm(event) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      if (!handles.ecmNotes || !(await ensurePermission(handles.ecmNotes, "readwrite"))) throw new Error("ECM Notes folder permission was not granted.");
      setFolderStatuses((prev) => ({ ...prev, ecmNotes: "granted" }));
      if (calcFile) {
        if (!handles.calculationFiles || !(await ensurePermission(handles.calculationFiles, "readwrite"))) throw new Error("Calculation Files folder permission was not granted.");
        setFolderStatuses((prev) => ({ ...prev, calculationFiles: "granted" }));
      }
      const id = upsertEcm(db, {
        ...ecmForm,
        id: ecmForm.id || null,
        property_id: Number(ecmForm.property_id),
        approved: Boolean(ecmForm.approved)
      });
      let ecm = getEcms(db).find((item) => item.id === id);
      const property = getProperties(db).find((item) => item.id === ecm.property_id);
      if (calcFile) {
        const routed = await routeCalculationFile(handles.calculationFiles, { file: calcFile, property, ecm });
        if (routed) insertAttachment(db, { ...routed, ecm_id: id });
      }
      ecm = getEcms(db).find((item) => item.id === id);
      const attachments = getAttachments(db, id);
      const filename = ecm.obsidian_filename || ecmFilename(ecm);
      await writeTextIntoFolder(handles.ecmNotes, filename, buildEcmMarkdown(ecm, property, attachments));
      setEcmObsidianFilename(db, id, filename);
      setCalcFile(null);
      setSelectedEcmId(String(id));
      setEcmForm({ ...ecm, property_id: String(ecm.property_id), approved: Boolean(ecm.approved), investment_eur: ecm.investment_eur ?? "", energy_saving_kwh: ecm.energy_saving_kwh ?? "" });
      await persist("ECM saved to database and Obsidian.");
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  function editEcm(id) {
    const ecm = data.ecms.find((item) => item.id === Number(id));
    setSelectedEcmId(String(id));
    setEcmForm({
      ...ecm,
      property_id: String(ecm.property_id),
      approved: Boolean(ecm.approved),
      investment_eur: ecm.investment_eur ?? "",
      energy_saving_kwh: ecm.energy_saving_kwh ?? ""
    });
  }

  async function removeEcm() {
    if (!selectedEcmId || !window.confirm("Delete this ECM from the database? The Obsidian note is not deleted automatically.")) return;
    deleteEcm(db, Number(selectedEcmId));
    setSelectedEcmId("");
    setEcmForm({ ...EMPTY_ECM, property_id: selectedProperty?.id || "" });
    await persist("ECM deleted from database.");
  }

  async function saveImplementedSaving(event) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      if (!handles.savingNotes || !(await ensurePermission(handles.savingNotes, "readwrite"))) throw new Error("Implemented Savings Notes folder permission was not granted.");
      setFolderStatuses((prev) => ({ ...prev, savingNotes: "granted" }));
      const ecm = data.ecms.find((item) => item.id === Number(savingForm.ecm_id));
      const property = properties.find((item) => item.id === Number(savingForm.property_id));
      const unitCost = savingForm.unit_cost_eur_per_kwh || utilityCost(property, savingForm.utility_type);
      const costSaving = Number(savingForm.energy_saving_kwh || 0) * Number(unitCost || 0);
      const id = upsertImplementedSaving(db, {
        ...savingForm,
        property_id: Number(savingForm.property_id),
        ecm_id: Number(savingForm.ecm_id),
        unit_cost_eur_per_kwh: unitCost,
        cost_saving_eur: costSaving
      });
      const saved = getImplementedSavings(db).find((item) => item.id === id);
      const filename = saved.obsidian_filename || savingFilename({ ...saved, ...ecm });
      await writeTextIntoFolder(handles.savingNotes, filename, buildSavingMarkdown(saved, ecm, property));
      setSavingObsidianFilename(db, id, filename);
      setSavingForm(defaultSavingForm());
      await persist("Implemented saving saved to database and Obsidian.");
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createMeetingNote(event) {
    event.preventDefault();
    if (!handles.meetingNotes || !(await ensurePermission(handles.meetingNotes, "readwrite"))) {
      notify("Monthly Meeting Notes folder permission was not granted.");
      return;
    }
    setFolderStatuses((prev) => ({ ...prev, meetingNotes: "granted" }));
    const property = properties.find((item) => item.id === Number(meetingForm.property_id));
    const performance = rollingPerformance(data.monthlyUsage, property?.id, meetingForm.report_month);
    const openEcms = data.ecms.filter((ecm) => ecm.property_id === property?.id && ecm.status === "Open");
    const filename = meetingFilename(property, meetingForm.report_month);
    const md = buildMeetingMarkdown({
      property,
      reportMonth: meetingForm.report_month,
      meetingDate: meetingForm.meeting_date,
      preMeeting: meetingForm.pre,
      postMeeting: "",
      performance,
      openEcms
    });
    await writeTextIntoFolder(handles.meetingNotes, filename, md);
    await loadMeetingFiles();
    notify(`Meeting note saved: ${filename}`);
  }

  async function loadMeetingFiles() {
    if (!handles.meetingNotes || !(await ensurePermission(handles.meetingNotes, "readwrite"))) {
      notify("Monthly Meeting Notes folder permission was not granted.");
      return [];
    }
    setFolderStatuses((prev) => ({ ...prev, meetingNotes: "granted" }));
    const files = await listMarkdownFiles(handles.meetingNotes);
    setMeetingFiles(files);
    return files;
  }

  function selectMeeting(name) {
    const file = meetingFiles.find((item) => item.name === name);
    setSelectedMeetingName(name);
    setMeetingDraft(extractMeetingSections(file?.text || ""));
  }

  async function saveMeetingDraft() {
    const file = meetingFiles.find((item) => item.name === selectedMeetingName);
    if (!file) return;
    await writeFile(file.handle, replaceMeetingSections(file.text, meetingDraft));
    await loadMeetingFiles();
    notify("Meeting note updated in Obsidian.");
  }

  async function importEcmReviewWorkbook(event) {
    const file = event.target.files?.[0];
    if (!file || !ready) return;
    setBusy(true);
    try {
      const reviewRows = await parseEcmReviewWorkbook(file);
      const existing = getEcms(db);
      const propertiesNow = getProperties(db);
      const canWriteNotes = handles.ecmNotes ? await ensurePermission(handles.ecmNotes, "readwrite") : false;
      if (handles.ecmNotes) setFolderStatuses((prev) => ({ ...prev, ecmNotes: canWriteNotes ? "granted" : "denied" }));
      let updated = 0;
      let skipped = 0;

      for (const row of reviewRows) {
        const current = existing.find((ecm) => Number(ecm.id) === Number(row.ecm_id));
        if (!current) {
          skipped += 1;
          continue;
        }
        const decision = String(row.review_decision || "").trim().toLowerCase();
        const reviewerComments = String(row.reviewer_comments || "").trim();
        let status = stringOrExisting(row.status, current.status);
        if (decision === "implemented" && !String(row.status || "").trim()) status = "Implemented";
        if (decision === "reject" && !String(row.status || "").trim()) status = "Rejected";
        let notes = stringOrExisting(row.notes, current.notes);
        if (reviewerComments && !notes.includes(reviewerComments)) {
          notes = notes ? `${notes}\n\nReview comments: ${reviewerComments}` : `Review comments: ${reviewerComments}`;
        }
        upsertEcm(db, {
          ...current,
          ref: stringOrExisting(row.ref, current.ref),
          title: stringOrExisting(row.title, current.title),
          status,
          approved: approvedValue(row.approved, current.approved),
          utility_type: stringOrExisting(row.utility_type, current.utility_type),
          investment_eur: numberOrExisting(row.investment_eur, current.investment_eur),
          energy_saving_kwh: numberOrExisting(row.energy_saving_kwh, current.energy_saving_kwh),
          what_why: stringOrExisting(row.what_why, current.what_why),
          pitfall: stringOrExisting(row.pitfall, current.pitfall),
          action: stringOrExisting(row.action, current.action),
          notes
        });
        const saved = getEcms(db).find((ecm) => Number(ecm.id) === Number(row.ecm_id));
        if (canWriteNotes && saved) {
          const property = propertiesNow.find((item) => item.id === saved.property_id);
          const attachments = getAttachments(db, saved.id);
          const filename = saved.obsidian_filename || ecmFilename(saved);
          await writeTextIntoFolder(handles.ecmNotes, filename, buildEcmMarkdown(saved, property, attachments));
          setEcmObsidianFilename(db, saved.id, filename);
        }
        updated += 1;
      }
      await persist(`Imported ${updated} ECM updates from workbook${skipped ? `; skipped ${skipped} unmatched rows` : ""}.`);
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  function runSql() {
    try {
      setSqlRows(runSelect(db, sqlText));
    } catch (error) {
      notify(error.message || String(error));
    }
  }

  function notify(message) {
    setToast(message);
  }

  return (
    <div className="app-shell">
      {toast ? <div className="toast">{toast}</div> : null}
      <aside className="sidebar">
        <div className="brand">
          <h1>⚡ ECM Register</h1>
          <p>Browser-local SQLite workspace</p>
        </div>
        <nav className="nav">
          {NAV.map(([key, label]) => (
            <button key={key} className={active === key ? "active" : ""} onClick={() => setActive(key)}>
              <span>{label}</span>
              {key === "setup" && ready ? <span>OK</span> : null}
            </button>
          ))}
        </nav>
        <div className="status-panel">
          <span className="pill">{ready ? "Database online" : "Setup required"}</span>
          <div>Vercel hosts the app only. Files stay local.</div>
        </div>
      </aside>

      <main className="main">
        <div className="hero">
          <div>
            <span className="eyebrow">TODAY ENERGY CONTROL</span>
            <h2>Local ECM Register</h2>
            <p>Manage properties, ECMs, usage, reports, Obsidian notes, and calculation evidence while keeping every working file local to your machine.</p>
          </div>
          <span className="pill">{ready ? "Synced local workspace" : "Setup required"}</span>
        </div>

        {active === "setup" && (
          <SetupView
            handles={handles}
            folderStatuses={folderStatuses}
            configureFolder={configureFolder}
            importDatabase={importDatabase}
            loadDatabase={() => openDatabaseFolder(handles.database)}
            data={data}
            setupError={setupError}
            busy={busy}
            ready={ready}
          />
        )}
        {active === "dashboard" && <DashboardView data={data} ready={ready} />}
        {active === "properties" && (
          <PropertiesView
            ready={ready}
            properties={properties}
            form={propertyForm}
            setForm={setPropertyForm}
            save={saveProperty}
            remove={removeProperty}
          />
        )}
        {active === "tenants" && (
          <TenantsEquipmentView
            ready={ready}
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
            tenants={data?.tenants || []}
            equipment={data?.equipment || []}
            tenantForm={tenantForm}
            setTenantForm={setTenantForm}
            equipmentForm={equipmentForm}
            setEquipmentForm={setEquipmentForm}
            saveTenant={saveTenant}
            removeTenant={removeTenant}
            saveEquipment={saveEquipment}
            removeEquipment={removeEquipment}
          />
        )}
        {active === "ecms" && (
          <EcmView
            ready={ready}
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
            filteredEcms={filteredEcms}
            ecmForm={ecmForm}
            setEcmForm={setEcmForm}
            saveEcm={saveEcm}
            editEcm={editEcm}
            selectedEcmId={selectedEcmId}
            removeEcm={removeEcm}
            calcFile={calcFile}
            setCalcFile={setCalcFile}
            busy={busy}
          />
        )}
        {active === "savings" && (
          <SavingsView
            ready={ready}
            properties={properties}
            implementedEcms={implementedEcms}
            savings={data?.implementedSavings || []}
            form={savingForm}
            setForm={setSavingForm}
            save={saveImplementedSaving}
            busy={busy}
          />
        )}
        {active === "usage" && (
          <MonthlyUsageView
            ready={ready}
            properties={properties}
            tenants={data?.tenants || []}
            usage={data?.monthlyUsage || []}
            form={usageForm}
            setForm={setUsageForm}
            save={saveUsage}
            remove={removeUsage}
          />
        )}
        {active === "meetings" && (
          <MeetingsView
            ready={ready}
            properties={properties}
            form={meetingForm}
            setForm={setMeetingForm}
            save={createMeetingNote}
            loadMeetingFiles={loadMeetingFiles}
            meetingFiles={meetingFiles}
            selectedMeetingName={selectedMeetingName}
            selectMeeting={selectMeeting}
            meetingDraft={meetingDraft}
            setMeetingDraft={setMeetingDraft}
            saveMeetingDraft={saveMeetingDraft}
          />
        )}
        {active === "reports" && (
          <ReportsView
            ready={ready}
            db={db}
            properties={properties}
            selectedProperty={selectedProperty}
            setSelectedPropertyId={setSelectedPropertyId}
            importEcmReviewWorkbook={importEcmReviewWorkbook}
            busy={busy}
          />
        )}
        {active === "database" && <DatabaseView ready={ready} db={db} sqlText={sqlText} setSqlText={setSqlText} runSql={runSql} sqlRows={sqlRows} />}
        {active === "admin" && (
          <DatabaseAdminView
            ready={ready}
            db={db}
            data={data}
            syncObsidianNotes={syncObsidianNotes}
            createDatabaseBackup={createDatabaseBackup}
            downloadDatabaseFile={downloadDatabaseFile}
            busy={busy}
          />
        )}
      </main>
    </div>
  );
}

function SetupView({ handles, folderStatuses, configureFolder, importDatabase, loadDatabase, data, setupError, busy, ready }) {
  const requiredConfigured = FOLDERS.filter((folder) => folder.required).every((folder) => handles[folder.key]);
  return (
    <section className="section">
      <h3>Folder Setup</h3>
      <p className="muted">Configure local folders once per browser/device. Folder permissions are stored in the browser, not on Vercel.</p>
      {setupError ? <div className="card" style={{ borderColor: "rgba(255,95,95,0.45)", color: "#ffd8d8", marginBottom: 14 }}>{setupError}</div> : null}
      {ready && data ? (
        <div className="grid four" style={{ marginBottom: 14 }}>
          <Kpi label="Loaded Properties" value={data.properties.length} />
          <Kpi label="Loaded ECMs" value={data.ecms.length} />
          <Kpi label="Monthly Usage Rows" value={data.monthlyUsage.length} />
          <Kpi label="Implemented Savings" value={data.implementedSavings.length} />
        </div>
      ) : null}
      <div className="grid two">
        {FOLDERS.map((folder) => (
          <div className="card" key={folder.key}>
            <div className="kpi">
              <div className="label">{folder.required ? "Required" : "Optional"}</div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginTop: 10 }}>
                <strong>{folder.label}</strong>
                <span className="pill">{folderStatusLabel(handles[folder.key], folderStatuses[folder.key])}</span>
              </div>
            </div>
            <div className="toolbar">
              <button className="btn" onClick={() => configureFolder(folder.key)}>Select Folder</button>
            </div>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={!handles.database || busy} onClick={loadDatabase}>{busy ? "Working..." : "Load Workspace"}</button>
        <button className="btn primary" disabled={!handles.database || busy} onClick={importDatabase}>Import Existing .db</button>
        <span className="muted">
          {ready
            ? "ecm_register.db is open. Go to Dashboard or ECMs."
            : requiredConfigured
              ? "Required folders are remembered. Click Load Workspace after reopening the browser to restore permissions and load the database."
              : "Select the required folders first, then import your existing .db."}
        </span>
      </div>
    </section>
  );
}

function folderStatusLabel(handle, status) {
  if (!handle) return "Missing";
  if (status === "granted") return "Ready";
  if (status === "denied") return "Blocked";
  return "Remembered";
}

function DashboardView({ data, ready }) {
  if (!ready) return <EmptyState />;
  const ecms = data.ecms || [];
  const open = ecms.filter((item) => item.status === "Open");
  const implemented = ecms.filter((item) => item.status === "Implemented");
  const openSaving = open.reduce((sum, item) => sum + Number(item.annual_saving_eur || 0), 0);
  const implementedSaving = implemented.reduce((sum, item) => sum + Number(item.annual_saving_eur || 0), 0);
  const totalEnergy = ecms.reduce((sum, item) => sum + Number(item.energy_saving_kwh || 0), 0);
  return (
    <section className="section">
      <h3>Dashboard</h3>
      <div className="grid four">
        <Kpi label="Properties" value={data.properties.length} />
        <Kpi label="Tenants" value={(data.tenants || []).length} />
        <Kpi label="Equipment" value={(data.equipment || []).length} />
        <Kpi label="ECMs" value={ecms.length} />
      </div>
      <div className="grid four" style={{ marginTop: 14 }}>
        <Kpi label="Open ECMs" value={open.length} />
        <Kpi label="Implemented" value={implemented.length} />
        <Kpi label="Open savings" value={`€${money(openSaving)}/a`} />
        <Kpi label="Implemented savings" value={`€${money(implementedSaving)}/a`} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <Kpi label="Total energy saving" value={`${kwh(totalEnergy)} kWh/a`} />
        <Kpi label="Monthly usage records" value={(data.monthlyUsage || []).length} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <SummaryTable title="ECM Status" rows={countRows(ecms, "status")} />
        <SummaryTable title="Utility Impacted" rows={countRows(ecms, "utility_type")} />
      </div>
    </section>
  );
}

function PropertiesView({ ready, properties, form, setForm, save, remove }) {
  if (!ready) return <EmptyState />;
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="section">
      <h3>Properties</h3>
      <div className="grid two">
        <div className="card">
          <form onSubmit={save}>
            <Field label="Name"><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
            <Field label="Address"><input value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <div className="grid two">
              <Field label="Total floor area m²"><input type="number" step="0.01" value={form.total_floor_area} onChange={(e) => set("total_floor_area", e.target.value)} /></Field>
              <Field label="Electricity cost EUR/kWh"><input type="number" step="0.0001" value={form.elec_cost_eur_per_kwh} onChange={(e) => set("elec_cost_eur_per_kwh", e.target.value)} /></Field>
              <Field label="Heating cost EUR/kWh"><input type="number" step="0.0001" value={form.heating_cost_eur_per_kwh} onChange={(e) => set("heating_cost_eur_per_kwh", e.target.value)} /></Field>
              <Field label="Cooling cost EUR/kWh"><input type="number" step="0.0001" value={form.cooling_cost_eur_per_kwh} onChange={(e) => set("cooling_cost_eur_per_kwh", e.target.value)} /></Field>
            </div>
            <Field label="Notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            <div className="toolbar">
              <button className="btn primary">Save Property</button>
              <button className="btn" type="button" onClick={() => setForm(EMPTY_PROPERTY)}>New Property</button>
            </div>
          </form>
        </div>
        <div className="card" style={{ overflow: "auto", maxHeight: 680 }}>
          <table>
            <thead><tr><th>Name</th><th>Area</th><th>Costs</th><th></th></tr></thead>
            <tbody>
              {properties.map((property) => (
                <tr key={property.id}>
                  <td onClick={() => setForm({ ...property, total_floor_area: property.total_floor_area ?? "" })} style={{ cursor: "pointer" }}>
                    <strong>{property.name}</strong><br /><span className="muted">{property.address}</span>
                  </td>
                  <td>{money(property.total_floor_area)} m²</td>
                  <td>Elec €{money(property.elec_cost_eur_per_kwh)} / Heat €{money(property.heating_cost_eur_per_kwh)} / Cool €{money(property.cooling_cost_eur_per_kwh)}</td>
                  <td><button className="btn danger" type="button" onClick={() => remove(property.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TenantsEquipmentView(props) {
  const { ready, properties, selectedPropertyId, setSelectedPropertyId, tenants, equipment, tenantForm, setTenantForm, equipmentForm, setEquipmentForm, saveTenant, removeTenant, saveEquipment, removeEquipment } = props;
  if (!ready) return <EmptyState />;
  const scopedTenants = tenants.filter((tenant) => tenant.property_id === Number(selectedPropertyId));
  const scopedEquipment = equipment.filter((item) => item.property_id === Number(selectedPropertyId));
  const setTenant = (key, value) => setTenantForm((prev) => ({ ...prev, [key]: value }));
  const setEquip = (key, value) => setEquipmentForm((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="section">
      <h3>Tenants & Equipment</h3>
      <div className="toolbar">
        <select className="input" value={selectedPropertyId} onChange={(e) => {
          setSelectedPropertyId(e.target.value);
          setTenantForm({ ...EMPTY_TENANT, property_id: e.target.value });
          setEquipmentForm({ ...EMPTY_EQUIPMENT, property_id: e.target.value });
        }} style={{ maxWidth: 420 }}>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </select>
      </div>
      <div className="grid two">
        <div className="card">
          <h3>Tenants</h3>
          <form onSubmit={saveTenant}>
            <Field label="Tenant name"><input value={tenantForm.tenant_name} onChange={(e) => setTenant("tenant_name", e.target.value)} required /></Field>
            <div className="grid two">
              <Field label="Location label"><input value={tenantForm.location_label} onChange={(e) => setTenant("location_label", e.target.value)} /></Field>
              <Field label="Tenant floor area m²"><input type="number" step="0.01" value={tenantForm.tenant_floor_area} onChange={(e) => setTenant("tenant_floor_area", e.target.value)} /></Field>
            </div>
            <Field label="Notes / sublocations"><textarea value={tenantForm.notes} onChange={(e) => setTenant("notes", e.target.value)} /></Field>
            <div className="toolbar">
              <button className="btn primary">Save Tenant</button>
              <button className="btn" type="button" onClick={() => setTenantForm({ ...EMPTY_TENANT, property_id: selectedPropertyId })}>New Tenant</button>
            </div>
          </form>
          <CompactTable rows={scopedTenants} columns={[
            ["tenant_name", "Tenant"],
            ["location_label", "Location"],
            ["tenant_floor_area", "Area m²"]
          ]} onEdit={(row) => setTenantForm({ ...row, property_id: String(row.property_id), tenant_floor_area: row.tenant_floor_area ?? "" })} onRemove={removeTenant} />
        </div>
        <div className="card">
          <h3>Equipment</h3>
          <form onSubmit={saveEquipment}>
            <Field label="Equipment name"><input value={equipmentForm.equipment_name} onChange={(e) => setEquip("equipment_name", e.target.value)} required /></Field>
            <div className="grid two">
              <Field label="Tenant scope"><select value={equipmentForm.tenant_id} onChange={(e) => setEquip("tenant_id", e.target.value)}><option value="">Whole property</option>{scopedTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.tenant_name} - {tenant.location_label}</option>)}</select></Field>
              <Field label="Utility"><select value={equipmentForm.utility_type} onChange={(e) => setEquip("utility_type", e.target.value)}>{["electricity", "heating", "cooling", ""].map((s) => <option key={s} value={s}>{s || "not stated"}</option>)}</select></Field>
            </div>
            <div className="grid two">
              <Field label="Equipment type"><select value={equipmentForm.equipment_type} onChange={(e) => setEquipmentForm((prev) => ({ ...prev, equipment_type: e.target.value, brick_class: EQUIPMENT_TYPE_TO_BRICK_CLASS[e.target.value] || "" }))}>{Object.keys(EQUIPMENT_TYPE_TO_BRICK_CLASS).map((type) => <option key={type}>{type}</option>)}</select></Field>
              <Field label="Brick class"><input value={equipmentForm.brick_class} onChange={(e) => setEquip("brick_class", e.target.value)} /></Field>
            </div>
            <Field label="Notes"><textarea value={equipmentForm.notes} onChange={(e) => setEquip("notes", e.target.value)} /></Field>
            <div className="toolbar">
              <button className="btn primary">Save Equipment</button>
              <button className="btn" type="button" onClick={() => setEquipmentForm({ ...EMPTY_EQUIPMENT, property_id: selectedPropertyId })}>New Equipment</button>
            </div>
          </form>
          <CompactTable rows={scopedEquipment} columns={[
            ["equipment_name", "Equipment"],
            ["equipment_type", "Type"],
            ["brick_class", "Brick"]
          ]} onEdit={(row) => setEquipmentForm({ ...row, property_id: String(row.property_id), tenant_id: row.tenant_id ? String(row.tenant_id) : "" })} onRemove={removeEquipment} />
        </div>
      </div>
    </section>
  );
}

function EcmView(props) {
  const { ready, properties, selectedPropertyId, setSelectedPropertyId, filteredEcms, ecmForm, setEcmForm, saveEcm, editEcm, selectedEcmId, removeEcm, calcFile, setCalcFile, busy } = props;
  if (!ready) return <EmptyState />;
  const set = (key, value) => setEcmForm((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="section">
      <h3>ECMs</h3>
      <div className="toolbar">
        <select className="input" value={selectedPropertyId} onChange={(e) => setSelectedPropertyId(e.target.value)} style={{ maxWidth: 420 }}>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </select>
        <button className="btn" onClick={() => setEcmForm({ ...EMPTY_ECM, property_id: selectedPropertyId })}>New ECM</button>
      </div>
      <div className="grid two">
        <div className="card">
          <form onSubmit={saveEcm}>
            <div className="grid two">
              <Field label="Property"><select value={ecmForm.property_id} onChange={(e) => set("property_id", e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Ref"><input value={ecmForm.ref} onChange={(e) => set("ref", e.target.value)} required /></Field>
            </div>
            <Field label="ECM title"><input value={ecmForm.title} onChange={(e) => set("title", e.target.value)} required /></Field>
            <div className="grid three">
              <Field label="Status"><select value={ecmForm.status} onChange={(e) => set("status", e.target.value)}>{["Open", "Approved", "In Progress", "Implemented", "Rejected", "On Hold"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Utility"><select value={ecmForm.utility_type} onChange={(e) => set("utility_type", e.target.value)}>{["electricity", "heating", "cooling"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Approved"><select value={ecmForm.approved ? "yes" : "no"} onChange={(e) => set("approved", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></Field>
            </div>
            <div className="grid two">
              <Field label="Investment EUR"><input type="number" step="0.01" value={ecmForm.investment_eur} onChange={(e) => set("investment_eur", e.target.value)} /></Field>
              <Field label="Energy saving kWh/a"><input type="number" step="0.01" value={ecmForm.energy_saving_kwh} onChange={(e) => set("energy_saving_kwh", e.target.value)} /></Field>
            </div>
            <Field label="What & why"><textarea value={ecmForm.what_why} onChange={(e) => set("what_why", e.target.value)} /></Field>
            <Field label="Pitfall"><textarea value={ecmForm.pitfall} onChange={(e) => set("pitfall", e.target.value)} /></Field>
            <Field label="Action"><textarea value={ecmForm.action} onChange={(e) => set("action", e.target.value)} /></Field>
            <Field label="Notes"><textarea value={ecmForm.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            <Field label="Calculation reference file"><input type="file" onChange={(e) => setCalcFile(e.target.files?.[0] || null)} /></Field>
            {calcFile ? <p className="muted">Selected: {calcFile.name}</p> : null}
            <div className="toolbar">
              <button className="btn primary" disabled={busy}>{busy ? "Saving..." : "Save ECM"}</button>
              <button type="button" className="btn danger" disabled={!selectedEcmId} onClick={removeEcm}>Remove ECM</button>
            </div>
          </form>
        </div>
        <div className="card" style={{ overflow: "auto", maxHeight: 720 }}>
          <table>
            <thead><tr><th>Ref</th><th>ECM</th><th>Status</th><th>Saving</th></tr></thead>
            <tbody>
              {filteredEcms.map((ecm) => (
                <tr key={ecm.id} onClick={() => editEcm(ecm.id)} style={{ cursor: "pointer" }}>
                  <td>{ecm.ref}</td>
                  <td>{ecm.title}</td>
                  <td>{ecm.status}</td>
                  <td>EUR {money(ecm.annual_saving_eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SavingsView({ ready, properties, implementedEcms, savings, form, setForm, save, busy }) {
  if (!ready) return <EmptyState />;
  const selectedEcm = implementedEcms.find((ecm) => ecm.id === Number(form.ecm_id));
  const selectedProperty = properties.find((property) => property.id === Number(form.property_id)) || properties.find((property) => property.id === selectedEcm?.property_id);
  const unitCost = form.unit_cost_eur_per_kwh || utilityCost(selectedProperty, form.utility_type);
  const costSaving = Number(form.energy_saving_kwh || 0) * Number(unitCost || 0);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="section">
      <h3>Implemented Savings</h3>
      <div className="grid two">
        <div className="card">
          <form onSubmit={save}>
            <Field label="Implemented ECM">
              <select value={form.ecm_id} onChange={(e) => {
                const ecm = implementedEcms.find((item) => item.id === Number(e.target.value));
                setForm((prev) => ({ ...prev, ecm_id: e.target.value, property_id: ecm?.property_id || prev.property_id, utility_type: ecm?.utility_type || prev.utility_type }));
              }} required>
                <option value="">Select ECM...</option>
                {implementedEcms.map((ecm) => <option key={ecm.id} value={ecm.id}>{ecm.property_name} - {ecm.ref} - {ecm.title}</option>)}
              </select>
            </Field>
            <div className="grid two">
              <Field label="Start date"><input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} required /></Field>
              <Field label="End date"><input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} required /></Field>
            </div>
            <div className="grid three">
              <Field label="Utility"><select value={form.utility_type} onChange={(e) => set("utility_type", e.target.value)}>{["electricity", "heating", "cooling"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Energy saving kWh"><input type="number" step="0.01" value={form.energy_saving_kwh} onChange={(e) => set("energy_saving_kwh", e.target.value)} /></Field>
              <Field label="Unit cost EUR/kWh"><input type="number" step="0.01" value={unitCost} onChange={(e) => set("unit_cost_eur_per_kwh", e.target.value)} /></Field>
            </div>
            <p className="pill">Calculated saving EUR {money(costSaving)}</p>
            <Field label="Measurement notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            <button className="btn primary" disabled={busy}>{busy ? "Saving..." : "Save Implemented Saving"}</button>
          </form>
        </div>
        <div className="card" style={{ overflow: "auto", maxHeight: 620 }}>
          <table>
            <thead><tr><th>Property</th><th>ECM</th><th>Period</th><th>Saving</th></tr></thead>
            <tbody>
              {savings.map((saving) => (
                <tr key={saving.id}>
                  <td>{saving.property_name}</td>
                  <td>{saving.ref}</td>
                  <td>{saving.start_date} to {saving.end_date}</td>
                  <td>EUR {money(saving.cost_saving_eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MonthlyUsageView({ ready, properties, tenants, usage, form, setForm, save, remove }) {
  if (!ready) return <EmptyState />;
  const propertyTenants = tenants.filter((tenant) => tenant.property_id === Number(form.property_id));
  const scopedUsage = usage.filter((row) => !form.property_id || row.property_id === Number(form.property_id)).slice(0, 80);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="section">
      <h3>Monthly Usage</h3>
      <div className="grid two">
        <div className="card">
          <form onSubmit={save}>
            <div className="grid two">
              <Field label="Property"><select value={form.property_id} onChange={(e) => set("property_id", e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Month"><input type="month" value={form.usage_month} onChange={(e) => set("usage_month", e.target.value)} required /></Field>
            </div>
            <div className="grid two">
              <Field label="Scope"><select value={form.scope_type} onChange={(e) => set("scope_type", e.target.value)}><option value="building">Whole building</option><option value="tenant">Tenant</option></select></Field>
              <Field label="Tenant">{form.scope_type === "tenant" ? <select value={form.tenant_id} onChange={(e) => set("tenant_id", e.target.value)}><option value="">Select tenant...</option>{propertyTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.tenant_name} - {tenant.location_label}</option>)}</select> : <input value="Whole building" disabled />}</Field>
            </div>
            <div className="grid three">
              <Field label="Electricity kWh"><input type="number" step="0.01" value={form.electricity_kwh} onChange={(e) => set("electricity_kwh", e.target.value)} /></Field>
              <Field label="Heating kWh"><input type="number" step="0.01" value={form.heating_kwh} onChange={(e) => set("heating_kwh", e.target.value)} /></Field>
              <Field label="Cooling kWh"><input type="number" step="0.01" value={form.cooling_kwh} onChange={(e) => set("cooling_kwh", e.target.value)} /></Field>
            </div>
            <Field label="Notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            <div className="toolbar">
              <button className="btn primary">Save Usage</button>
              <button className="btn" type="button" onClick={() => setForm({ ...defaultUsageForm(), property_id: form.property_id })}>New Usage Record</button>
            </div>
          </form>
        </div>
        <div className="card" style={{ overflow: "auto", maxHeight: 680 }}>
          <table>
            <thead><tr><th>Month</th><th>Scope</th><th>Electricity</th><th>Heating</th><th>Cooling</th><th></th></tr></thead>
            <tbody>
              {scopedUsage.map((row) => (
                <tr key={row.id}>
                  <td onClick={() => setForm({ ...row, property_id: String(row.property_id), tenant_id: row.tenant_id ? String(row.tenant_id) : "" })} style={{ cursor: "pointer" }}>{row.usage_month}</td>
                  <td>{row.scope_type === "tenant" ? row.tenant_name : "Whole building"}</td>
                  <td>{kwh(row.electricity_kwh)} kWh</td>
                  <td>{kwh(row.heating_kwh)} kWh</td>
                  <td>{kwh(row.cooling_kwh)} kWh</td>
                  <td><button className="btn danger" type="button" onClick={() => remove(row.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MeetingsView({ ready, properties, form, setForm, save, loadMeetingFiles, meetingFiles, selectedMeetingName, selectMeeting, meetingDraft, setMeetingDraft, saveMeetingDraft }) {
  if (!ready) return <EmptyState />;
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="section">
      <h3>Monthly Meeting Notes</h3>
      <div className="grid two meeting-notes-grid">
      <div className="card meeting-note-card">
        <form className="meeting-note-form" onSubmit={save}>
          <div className="grid three">
            <Field label="Property"><select value={form.property_id} onChange={(e) => set("property_id", e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Report month"><input type="month" value={form.report_month} onChange={(e) => set("report_month", e.target.value)} /></Field>
            <Field label="Meeting date"><input type="date" value={form.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} /></Field>
          </div>
          <Field label="Comments pre meeting" className="meeting-note-field"><textarea className="meeting-note-textarea" value={form.pre} onChange={(e) => set("pre", e.target.value)} /></Field>
          <button className="btn primary">Save Meeting Note to Obsidian</button>
        </form>
      </div>
      <div className="card meeting-note-card">
        <div className="meeting-note-controls">
          <button className="btn" type="button" onClick={loadMeetingFiles}>Load Existing Notes</button>
          <select className="input" value={selectedMeetingName} onChange={(e) => selectMeeting(e.target.value)}>
            <option value="">Select note...</option>
            {meetingFiles.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}
          </select>
        </div>
        <Field label="Existing note - comments post meeting" className="meeting-note-field">
          <textarea
            className="meeting-note-textarea"
            value={meetingDraft.post || ""}
            onChange={(e) => setMeetingDraft((prev) => ({ ...prev, post: e.target.value }))}
          />
        </Field>
        <button className="btn primary" type="button" disabled={!selectedMeetingName} onClick={saveMeetingDraft}>Save Existing Note</button>
      </div>
      </div>
    </section>
  );
}

function ReportsView({ ready, db, properties, selectedProperty, setSelectedPropertyId, importEcmReviewWorkbook, busy }) {
  if (!ready) return <EmptyState />;
  return (
    <section className="section">
      <h3>Reports</h3>
      <div className="card">
        <div className="toolbar">
          <select className="input" value={selectedProperty?.id || ""} onChange={(e) => setSelectedPropertyId(e.target.value)} style={{ maxWidth: 380 }}>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn primary" onClick={() => downloadExcelRegister(db, selectedProperty)}>Excel - Selected Property</button>
          <button className="btn" onClick={() => downloadExcelRegister(db, null)}>Excel - All Properties</button>
          <button className="btn" onClick={() => downloadEcmReviewWorkbook(db, selectedProperty)}>ECM List Template - Selected</button>
          <button className="btn" onClick={() => downloadEcmReviewWorkbook(db, null)}>ECM List Template - All</button>
          <label className={`btn ${busy ? "disabled" : ""}`}>
            {busy ? "Importing..." : "Import Reviewed ECM Workbook"}
            <input type="file" accept=".xlsx" onChange={importEcmReviewWorkbook} disabled={busy} style={{ display: "none" }} />
          </label>
          <button className="btn" onClick={() => downloadWordRegister(db, selectedProperty)}>Word - Selected Property</button>
          <button className="btn" onClick={() => downloadPdfRegister(db, selectedProperty)}>PDF - Selected Property</button>
        </div>
        <p className="muted">Exports download locally. The ECM list template is designed for Excel review and can be imported back using the stable ecm_id column.</p>
      </div>
    </section>
  );
}

function DatabaseView({ ready, db, sqlText, setSqlText, runSql, sqlRows }) {
  if (!ready) return <EmptyState />;
  const tables = ["properties", "tenants", "equipment", "ecms", "monthly_utility_usage", "ecm_measured_savings", "ecm_attachments"];
  return (
    <section className="section">
      <h3>Database</h3>
      <div className="grid four">
        {tables.slice(0, 4).map((table) => <Kpi key={table} label={table} value={tableCount(db, table)} />)}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <Field label="Read-only SQL"><textarea value={sqlText} onChange={(e) => setSqlText(e.target.value)} /></Field>
        <button className="btn primary" onClick={runSql}>Run SELECT</button>
      </div>
      {sqlRows.length ? (
        <div className="card" style={{ overflow: "auto", marginTop: 14 }}>
          <table>
            <thead><tr>{Object.keys(sqlRows[0]).map((key) => <th key={key}>{key}</th>)}</tr></thead>
            <tbody>{sqlRows.map((row, i) => <tr key={i}>{Object.keys(sqlRows[0]).map((key) => <td key={key}>{String(row[key] ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function DatabaseAdminView({ ready, db, data, syncObsidianNotes, createDatabaseBackup, downloadDatabaseFile, busy }) {
  if (!ready) return <EmptyState />;
  const health = databaseHealth(db);
  const integrity = health.integrity?.[0]?.integrity_check || "unknown";
  const foreignKeyIssues = health.foreignKeys?.length || 0;
  const missingEcmNotes = (data?.ecms || []).filter((ecm) => !ecm.obsidian_filename).length;
  const missingSavingNotes = (data?.implementedSavings || []).filter((saving) => !saving.obsidian_filename).length;
  return (
    <section className="section">
      <h3>Database Admin</h3>
      <div className="grid four">
        <Kpi label="Integrity" value={integrity} />
        <Kpi label="FK issues" value={foreignKeyIssues} />
        <Kpi label="ECM notes to sync" value={missingEcmNotes} />
        <Kpi label="Savings notes to sync" value={missingSavingNotes} />
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="toolbar">
          <button className="btn primary" disabled={busy} onClick={syncObsidianNotes}>{busy ? "Syncing..." : "Sync DB Records to Obsidian"}</button>
          <button className="btn" onClick={createDatabaseBackup}>Create Local DB Backup</button>
          <button className="btn" onClick={downloadDatabaseFile}>Download DB File</button>
        </div>
        <p className="muted">Sync writes ECM and implemented-savings Markdown files for existing database records and stores the generated filenames back into SQLite.</p>
      </div>
      <div className="card" style={{ overflow: "auto", marginTop: 14 }}>
        <table>
          <thead><tr><th>Table</th><th>Rows</th></tr></thead>
          <tbody>{health.tables.map((row) => <tr key={row.table}><td>{row.table}</td><td>{row.rows}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function Kpi({ label, value }) {
  return <div className="card kpi"><div className="label">{label}</div><div className="value">{value}</div></div>;
}

function SummaryTable({ title, rows }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <table>
        <thead><tr><th>Bucket</th><th>Count</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.count}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function CompactTable({ rows, columns, onEdit, onRemove }) {
  return (
    <div style={{ overflow: "auto", maxHeight: 320 }}>
      <table>
        <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}<th></th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map(([key]) => <td key={key} onClick={() => onEdit(row)} style={{ cursor: "pointer" }}>{String(row[key] ?? "")}</td>)}
              <td><button className="btn danger" type="button" onClick={() => onRemove(row.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, children, className = "" }) {
  return <div className={`field ${className}`.trim()}><label>{label}</label>{children}</div>;
}

function EmptyState() {
  return <section className="section"><div className="card"><h3>Setup Required</h3><p className="muted">Configure the local folders and open or import an ECM database first.</p></div></section>;
}

function defaultSavingForm() {
  return { ecm_id: "", property_id: "", utility_type: "electricity", start_date: todayIso(), end_date: todayIso(), energy_saving_kwh: "", unit_cost_eur_per_kwh: "", notes: "" };
}

function defaultUsageForm() {
  return {
    property_id: "",
    tenant_id: "",
    scope_type: "building",
    usage_month: todayIso().slice(0, 7),
    electricity_kwh: "",
    heating_kwh: "",
    cooling_kwh: "",
    notes: ""
  };
}

function countRows(rows, key) {
  const counts = new Map();
  for (const row of rows || []) {
    const label = row[key] || "Not stated";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function rollingPerformance(rows, propertyId, reportMonth) {
  const currentMonths = monthRange(reportMonth, 11);
  const previousEnd = shiftMonth(reportMonth, -12);
  const previousMonths = monthRange(previousEnd, 11);
  const utilities = {};
  for (const utility of ["electricity", "heating", "cooling"]) {
    const key = `${utility}_kwh`;
    const current = sumUsage(rows, propertyId, currentMonths, key);
    const previous = sumUsage(rows, propertyId, previousMonths, key);
    const diff = current - previous;
    utilities[utility] = { current, previous, diff, percentDiff: previous ? (diff / previous) * 100 : null };
  }
  return {
    currentLabel: `${currentMonths[0]} to ${currentMonths[currentMonths.length - 1]}`,
    previousLabel: `${previousMonths[0]} to ${previousMonths[previousMonths.length - 1]}`,
    utilities
  };
}

function sumUsage(rows, propertyId, months, key) {
  const set = new Set(months);
  return (rows || [])
    .filter((row) => row.property_id === propertyId && set.has(row.usage_month))
    .reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function stringOrExisting(value, existing = "") {
  const text = String(value ?? "").trim();
  return text ? text : existing;
}

function numberOrExisting(value, existing = null) {
  if (value === "" || value === null || value === undefined) return existing;
  const n = Number(value);
  return Number.isFinite(n) ? n : existing;
}

function approvedValue(value, existing = false) {
  if (value === "" || value === null || value === undefined) return Boolean(existing);
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["yes", "true", "1", "approved"].includes(text)) return true;
  if (["no", "false", "0", "not approved"].includes(text)) return false;
  return Boolean(existing);
}

function monthRange(endMonth, countBack) {
  const out = [];
  for (let i = countBack; i >= 0; i--) out.push(shiftMonth(endMonth, -i));
  return out;
}

function shiftMonth(month, offset) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
