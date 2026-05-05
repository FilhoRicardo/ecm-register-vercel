"use client";

import { CheckCircle2, Database, FileText, Gauge, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { kwh, money } from "@/lib/calculations";
import type { Ecm, EcmInput, EcmStatus, PortfolioSummary, Property, UtilityType } from "@/lib/types";

const emptySummary: PortfolioSummary = {
  properties: 0,
  ecms: 0,
  open: 0,
  implemented: 0,
  openAnnualSaving: 0,
  implementedAnnualSaving: 0,
  totalEnergySaving: 0
};

const statusOptions: EcmStatus[] = ["Open", "Approved", "In Progress", "Implemented", "Rejected", "On Hold"];
const utilityOptions: UtilityType[] = ["electricity", "heating", "cooling"];

export function EcmConsole() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | "all">("all");
  const [summary, setSummary] = useState<PortfolioSummary>(emptySummary);
  const [ecms, setEcms] = useState<Ecm[]>([]);
  const [tab, setTab] = useState<"register" | "add" | "implemented">("register");
  const [statusFilter, setStatusFilter] = useState("");
  const [utilityFilter, setUtilityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData(propertyId: number | "all" = selectedPropertyId) {
    const query = propertyId === "all" ? "" : `?propertyId=${propertyId}`;
    const [propertiesResponse, summaryResponse, ecmsResponse] = await Promise.all([
      fetch("/api/properties"),
      fetch(`/api/summary${query}`),
      fetch(`/api/ecms${query}`)
    ]);
    setProperties(await propertiesResponse.json());
    setSummary(await summaryResponse.json());
    setEcms(await ecmsResponse.json());
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function changeProperty(value: string) {
    const nextValue = value === "all" ? "all" : Number(value);
    setSelectedPropertyId(nextValue);
    await loadData(nextValue);
  }

  const filteredEcms = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return ecms.filter((ecm) => {
      const matchesStatus = !statusFilter || ecm.status === statusFilter;
      const matchesUtility = !utilityFilter || ecm.utility_type === utilityFilter;
      const haystack = `${ecm.ref} ${ecm.title} ${ecm.action} ${ecm.notes}`.toLowerCase();
      const matchesSearch = !needle || haystack.includes(needle);
      return matchesStatus && matchesUtility && matchesSearch;
    });
  }, [ecms, search, statusFilter, utilityFilter]);

  async function updateStatus(ecm: Ecm, status: EcmStatus) {
    await fetch(`/api/ecms/${ecm.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, approved: ecm.approved })
    });
    await loadData();
  }

  async function removeEcm(ecm: Ecm) {
    if (!confirm(`Remove ${ecm.ref || ecm.title}?`)) return;
    await fetch(`/api/ecms/${ecm.id}`, { method: "DELETE" });
    await loadData();
  }

  async function addEcm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const formData = new FormData(event.currentTarget);
    const propertyId = Number(formData.get("property_id"));
    const payload: EcmInput = {
      property_id: propertyId,
      ref: String(formData.get("ref") ?? ""),
      title: String(formData.get("title") ?? ""),
      status: String(formData.get("status") ?? "Open") as EcmStatus,
      approved: formData.get("approved") === "on",
      utility_type: String(formData.get("utility_type") ?? "electricity") as UtilityType,
      investment_eur: numberOrNull(formData.get("investment_eur")),
      energy_saving_kwh: numberOrNull(formData.get("energy_saving_kwh")),
      what_why: String(formData.get("what_why") ?? ""),
      pitfall: String(formData.get("pitfall") ?? "Not stated in source."),
      action: String(formData.get("action") ?? ""),
      notes: String(formData.get("notes") ?? "")
    };
    await fetch("/api/ecms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    event.currentTarget.reset();
    setTab("register");
    await changeProperty(String(propertyId));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>ECM Register</h1>
          <p>Vercel operations console</p>
        </div>
        <nav className="nav">
          <button className="active"><Gauge size={15} /> Dashboard</button>
          <button><Database size={15} /> Properties</button>
          <button><CheckCircle2 size={15} /> ECMs</button>
          <button><FileText size={15} /> Reports</button>
        </nav>
        <div className="db-chip">
          Database mode<br />
          <strong>{process.env.NEXT_PUBLIC_DB_LABEL ?? "API backend"}</strong>
        </div>
      </aside>

      <main className="main">
        <section className="hero">
          <h2>Local ECM Register</h2>
          <p>Portfolio energy intelligence with a proper frontend, API backend, and Vercel-ready database layer.</p>
        </section>

        <div className="toolbar">
          <div className="field">
            <label>Property</label>
            <select className="select" value={selectedPropertyId} onChange={(event) => void changeProperty(event.target.value)}>
              <option value="all">All properties</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>
          <button className="button" onClick={() => setTab("add")}>
            <Plus size={16} /> Add ECM
          </button>
        </div>

        <section className="kpis">
          <Kpi label="Properties" value={summary.properties.toLocaleString("en-IE")} />
          <Kpi label="ECMs" value={summary.ecms.toLocaleString("en-IE")} />
          <Kpi label="Open" value={summary.open.toLocaleString("en-IE")} />
          <Kpi label="Open annual saving" value={money(summary.openAnnualSaving)} delta={kwh(summary.totalEnergySaving)} />
          <Kpi label="Implemented annual saving" value={money(summary.implementedAnnualSaving)} delta={`${summary.implemented} implemented`} />
        </section>

        <div className="tabs">
          <button className={`tab ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>Register</button>
          <button className={`tab ${tab === "add" ? "active" : ""}`} onClick={() => setTab("add")}>Add ECM</button>
          <button className={`tab ${tab === "implemented" ? "active" : ""}`} onClick={() => setTab("implemented")}>Implemented Savings</button>
        </div>

        {tab === "register" && (
          <section className="panel">
            <div className="filters">
              <div className="field">
                <label>Status</label>
                <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">All</option>
                  {statusOptions.map((status) => <option key={status}>{status}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Utility</label>
                <select className="select" value={utilityFilter} onChange={(event) => setUtilityFilter(event.target.value)}>
                  <option value="">All</option>
                  {utilityOptions.map((utility) => <option key={utility}>{utility}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Search ECMs</label>
                <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ref, title, action, notes" />
              </div>
            </div>
            <EcmTable ecms={filteredEcms} onStatus={updateStatus} onDelete={removeEcm} />
          </section>
        )}

        {tab === "add" && (
          <section className="panel">
            <form onSubmit={(event) => void addEcm(event)} className="form-grid">
              <div className="field">
                <label>Property</label>
                <select className="select" name="property_id" defaultValue={selectedPropertyId === "all" ? properties[0]?.id : selectedPropertyId}>
                  {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Ref</label>
                <input className="input" name="ref" placeholder="202605-ECM1" />
              </div>
              <div className="field full">
                <label>ECM title</label>
                <input className="input" name="title" required />
              </div>
              <div className="field">
                <label>Status</label>
                <select className="select" name="status" defaultValue="Open">{statusOptions.map((status) => <option key={status}>{status}</option>)}</select>
              </div>
              <div className="field">
                <label>Utility</label>
                <select className="select" name="utility_type" defaultValue="electricity">{utilityOptions.map((utility) => <option key={utility}>{utility}</option>)}</select>
              </div>
              <div className="field">
                <label>Investment EUR</label>
                <input className="input" name="investment_eur" type="number" min="0" step="100" />
              </div>
              <div className="field">
                <label>Energy saving kWh/a</label>
                <input className="input" name="energy_saving_kwh" type="number" min="0" step="100" />
              </div>
              <div className="field full">
                <label>What & why</label>
                <textarea className="textarea" name="what_why" rows={4} />
              </div>
              <div className="field">
                <label>Pitfall</label>
                <textarea className="textarea" name="pitfall" rows={4} defaultValue="Not stated in source." />
              </div>
              <div className="field">
                <label>Action</label>
                <textarea className="textarea" name="action" rows={4} />
              </div>
              <label className="field full">
                <input name="approved" type="checkbox" /> Approved
              </label>
              <button className="button" disabled={saving}>{saving ? "Saving..." : "Save ECM"}</button>
            </form>
          </section>
        )}

        {tab === "implemented" && (
          <section className="panel">
            <p>Implemented savings registration is scaffolded for the Vercel backend. The next migration step is to connect the measured-savings form to the Postgres table and import historical records.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {delta ? <em>{delta}</em> : null}
    </div>
  );
}

function EcmTable({ ecms, onStatus, onDelete }: { ecms: Ecm[]; onStatus: (ecm: Ecm, status: EcmStatus) => Promise<void>; onDelete: (ecm: Ecm) => Promise<void> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ref</th>
            <th>ECM</th>
            <th>Status</th>
            <th>Utility</th>
            <th>Energy saving</th>
            <th>Annual saving</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {ecms.map((ecm) => (
            <tr key={ecm.id}>
              <td>{ecm.ref}</td>
              <td>{ecm.title}</td>
              <td>
                <select className="select" value={ecm.status} onChange={(event) => void onStatus(ecm, event.target.value as EcmStatus)}>
                  {statusOptions.map((status) => <option key={status}>{status}</option>)}
                </select>
              </td>
              <td>{ecm.utility_type}</td>
              <td>{kwh(ecm.energy_saving_kwh ?? 0)}</td>
              <td>{money(ecm.annual_saving_eur)}</td>
              <td>
                <button className="button danger" onClick={() => void onDelete(ecm)} title="Remove ECM">
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
