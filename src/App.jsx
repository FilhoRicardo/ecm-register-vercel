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
import { downloadCrremPdfReport, downloadEcmReviewWorkbook, downloadExcelRegister, downloadPptxRegister, parseEcmReviewWorkbook } from "./lib/reports.js";
import { EQUIPMENT_TYPE_TO_BRICK_CLASS, kwh, money, todayIso, utilityCost } from "./lib/format.js";
import {
  buildCrremAnalysis,
  CRREM_COUNTRIES,
  CRREM_DATA_ATTRIBUTION,
  CRREM_DATA_VERSION,
  CRREM_EMISSION_FACTORS_SOURCE,
  CRREM_PROPERTY_TYPES,
  COOLING_CARRIER_OPTIONS,
  getCrremDataAvailability,
  HEATING_CARRIER_OPTIONS,
  inferCrremCountry,
  normaliseCrremSettings
} from "./lib/crrem.js";

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
  ["crrem", "🌍 CRREM Plot"],
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
  crrem_country: "",
  crrem_property_type: "Office",
  heating_carrier: "natural_gas",
  cooling_carrier: "electric",
  renewable_consumed_kwh: "",
  renewable_exported_kwh: "",
  heating_emission_factor_kgco2e_per_kwh: "",
  cooling_emission_factor_kgco2e_per_kwh: "",
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
    if (next.database && statuses.database === "granted") await openDatabaseFolder(next.database, next);
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

  async function restoreFolderPermission(key) {
    try {
      setSetupError("");
      const handle = handles[key];
      if (!handle) return configureFolder(key);
      const granted = await ensurePermission(handle, "readwrite");
      const status = granted ? "granted" : await permissionState(handle, "readwrite");
      setFolderStatuses((prev) => ({ ...prev, [key]: status }));
      notify(granted ? "Folder permission restored." : "Folder permission was not granted.");
    } catch (error) {
      setSetupError(error.message || String(error));
      notify("Folder permission restore failed.");
    }
  }

  async function openDatabaseFolder(folderHandle, allHandles = handles, options = {}) {
    try {
      setBusy(true);
      setSetupError("");
      if (!folderHandle) throw new Error("Select the Database Folder first.");
      const statuses = {};
      for (const [key, handle] of Object.entries(allHandles)) {
        if (!handle) continue;
        const shouldRequest = key === "database" || options.requestAll;
        const granted = shouldRequest
          ? await ensurePermission(handle, "readwrite")
          : (await permissionState(handle, "readwrite")) === "granted";
        statuses[key] = granted ? "granted" : await permissionState(handle, "readwrite");
      }
      setFolderStatuses((prev) => ({ ...prev, ...statuses }));
      if (statuses.database !== "granted") throw new Error("Database folder permission was not granted.");
      const fileHandle = await folderHandle.getFileHandle("ecm_register.db", { create: true });
      const nextDb = await openDatabaseFromHandle(fileHandle);
      setDb(nextDb);
      setDbFileHandle(fileHandle);
      let ecmSyncMessage = "";
      if (allHandles.ecmNotes && statuses.ecmNotes === "granted") {
        try {
          const synced = await writeAllEcmMarkdownFiles(nextDb, allHandles.ecmNotes, { requestPermission: false });
          await saveDatabase(nextDb, fileHandle);
          ecmSyncMessage = ` Synced ${synced.count} ECM Markdown notes.`;
        } catch (syncError) {
          ecmSyncMessage = ` ECM Markdown sync skipped: ${syncError.message || String(syncError)}`;
        }
      }
      const nextData = getPortfolio(nextDb);
      setData(nextData);
      setActive("dashboard");
      notify(`Workspace loaded: ${nextData.properties.length} properties, ${nextData.ecms.length} ECMs.${ecmSyncMessage}`);
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
    const id = upsertProperty(db, {
      ...propertyForm,
      id: propertyForm.id || null,
      crrem_country: propertyForm.crrem_country || inferCrremCountry(propertyForm),
      crrem_property_type: propertyForm.crrem_property_type || "Office",
      heating_carrier: propertyForm.heating_carrier || "natural_gas",
      cooling_carrier: propertyForm.cooling_carrier || "electric"
    });
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
      const ecmSync = await writeAllEcmMarkdownFiles(db, handles.ecmNotes, { requestPermission: false });
      const propertiesNow = getProperties(db);
      const ecmsNow = getEcms(db);
      const savingsNow = getImplementedSavings(db);
      for (const saving of savingsNow) {
        const ecm = ecmsNow.find((item) => item.id === saving.ecm_id);
        const property = propertiesNow.find((item) => item.id === saving.property_id);
        const filename = saving.obsidian_filename || savingFilename({ ...saving, ...ecm });
        await writeTextIntoFolder(handles.savingNotes, filename, buildSavingMarkdown(saving, ecm, property));
        setSavingObsidianFilename(db, saving.id, filename);
      }
      await persist(`Synced ${ecmSync.count} ECM notes and ${savingsNow.length} implemented-savings notes to Obsidian.`);
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function syncEcmMarkdownNotes() {
    setBusy(true);
    try {
      const ecmSync = await writeAllEcmMarkdownFiles(db, handles.ecmNotes);
      await persist(`Synced ${ecmSync.count} ECM Markdown files to Obsidian.`);
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function writeAllEcmMarkdownFiles(targetDb, ecmNotesHandle, options = {}) {
    if (!targetDb) throw new Error("Load a database before syncing ECM notes.");
    if (!ecmNotesHandle) throw new Error("Configure the ECM Notes folder first.");
    const requestPermission = options.requestPermission !== false;
    const granted = requestPermission
      ? await ensurePermission(ecmNotesHandle, "readwrite")
      : (await permissionState(ecmNotesHandle, "readwrite")) === "granted";
    setFolderStatuses((prev) => ({ ...prev, ecmNotes: granted ? "granted" : "denied" }));
    if (!granted) throw new Error("ECM Notes folder permission was not granted.");
    const propertiesNow = getProperties(targetDb);
    const ecmsNow = getEcms(targetDb);
    for (const ecm of ecmsNow) {
      const property = propertiesNow.find((item) => item.id === ecm.property_id);
      const attachments = getAttachments(targetDb, ecm.id);
      const filename = ecm.obsidian_filename || ecmFilename(ecm, property, ecmSequence(ecmsNow, ecm));
      await writeTextIntoFolder(ecmNotesHandle, filename, buildEcmMarkdown(ecm, property, attachments));
      if (ecm.obsidian_filename !== filename) setEcmObsidianFilename(targetDb, ecm.id, filename);
    }
    return { count: ecmsNow.length };
  }

  async function createDatabaseBackup() {
    const filename = `ecm_register_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    try {
      if (!db) throw new Error("Load a database before creating a backup.");
      const bytes = db.export();
      if (!handles.database) {
        downloadBlob(new Blob([bytes], { type: "application/octet-stream" }), filename);
        notify(`Database folder is not configured. Backup downloaded instead: ${filename}`);
        return;
      }
      const databaseGranted = await ensurePermission(handles.database, "readwrite");
      setFolderStatuses((prev) => ({ ...prev, database: databaseGranted ? "granted" : "denied" }));
      if (!databaseGranted) {
        downloadBlob(new Blob([bytes], { type: "application/octet-stream" }), filename);
        notify(`Database folder permission was not granted. Backup downloaded instead: ${filename}`);
        return;
      }
      const handle = await handles.database.getFileHandle(filename, { create: true });
      await saveDatabase(db, handle);
      notify(`Backup created in Database Folder: ${filename}`);
    } catch (error) {
      notify(error.message || String(error));
    }
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
      const ecmsNow = getEcms(db);
      const filename = ecm.obsidian_filename || ecmFilename(ecm, property, ecmSequence(ecmsNow, ecm));
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

  function ecmSequence(ecms, ecm) {
    const propertyEcms = (ecms || [])
      .filter((item) => item.property_id === ecm.property_id)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const index = propertyEcms.findIndex((item) => item.id === ecm.id);
    return index >= 0 ? index + 1 : propertyEcms.length + 1;
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
    const existingFiles = await listMarkdownFiles(handles.meetingNotes);
    const existing = existingFiles.find((file) => file.name === filename);
    const existingSections = existing ? extractMeetingSections(existing.text) : null;
    if (existing && !window.confirm(`A meeting note named "${filename}" already exists. Update the pre-meeting section and keep the existing post-meeting comments?`)) {
      return;
    }
    const md = buildMeetingMarkdown({
      property,
      reportMonth: meetingForm.report_month,
      meetingDate: meetingForm.meeting_date,
      preMeeting: meetingForm.pre,
      postMeeting: existingSections?.post || "",
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
          const filename = saved.obsidian_filename || ecmFilename(saved, property, ecmSequence(getEcms(db), saved));
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
        <div className="mobile-nav">
          <select className="input" value={active} onChange={(event) => setActive(event.target.value)}>
            {NAV.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
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
            restoreFolderPermission={restoreFolderPermission}
            importDatabase={importDatabase}
            loadDatabase={() => openDatabaseFolder(handles.database, handles, { requestAll: true })}
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
        {active === "crrem" && (
          <CrremView
            ready={ready}
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
            monthlyUsage={data?.monthlyUsage || []}
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
            syncEcmMarkdownNotes={syncEcmMarkdownNotes}
            createDatabaseBackup={createDatabaseBackup}
            downloadDatabaseFile={downloadDatabaseFile}
            busy={busy}
          />
        )}
      </main>
    </div>
  );
}

function SetupView({ handles, folderStatuses, configureFolder, restoreFolderPermission, importDatabase, loadDatabase, data, setupError, busy, ready }) {
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
              <p className="muted" style={{ margin: "8px 0 0" }}>
                {handles[folder.key]?.name ? `Remembered folder: ${handles[folder.key].name}` : "No folder selected."}
              </p>
            </div>
            <div className="toolbar">
              {handles[folder.key] ? (
                <>
                  <button className="btn" onClick={() => restoreFolderPermission(folder.key)}>Restore Permission</button>
                  <button className="btn" onClick={() => configureFolder(folder.key)}>Change Folder</button>
                </>
              ) : (
                <button className="btn" onClick={() => configureFolder(folder.key)}>Select Folder</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={!handles.database || busy} onClick={loadDatabase}>{busy ? "Working..." : ready ? "Reload Workspace" : "Resume Workspace"}</button>
        <button className="btn primary" disabled={!handles.database || busy} onClick={importDatabase}>Import Existing .db</button>
        <span className="muted">
          {ready
            ? "ecm_register.db is open. Go to Dashboard or ECMs."
            : requiredConfigured
              ? "Required folders are remembered. Click Resume Workspace after reopening the browser to restore permissions and load the database."
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
  if (status === "prompt") return "Permission needed";
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
  const inferredCountry = inferCrremCountry(form);
  return (
    <section className="section">
      <h3>Properties</h3>
      <div className="grid two">
        <div className="card">
          <form onSubmit={save}>
            <Field label="Name" help="Enter the building or asset name used in reports and filters."><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
            <Field label="Address" help="Enter the full property address for report headers and CRREM country inference."><input value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <div className="grid two">
              <Field label="CRREM country" help="Select the country used to choose the CRREM pathway and grid emission factors.">
                <select value={form.crrem_country || ""} onChange={(e) => set("crrem_country", e.target.value)}>
                  <option value="">{inferredCountry ? `Use inferred: ${inferredCountry}` : "Select country..."}</option>
                  {CRREM_COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
                </select>
              </Field>
              <Field label="CRREM property type" help="Select the CRREM asset class that best matches the property use.">
                <select value={form.crrem_property_type || "Office"} onChange={(e) => set("crrem_property_type", e.target.value)}>
                  {CRREM_PROPERTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid two">
              <Field label="Heating carrier" help="Select the energy carrier behind the heating kWh entered in monthly usage. District heating requires a supplier/operator emissions factor override.">
                <select value={form.heating_carrier || "natural_gas"} onChange={(e) => set("heating_carrier", e.target.value)}>
                  {HEATING_CARRIER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Cooling carrier" help="Select the energy carrier behind the cooling kWh entered in monthly usage. District cooling requires a supplier/operator emissions factor override.">
                <select value={form.cooling_carrier || "electric"} onChange={(e) => set("cooling_carrier", e.target.value)}>
                  {COOLING_CARRIER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid two">
              <Field label="Heating emissions factor override" help="Required for district heating. Optional for other carriers if you have a project-specific factor in kgCO2e/kWh."><input type="number" step="0.0001" value={form.heating_emission_factor_kgco2e_per_kwh ?? ""} onChange={(e) => set("heating_emission_factor_kgco2e_per_kwh", e.target.value)} /></Field>
              <Field label="Cooling emissions factor override" help="Required for district cooling. Optional for other carriers if you have a project-specific factor in kgCO2e/kWh."><input type="number" step="0.0001" value={form.cooling_emission_factor_kgco2e_per_kwh ?? ""} onChange={(e) => set("cooling_emission_factor_kgco2e_per_kwh", e.target.value)} /></Field>
            </div>
            <div className="grid two">
              <Field label="On-site renewable consumed kWh/a" help="Annual renewable energy generated and used on site. Counts in EUI with zero carbon."><input type="number" step="0.01" value={form.renewable_consumed_kwh ?? ""} onChange={(e) => set("renewable_consumed_kwh", e.target.value)} /></Field>
              <Field label="On-site renewable exported kWh/a" help="Annual renewable electricity exported. Creates a capped grid carbon credit."><input type="number" step="0.01" value={form.renewable_exported_kwh ?? ""} onChange={(e) => set("renewable_exported_kwh", e.target.value)} /></Field>
            </div>
            <div className="grid two">
              <Field label="Total floor area m²" help="Enter gross internal area in square metres. CRREM EUI and carbon intensity divide by this number."><input type="number" step="0.01" value={form.total_floor_area} onChange={(e) => set("total_floor_area", e.target.value)} /></Field>
              <Field label="Electricity cost EUR/kWh" help="Enter the electricity unit cost used to calculate ECM annual cost savings."><input type="number" step="0.0001" value={form.elec_cost_eur_per_kwh} onChange={(e) => set("elec_cost_eur_per_kwh", e.target.value)} /></Field>
              <Field label="Heating cost EUR/kWh" help="Enter the heating unit cost used to calculate heating ECM savings."><input type="number" step="0.0001" value={form.heating_cost_eur_per_kwh} onChange={(e) => set("heating_cost_eur_per_kwh", e.target.value)} /></Field>
              <Field label="Cooling cost EUR/kWh" help="Enter the cooling unit cost used to calculate cooling ECM savings."><input type="number" step="0.0001" value={form.cooling_cost_eur_per_kwh} onChange={(e) => set("cooling_cost_eur_per_kwh", e.target.value)} /></Field>
            </div>
            <Field label="Notes" help="Use this for property codes, assumptions, or any context you want kept with the property."><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            <div className="toolbar">
              <button className="btn primary">Save Property</button>
              <button className="btn" type="button" onClick={() => setForm(EMPTY_PROPERTY)}>New Property</button>
            </div>
          </form>
        </div>
        <div className="card" style={{ overflow: "auto", maxHeight: 680 }}>
          <table>
            <thead><tr><th>Name</th><th>Area</th><th>CRREM</th><th>Carriers</th><th>Costs</th><th></th></tr></thead>
            <tbody>
              {properties.map((property) => (
                <tr key={property.id}>
                  <td onClick={() => setForm(propertyToForm(property))} style={{ cursor: "pointer" }}>
                    <strong>{property.name}</strong><br /><span className="muted">{property.address}</span>
                  </td>
                  <td>{money(property.total_floor_area)} m²</td>
                  <td>{normaliseCrremSettings(property).country} / {normaliseCrremSettings(property).propertyType}</td>
                  <td>{carrierLabel(HEATING_CARRIER_OPTIONS, property.heating_carrier || "natural_gas")} / {carrierLabel(COOLING_CARRIER_OPTIONS, property.cooling_carrier || "electric")}</td>
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

function CrremView({ ready, properties, selectedPropertyId, setSelectedPropertyId, monthlyUsage }) {
  const [mode, setMode] = useState("first_complete_year");
  const [reportingYear, setReportingYear] = useState("");
  const [rollingEndMonth, setRollingEndMonth] = useState("");
  const selectedId = Number(selectedPropertyId) || properties[0]?.id || "";
  const property = properties.find((item) => item.id === Number(selectedId)) || properties[0] || null;
  const availability = useMemo(
    () => getCrremDataAvailability(monthlyUsage, property?.id),
    [monthlyUsage, property?.id]
  );

  useEffect(() => {
    const latestFullYear = availability.fullYears.at(-1);
    if (latestFullYear && !availability.fullYears.includes(Number(reportingYear))) setReportingYear(String(latestFullYear));
    if (availability.latestMonth && !rollingEndMonth) setRollingEndMonth(availability.latestMonth);
  }, [availability.fullYears, availability.latestMonth, reportingYear, rollingEndMonth]);

  const analysis = useMemo(
    () => buildCrremAnalysis({ property, monthlyUsage, mode, reportingYear, rollingEndMonth }),
    [property, monthlyUsage, mode, reportingYear, rollingEndMonth]
  );

  if (!ready) return <EmptyState />;
  const settings = property ? normaliseCrremSettings(property) : { country: "", propertyType: "" };
  const chartPoints = analysis.ok ? combineCrremSeries(analysis.historical, analysis.projected) : [];
  return (
    <section className="section">
      <h3>CRREM Plot</h3>
      <div className="card">
        <div className="grid four">
          <Field label="Property">
            <select className="input" value={selectedId} onChange={(e) => setSelectedPropertyId(e.target.value)}>
              {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Baseline source">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="first_complete_year">First complete year</option>
              <option value="reporting_year">Reporting year</option>
              <option value="rolling_12">Rolling 12 months</option>
            </select>
          </Field>
          {mode === "reporting_year" ? (
            <Field label="Reporting year">
              <select value={reportingYear} onChange={(e) => setReportingYear(e.target.value)}>
                {availability.fullYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </Field>
          ) : mode === "first_complete_year" ? (
            <Field label="First complete year"><input value={availability.fullYears[0] || "No complete year"} disabled /></Field>
          ) : (
            <Field label="Usage source"><input value={availability.usageSource || "No usage"} disabled /></Field>
          )}
          {mode === "rolling_12" ? (
            <Field label="Rolling end month"><input type="month" value={rollingEndMonth} onChange={(e) => setRollingEndMonth(e.target.value)} /></Field>
          ) : (
            <Field label="Latest month"><input value={availability.latestMonth || "No usage"} disabled /></Field>
          )}
        </div>
        <p className="muted">
          CRREM settings: {settings.country || "not set"} / {settings.propertyType || "not set"}.
          Edit the property record to change country or asset type.
        </p>
      </div>

      {!analysis.ok ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>CRREM input needed</h3>
          <p className="muted">{analysis.error}</p>
        </div>
      ) : (
        <>
          <div className="grid four" style={{ marginTop: 14 }}>
            <Kpi label="Baseline EUI" value={`${formatCrremNumber(analysis.baselinePoint.eui)} kWh/m²/a`} />
            <Kpi label="Carbon intensity" value={`${formatCrremNumber(analysis.baselinePoint.carbonIntensity)} kgCO2e/m²/a`} />
            <Kpi label="CO2 misalignment" value={analysis.carbonMisalignmentYear} />
            <Kpi label="EUI misalignment" value={analysis.euiMisalignmentYear} />
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <CrremChart
              title="Carbon intensity pathway"
              unit="kgCO2e/m²/a"
              points={chartPoints}
              actualKey="carbonIntensity"
              pathwayKey="carbonPathway"
              baselineYear={analysis.baseline.year}
            />
            <CrremChart
              title="Energy intensity pathway"
              unit="kWh/m²/a"
              points={chartPoints}
              actualKey="eui"
              pathwayKey="euiPathway"
              baselineYear={analysis.baseline.year}
            />
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>Baseline Inputs</h3>
              <table>
                <tbody>
                  <tr><th>Baseline</th><td>{analysis.baseline.label}</td></tr>
                  <tr><th>Usage source</th><td>{analysis.usageSource}</td></tr>
                  <tr><th>Region code</th><td>{analysis.regionCode}</td></tr>
                  <tr><th>Floor area</th><td>{money(property.total_floor_area)} m²</td></tr>
                  <tr><th>Electricity</th><td>{kwh(analysis.baseline.usage.electricity_kwh)} kWh/a</td></tr>
                  <tr><th>Heating</th><td>{kwh(analysis.baseline.usage.heating_kwh)} kWh/a - {carrierLabel(HEATING_CARRIER_OPTIONS, analysis.settings.heatingCarrier)}</td></tr>
                  <tr><th>Cooling</th><td>{kwh(analysis.baseline.usage.cooling_kwh)} kWh/a - {carrierLabel(COOLING_CARRIER_OPTIONS, analysis.settings.coolingCarrier)}</td></tr>
                  <tr><th>Renewable consumed</th><td>{kwh(analysis.settings.renewableConsumed)} kWh/a</td></tr>
                  <tr><th>Renewable exported</th><td>{kwh(analysis.settings.renewableExported)} kWh/a</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Method</h3>
              <p className="muted">
                Historical points use every complete calendar year available from CRREM monthly usage. The app prefers whole-building records and only aggregates tenant rows when no whole-building records exist for the property. The baseline reference remains {analysis.baseline.label}. Future points only start after the latest complete actual year and hold annual energy demand flat from {analysis.projectionBase?.label || analysis.baseline.label} through 2050. Electricity and fixed non-electric carrier factors use CRREM Emission Factors v2.05. District heating and cooling require a user-supplied operator emissions factor.
              </p>
              <p className="muted">CRREM data: {CRREM_DATA_VERSION}. {CRREM_DATA_ATTRIBUTION}. {CRREM_EMISSION_FACTORS_SOURCE}</p>
            </div>
          </div>
          <CrremFormulaBlock />
          <CrremCalculationTable analysis={analysis} points={chartPoints} />
        </>
      )}
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
          <button className="btn" onClick={() => downloadPptxRegister(db, selectedProperty)}>PPTX Report - Selected Property</button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await downloadCrremPdfReport(db, selectedProperty);
              } catch (error) {
                window.alert(error.message || String(error));
              }
            }}
          >
            PDF CRREM Report
          </button>
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

function DatabaseAdminView({ ready, db, data, syncObsidianNotes, syncEcmMarkdownNotes, createDatabaseBackup, downloadDatabaseFile, busy }) {
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
          <button className="btn" disabled={busy} onClick={syncEcmMarkdownNotes}>Sync ECM Markdown Files</button>
          <button className="btn" onClick={createDatabaseBackup}>Create Local DB Backup</button>
          <button className="btn" onClick={downloadDatabaseFile}>Download DB File</button>
        </div>
        <p className="muted">Sync writes ECM and implemented-savings Markdown files for existing database records and stores the generated filenames back into SQLite. Use the ECM-only sync when you only need the ECM folder updated.</p>
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

function CrremChart({ title, unit, points, actualKey, pathwayKey, baselineYear }) {
  const valid = (points || []).filter((point) => Number.isFinite(Number(point[actualKey])) && Number.isFinite(Number(point[pathwayKey])));
  if (!valid.length) return <div className="card"><h3>{title}</h3><p className="muted">No chart data available.</p></div>;
  const width = 760;
  const height = 320;
  const pad = { left: 54, right: 20, top: 26, bottom: 62 };
  const minYear = Math.min(...valid.map((point) => point.year));
  const maxYear = Math.max(...valid.map((point) => point.year));
  const maxValue = Math.max(...valid.flatMap((point) => [Number(point[actualKey]), Number(point[pathwayKey])])) * 1.12 || 1;
  const x = (year) => pad.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * (width - pad.left - pad.right);
  const y = (value) => height - pad.bottom - (Number(value) / maxValue) * (height - pad.top - pad.bottom);
  const actualPath = chartPath(valid, x, y, actualKey);
  const pathwayPath = chartPath(valid, x, y, pathwayKey);
  const ticks = valid.map((point) => point.year);
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="muted">{unit}</span>
      </div>
      <svg className="crrem-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="chart-axis" />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="chart-axis" />
        {ticks.map((year) => (
          <g key={`year-${year}`}>
            <line x1={x(year)} y1={pad.top} x2={x(year)} y2={height - pad.bottom} className="chart-year-gridline" />
            <text
              x={x(year) + 3}
              y={height - 38}
              className="chart-label chart-year-label"
              textAnchor="start"
              transform={`rotate(45 ${x(year) + 3} ${height - 38})`}
            >
              {year}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maxValue * ratio;
          const yy = y(value);
          return (
            <g key={ratio}>
              <line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="chart-gridline" />
              <text x={pad.left - 8} y={yy + 4} className="chart-label" textAnchor="end">{formatCrremNumber(value)}</text>
            </g>
          );
        })}
        {baselineYear ? (
          <g>
            <line x1={x(baselineYear)} y1={pad.top} x2={x(baselineYear)} y2={height - pad.bottom} className="chart-baseline" />
            <text x={x(baselineYear) + 5} y={pad.top + 12} className="chart-label">baseline</text>
          </g>
        ) : null}
        <path d={pathwayPath} className="chart-path pathway" />
        <path d={actualPath} className="chart-path actual" />
      </svg>
      <div className="chart-legend">
        <span><i className="legend-dot actual"></i>Asset</span>
        <span><i className="legend-dot pathway"></i>CRREM pathway</span>
      </div>
    </div>
  );
}

function CrremCalculationTable({ analysis, points }) {
  const rows = buildCrremCalculationRows(analysis, points);
  return (
    <div className="card crrem-calculation-card" style={{ marginTop: 14 }}>
      <h3>Calculation Method</h3>
      <p className="muted">
        This matrix is the audit trail for the CRREM numbers. Years run across the top; each row shows the input, carrier factor, total, asset result, or CRREM pathway value used for that year.
      </p>
      <div className="calculation-table-wrap">
        <table className="calculation-table">
          <thead>
            <tr>
              <th>Calculation item</th>
              {points.map((point) => <th key={point.year}>{point.year}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.emphasis ? "calculation-total-row" : ""}>
                <td>{row.label}</td>
                {points.map((point) => <td key={`${row.id}-${point.year}`}>{row.value(point)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CrremFormulaBlock() {
  const formulas = [
    ["Total energy", "electricity kWh + heating kWh + cooling kWh + on-site renewable consumed kWh"],
    ["EUI", "total energy / gross floor area"],
    ["Electricity carbon", "electricity kWh x electricity emission factor"],
    ["Heating carbon", "heating kWh x heating carrier emission factor"],
    ["Cooling carbon", "cooling kWh x cooling carrier emission factor"],
    ["Export credit", "minimum of exported renewable kWh x grid emission factor, or electricity carbon"],
    ["Net carbon", "maximum of 0, or electricity carbon + heating carbon + cooling carbon - export credit"],
    ["Carbon intensity", "net carbon / gross floor area"],
    ["CRREM misalignment", "first year where asset intensity is greater than the CRREM pathway line"]
  ];
  return (
    <div className="card formula-card" style={{ marginTop: 14 }}>
      <h3>Calculation Formulas</h3>
      <div className="formula-grid">
        {formulas.map(([label, formula]) => (
          <div className="formula-row" key={label}>
            <strong>{label}</strong>
            <span>{formula}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildCrremCalculationRows(analysis, points) {
  const area = Number(analysis.property.total_floor_area || 0);
  const hasHeating = points.some((point) => Number(point.heating || 0) !== 0) || analysis.settings.heatingCarrier !== "none";
  const hasCooling = points.some((point) => Number(point.cooling || 0) !== 0) || analysis.settings.coolingCarrier !== "none";
  const hasRenewables = points.some((point) => Number(point.renewableConsumed || 0) !== 0 || Number(point.renewableExported || 0) !== 0);
  const rows = [
    { id: "source", label: "Source", value: (point) => crremPointSource(point, analysis.baseline.year) },
    { id: "area", label: "Gross floor area (m²)", value: () => money(area) },
    { id: "electricity", label: "Electricity (kWh/a)", value: (point) => kwh(point.electricity) },
    { id: "electricity-ef", label: "Electricity emission factor (kgCO2e/kWh)", value: (point) => formatCrremFactor(point.gridEf) }
  ];
  if (hasHeating) {
    rows.push(
      { id: "heating-carrier", label: "Heating carrier", value: (point) => carrierLabel(HEATING_CARRIER_OPTIONS, point.heatingCarrier) },
      { id: "heating", label: "Heating (kWh/a)", value: (point) => kwh(point.heating) },
      { id: "heating-ef", label: "Heating emission factor (kgCO2e/kWh)", value: (point) => formatCrremFactor(point.heatEf) }
    );
  }
  if (hasCooling) {
    rows.push(
      { id: "cooling-carrier", label: "Cooling carrier", value: (point) => carrierLabel(COOLING_CARRIER_OPTIONS, point.coolingCarrier) },
      { id: "cooling", label: "Cooling (kWh/a)", value: (point) => kwh(point.cooling) },
      { id: "cooling-ef", label: "Cooling emission factor (kgCO2e/kWh)", value: (point) => formatCrremFactor(point.coolEf) }
    );
  }
  if (hasRenewables) {
    rows.push(
      { id: "renewable-consumed", label: "On-site renewable consumed (kWh/a)", value: (point) => kwh(point.renewableConsumed) },
      { id: "renewable-exported", label: "On-site renewable exported (kWh/a)", value: (point) => kwh(point.renewableExported) },
      { id: "renewable-credit", label: "Export credit (kgCO2e/a)", value: (point) => kwh(point.exportCreditKg) }
    );
  }
  rows.push(
    { id: "total-energy", label: "Total energy (kWh/a)", value: (point) => kwh(point.totalEnergy), emphasis: true },
    { id: "asset-eui", label: "Asset EUI (kWh/m²/a)", value: (point) => formatCrremNumber(point.eui), emphasis: true },
    { id: "crrem-eui", label: "CRREM line for EUI (kWh/m²/a)", value: (point) => formatCrremNumber(point.euiPathway), emphasis: true },
    { id: "gross-carbon", label: "Gross carbon (kgCO2e/a)", value: (point) => kwh(point.grossCarbonKg) },
    { id: "net-carbon", label: "Net carbon (kgCO2e/a)", value: (point) => kwh(point.netCarbonKg), emphasis: true },
    { id: "asset-carbon", label: "Asset carbon intensity (kgCO2e/m²/a)", value: (point) => formatCrremNumber(point.carbonIntensity), emphasis: true },
    { id: "crrem-carbon", label: "CRREM line for carbon (kgCO2e/m²/a)", value: (point) => formatCrremNumber(point.carbonPathway), emphasis: true }
  );
  return rows;
}

function crremPointSource(point, baselineYear) {
  if (point.year === baselineYear) return "Selected baseline";
  if (point.projected) return "Projected from latest complete actual";
  return "Actual complete year";
}

function chartPath(points, x, y, key) {
  return points.map((point, index) => `${index ? "L" : "M"} ${x(point.year).toFixed(1)} ${y(point[key]).toFixed(1)}`).join(" ");
}

function combineCrremSeries(historical, projected) {
  const rows = [...(historical || []), ...(projected || [])];
  return rows.sort((a, b) => a.year - b.year);
}

function formatCrremNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

function formatCrremFactor(value) {
  if (value === null || value === undefined || value === "") return "requires override";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(4);
}

function Field({ label, children, className = "", help = "" }) {
  return (
    <div className={`field ${className}`.trim()}>
      <label>{label}</label>
      {children}
      {help ? <p className="field-help">{help}</p> : null}
    </div>
  );
}

function propertyToForm(property) {
  return {
    ...property,
    total_floor_area: property.total_floor_area ?? "",
    crrem_country: property.crrem_country || inferCrremCountry(property),
    crrem_property_type: property.crrem_property_type || "Office",
    heating_carrier: property.heating_carrier || "natural_gas",
    cooling_carrier: property.cooling_carrier || "electric",
    renewable_consumed_kwh: property.renewable_consumed_kwh ?? "",
    renewable_exported_kwh: property.renewable_exported_kwh ?? "",
    heating_emission_factor_kgco2e_per_kwh: property.heating_emission_factor_kgco2e_per_kwh ?? "",
    cooling_emission_factor_kgco2e_per_kwh: property.cooling_emission_factor_kgco2e_per_kwh ?? ""
  };
}

function carrierLabel(options, value) {
  return options.find((item) => item.value === value)?.label || value || "not set";
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
