import { useEffect, useMemo, useState } from "react";
import {
  deleteEcm,
  getAttachments,
  getEcms,
  getImplementedSavings,
  getMonthlyUsage,
  getPortfolio,
  getProperties,
  insertAttachment,
  openDatabaseFromFile,
  openDatabaseFromHandle,
  runSelect,
  saveDatabase,
  setEcmObsidianFilename,
  setSavingObsidianFilename,
  tableCount,
  upsertEcm,
  upsertImplementedSaving
} from "./lib/sqlite.js";
import { ensurePermission, idbGet, idbSet, supportsFileSystemAccess, writeFile } from "./lib/storage.js";
import { listMarkdownFiles, routeCalculationFile, writeTextIntoFolder } from "./lib/files.js";
import { buildEcmMarkdown, buildMeetingMarkdown, buildSavingMarkdown, ecmFilename, meetingFilename, savingFilename } from "./lib/markdown.js";
import { downloadExcelRegister, downloadWordRegister } from "./lib/reports.js";
import { kwh, money, slug, todayIso, utilityCost } from "./lib/format.js";

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
  ["setup", "Setup"],
  ["dashboard", "Dashboard"],
  ["ecms", "ECMs"],
  ["savings", "Implemented Savings"],
  ["meetings", "Monthly Meetings"],
  ["reports", "Reports"],
  ["database", "Database"]
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

export default function App() {
  const [active, setActive] = useState("setup");
  const [handles, setHandles] = useState({});
  const [db, setDb] = useState(null);
  const [dbFileHandle, setDbFileHandle] = useState(null);
  const [data, setData] = useState(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedEcmId, setSelectedEcmId] = useState("");
  const [ecmForm, setEcmForm] = useState(EMPTY_ECM);
  const [calcFile, setCalcFile] = useState(null);
  const [savingForm, setSavingForm] = useState(defaultSavingForm());
  const [meetingForm, setMeetingForm] = useState({ property_id: "", report_month: todayIso().slice(0, 7), meeting_date: todayIso(), pre: "", post: "" });
  const [meetingFiles, setMeetingFiles] = useState([]);
  const [selectedMeetingName, setSelectedMeetingName] = useState("");
  const [meetingDraft, setMeetingDraft] = useState("");
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
    for (const def of FOLDERS) {
      const handle = await idbGet(`folder_${def.key}`);
      if (!handle) continue;
      try {
        if (await ensurePermission(handle, "readwrite")) next[def.key] = handle;
      } catch {
        // Keep boot resilient; user can reconfigure the folder.
      }
    }
    setHandles(next);
    if (next.database) await openDatabaseFolder(next.database);
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

  async function saveEcm(event) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
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
    const property = properties.find((item) => item.id === Number(meetingForm.property_id));
    const performance = rollingPerformance(data.monthlyUsage, property?.id, meetingForm.report_month);
    const openEcms = data.ecms.filter((ecm) => ecm.property_id === property?.id && ecm.status === "Open");
    const filename = meetingFilename(property, meetingForm.report_month);
    const md = buildMeetingMarkdown({
      property,
      reportMonth: meetingForm.report_month,
      meetingDate: meetingForm.meeting_date,
      preMeeting: meetingForm.pre,
      postMeeting: meetingForm.post,
      performance,
      openEcms
    });
    await writeTextIntoFolder(handles.meetingNotes, filename, md);
    await loadMeetingFiles();
    notify(`Meeting note saved: ${filename}`);
  }

  async function loadMeetingFiles() {
    const files = await listMarkdownFiles(handles.meetingNotes);
    setMeetingFiles(files);
    return files;
  }

  function selectMeeting(name) {
    const file = meetingFiles.find((item) => item.name === name);
    setSelectedMeetingName(name);
    setMeetingDraft(file?.text || "");
  }

  async function saveMeetingDraft() {
    const file = meetingFiles.find((item) => item.name === selectedMeetingName);
    if (!file) return;
    await writeFile(file.handle, meetingDraft);
    await loadMeetingFiles();
    notify("Meeting note updated in Obsidian.");
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
          <h1>ECM Register</h1>
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
          <h2>Local ECM Register</h2>
          <p>Manage ECMs through a clean React interface while storing the database, notes, reports, and calculation files locally on your machine.</p>
        </div>

        {active === "setup" && (
          <SetupView
            handles={handles}
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
        {active === "reports" && <ReportsView ready={ready} db={db} properties={properties} selectedProperty={selectedProperty} setSelectedPropertyId={setSelectedPropertyId} />}
        {active === "database" && <DatabaseView ready={ready} db={db} sqlText={sqlText} setSqlText={setSqlText} runSql={runSql} sqlRows={sqlRows} />}
      </main>
    </div>
  );
}

function SetupView({ handles, configureFolder, importDatabase, loadDatabase, data, setupError, busy, ready }) {
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
                <span className="pill">{handles[folder.key] ? "Configured" : "Missing"}</span>
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
              ? "All required folders are configured. Click Import Existing .db, then the app will load the dashboard."
              : "Select the required folders first, then import your existing .db."}
        </span>
      </div>
    </section>
  );
}

function DashboardView({ data, ready }) {
  if (!ready) return <EmptyState />;
  const ecms = data.ecms || [];
  const open = ecms.filter((item) => item.status === "Open");
  const implemented = ecms.filter((item) => item.status === "Implemented");
  return (
    <section className="section">
      <h3>Dashboard</h3>
      <div className="grid four">
        <Kpi label="Properties" value={data.properties.length} />
        <Kpi label="ECMs" value={ecms.length} />
        <Kpi label="Open ECMs" value={open.length} />
        <Kpi label="Implemented" value={implemented.length} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <Kpi label="Open annual saving EUR/a" value={money(open.reduce((sum, item) => sum + Number(item.annual_saving_eur || 0), 0))} />
        <Kpi label="Implemented annual saving EUR/a" value={money(implemented.reduce((sum, item) => sum + Number(item.annual_saving_eur || 0), 0))} />
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

function MeetingsView({ ready, properties, form, setForm, save, loadMeetingFiles, meetingFiles, selectedMeetingName, selectMeeting, meetingDraft, setMeetingDraft, saveMeetingDraft }) {
  if (!ready) return <EmptyState />;
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <section className="section">
      <h3>Monthly Meeting Notes</h3>
      <div className="grid two">
      <div className="card">
        <form onSubmit={save}>
          <div className="grid three">
            <Field label="Property"><select value={form.property_id} onChange={(e) => set("property_id", e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Report month"><input type="month" value={form.report_month} onChange={(e) => set("report_month", e.target.value)} /></Field>
            <Field label="Meeting date"><input type="date" value={form.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} /></Field>
          </div>
          <Field label="Comments pre meeting"><textarea value={form.pre} onChange={(e) => set("pre", e.target.value)} /></Field>
          <Field label="Comments post meeting"><textarea value={form.post} onChange={(e) => set("post", e.target.value)} /></Field>
          <button className="btn primary">Save Meeting Note to Obsidian</button>
        </form>
      </div>
      <div className="card">
        <div className="toolbar">
          <button className="btn" type="button" onClick={loadMeetingFiles}>Load Existing Notes</button>
          <select className="input" value={selectedMeetingName} onChange={(e) => selectMeeting(e.target.value)}>
            <option value="">Select note...</option>
            {meetingFiles.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}
          </select>
        </div>
        <Field label="Existing monthly note editor">
          <textarea value={meetingDraft} onChange={(e) => setMeetingDraft(e.target.value)} style={{ minHeight: 420 }} />
        </Field>
        <button className="btn primary" type="button" disabled={!selectedMeetingName} onClick={saveMeetingDraft}>Save Existing Note</button>
      </div>
      </div>
    </section>
  );
}

function ReportsView({ ready, db, properties, selectedProperty, setSelectedPropertyId }) {
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
          <button className="btn" onClick={() => downloadWordRegister(db, selectedProperty)}>Word - Selected Property</button>
        </div>
        <p className="muted">PDF export will be added after the Word/Excel layout is verified in the browser version.</p>
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

function Kpi({ label, value }) {
  return <div className="card kpi"><div className="label">{label}</div><div className="value">{value}</div></div>;
}

function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function EmptyState() {
  return <section className="section"><div className="card"><h3>Setup Required</h3><p className="muted">Configure the local folders and open or import an ECM database first.</p></div></section>;
}

function defaultSavingForm() {
  return { ecm_id: "", property_id: "", utility_type: "electricity", start_date: todayIso(), end_date: todayIso(), energy_saving_kwh: "", unit_cost_eur_per_kwh: "", notes: "" };
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
