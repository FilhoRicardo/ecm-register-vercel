import { useEffect, useMemo, useState } from "react";
import {
  databaseHealth,
  deleteEcm,
  deleteEquipment,
  deleteImplementedSaving,
  deleteMonthlyUsage,
  deleteProperty,
  deleteTenant,
  getAttachments,
  getAdminTracker,
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
  upsertAdminTracker,
  upsertImplementedSaving,
  upsertMonthlyUsage,
  upsertProperty,
  upsertTenant
} from "./lib/sqlite.js";
import { downloadBlob, ensurePermission, idbDel, idbGet, idbSet, permissionState, supportsFileSystemAccess, writeFile } from "./lib/storage.js";
import { listMarkdownFiles, routeCalculationFile, writeTextIntoFolder } from "./lib/files.js";
import { adminTrackerFilename, buildAdminTrackerMarkdown, buildEcmMarkdown, buildMeetingMarkdown, buildMonthlyUsageMarkdown, buildSavingMarkdown, ecmFilename, extractMeetingSections, meetingFilename, monthlyUsageFilename, replaceMeetingSections, savingFilename } from "./lib/markdown.js";
import { downloadCrremPdfReport, downloadEcmReviewWorkbook, downloadExcelRegister, downloadPptxRegister, downloadUsageCsv, downloadUsageWorkbook, parseEcmReviewWorkbook } from "./lib/reports.js";
import { EQUIPMENT_TYPE_TO_BRICK_CLASS, kwh, money, todayIso, utilityCost, yamlQuote } from "./lib/format.js";
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
  { key: "database", label: "Database", required: true, description: "Where ecm_register.db is stored and backed up" },
  { key: "ecmNotes", label: "ECM Notes", required: true, description: "Obsidian folder for ECM Markdown files" },
  { key: "savingNotes", label: "Implemented Savings Notes", required: true, description: "Obsidian folder where implemented saving Markdown files are written" },
  { key: "meetingNotes", label: "Meeting Notes", required: true, description: "Obsidian folder for monthly meeting notes" },
  { key: "monthlyUsage", label: "Monthly Usage", required: true, description: "Obsidian folder for one Markdown usage table per building" },
  { key: "adminTracker", label: "Admin Tracker", required: true, description: "Obsidian folder for one Markdown admin tracker table per building" },
  { key: "statusQuo", label: "Status Quo", required: false, description: "Obsidian folder for property status quo timeline Markdown files" },
  { key: "openActions", label: "Open Actions", required: false, description: "Obsidian folder for property open action checklist Markdown files" },
  { key: "calculationFiles", label: "Calculations", required: true, description: "Local folder for ECM calculation evidence" },
  { key: "reports", label: "Reports", required: false, description: "Optional folder for generated reports" },
  { key: "imports", label: "Imports", required: false, description: "Optional folder for source import files" }
];

const NAV = [
  ["welcome", "👋 Welcome"],
  ["workflow", "\u{1F5D3}\u{FE0F} Workflow Guide"],
  ["setup", "⚙️ Setup"],
  ["dashboard", "🎯 Dashboard"],
  ["properties", "🏢 Properties"],
  ["tenants", "👥 Tenants & Equipment"],
  ["ecms", "⚡ ECMs"],
  ["savings", "💶 Implemented Savings"],
  ["usage", "📊 Monthly Usage"],
  ["data", "📈 Data View"],
  ["crrem", "🌍 CRREM Plot"],
  ["meetings", "📝 Monthly Meetings"],
  ["reports", "📤 Reports"],
  ["statusquo", "\u{1F4CD} Status Quo"],
  ["actions", "\u{2611}\u{FE0F} Open Actions"],
  ["admintracker", "\u{1F5C2}\u{FE0F} Admin Tracker"],
  ["benchmark", "\u{1F3C1} Benchmark"],
  ["database", "🧪 SQLite Lab"],
  ["admin", "🛡️ Database Admin"]
];

const RESPONSIBLE_OPTIONS = [
  "Property Manager",
  "Asset Manager",
  "BMS Company",
  "Metering Company",
  "SavIQ team"
];

const ADMIN_DELIVERABLES = [
  ["docunite_report", "Docunite report"],
  ["ecm_report", "ECM report"],
  ["status_quo", "Status Quo"],
  ["pre_meeting_notes", "Pre Meeting notes"],
  ["post_meeting_notes", "Post meeting notes"]
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
  const [active, setActive] = useState("welcome");
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
  const [adminForm, setAdminForm] = useState(defaultAdminTrackerForm());
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
    setAdminForm((prev) => ({ ...prev, property_id: prev.property_id || first }));
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
      if (key === "monthlyUsage" && db) {
        const synced = await writeMonthlyUsageMarkdownFiles(db, handle, { requestPermission: false });
        notify(`Monthly Usage folder configured. Synced ${synced.count} usage files.`);
        return;
      }
      if (key === "adminTracker" && db) {
        const synced = await writeAdminTrackerMarkdownFiles(db, handle, { requestPermission: false });
        notify(`Admin Tracker folder configured. Synced ${synced.count} tracker files.`);
        return;
      }
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
      if (granted && key === "monthlyUsage" && db) {
        const synced = await writeMonthlyUsageMarkdownFiles(db, handle, { requestPermission: false });
        notify(`Folder permission restored. Synced ${synced.count} usage files.`);
        return;
      }
      if (granted && key === "adminTracker" && db) {
        const synced = await writeAdminTrackerMarkdownFiles(db, handle, { requestPermission: false });
        notify(`Folder permission restored. Synced ${synced.count} tracker files.`);
        return;
      }
      notify(granted ? "Folder permission restored." : "Folder permission was not granted.");
    } catch (error) {
      setSetupError(error.message || String(error));
      notify("Folder permission restore failed.");
    }
  }

  async function forgetFolder(key) {
    await idbDel(`folder_${key}`);
    setHandles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setFolderStatuses((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (key === "database") {
      setDb(null);
      setDbFileHandle(null);
      setData(null);
    }
    notify("Folder assignment cleared.");
  }

  async function forgetAllFolders() {
    for (const def of FOLDERS) await idbDel(`folder_${def.key}`);
    setHandles({});
    setFolderStatuses({});
    setDb(null);
    setDbFileHandle(null);
    setData(null);
    setActive("setup");
    notify("All folder assignments cleared.");
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
      let usageSyncMessage = "";
      if (allHandles.monthlyUsage && statuses.monthlyUsage === "granted") {
        try {
          const synced = await writeMonthlyUsageMarkdownFiles(nextDb, allHandles.monthlyUsage, { requestPermission: false });
          usageSyncMessage = ` Synced ${synced.count} monthly usage files.`;
        } catch (syncError) {
          usageSyncMessage = ` Monthly usage sync skipped: ${syncError.message || String(syncError)}`;
        }
      }
      let adminTrackerSyncMessage = "";
      if (allHandles.adminTracker && statuses.adminTracker === "granted") {
        try {
          const synced = await writeAdminTrackerMarkdownFiles(nextDb, allHandles.adminTracker, { requestPermission: false });
          adminTrackerSyncMessage = ` Synced ${synced.count} admin tracker files.`;
        } catch (syncError) {
          adminTrackerSyncMessage = ` Admin tracker sync skipped: ${syncError.message || String(syncError)}`;
        }
      }
      const nextData = getPortfolio(nextDb);
      setData(nextData);
      setActive("dashboard");
      notify(`Workspace loaded: ${nextData.properties.length} properties, ${nextData.ecms.length} ECMs.${ecmSyncMessage}${usageSyncMessage}${adminTrackerSyncMessage}`);
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

  async function saveUsage(event, override = {}) {
    event.preventDefault();
    const nextUsage = { ...usageForm, ...override };
    upsertMonthlyUsage(db, {
      ...nextUsage,
      id: nextUsage.id || null,
      property_id: Number(nextUsage.property_id),
      tenant_id: nextUsage.scope_type === "tenant" && nextUsage.tenant_id ? Number(nextUsage.tenant_id) : null
    });
    setUsageForm({ ...defaultUsageForm(), property_id: selectedPropertyId || nextUsage.property_id, scope_type: nextUsage.scope_type });
    await persist("Monthly usage saved.");
    await syncMonthlyUsageMarkdown(Number(nextUsage.property_id));
  }

  async function removeUsage(id) {
    if (!window.confirm("Delete this monthly usage record?")) return;
    const existing = (data?.monthlyUsage || []).find((row) => row.id === id);
    deleteMonthlyUsage(db, id);
    await persist("Monthly usage deleted.");
    if (!existing) return;
    await syncMonthlyUsageMarkdown(existing.property_id);
  }

  async function saveAdminTracker(event, override = {}) {
    event?.preventDefault?.();
    const next = { ...adminForm, ...override };
    upsertAdminTracker(db, {
      ...next,
      property_id: Number(next.property_id),
      admin_year: Number(next.admin_year),
      admin_month: Number(next.admin_month)
    });
    setAdminForm((prev) => ({ ...prev, ...next }));
    await persist("Admin tracker saved.");
    await syncAdminTrackerMarkdown(Number(next.property_id));
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

  async function syncMonthlyUsageMarkdown(propertyId = null) {
    if (!handles.monthlyUsage) return;
    try {
      await writeMonthlyUsageMarkdownFiles(db, handles.monthlyUsage, { propertyId });
    } catch (error) {
      notify(`Monthly usage saved locally. Obsidian usage sync failed: ${error.message || String(error)}`);
    }
  }

  async function syncAdminTrackerMarkdown(propertyId = null) {
    if (!handles.adminTracker) return;
    try {
      await writeAdminTrackerMarkdownFiles(db, handles.adminTracker, { propertyId });
    } catch (error) {
      notify(`Admin tracker saved locally. Obsidian tracker sync failed: ${error.message || String(error)}`);
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

  async function writeMonthlyUsageMarkdownFiles(targetDb, monthlyUsageHandle, options = {}) {
    if (!targetDb) throw new Error("Load a database before syncing monthly usage.");
    if (!monthlyUsageHandle) throw new Error("Configure the Monthly Usage folder first.");
    const requestPermission = options.requestPermission !== false;
    const granted = requestPermission
      ? await ensurePermission(monthlyUsageHandle, "readwrite")
      : (await permissionState(monthlyUsageHandle, "readwrite")) === "granted";
    setFolderStatuses((prev) => ({ ...prev, monthlyUsage: granted ? "granted" : "denied" }));
    if (!granted) throw new Error("Monthly Usage folder permission was not granted.");

    const propertiesNow = getProperties(targetDb).filter((property) => !options.propertyId || property.id === Number(options.propertyId));
    const usageNow = getMonthlyUsage(targetDb);
    for (const property of propertiesNow) {
      const rows = usageNow.filter((row) => row.property_id === property.id);
      await writeTextIntoFolder(monthlyUsageHandle, monthlyUsageFilename(property), buildMonthlyUsageMarkdown(property, rows));
    }
    return { count: propertiesNow.length };
  }

  async function writeAdminTrackerMarkdownFiles(targetDb, adminTrackerHandle, options = {}) {
    if (!targetDb) throw new Error("Load a database before syncing admin tracker.");
    if (!adminTrackerHandle) throw new Error("Configure the Admin Tracker folder first.");
    const requestPermission = options.requestPermission !== false;
    const granted = requestPermission
      ? await ensurePermission(adminTrackerHandle, "readwrite")
      : (await permissionState(adminTrackerHandle, "readwrite")) === "granted";
    setFolderStatuses((prev) => ({ ...prev, adminTracker: granted ? "granted" : "denied" }));
    if (!granted) throw new Error("Admin Tracker folder permission was not granted.");

    const propertiesNow = getProperties(targetDb).filter((property) => !options.propertyId || property.id === Number(options.propertyId));
    const recordsNow = getAdminTracker(targetDb);
    for (const property of propertiesNow) {
      const rows = recordsNow.filter((row) => row.property_id === property.id);
      await writeTextIntoFolder(adminTrackerHandle, adminTrackerFilename(property), buildAdminTrackerMarkdown(property, rows));
    }
    return { count: propertiesNow.length };
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
      if (!ecm) throw new Error("Select an implemented ECM before saving measured savings.");
      const propertyId = Number(ecm.property_id || savingForm.property_id);
      const utilityType = savingForm.utility_type || ecm.utility_type;
      const property = properties.find((item) => item.id === propertyId);
      const unitCost = savingForm.unit_cost_eur_per_kwh || utilityCost(property, utilityType);
      const costSaving = Number(savingForm.energy_saving_kwh || 0) * Number(unitCost || 0);
      const id = upsertImplementedSaving(db, {
        ...savingForm,
        property_id: propertyId,
        ecm_id: ecm.id,
        utility_type: utilityType,
        unit_cost_eur_per_kwh: unitCost,
        cost_saving_eur: costSaving
      });
      const saved = getImplementedSavings(db).find((item) => item.id === id);
      const filename = saved.obsidian_filename || savingFilename({ ...saved, ref: ecm.ref });
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

  async function removeImplementedSaving(id) {
    const saving = data.implementedSavings.find((item) => item.id === Number(id));
    if (!saving || !window.confirm("Delete this implemented saving from the database and remove its Obsidian note if available?")) return;
    setBusy(true);
    try {
      deleteImplementedSaving(db, saving.id);
      if (saving.obsidian_filename && handles.savingNotes && await ensurePermission(handles.savingNotes, "readwrite")) {
        try {
          await handles.savingNotes.removeEntry(saving.obsidian_filename);
        } catch (error) {
          if (error?.name !== "NotFoundError") throw error;
        }
      }
      setSavingForm(defaultSavingForm());
      await persist("Implemented saving deleted.");
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
    const files = (await listMarkdownFiles(handles.meetingNotes))
      .filter((file) => (
        file.name.includes("_Monthly_ECM_Meeting")
        || file.text.includes("record_type: monthly_meeting")
        || (file.text.includes("# ") && file.text.includes("Monthly ECM Meeting"))
      ))
      .sort((a, b) => b.name.localeCompare(a.name));
    setMeetingFiles(files);
    if (selectedMeetingName) {
      const selected = files.find((item) => item.name === selectedMeetingName);
      if (selected) setMeetingDraft(extractMeetingSections(selected.text || ""));
    }
    return files;
  }

  function selectMeeting(name) {
    if (!name) {
      setSelectedMeetingName("");
      setMeetingDraft({ pre: "", post: "" });
      return;
    }
    const file = meetingFiles.find((item) => item.name === name);
    setSelectedMeetingName(name);
    setMeetingDraft(extractMeetingSections(file?.text || ""));
  }

  async function saveMeetingDraft() {
    const file = meetingFiles.find((item) => item.name === selectedMeetingName);
    if (!file) return;
    const latest = await file.handle.getFile();
    const latestText = await latest.text();
    const currentSections = extractMeetingSections(latestText);
    const updated = replaceMeetingSections(latestText, { ...currentSections, post: meetingDraft.post || "" });
    await writeFile(file.handle, updated);
    await loadMeetingFiles();
    setMeetingDraft(extractMeetingSections(updated));
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

        {active === "welcome" && <WelcomeView ready={ready} />}
        {active === "workflow" && <WorkflowGuideView />}
        {active === "setup" && (
          <SetupView
            handles={handles}
            folderStatuses={folderStatuses}
            configureFolder={configureFolder}
            forgetFolder={forgetFolder}
            forgetAllFolders={forgetAllFolders}
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
            ecms={data?.ecms || []}
            savings={data?.implementedSavings || []}
            form={savingForm}
            setForm={setSavingForm}
            save={saveImplementedSaving}
            remove={removeImplementedSaving}
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
            downloadUsage={() => downloadUsageWorkbook(db)}
            downloadUsageCsv={() => downloadUsageCsv(db)}
          />
        )}
        {active === "data" && (
          <DataView
            ready={ready}
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
            monthlyUsage={data?.monthlyUsage || []}
          />
        )}
        {active === "benchmark" && (
          <BenchmarkView
            ready={ready}
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
            monthlyUsage={data?.monthlyUsage || []}
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
        {active === "statusquo" && (
          <StatusQuoView
            ready={ready}
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
            folderHandle={handles.statusQuo}
            folderStatus={folderStatuses.statusQuo}
            configureFolder={() => configureFolder("statusQuo")}
            notify={notify}
          />
        )}
        {active === "actions" && (
          <OpenActionsView
            ready={ready}
            properties={properties}
            selectedPropertyId={selectedPropertyId}
            setSelectedPropertyId={setSelectedPropertyId}
            folderHandle={handles.openActions}
            folderStatus={folderStatuses.openActions}
            configureFolder={() => configureFolder("openActions")}
            notify={notify}
          />
        )}
        {active === "admintracker" && (
          <AdminTrackerView
            ready={ready}
            properties={properties}
            records={data?.adminTracker || []}
            form={adminForm}
            setForm={setAdminForm}
            save={saveAdminTracker}
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

function WelcomeView({ ready }) {
  const workflow = [
    ["1", "Setup folders", "Connect the local database folder, Obsidian note folders, calculation evidence folder, and optional report/import folders."],
    ["2", "Import or resume database", "Open ecm_register.db from your selected database folder or import an existing SQLite database into that folder."],
    ["3", "Register portfolio data", "Add properties, tenants, equipment, monthly consumption, ECMs, and implemented savings from the app."],
    ["4", "Sync evidence", "ECM notes, implemented saving notes, monthly usage, admin tracker, meeting notes, status quo timelines, open actions, and calculation files are written to your selected local folders."],
    ["5", "Report and review", "Export Excel, CSV, PPTX, CRREM PDF, and ECM review workbooks from the Reports and Monthly Consumption pages."]
  ];
  const storageRows = [
    ["Properties", "SQLite database", "Property name, address, floor area, tariffs, CRREM settings, carriers, renewables, notes."],
    ["Tenants", "SQLite database", "Tenant names, tenant floor area, location labels, and tenant notes."],
    ["Equipment", "SQLite database", "Equipment records, type, Brick class, utility, optional tenant/property relationship."],
    ["ECMs", "SQLite database + ECM Notes folder", "Every ECM is stored in SQLite and written as a Markdown note in the ECM Notes folder."],
    ["Implemented savings", "SQLite database + Implemented Savings Notes folder", "Measured saving periods are stored in SQLite and written as Markdown notes in the implemented-savings folder."],
    ["Monthly consumption", "SQLite database + Monthly Usage folder", "Landlord and tenant monthly electricity, heating, and cooling values are stored in SQLite and mirrored to one Markdown table per building."],
    ["Monthly meeting notes", "Monthly Meeting Notes folder", "Meeting notes are Markdown files in Obsidian. The app creates and edits the pre/post meeting sections."],
    ["Status quo timelines", "Status Quo folder", "Property status updates are Markdown files in Obsidian. The app adds or edits one month section per property."],
    ["Open actions", "Open Actions folder", "Property action lists are Markdown checklist files in Obsidian. The app creates open items and closes them with comments."],
    ["Admin tracker", "SQLite database + Admin Tracker folder", "Monthly deliverable status is stored in SQLite and mirrored to one Markdown table per building."],
    ["Calculation evidence", "Calculation Files folder", "Uploaded calculation files are renamed and routed locally for traceability."],
    ["Reports", "Browser download / optional Reports folder", "Excel registers, usage CSV/Excel, ECM review workbooks, PPTX reports, and CRREM PDFs are exported locally."],
    ["Database admin", "SQLite database + backup download", "Backups and database checks operate on the local SQLite file."]
  ];
  return (
    <section className="section">
      <div className="welcome-grid">
        <div className="card welcome-card">
          <span className="eyebrow">START HERE</span>
          <h3>ECM Register Workflow</h3>
          <p className="muted">
            This app is a browser-hosted interface for local files. Vercel serves the app, but your database, Obsidian notes, calculation evidence, and reports stay on your machine.
          </p>
          <div className="workflow-list">
            {workflow.map(([step, title, text]) => (
              <div className="workflow-step" key={step}>
                <span>{step}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card welcome-card">
          <span className="eyebrow">CURRENT STATE</span>
          <h3>{ready ? "Workspace is loaded" : "Setup required"}</h3>
          <p className="muted">
            {ready
              ? "Your local database is open. You can work from any tab and exports will download locally."
              : "Go to Setup, connect the required folders, then resume or import ecm_register.db."}
          </p>
          <div className="artifact-callout">
            <strong>Markdown outputs</strong>
            <p>ECMs, implemented savings, monthly usage, admin tracker, and monthly meeting notes are the records that become Obsidian `.md` files.</p>
          </div>
          <div className="artifact-callout">
            <strong>Database records</strong>
            <p>Properties, tenants, equipment, ECMs, implemented savings, monthly usage, and attachment references are stored in SQLite.</p>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Where Each Artifact Is Saved</h3>
        <div style={{ overflow: "auto" }}>
          <table>
            <thead>
              <tr><th>Artifact</th><th>Saved to</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {storageRows.map(([artifact, savedTo, notes]) => (
                <tr key={artifact}>
                  <td><strong>{artifact}</strong></td>
                  <td>{savedTo}</td>
                  <td>{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function WorkflowGuideView() {
  const weeks = [
    {
      week: "Week 1",
      title: "Data Review And Meeting Prep",
      tone: "Find the story in the data before the month gets busy.",
      steps: [
        "Review the latest data in SavIQ.",
        "Open the Open Actions tab and review existing actions.",
        "Pay extra attention to data-review actions, missing data, zero readings, and abnormal patterns.",
        "Go to Monthly Meetings and initiate the monthly meeting note.",
        "Add all findings into the pre-meeting notes section."
      ],
      outputs: ["Updated open actions", "New monthly meeting note", "Pre-meeting findings captured"]
    },
    {
      week: "Week 2",
      title: "BMS Company Meetings",
      tone: "Use the action list as the agenda.",
      steps: [
        "Filter Open Actions by BMS Company.",
        "Discuss each relevant action with the BMS company.",
        "Add closing comments where actions are resolved.",
        "Close completed actions and create new actions where follow-up is needed."
      ],
      outputs: ["BMS actions updated", "Closed actions have comments", "New control actions created"]
    },
    {
      week: "Week 3",
      title: "Admin, Consumption, And Client Outputs",
      tone: "Make sure the monthly evidence pack is complete.",
      steps: [
        "Use Admin Tracker to mark property deliverables by month and year.",
        "Add the past month consumption in Monthly Usage.",
        "Update Status Quo where the property story changed.",
        "Export or send the CRREM plot and Benchmark view to the client.",
        "Check that Docunite report, ECM report, pre-meeting notes, and post-meeting notes are tracked."
      ],
      outputs: ["Monthly consumption entered", "Admin Tracker updated", "CRREM and Benchmark ready for client"]
    },
    {
      week: "Week 4",
      title: "Meeting And Post-Meeting Notes",
      tone: "Close the loop while the meeting is still fresh.",
      steps: [
        "Run the monthly meeting.",
        "Open the existing Monthly Meeting note.",
        "Add post-meeting comments only.",
        "Review Open Actions and assign responsible owners for next month.",
        "Confirm whether any Status Quo or ECM records need updating."
      ],
      outputs: ["Post-meeting notes saved", "Next actions assigned", "Monthly cycle ready to repeat"]
    }
  ];
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h3>Project Timeline Guide</h3>
          <p className="muted">A static monthly workflow to keep the project running consistently.</p>
        </div>
      </div>
      <div className="workflow-guide-grid">
        {weeks.map((item) => (
          <div className="card workflow-guide-card" key={item.week}>
            <div className="workflow-guide-head">
              <span>{item.week}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.tone}</p>
              </div>
            </div>
            <ol>
              {item.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <div className="workflow-output-list">
              {item.outputs.map((output) => <span key={output}>{output}</span>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SetupView({ handles, folderStatuses, configureFolder, forgetFolder, forgetAllFolders, importDatabase, loadDatabase, data, setupError, busy, ready }) {
  const requiredFolders = FOLDERS.filter((folder) => folder.required);
  const requiredConfigured = requiredFolders.every((folder) => handles[folder.key]);
  const configuredCount = FOLDERS.filter((folder) => handles[folder.key]).length;
  return (
    <section className="setup-screen">
      <div className="setup-panel">
        <div className="setup-title">
          <div className="setup-icon">⚡</div>
          <span className="eyebrow">LOCAL WORKSPACE</span>
          <h3>Connect your folders</h3>
          <p className="muted">Pick each local folder once per device. The files stay on your machine; the app only remembers browser folder permissions.</p>
        </div>
        {setupError ? <div className="setup-error">{setupError}</div> : null}
        {ready && data ? (
          <div className="setup-summary">
            <Kpi label="Properties" value={data.properties.length} />
            <Kpi label="ECMs" value={data.ecms.length} />
            <Kpi label="Usage Rows" value={data.monthlyUsage.length} />
            <Kpi label="Savings" value={data.implementedSavings.length} />
          </div>
        ) : null}
        <div className="folder-list">
          {FOLDERS.map((folder) => {
            const handle = handles[folder.key];
            const status = folderStatusLabel(handle, folderStatuses[folder.key]);
            return (
              <div className={`folder-row ${handle ? "is-set" : ""}`} key={folder.key}>
                <div className="folder-main">
                  <div className="folder-name-line">
                    <strong>{folder.label}</strong>
                    {folder.required ? <span className="required-tag">Required</span> : null}
                    <span className={`folder-status ${folderStatuses[folder.key] || "missing"}`}>● {status}</span>
                  </div>
                  <p>{folder.description}</p>
                  <span className="folder-path">{handle?.name || "No folder selected"}</span>
                </div>
                <div className="folder-actions">
                  <button className="btn" type="button" onClick={() => configureFolder(folder.key)}>{handle ? "Change" : "Select"}</button>
                  {handle ? <button className="icon-btn danger" type="button" aria-label={`Forget ${folder.label}`} onClick={() => forgetFolder(folder.key)}>×</button> : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="setup-note">{configuredCount} of {FOLDERS.length} folders selected. Required folders: {requiredConfigured ? "complete" : "not complete"}.</p>
        <div className="setup-footer">
          <button className="btn primary" disabled={!handles.database || busy} onClick={loadDatabase}>{busy ? "Working..." : ready ? "Done" : "Resume Workspace"}</button>
          <button className="btn" disabled={!handles.database || busy} onClick={importDatabase}>Import Existing .db</button>
          <button className="btn danger" type="button" disabled={busy || !configuredCount} onClick={forgetAllFolders}>Forget all folders</button>
        </div>
        <p className="muted setup-note">
          {ready
            ? "ecm_register.db is open. You can go to Dashboard or continue changing folder assignments."
            : requiredConfigured
              ? "Required folders are remembered. Resume Workspace restores permissions and opens ecm_register.db."
              : "Select the required folders first, then import your existing .db or resume the workspace."}
        </p>
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

function SavingsView({ ready, properties, ecms, savings, form, setForm, save, remove, busy }) {
  if (!ready) return <EmptyState />;
  const selectedEcm = ecms.find((ecm) => ecm.id === Number(form.ecm_id));
  const selectedPropertyId = Number(form.property_id || selectedEcm?.property_id || properties[0]?.id || "");
  const selectedProperty = properties.find((property) => property.id === selectedPropertyId) || properties.find((property) => property.id === selectedEcm?.property_id);
  const availableEcms = ecms.filter((ecm) => (
    (!selectedPropertyId || ecm.property_id === selectedPropertyId)
    && (ecm.status === "Implemented" || ecm.id === Number(form.ecm_id))
  ));
  const unitCost = form.unit_cost_eur_per_kwh || utilityCost(selectedProperty, form.utility_type);
  const costSaving = Number(form.energy_saving_kwh || 0) * Number(unitCost || 0);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const editSaving = (saving) => {
    setForm({
      ...saving,
      id: saving.id,
      property_id: String(saving.property_id || ""),
      ecm_id: String(saving.ecm_id || ""),
      energy_saving_kwh: saving.energy_saving_kwh ?? "",
      unit_cost_eur_per_kwh: saving.unit_cost_eur_per_kwh ?? "",
      cost_saving_eur: saving.cost_saving_eur ?? "",
      notes: saving.notes || ""
    });
  };
  const resetForm = () => setForm(defaultSavingForm());
  return (
    <section className="section">
      <h3>Implemented Savings</h3>
      <div className="grid two">
        <div className="card">
          <form onSubmit={save}>
            <Field label="Property">
              <select value={selectedPropertyId || ""} onChange={(e) => {
                const nextPropertyId = e.target.value;
                const currentEcm = ecms.find((item) => item.id === Number(form.ecm_id));
                setForm((prev) => ({
                  ...prev,
                  property_id: nextPropertyId,
                  ecm_id: currentEcm?.property_id === Number(nextPropertyId) ? prev.ecm_id : ""
                }));
              }}>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </Field>
            <Field label="Implemented ECM">
              <select value={form.ecm_id} onChange={(e) => {
                const ecm = ecms.find((item) => item.id === Number(e.target.value));
                setForm((prev) => ({ ...prev, ecm_id: e.target.value, property_id: ecm?.property_id || prev.property_id, utility_type: ecm?.utility_type || prev.utility_type }));
              }} required>
                <option value="">Select ECM...</option>
                {availableEcms.map((ecm) => <option key={ecm.id} value={ecm.id}>{ecm.ref} - {ecm.title}{ecm.status !== "Implemented" ? ` (${ecm.status})` : ""}</option>)}
              </select>
              {selectedEcm ? <p className="field-help">Linked to {selectedEcm.property_name} / {selectedEcm.ref}. The saving record will use this ECM relationship.</p> : null}
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
            <div className="toolbar">
              <button className="btn primary" disabled={busy}>{busy ? "Saving..." : form.id ? "Update Implemented Saving" : "Save Implemented Saving"}</button>
              <button type="button" className="btn" onClick={resetForm}>New Saving</button>
              <button type="button" className="btn danger" disabled={!form.id || busy} onClick={() => remove(form.id)}>Delete Saving</button>
            </div>
          </form>
        </div>
        <div className="card" style={{ overflow: "auto", maxHeight: 620 }}>
          <table>
            <thead><tr><th>Property</th><th>ECM</th><th>Period</th><th>Energy</th><th>Saving</th><th>Actions</th></tr></thead>
            <tbody>
              {savings.map((saving) => (
                <tr key={saving.id}>
                  <td>{saving.property_name}</td>
                  <td>{saving.ref} - {saving.ecm_title}</td>
                  <td>{saving.start_date} to {saving.end_date}</td>
                  <td>{kwh(saving.energy_saving_kwh)} kWh</td>
                  <td>EUR {money(saving.cost_saving_eur)}</td>
                  <td>
                    <div className="toolbar table-actions">
                      <button type="button" className="btn" onClick={() => editSaving(saving)}>Edit</button>
                      <button type="button" className="btn danger" disabled={busy} onClick={() => remove(saving.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!savings.length ? <tr><td colSpan="6" className="muted">No implemented savings recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MonthlyUsageView({ ready, properties, tenants, usage, form, setForm, save, remove, downloadUsage, downloadUsageCsv }) {
  const [usageTab, setUsageTab] = useState(form.scope_type === "tenant" ? "tenant" : "landlord");
  if (!ready) return <EmptyState />;
  const propertyTenants = tenants.filter((tenant) => tenant.property_id === Number(form.property_id));
  const selectedPropertyId = Number(form.property_id);
  const landlordUsage = usage
    .filter((row) => (!selectedPropertyId || row.property_id === selectedPropertyId) && row.scope_type !== "tenant")
    .slice(0, 120);
  const tenantUsage = usage
    .filter((row) => (!selectedPropertyId || row.property_id === selectedPropertyId) && row.scope_type === "tenant")
    .slice(0, 160);
  const activeUsage = usageTab === "tenant" ? tenantUsage : landlordUsage;
  const set = (key, value) => setForm((prev) => {
    const next = { ...prev, [key]: value };
    if (key === "property_id") next.tenant_id = "";
    return next;
  });
  const switchUsageTab = (tab) => {
    setUsageTab(tab);
    setForm((prev) => ({
      ...prev,
      scope_type: tab === "tenant" ? "tenant" : "building",
      tenant_id: tab === "tenant" ? prev.tenant_id : ""
    }));
  };
  const editUsage = (row) => {
    const tab = row.scope_type === "tenant" ? "tenant" : "landlord";
    setUsageTab(tab);
    setForm({
      ...row,
      property_id: String(row.property_id),
      tenant_id: row.tenant_id ? String(row.tenant_id) : "",
      scope_type: tab === "tenant" ? "tenant" : "building"
    });
  };
  const newUsageRecord = () => setForm({
    ...defaultUsageForm(),
    property_id: form.property_id,
    scope_type: usageTab === "tenant" ? "tenant" : "building",
    tenant_id: ""
  });
  const saveUsage = (event) => {
    save(event, {
      scope_type: usageTab === "tenant" ? "tenant" : "building",
      tenant_id: usageTab === "tenant" ? form.tenant_id : ""
    });
  };
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h3>Monthly Consumption</h3>
          <p className="muted">Landlord consumption is stored separately from tenant consumption. Tenant choices are filtered by the selected building.</p>
        </div>
        <div className="toolbar">
          <button className="btn" type="button" onClick={downloadUsage}>Download Usage Excel</button>
          <button className="btn" type="button" onClick={downloadUsageCsv}>Download Usage CSV</button>
        </div>
      </div>
      <div className="tabs">
        <button className={usageTab === "landlord" ? "active" : ""} type="button" onClick={() => switchUsageTab("landlord")}>Landlord Consumption</button>
        <button className={usageTab === "tenant" ? "active" : ""} type="button" onClick={() => switchUsageTab("tenant")}>Tenant Monthly Consumption</button>
      </div>
      <div className="grid two">
        <div className="card">
          <form onSubmit={saveUsage}>
            <div className="grid two">
              <Field label="Property"><select value={form.property_id} onChange={(e) => set("property_id", e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Month"><input type="month" value={form.usage_month} onChange={(e) => set("usage_month", e.target.value)} required /></Field>
            </div>
            {usageTab === "tenant" ? (
              <Field label="Tenant">
                <select value={form.tenant_id} onChange={(e) => set("tenant_id", e.target.value)} required>
                  <option value="">Select tenant...</option>
                  {propertyTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.tenant_name} - {tenant.location_label}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Scope"><input value="Landlord consumption" disabled /></Field>
            )}
            <div className="grid three">
              <Field label="Electricity kWh"><input type="number" step="0.01" value={form.electricity_kwh} onChange={(e) => set("electricity_kwh", e.target.value)} /></Field>
              <Field label="Heating kWh"><input type="number" step="0.01" value={form.heating_kwh} onChange={(e) => set("heating_kwh", e.target.value)} /></Field>
              <Field label="Cooling kWh"><input type="number" step="0.01" value={form.cooling_kwh} onChange={(e) => set("cooling_kwh", e.target.value)} /></Field>
            </div>
            <Field label="Notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
            <div className="toolbar">
              <button className="btn primary">Save {usageTab === "tenant" ? "Tenant" : "Landlord"} Usage</button>
              <button className="btn" type="button" onClick={newUsageRecord}>New Usage Record</button>
            </div>
          </form>
        </div>
        <div className="card" style={{ overflow: "auto", maxHeight: 680 }}>
          <table>
            <thead><tr><th>Month</th><th>{usageTab === "tenant" ? "Tenant" : "Scope"}</th><th>Electricity</th><th>Heating</th><th>Cooling</th><th></th></tr></thead>
            <tbody>
              {activeUsage.map((row) => (
                <tr key={row.id}>
                  <td onClick={() => editUsage(row)} style={{ cursor: "pointer" }}>{row.usage_month}</td>
                  <td>{row.scope_type === "tenant" ? row.tenant_name : "Landlord"}</td>
                  <td>{kwh(row.electricity_kwh)} kWh</td>
                  <td>{kwh(row.heating_kwh)} kWh</td>
                  <td>{kwh(row.cooling_kwh)} kWh</td>
                  <td><button className="btn danger" type="button" onClick={() => remove(row.id)}>Remove</button></td>
                </tr>
              ))}
              {!activeUsage.length ? <tr><td colSpan="6" className="muted">No {usageTab === "tenant" ? "tenant" : "landlord"} usage records for this building yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DataView({ ready, properties, selectedPropertyId, setSelectedPropertyId, monthlyUsage }) {
  const availableYears = useMemo(() => dataViewYears(monthlyUsage), [monthlyUsage]);
  const fallbackYear = availableYears[0] || String(new Date().getFullYear());
  const [primaryYear, setPrimaryYear] = useState(fallbackYear);
  const [comparisonYearA, setComparisonYearA] = useState(availableYears[1] || fallbackYear);
  const [comparisonYearB, setComparisonYearB] = useState(availableYears[2] || fallbackYear);
  const [utility, setUtility] = useState("electricity");
  const [scope, setScope] = useState("building");

  useEffect(() => {
    if (!availableYears.length) return;
    setPrimaryYear((prev) => availableYears.includes(prev) ? prev : availableYears[0]);
    setComparisonYearA((prev) => availableYears.includes(prev) ? prev : availableYears[1] || availableYears[0]);
    setComparisonYearB((prev) => availableYears.includes(prev) ? prev : availableYears[2] || availableYears[0]);
  }, [availableYears]);

  if (!ready) return <EmptyState />;
  const property = properties.find((item) => item.id === Number(selectedPropertyId)) || properties[0] || null;
  const selectedYears = [primaryYear, comparisonYearA, comparisonYearB].filter(Boolean);
  const series = buildDataViewSeries(monthlyUsage, {
    propertyId: property?.id,
    scope,
    utility,
    years: selectedYears
  });
  const health = buildDataHealth(monthlyUsage, {
    propertyId: property?.id,
    scope,
    utility,
    years: selectedYears
  });
  const totals = selectedYears.map((year) => ({ year, total: series[year]?.reduce((sum, item) => sum + item.value, 0) || 0 }));

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h3>Data View</h3>
          <p className="muted">Compare one selected year as bars against two previous or reference years as line plots.</p>
        </div>
      </div>
      <div className="card data-controls">
        <div className="grid three">
          <Field label="Property">
            <select value={property?.id || ""} onChange={(e) => setSelectedPropertyId(e.target.value)}>
              {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Scope">
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="building">Landlord consumption</option>
              <option value="tenant">Tenant consumption</option>
            </select>
          </Field>
          <Field label="Utility">
            <select value={utility} onChange={(e) => setUtility(e.target.value)}>
              <option value="electricity">Electricity</option>
              <option value="heating">Heating</option>
              <option value="cooling">Cooling</option>
              <option value="total">Total energy</option>
            </select>
          </Field>
        </div>
        <div className="grid three">
          <Field label="Selected year">
            <select value={primaryYear} onChange={(e) => setPrimaryYear(e.target.value)}>
              {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </Field>
          <Field label="Comparison year 1">
            <select value={comparisonYearA} onChange={(e) => setComparisonYearA(e.target.value)}>
              {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </Field>
          <Field label="Comparison year 2">
            <select value={comparisonYearB} onChange={(e) => setComparisonYearB(e.target.value)}>
              {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div className="grid four data-kpis" style={{ marginTop: 14 }}>
        {totals.map(({ year, total }, index) => <Kpi key={`${year}-${index}`} label={`${year} total`} value={`${kwh(total)} kWh`} />)}
        <Kpi label="Months selected" value={health.monthsPresent} />
      </div>
      <div className="data-view-grid">
        <div className="card">
          <h3>Data Health</h3>
          <p className="muted">Green means a reading is present for that month, year, property, scope, and utility.</p>
          <DataHealthTable years={selectedYears} health={health} />
        </div>
        <div className="card data-chart-card">
          <div className="chart-head">
            <h3>{dataViewUtilityLabel(utility)} comparison</h3>
            <span className="muted">kWh/month</span>
          </div>
          <UsageComparisonChart years={selectedYears} primaryYear={primaryYear} series={series} />
        </div>
      </div>
    </section>
  );
}

function BenchmarkView({ ready, properties, selectedPropertyId, setSelectedPropertyId, monthlyUsage }) {
  const selectedId = Number(selectedPropertyId) || properties[0]?.id || "";
  const property = properties.find((item) => item.id === Number(selectedId)) || properties[0] || null;
  const availableYears = useMemo(() => benchmarkYears(monthlyUsage, property?.id), [monthlyUsage, property?.id]);
  const availableMonths = useMemo(() => benchmarkMonths(monthlyUsage, property?.id), [monthlyUsage, property?.id]);
  const [year, setYear] = useState("");
  const [periodMode, setPeriodMode] = useState("calendar");
  const [rollingEndMonth, setRollingEndMonth] = useState("");
  const [nlaOverride, setNlaOverride] = useState("");

  useEffect(() => {
    if (!availableYears.length) return;
    setYear((prev) => availableYears.includes(prev) ? prev : availableYears[0]);
  }, [availableYears]);

  useEffect(() => {
    if (!availableMonths.length) return;
    setRollingEndMonth((prev) => availableMonths.includes(prev) ? prev : availableMonths[0]);
  }, [availableMonths]);

  if (!ready) return <EmptyState />;
  const analysis = buildBenchmarkAnalysis({
    property,
    properties,
    monthlyUsage,
    periodMode,
    year: year || availableYears[0],
    rollingEndMonth: rollingEndMonth || availableMonths[0],
    nlaOverride
  });
  const currentYear = year || availableYears[0] || String(new Date().getFullYear());
  const currentRollingEnd = rollingEndMonth || availableMonths[0] || todayIso().slice(0, 7);

  return (
    <section className="section benchmark-section">
      <div className="section-head">
        <div>
          <h3>Benchmark</h3>
          <p className="muted">REEB office benchmark view using landlord / whole-building monthly consumption.</p>
        </div>
      </div>
      <div className="card data-controls benchmark-controls">
        <div className="benchmark-control-grid">
          <Field label="Property">
            <select value={property?.id || ""} onChange={(e) => setSelectedPropertyId(e.target.value)}>
              {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Period" help="Calendar year is useful for annual reporting. Rolling 12 months is better for current performance.">
            <select value={periodMode} onChange={(e) => setPeriodMode(e.target.value)}>
              <option value="calendar">Calendar year</option>
              <option value="rolling_12">Rolling 12 months</option>
            </select>
          </Field>
          {periodMode === "rolling_12" ? (
            <Field label="Rolling end month" help="The page uses this month plus the previous 11 months.">
              <input type="month" value={currentRollingEnd} onChange={(e) => setRollingEndMonth(e.target.value)} />
            </Field>
          ) : (
            <Field label="Benchmark year" help="The page uses full or partial landlord usage records for this calendar year.">
              <select value={currentYear} onChange={(e) => setYear(e.target.value)}>
                {availableYears.length ? availableYears.map((item) => <option key={item} value={item}>{item}</option>) : <option value={currentYear}>{currentYear}</option>}
              </select>
            </Field>
          )}
          <Field label="NLA override m2" help="REEB electricity-equivalent benchmark uses NLA. If blank, the app uses the property floor area as a temporary proxy.">
            <input type="number" min="0" step="0.01" value={nlaOverride} onChange={(e) => setNlaOverride(e.target.value)} placeholder={analysis.gia ? String(analysis.gia) : "Enter NLA"} />
          </Field>
        </div>
      </div>

      {!analysis.ok ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Benchmark input needed</h3>
          <p className="muted">{analysis.error}</p>
        </div>
      ) : (
        <>
          <div className="grid four data-kpis" style={{ marginTop: 14 }}>
            <Kpi label="Months present" value={`${analysis.monthsPresent}/12`} />
            <Kpi label="Total energy" value={`${kwh(analysis.totalEnergyKwh)} kWh`} />
            <Kpi label="Total energy intensity" value={`${formatBenchmarkNumber(analysis.totalEnergyIntensity)} kWh/m2`} />
            <Kpi label="Elec. equivalent intensity" value={`${formatBenchmarkNumber(analysis.electricityEquivalentIntensity)} kWh/m2`} />
          </div>
          <div className="benchmark-grid">
            <div className="card">
              <h3>REEB Office Method</h3>
              <p className="muted">
                This page compares the selected property against the office benchmark figures from your REEB reference screenshot.
                Benchmarks are whole-building values and should only be used where offices represent more than 75% of the reporting area.
              </p>
              <div className="benchmark-definition-grid">
                <div>
                  <strong>Electricity equivalent</strong>
                  <span>Converts each fuel to an electricity-equivalent basis using REEB factors, then divides by NLA.</span>
                </div>
                <div>
                  <strong>Total energy</strong>
                  <span>Adds electricity, heating and cooling kWh directly, then divides by GIA. No conversion factor is applied.</span>
                </div>
                <div>
                  <strong>Portfolio average</strong>
                  <span>Weighted average for all properties with usage in the same period: total portfolio kWh divided by total portfolio area.</span>
                </div>
              </div>
              <table className="benchmark-factor-table">
                <thead><tr><th>Carrier</th><th>Electricity equivalent factor</th></tr></thead>
                <tbody>
                  {REEB_FACTOR_ROWS.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.factor.toFixed(2)}</td></tr>)}
                </tbody>
              </table>
              <div className="benchmark-note">
                <strong>Area basis</strong>
                <span>Total energy uses GIA. Electricity equivalent uses NLA. Current app data has one stored floor-area field, so NLA defaults to the same value unless you override it above.</span>
              </div>
              {analysis.warnings.map((warning) => <div key={warning} className="benchmark-warning">{warning}</div>)}
            </div>
            <div className="card benchmark-chart-card">
              <div className="chart-head">
                <h3>Office energy benchmark</h3>
                <span className="muted">kWh/m2/year</span>
              </div>
              <BenchmarkComparisonChart analysis={analysis} />
            </div>
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>Inputs Used</h3>
              <table>
                <tbody>
                  <tr><th>Period</th><td>{analysis.periodLabel}</td></tr>
                  <tr><th>GIA</th><td>{formatBenchmarkNumber(analysis.gia)} m2</td></tr>
                  <tr><th>NLA</th><td>{formatBenchmarkNumber(analysis.nla)} m2</td></tr>
                  <tr><th>Electricity</th><td>{kwh(analysis.usage.electricity_kwh)} kWh</td></tr>
                  <tr><th>Heating</th><td>{kwh(analysis.usage.heating_kwh)} kWh - factor {formatBenchmarkNumber(analysis.heatingFactor)}</td></tr>
                  <tr><th>Cooling</th><td>{kwh(analysis.usage.cooling_kwh)} kWh - factor {formatBenchmarkNumber(analysis.coolingFactor)}</td></tr>
                  <tr><th>Portfolio properties</th><td>{analysis.portfolio?.propertyCount || 0}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Benchmark Status</h3>
              <BenchmarkStatus
                label="Electricity equivalent"
                value={analysis.electricityEquivalentIntensity}
                good={REEB_OFFICE_BENCHMARKS.electricityEquivalent.good}
                typical={REEB_OFFICE_BENCHMARKS.electricityEquivalent.typical}
              />
              <BenchmarkStatus
                label="Total energy"
                value={analysis.totalEnergyIntensity}
                good={REEB_OFFICE_BENCHMARKS.totalEnergy.good}
                typical={REEB_OFFICE_BENCHMARKS.totalEnergy.typical}
              />
            </div>
          </div>
        </>
      )}
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
  const [mode, setMode] = useState("new");
  const [loadedOnce, setLoadedOnce] = useState(false);
  useEffect(() => {
    if (!ready || mode !== "existing" || loadedOnce) return;
    setLoadedOnce(true);
    loadMeetingFiles();
  }, [ready, mode, loadedOnce, loadMeetingFiles]);
  if (!ready) return <EmptyState />;
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const selectedFile = meetingFiles.find((file) => file.name === selectedMeetingName);
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h3>Monthly Meeting Notes</h3>
          <p className="muted">Create the pre-meeting pack, then come back after the meeting to update only the post-meeting comments.</p>
        </div>
        <button className="btn" type="button" onClick={loadMeetingFiles}>Refresh Notes</button>
      </div>
      <div className="tabs compact-tabs">
        <button className={mode === "new" ? "active" : ""} type="button" onClick={() => setMode("new")}>New Note</button>
        <button className={mode === "existing" ? "active" : ""} type="button" onClick={() => setMode("existing")}>Update Existing</button>
      </div>
      {mode === "new" ? (
        <div className="card meeting-editor-card">
          <form onSubmit={save}>
            <div className="grid three">
              <Field label="Property"><select value={form.property_id} onChange={(e) => set("property_id", e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Report month"><input type="month" value={form.report_month} onChange={(e) => set("report_month", e.target.value)} /></Field>
              <Field label="Meeting date"><input type="date" value={form.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} /></Field>
            </div>
            <Field label="Comments pre meeting" help="These comments are written into the new Obsidian note. Existing post-meeting comments are preserved if the note already exists.">
              <textarea className="meeting-textarea" value={form.pre} onChange={(e) => set("pre", e.target.value)} />
            </Field>
            <div className="toolbar">
              <button className="btn primary">Create / Update Meeting Note</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="grid two meeting-edit-grid">
          <div className="card meeting-picker-card">
            <div className="section-head">
              <div>
                <h3>Existing Notes</h3>
                <p className="muted">{meetingFiles.length ? `${meetingFiles.length} monthly notes loaded.` : "Click Refresh Notes to read the meeting folder."}</p>
              </div>
            </div>
            <Field label="Meeting note">
              <select className="input" value={selectedMeetingName} onChange={(e) => selectMeeting(e.target.value)}>
                <option value="">Select note...</option>
                {meetingFiles.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}
              </select>
            </Field>
            {selectedFile ? (
              <div className="meeting-context">
                <strong>{selectedFile.name}</strong>
                <span>Pre-meeting context</span>
                <p>{meetingDraft.pre || "No pre-meeting comments found in this note."}</p>
              </div>
            ) : null}
          </div>
          <div className="card meeting-editor-card">
            <Field label="Comments post meeting" help="Only this section is saved back to the selected Obsidian note.">
              <textarea
                className="meeting-textarea"
                value={meetingDraft.post || ""}
                onChange={(e) => setMeetingDraft((prev) => ({ ...prev, post: e.target.value }))}
                disabled={!selectedMeetingName}
              />
            </Field>
            <div className="toolbar">
              <button className="btn primary" type="button" disabled={!selectedMeetingName} onClick={saveMeetingDraft}>Save Post-Meeting Comments</button>
            </div>
          </div>
        </div>
      )}
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

function StatusQuoView({ ready, properties, selectedPropertyId, setSelectedPropertyId, folderHandle, folderStatus, configureFolder, notify }) {
  const selectedId = Number(selectedPropertyId) || properties[0]?.id || "";
  const property = properties.find((item) => item.id === Number(selectedId)) || properties[0] || null;
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [text, setText] = useState("");
  const [entries, setEntries] = useState([]);
  const [frontmatter, setFrontmatter] = useState("");
  const [filename, setFilename] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedPeriod = `${year}/${month}`;

  useEffect(() => {
    if (!ready || !folderHandle || !property) return;
    loadStatusQuo();
  }, [ready, folderHandle, property?.id]);

  useEffect(() => {
    const existing = entries.find((entry) => entry.period === selectedPeriod);
    setText(existing?.text || "");
  }, [selectedPeriod, entries]);

  async function loadStatusQuo() {
    if (!folderHandle || !property) return;
    setLoading(true);
    try {
      if (!(await ensurePermission(folderHandle, "readwrite"))) throw new Error("Status Quo folder permission was not granted.");
      const files = await listMarkdownFiles(folderHandle);
      const file = findStatusQuoFile(files, property);
      const parsed = parseStatusQuoMarkdown(file?.text || "", property);
      setEntries(parsed.entries);
      setFrontmatter(parsed.frontmatter);
      setFilename(file?.name || statusQuoFilename(property));
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  async function saveStatusQuo(event) {
    event.preventDefault();
    if (!folderHandle || !property) {
      notify("Configure the Status Quo folder in Setup first.");
      return;
    }
    setLoading(true);
    try {
      if (!(await ensurePermission(folderHandle, "readwrite"))) throw new Error("Status Quo folder permission was not granted.");
      const normalised = normaliseStatusQuoText(text);
      if (!normalised) throw new Error("Add status quo text before saving.");
      const nextEntries = upsertStatusQuoEntry(entries, { period: selectedPeriod, text: normalised });
      const nextFrontmatter = frontmatter || statusQuoFrontmatter(property);
      const nextFilename = filename || statusQuoFilename(property);
      await writeTextIntoFolder(folderHandle, nextFilename, buildStatusQuoMarkdown(nextFrontmatter, nextEntries));
      setEntries(nextEntries);
      setFrontmatter(nextFrontmatter);
      setFilename(nextFilename);
      notify(`Status quo saved to ${nextFilename}.`);
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return <EmptyState />;
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h3>Status Quo</h3>
          <p className="muted">Maintain one Obsidian Markdown timeline per property.</p>
        </div>
        <div className="toolbar">
          <button className="btn" type="button" onClick={configureFolder}>{folderHandle ? "Change Folder" : "Select Folder"}</button>
          <button className="btn" type="button" disabled={!folderHandle || loading} onClick={loadStatusQuo}>{loading ? "Loading..." : "Refresh"}</button>
        </div>
      </div>
      {!folderHandle ? (
        <div className="card">
          <h3>Status Quo folder needed</h3>
          <p className="muted">Select the Obsidian folder that contains files like `5 Keizers - Status Quo.md`.</p>
          <button className="btn primary" type="button" onClick={configureFolder}>Select Status Quo Folder</button>
        </div>
      ) : (
        <div className="status-quo-grid">
          <div className="card status-quo-editor">
            <form onSubmit={saveStatusQuo}>
              <Field label="Property">
                <select value={property?.id || ""} onChange={(event) => setSelectedPropertyId(event.target.value)}>
                  {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <div className="grid two">
                <Field label="Year">
                  <input type="number" min="2020" max="2050" value={year} onChange={(event) => setYear(event.target.value)} />
                </Field>
                <Field label="Month">
                  <select value={month} onChange={(event) => setMonth(event.target.value)}>
                    {MONTH_LABELS.map((label, index) => {
                      const value = String(index + 1).padStart(2, "0");
                      return <option key={value} value={value}>{value} - {label}</option>;
                    })}
                  </select>
                </Field>
              </div>
              <Field label="Status quo text" help="Write plain lines. The app saves each line as a bullet to match the existing notes.">
                <textarea className="status-quo-textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder="- Add current status, blockers, decisions, or next steps..." />
              </Field>
              <div className="toolbar">
                <button className="btn primary" disabled={loading}>{loading ? "Saving..." : "Save Month"}</button>
                <button className="btn" type="button" onClick={() => setText("")}>Clear Text</button>
              </div>
              <p className="muted">File: {filename || statusQuoFilename(property)}. Folder status: {folderStatus || "selected"}.</p>
            </form>
          </div>
          <div className="card status-quo-timeline-card">
            <div className="section-head">
              <div>
                <h3>{property?.name || "Property"} Timeline</h3>
                <p className="muted">{entries.length ? `${entries.length} status updates loaded.` : "No status quo updates found yet."}</p>
              </div>
            </div>
            <StatusQuoTimeline entries={entries} />
          </div>
        </div>
      )}
    </section>
  );
}

function OpenActionsView({ ready, properties, selectedPropertyId, setSelectedPropertyId, folderHandle, folderStatus, configureFolder, notify }) {
  const selectedId = Number(selectedPropertyId) || properties[0]?.id || "";
  const property = properties.find((item) => item.id === Number(selectedId)) || properties[0] || null;
  const [actions, setActions] = useState([]);
  const [frontmatter, setFrontmatter] = useState("");
  const [filename, setFilename] = useState("");
  const [newAction, setNewAction] = useState("");
  const [newResponsible, setNewResponsible] = useState(RESPONSIBLE_OPTIONS[0]);
  const [responsibleFilter, setResponsibleFilter] = useState("All");
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready || !folderHandle || !property) return;
    loadOpenActions();
  }, [ready, folderHandle, property?.id]);

  async function loadOpenActions() {
    if (!folderHandle || !property) return;
    setLoading(true);
    try {
      if (!(await ensurePermission(folderHandle, "readwrite"))) throw new Error("Open Actions folder permission was not granted.");
      const files = await listMarkdownFiles(folderHandle);
      const file = findOpenActionsFile(files, property);
      const parsed = parseOpenActionsMarkdown(file?.text || "", property);
      setActions(parsed.actions);
      setFrontmatter(parsed.frontmatter);
      setFilename(file?.name || openActionsFilename(property));
      setComments({});
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  async function writeActions(nextActions, nextFrontmatter = frontmatter, nextFilename = filename) {
    if (!folderHandle || !property) throw new Error("Configure the Open Actions folder first.");
    if (!(await ensurePermission(folderHandle, "readwrite"))) throw new Error("Open Actions folder permission was not granted.");
    const fileFrontmatter = nextFrontmatter || openActionsFrontmatter(property);
    const fileName = nextFilename || openActionsFilename(property);
    await writeTextIntoFolder(folderHandle, fileName, buildOpenActionsMarkdown(fileFrontmatter, nextActions));
    setActions(nextActions);
    setFrontmatter(fileFrontmatter);
    setFilename(fileName);
  }

  async function addAction(event) {
    event.preventDefault();
    if (!folderHandle || !property) {
      notify("Configure the Open Actions folder in Setup first.");
      return;
    }
    const text = normaliseActionText(newAction);
    if (!text) {
      notify("Add an action before saving.");
      return;
    }
    setLoading(true);
    try {
      await writeActions([...actions, { text, responsible: newResponsible, done: false, comment: "" }]);
      setNewAction("");
      notify("Open action saved.");
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  async function closeAction(index) {
    const comment = String(comments[index] || "").trim();
    setLoading(true);
    try {
      const nextActions = actions.map((action, actionIndex) => actionIndex === index ? { ...action, done: true, comment } : action);
      await writeActions(nextActions);
      setComments((prev) => ({ ...prev, [index]: "" }));
      notify("Action closed.");
    } catch (error) {
      notify(error.message || String(error));
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return <EmptyState />;
  const openCount = actions.filter((action) => !action.done).length;
  const closedCount = actions.length - openCount;
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h3>Open Actions</h3>
          <p className="muted">Maintain one Obsidian checklist per property.</p>
        </div>
        <div className="toolbar">
          <button className="btn" type="button" onClick={configureFolder}>{folderHandle ? "Change Folder" : "Select Folder"}</button>
          <button className="btn" type="button" disabled={!folderHandle || loading} onClick={loadOpenActions}>{loading ? "Loading..." : "Refresh"}</button>
        </div>
      </div>
      {!folderHandle ? (
        <div className="card">
          <h3>Open Actions folder needed</h3>
          <p className="muted">Select the Obsidian folder where property action checklist files should be saved.</p>
          <button className="btn primary" type="button" onClick={configureFolder}>Select Open Actions Folder</button>
        </div>
      ) : (
        <div className="open-actions-grid">
          <div className="card open-actions-editor">
            <form onSubmit={addAction}>
              <Field label="Property">
                <select value={property?.id || ""} onChange={(event) => setSelectedPropertyId(event.target.value)}>
                  {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="New open item" help="Saved as an Obsidian checklist item: - [ ] action text">
                <textarea className="open-actions-textarea" value={newAction} onChange={(event) => setNewAction(event.target.value)} placeholder="Add the action text..." />
              </Field>
              <Field label="Responsible">
                <select value={newResponsible} onChange={(event) => setNewResponsible(event.target.value)}>
                  {RESPONSIBLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
              <div className="toolbar">
                <button className="btn primary" disabled={loading}>{loading ? "Saving..." : "Add Open Item"}</button>
                <button className="btn" type="button" onClick={() => setNewAction("")}>Clear</button>
              </div>
              <p className="muted">File: {filename || openActionsFilename(property)}. Folder status: {folderStatus || "selected"}.</p>
            </form>
          </div>
          <div className="card open-actions-list-card">
            <div className="section-head">
              <div>
                <h3>{property?.name || "Property"} Actions</h3>
                <p className="muted">{openCount} open, {closedCount} closed.</p>
              </div>
            </div>
            <Field label="Filter by responsible" className="open-actions-filter">
              <select value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Unassigned">Unassigned</option>
                {RESPONSIBLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <OpenActionsList actions={actions} responsibleFilter={responsibleFilter} comments={comments} setComments={setComments} closeAction={closeAction} loading={loading} />
          </div>
        </div>
      )}
    </section>
  );
}

function AdminTrackerView({ ready, properties, records, form, setForm, save }) {
  if (!ready) return <EmptyState />;
  const selectedPropertyId = Number(form.property_id || properties[0]?.id || "");
  const propertyRecords = (records || []).filter((record) => record.property_id === selectedPropertyId);
  const sortedRecords = [...propertyRecords].sort((a, b) => {
    const yearDiff = Number(b.admin_year) - Number(a.admin_year);
    if (yearDiff) return yearDiff;
    return Number(b.admin_month) - Number(a.admin_month);
  });
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const editRecord = (record) => {
    setForm({
      ...record,
      property_id: String(record.property_id),
      admin_year: String(record.admin_year),
      admin_month: String(record.admin_month || 1),
      comments: record.comments || ""
    });
  };
  async function toggleDeliverable(record, key) {
    await save(null, { ...record, [key]: !record[key] });
  }
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h3>Admin Tracker</h3>
          <p className="muted">Lightweight monthly deliverable tracker stored only in the SQLite database.</p>
        </div>
      </div>
      <div className="admin-tracker-grid">
        <div className="card">
          <form onSubmit={save}>
            <Field label="Property">
              <select value={selectedPropertyId || ""} onChange={(event) => set("property_id", event.target.value)}>
                {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
              </select>
            </Field>
            <Field label="Year">
              <input type="number" min="2024" max="2050" value={form.admin_year} onChange={(event) => set("admin_year", event.target.value)} />
            </Field>
            <Field label="Month">
              <select value={form.admin_month} onChange={(event) => set("admin_month", event.target.value)}>
                {MONTH_LABELS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </select>
            </Field>
            <Field label="Comments">
              <textarea value={form.comments} onChange={(event) => set("comments", event.target.value)} placeholder="Admin context, blockers, or handover notes..." />
            </Field>
            <div className="admin-deliverable-list">
              {ADMIN_DELIVERABLES.map(([key, label]) => (
                <label key={key}>
                  <input type="checkbox" checked={Boolean(form[key])} onChange={(event) => set(key, event.target.checked)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="toolbar">
              <button className="btn primary">Save Admin Row</button>
              <button className="btn" type="button" onClick={() => setForm({ ...defaultAdminTrackerForm(), property_id: String(selectedPropertyId || "") })}>New Month</button>
            </div>
          </form>
        </div>
        <div className="card admin-tracker-table-card">
          <h3>{properties.find((property) => property.id === selectedPropertyId)?.name || "Property"} Deliverables</h3>
          <div style={{ overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  {ADMIN_DELIVERABLES.map(([, label]) => <th key={label}>{label}</th>)}
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map((record) => (
                  <tr key={record.id} onClick={() => editRecord(record)} style={{ cursor: "pointer" }}>
                    <td><strong>{MONTH_LABELS[Number(record.admin_month || 1) - 1]} {record.admin_year}</strong></td>
                    {ADMIN_DELIVERABLES.map(([key]) => (
                      <td key={key} onClick={(event) => event.stopPropagation()}>
                        <button className={`tracker-check ${record[key] ? "is-done" : ""}`} type="button" onClick={() => toggleDeliverable(record, key)}>
                          {record[key] ? "Done" : "Open"}
                        </button>
                      </td>
                    ))}
                    <td>{record.comments || ""}</td>
                  </tr>
                ))}
                {!sortedRecords.length ? <tr><td colSpan={ADMIN_DELIVERABLES.length + 2} className="muted">No monthly admin tracker rows for this property yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function DatabaseView({ ready, db, sqlText, setSqlText, runSql, sqlRows }) {
  if (!ready) return <EmptyState />;
  const tables = ["properties", "tenants", "equipment", "ecms", "monthly_utility_usage", "monthly_admin_tracker", "ecm_measured_savings", "ecm_attachments"];
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

function StatusQuoTimeline({ entries }) {
  const sorted = [...(entries || [])].sort((a, b) => b.period.localeCompare(a.period));
  if (!sorted.length) return <p className="muted">Select a month and save the first status update.</p>;
  return (
    <div className="status-quo-timeline">
      {sorted.map((entry) => {
        const [year, month] = entry.period.split("/");
        return (
          <div className="status-quo-item" key={entry.period}>
            <div className="status-quo-date">
              <strong>{month}</strong>
              <span>{year}</span>
            </div>
            <div className="status-quo-bubble">
              {statusQuoLines(entry.text).map((line, index) => <p key={`${entry.period}-${index}`}>{line}</p>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OpenActionsList({ actions, responsibleFilter, comments, setComments, closeAction, loading }) {
  const sorted = [...(actions || [])]
    .map((action, index) => ({ ...action, index, responsible: normaliseResponsible(action.responsible) }))
    .filter((action) => responsibleFilter === "All" || action.responsible === responsibleFilter)
    .sort((a, b) => Number(a.done) - Number(b.done));
  if (!sorted.length) return <p className="muted">Add the first open action from the left panel.</p>;
  return (
    <div className="open-actions-list">
      {sorted.map((action) => (
        <div className={`open-action-item ${action.done ? "is-done" : ""}`} key={`${action.index}-${action.text}`}>
          <div className="open-action-check">{action.done ? "✓" : ""}</div>
          <div className="open-action-body">
            <span className="open-action-responsible">{action.responsible}</span>
            <strong>{action.text}</strong>
            {action.done ? (
              <p className="open-action-comment">{action.comment ? `comment: ${action.comment}` : "comment: closed without comment"}</p>
            ) : (
              <div className="open-action-close">
                <textarea
                  value={comments[action.index] || ""}
                  onChange={(event) => setComments((prev) => ({ ...prev, [action.index]: event.target.value }))}
                  placeholder="Closing comment, optional"
                />
                <button className="btn primary" type="button" disabled={loading} onClick={() => closeAction(action.index)}>Close</button>
              </div>
            )}
          </div>
        </div>
      ))}
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

function DataHealthTable({ years, health }) {
  return (
    <div className="data-health-wrap">
      <table className="data-health-table">
        <thead>
          <tr>
            <th>Month</th>
            {years.map((year, index) => <th key={`${year}-${index}`}>{year}</th>)}
          </tr>
        </thead>
        <tbody>
          {MONTH_LABELS.map((month, monthIndex) => (
            <tr key={month}>
              <td>{month}</td>
              {years.map((year, yearIndex) => {
                const present = Boolean(health.matrix?.[year]?.[monthIndex]);
                return (
                  <td key={`${year}-${yearIndex}-${month}`}>
                    <span className={`status-light ${present ? "ok" : "missing"}`}>{present ? "Present" : "Missing"}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BenchmarkComparisonChart({ analysis }) {
  const width = 820;
  const height = 390;
  const pad = { left: 205, right: 26, top: 24, bottom: 42 };
  const rows = [
    {
      key: "electricityEquivalent",
      label: "Electricity equivalent",
      asset: analysis.electricityEquivalentIntensity,
      portfolio: analysis.portfolio?.electricityEquivalentIntensity,
      good: REEB_OFFICE_BENCHMARKS.electricityEquivalent.good,
      typical: REEB_OFFICE_BENCHMARKS.electricityEquivalent.typical
    },
    {
      key: "totalEnergy",
      label: "Total energy",
      asset: analysis.totalEnergyIntensity,
      portfolio: analysis.portfolio?.totalEnergyIntensity,
      good: REEB_OFFICE_BENCHMARKS.totalEnergy.good,
      typical: REEB_OFFICE_BENCHMARKS.totalEnergy.typical
    }
  ];
  const values = rows.flatMap((row) => [row.asset, row.portfolio, row.good, row.typical]).filter((value) => Number.isFinite(Number(value)));
  const maxValue = Math.max(...values, 1) * 1.18;
  const chartW = width - pad.left - pad.right;
  const x = (value) => pad.left + (Number(value || 0) / maxValue) * chartW;
  const groups = [
    { key: "asset", label: "Asset", className: "asset" },
    { key: "portfolio", label: "Portfolio avg", className: "portfolio" },
    { key: "good", label: "Good practice", className: "good" },
    { key: "typical", label: "Typical", className: "typical" }
  ];
  return (
    <svg className="benchmark-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="REEB office benchmark comparison">
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="chart-axis" />
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="chart-axis" />
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const value = maxValue * ratio;
        const xx = x(value);
        return (
          <g key={ratio}>
            <line x1={xx} y1={pad.top} x2={xx} y2={height - pad.bottom} className="chart-gridline" />
            <text x={xx} y={height - 18} className="chart-label" textAnchor="middle">{formatBenchmarkNumber(value)}</text>
          </g>
        );
      })}
      {rows.map((row, rowIndex) => {
        const baseY = pad.top + 44 + rowIndex * 158;
        return (
          <g key={row.key}>
            <text x={18} y={baseY + 20} className="benchmark-row-label">{row.label}</text>
            {groups.map((group, groupIndex) => {
              const y = baseY + groupIndex * 26;
              const value = row[group.key];
              if (!Number.isFinite(Number(value))) return null;
              return (
                <g key={`${row.key}-${group.key}`}>
                  <text x={pad.left - 12} y={y + 13} className="chart-label" textAnchor="end">{group.label}</text>
                  <rect x={pad.left} y={y} width={Math.max(2, x(value) - pad.left)} height="17" rx="3" className={`benchmark-bar ${group.className}`} />
                  <text x={Math.min(width - pad.right - 8, x(value) + 8)} y={y + 13} className="benchmark-value-label">{formatBenchmarkNumber(value)}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function BenchmarkStatus({ label, value, good, typical }) {
  const status = benchmarkStatus(value, good, typical);
  return (
    <div className={`benchmark-status ${status.className}`}>
      <strong>{label}</strong>
      <span>{formatBenchmarkNumber(value)} kWh/m2/year</span>
      <em>{status.label}</em>
    </div>
  );
}

function UsageComparisonChart({ years, primaryYear, series }) {
  const width = 820;
  const height = 360;
  const pad = { left: 70, right: 22, top: 26, bottom: 48 };
  const allValues = years.flatMap((year) => (series[year] || []).map((point) => point.value));
  const maxValue = Math.max(...allValues, 0) * 1.15 || 1;
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const monthStep = chartW / 12;
  const x = (monthIndex) => pad.left + monthStep * (monthIndex + 0.5);
  const y = (value) => pad.top + chartH - (Number(value || 0) / maxValue) * chartH;
  const barW = Math.min(42, monthStep * 0.62);
  const primary = series[primaryYear] || [];
  const comparisonYears = years.filter((year) => year !== primaryYear);
  const colors = ["#a78bfa", "#22d3ee"];
  return (
    <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly usage comparison">
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="chart-axis" />
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="chart-axis" />
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const value = maxValue * ratio;
        const yy = y(value);
        return (
          <g key={ratio}>
            <line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="chart-gridline" />
            <text x={pad.left - 8} y={yy + 4} className="chart-label" textAnchor="end">{kwh(value)}</text>
          </g>
        );
      })}
      {MONTH_LABELS.map((month, index) => (
        <g key={month}>
          <line x1={pad.left + monthStep * index} y1={pad.top} x2={pad.left + monthStep * index} y2={height - pad.bottom} className="chart-year-gridline" />
          <text x={x(index)} y={height - 24} className="chart-label" textAnchor="middle">{month.slice(0, 3)}</text>
        </g>
      ))}
      <line x1={width - pad.right} y1={pad.top} x2={width - pad.right} y2={height - pad.bottom} className="chart-year-gridline" />
      {primary.map((point) => {
        const barH = height - pad.bottom - y(point.value);
        return (
          <rect
            key={`${primaryYear}-${point.month}`}
            x={x(point.monthIndex) - barW / 2}
            y={y(point.value)}
            width={barW}
            height={Math.max(0, barH)}
            rx="3"
            className="usage-bar"
          />
        );
      })}
      {comparisonYears.map((year, index) => {
        const points = series[year] || [];
        const path = points.map((point, i) => `${i ? "L" : "M"} ${x(point.monthIndex).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
        return (
          <g key={year}>
            <path d={path} fill="none" stroke={colors[index % colors.length]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((point) => <circle key={`${year}-${point.month}`} cx={x(point.monthIndex)} cy={y(point.value)} r="3.5" fill={colors[index % colors.length]} />)}
          </g>
        );
      })}
      <g className="usage-chart-legend">
        <text x={pad.left} y={18} className="chart-label">{primaryYear} bars</text>
        {comparisonYears.map((year, index) => (
          <text key={year} x={pad.left + 120 + index * 112} y={18} className="chart-label" fill={colors[index % colors.length]}>{year} line</text>
        ))}
      </g>
    </svg>
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

const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const REEB_OFFICE_BENCHMARKS = {
  electricityEquivalent: { good: 136, typical: 191 },
  totalEnergy: { good: 112, typical: 163 }
};

const REEB_FACTOR_ROWS = [
  { label: "Gas / LPG", factor: 0.76 },
  { label: "Fuel oil", factor: 0.80 },
  { label: "Wood pellets", factor: 0.91 },
  { label: "District heating", factor: 0.91 },
  { label: "District cooling", factor: 0.40 }
];

const REEB_ELECTRICITY_EQUIVALENT_FACTORS = {
  natural_gas: 0.76,
  lpg: 0.76,
  heating_oil: 0.80,
  biomass: 0.91,
  district_heating: 0.91,
  district_cooling: 0.40,
  electric: 1,
  none: 0
};

function benchmarkYears(rows = [], propertyId) {
  const years = new Set();
  for (const row of rows || []) {
    if (propertyId && Number(row.property_id) !== Number(propertyId)) continue;
    if ((row.scope_type || "building") !== "building") continue;
    const year = String(row.usage_month || "").slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
  }
  return [...years].sort((a, b) => Number(b) - Number(a));
}

function benchmarkMonths(rows = [], propertyId) {
  const months = new Set();
  for (const row of rows || []) {
    if (propertyId && Number(row.property_id) !== Number(propertyId)) continue;
    if ((row.scope_type || "building") !== "building") continue;
    const month = String(row.usage_month || "");
    if (/^\d{4}-\d{2}$/.test(month)) months.add(month);
  }
  return [...months].sort((a, b) => b.localeCompare(a));
}

function buildBenchmarkAnalysis({ property, properties = [], monthlyUsage = [], periodMode = "calendar", year, rollingEndMonth, nlaOverride }) {
  if (!property) return { ok: false, error: "Select a property first." };
  const gia = Number(property.total_floor_area || 0);
  if (!gia) return { ok: false, error: "This property needs a total floor area before it can be benchmarked." };
  const nla = Number(nlaOverride || 0) || gia;
  const period = benchmarkPeriod(periodMode, year, rollingEndMonth);
  if (!period.ok) return { ok: false, error: period.error };
  const rows = benchmarkRowsForPeriod(monthlyUsage, property.id, period);
  if (!rows.length) return { ok: false, error: "No landlord / whole-building usage was found for the selected period." };
  const usage = sumBenchmarkUsage(rows);
  const months = benchmarkPresentMonths(rows);
  const heatingFactorInfo = reebFactorForCarrier(property.heating_carrier, "heating");
  const coolingFactorInfo = reebFactorForCarrier(property.cooling_carrier, "cooling");
  const portfolio = buildPortfolioBenchmark({ properties, monthlyUsage, period });
  const warnings = [];
  if (!nlaOverride) warnings.push("NLA is currently defaulting to the stored property floor area. Enter an NLA override if you have the REEB reporting area.");
  if (months.size < 12) warnings.push(`Only ${months.size}/12 months have usage values for ${period.label}. Benchmark intensity may be understated.`);
  if (!portfolio) warnings.push("Portfolio average is not available because no properties have floor area and usage for this period.");
  if (heatingFactorInfo.warning) warnings.push(heatingFactorInfo.warning);
  if (coolingFactorInfo.warning) warnings.push(coolingFactorInfo.warning);
  const totalEnergyKwh = usage.electricity_kwh + usage.heating_kwh + usage.cooling_kwh;
  const electricityEquivalentKwh = usage.electricity_kwh
    + usage.heating_kwh * heatingFactorInfo.factor
    + usage.cooling_kwh * coolingFactorInfo.factor;
  return {
    ok: true,
    periodLabel: period.label,
    gia,
    nla,
    usage,
    monthsPresent: months.size,
    portfolio,
    heatingFactor: heatingFactorInfo.factor,
    coolingFactor: coolingFactorInfo.factor,
    totalEnergyKwh,
    electricityEquivalentKwh,
    totalEnergyIntensity: totalEnergyKwh / gia,
    electricityEquivalentIntensity: electricityEquivalentKwh / nla,
    warnings
  };
}

function benchmarkPeriod(periodMode, year, rollingEndMonth) {
  if (periodMode === "rolling_12") {
    const endMonth = String(rollingEndMonth || "");
    if (!/^\d{4}-\d{2}$/.test(endMonth)) return { ok: false, error: "Select a valid rolling end month." };
    const months = monthRange(endMonth, 11);
    return { ok: true, mode: "rolling_12", months, label: `${months[0]} to ${months[11]}` };
  }
  const selectedYear = String(year || "");
  if (!/^\d{4}$/.test(selectedYear)) return { ok: false, error: "Select a valid benchmark year." };
  return { ok: true, mode: "calendar", year: selectedYear, label: selectedYear };
}

function benchmarkRowsForPeriod(rows = [], propertyId, period) {
  return (rows || []).filter((row) => {
    if (Number(row.property_id) !== Number(propertyId)) return false;
    if ((row.scope_type || "building") !== "building") return false;
    const month = String(row.usage_month || "");
    if (period.mode === "rolling_12") return period.months.includes(month);
    return month.startsWith(`${period.year}-`);
  });
}

function sumBenchmarkUsage(rows = []) {
  return rows.reduce((sum, row) => ({
    electricity_kwh: sum.electricity_kwh + Number(row.electricity_kwh || 0),
    heating_kwh: sum.heating_kwh + Number(row.heating_kwh || 0),
    cooling_kwh: sum.cooling_kwh + Number(row.cooling_kwh || 0)
  }), { electricity_kwh: 0, heating_kwh: 0, cooling_kwh: 0 });
}

function benchmarkPresentMonths(rows = []) {
  return new Set(rows.filter((row) => (
    Number(row.electricity_kwh || 0) > 0 || Number(row.heating_kwh || 0) > 0 || Number(row.cooling_kwh || 0) > 0
  )).map((row) => String(row.usage_month || "").slice(0, 7)));
}

function buildPortfolioBenchmark({ properties = [], monthlyUsage = [], period }) {
  let gia = 0;
  let nla = 0;
  let totalEnergyKwh = 0;
  let electricityEquivalentKwh = 0;
  let propertyCount = 0;
  for (const property of properties || []) {
    const area = Number(property.total_floor_area || 0);
    if (!area) continue;
    const rows = benchmarkRowsForPeriod(monthlyUsage, property.id, period);
    if (!rows.length) continue;
    const usage = sumBenchmarkUsage(rows);
    if (usage.electricity_kwh <= 0 && usage.heating_kwh <= 0 && usage.cooling_kwh <= 0) continue;
    const heatingFactor = reebFactorForCarrier(property.heating_carrier, "heating").factor;
    const coolingFactor = reebFactorForCarrier(property.cooling_carrier, "cooling").factor;
    gia += area;
    nla += area;
    totalEnergyKwh += usage.electricity_kwh + usage.heating_kwh + usage.cooling_kwh;
    electricityEquivalentKwh += usage.electricity_kwh + usage.heating_kwh * heatingFactor + usage.cooling_kwh * coolingFactor;
    propertyCount += 1;
  }
  if (!propertyCount || !gia || !nla) return null;
  return {
    propertyCount,
    totalEnergyIntensity: totalEnergyKwh / gia,
    electricityEquivalentIntensity: electricityEquivalentKwh / nla
  };
}

function reebFactorForCarrier(carrier, utility) {
  const key = carrier || "none";
  if (Object.prototype.hasOwnProperty.call(REEB_ELECTRICITY_EQUIVALENT_FACTORS, key)) {
    return { factor: REEB_ELECTRICITY_EQUIVALENT_FACTORS[key], warning: "" };
  }
  return {
    factor: 1,
    warning: `${utility} carrier "${key}" is not shown in the REEB screenshot. The benchmark page is using factor 1.00 until a verified factor is configured.`
  };
}

function benchmarkStatus(value, good, typical) {
  if (Number(value) <= Number(good)) return { className: "good", label: "At or better than good practice" };
  if (Number(value) <= Number(typical)) return { className: "mid", label: "Between good practice and typical" };
  return { className: "high", label: "Above typical benchmark" };
}

function formatBenchmarkNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

function statusQuoFilename(property) {
  return `${safeFilePart(property?.name || "Property")} - Status Quo.md`;
}

function safeFilePart(value) {
  return String(value || "Property").replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim() || "Property";
}

function findStatusQuoFile(files, property) {
  const expected = statusQuoFilename(property).toLowerCase();
  const propertyKey = normaliseStatusQuoName(property?.name || "");
  return (files || []).find((file) => file.name.toLowerCase() === expected)
    || (files || []).find((file) => statusQuoFileMatchesProperty(file, propertyKey))
    || null;
}

function statusQuoFileMatchesProperty(file, propertyKey) {
  const fileKey = normaliseStatusQuoName(file?.name || "");
  const buildingKey = normaliseStatusQuoName(extractStatusQuoBuilding(file?.text || ""));
  return statusQuoNameMatches(fileKey, propertyKey) || statusQuoNameMatches(buildingKey, propertyKey);
}

function statusQuoNameMatches(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return left.length > 2 && right.length > 2 && (left.includes(right) || right.includes(left));
}

function extractStatusQuoBuilding(text) {
  const match = String(text || "").match(/^building:\s*(.+)$/m);
  return match ? match[1] : "";
}

function normaliseStatusQuoName(value) {
  let text = String(value || "").toLowerCase();
  const wiki = text.match(/\[\[(?:.*\/)?([^|\]]+)(?:\|([^\]]+))?\]\]/);
  if (wiki) text = wiki[2] || wiki[1];
  text = text
    .replace(/\.md$/i, "")
    .replace(/status\s*quo/g, "")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bblue\b/g, "blu")
    .replace(/\b(building|tower|property|main|notes|work|db)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return text;
}

function parseStatusQuoMarkdown(text, property) {
  const source = String(text || "");
  const frontmatterMatch = source.match(/^---\s*\n[\s\S]*?\n---\s*/);
  const frontmatter = frontmatterMatch?.[0]?.trim() || statusQuoFrontmatter(property);
  const entries = [];
  const sectionPattern = /###\s+(\d{4})\/(\d{2})\s*\n([\s\S]*?)(?=\n---|\n###\s+\d{4}\/\d{2}|$)/g;
  let match;
  while ((match = sectionPattern.exec(source))) {
    const body = match[3].replace(/\s+$/g, "");
    entries.push({ period: `${match[1]}/${match[2]}`, text: body });
  }
  return { frontmatter, entries: sortStatusQuoEntries(entries) };
}

function statusQuoFrontmatter(property) {
  return `---\nclient: "[[Union]]"\nbuilding: ${yamlQuote(property?.name || "")}\nteamBucket: "[[SavIQ]]"\ncreated: ${todayIso()}\nnoteType: "[[StatusQuo]]"\n---`;
}

function normaliseStatusQuoText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.startsWith("- ") ? line : `- ${line.replace(/^-+/, "").trim()}`)
    .join("\n");
}

function upsertStatusQuoEntry(entries, next) {
  const existing = (entries || []).filter((entry) => entry.period !== next.period);
  return sortStatusQuoEntries([...existing, next]);
}

function sortStatusQuoEntries(entries) {
  return [...(entries || [])].sort((a, b) => a.period.localeCompare(b.period));
}

function buildStatusQuoMarkdown(frontmatter, entries) {
  const body = sortStatusQuoEntries(entries)
    .map((entry) => `### ${entry.period}\n${normaliseStatusQuoText(entry.text)}\n\n---`)
    .join("\n\n");
  return `${frontmatter.trim()}\n\n# Status Quo\n\n${body}\n`;
}

function statusQuoLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^-+\s*/, ""))
    .filter(Boolean);
}

function openActionsFilename(property) {
  return `${safeFilePart(property?.name || "Property")} - Open Actions.md`;
}

function findOpenActionsFile(files, property) {
  const expected = openActionsFilename(property).toLowerCase();
  const propertyKey = normaliseStatusQuoName(property?.name || "");
  return (files || []).find((file) => file.name.toLowerCase() === expected)
    || (files || []).find((file) => openActionsFileMatchesProperty(file, propertyKey))
    || null;
}

function openActionsFileMatchesProperty(file, propertyKey) {
  const fileKey = normaliseStatusQuoName(String(file?.name || "").replace(/open\s*actions/gi, ""));
  const buildingKey = normaliseStatusQuoName(extractStatusQuoBuilding(file?.text || ""));
  return statusQuoNameMatches(fileKey, propertyKey) || statusQuoNameMatches(buildingKey, propertyKey);
}

function openActionsFrontmatter(property) {
  return `---\nclient: "[[Union]]"\nbuilding: ${yamlQuote(property?.name || "")}\nteamBucket: "[[SavIQ]]"\ncreated: ${todayIso()}\nnoteType: "[[OpenActions]]"\n---`;
}

function parseOpenActionsMarkdown(text, property) {
  const source = String(text || "");
  const frontmatterMatch = source.match(/^---\s*\n[\s\S]*?\n---\s*/);
  const frontmatter = frontmatterMatch?.[0]?.trim() || openActionsFrontmatter(property);
  const actions = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*-\s*\[\s*([xX]?)\s*\]\s+(.+?)\s*$/);
    if (!match) continue;
    let comment = "";
    let responsible = "";
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*-\s*\[\s*[xX]?\s*\]\s+/.test(lines[j])) break;
      const commentMatch = lines[j].match(/^\s*comment:\s*(.+?)\s*$/i);
      const responsibleMatch = lines[j].match(/^\s*responsible:\s*(.+?)\s*$/i);
      if (commentMatch) {
        comment = commentMatch[1];
        i = j;
      } else if (responsibleMatch) {
        responsible = responsibleMatch[1];
        i = j;
      } else if (String(lines[j] || "").trim()) {
        break;
      }
    }
    actions.push({ done: Boolean(match[1]), text: normaliseActionText(match[2]), responsible: normaliseResponsible(responsible), comment });
  }
  return { frontmatter, actions };
}

function normaliseActionText(text) {
  return String(text || "")
    .replace(/^\s*-\s*\[\s*[xX]?\s*\]\s*/, "")
    .replace(/^comment:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseResponsible(value) {
  const text = String(value || "").trim();
  return RESPONSIBLE_OPTIONS.includes(text) ? text : "Unassigned";
}

function buildOpenActionsMarkdown(frontmatter, actions) {
  const body = (actions || []).map((action) => {
    const checkbox = action.done ? "[x]" : "[ ]";
    const responsible = normaliseResponsible(action.responsible);
    const responsibleLine = responsible !== "Unassigned" ? `\nresponsible: ${responsible}` : "";
    const comment = action.done && action.comment ? `\ncomment: ${String(action.comment).replace(/\r?\n/g, " ").trim()}` : "";
    return `- ${checkbox} ${normaliseActionText(action.text)}${responsibleLine}${comment}`;
  }).join("\n\n");
  return `${frontmatter.trim()}\n\n# Open Actions\n\n${body}\n`;
}

function dataViewYears(rows = []) {
  const current = new Date().getFullYear();
  const years = new Set([String(current), String(current - 1), String(current - 2)]);
  for (const row of rows || []) {
    const year = String(row.usage_month || "").slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
  }
  return [...years].sort((a, b) => Number(b) - Number(a));
}

function buildDataViewSeries(rows = [], options) {
  const out = {};
  for (const year of options.years || []) {
    out[year] = MONTH_LABELS.map((_, index) => ({
      month: String(index + 1).padStart(2, "0"),
      monthIndex: index,
      value: 0
    }));
  }
  for (const row of rows || []) {
    if (Number(row.property_id) !== Number(options.propertyId)) continue;
    if ((row.scope_type || "building") !== options.scope) continue;
    const [year, monthText] = String(row.usage_month || "").split("-");
    const monthIndex = Number(monthText) - 1;
    if (!out[year] || monthIndex < 0 || monthIndex > 11) continue;
    out[year][monthIndex].value += monthlyUsageValue(row, options.utility);
  }
  return out;
}

function buildDataHealth(rows = [], options) {
  const series = buildDataViewSeries(rows, options);
  const matrix = {};
  let primaryPresent = 0;
  for (const year of options.years || []) {
    matrix[year] = (series[year] || []).map((point) => point.value > 0);
  }
  const primary = options.years?.[0];
  if (primary && matrix[primary]) primaryPresent = matrix[primary].filter(Boolean).length;
  return { matrix, monthsPresent: `${primaryPresent}/12` };
}

function monthlyUsageValue(row, utility) {
  if (utility === "total") {
    return Number(row.electricity_kwh || 0) + Number(row.heating_kwh || 0) + Number(row.cooling_kwh || 0);
  }
  return Number(row[`${utility}_kwh`] || 0);
}

function dataViewUtilityLabel(utility) {
  if (utility === "total") return "Total energy";
  if (utility === "electricity") return "Electricity";
  if (utility === "heating") return "Heating";
  if (utility === "cooling") return "Cooling";
  return utility || "Usage";
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
  return { id: "", ecm_id: "", property_id: "", utility_type: "electricity", start_date: todayIso(), end_date: todayIso(), energy_saving_kwh: "", unit_cost_eur_per_kwh: "", notes: "" };
}

function defaultAdminTrackerForm() {
  return {
    id: "",
    property_id: "",
    admin_year: String(new Date().getFullYear()),
    admin_month: String(new Date().getMonth() + 1),
    docunite_report: false,
    ecm_report: false,
    status_quo: false,
    pre_meeting_notes: false,
    post_meeting_notes: false,
    comments: ""
  };
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
