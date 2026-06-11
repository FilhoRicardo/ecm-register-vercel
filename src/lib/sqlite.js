import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { migrate } from "./schema.js";
import { utilityCost } from "./format.js";

let SQL = null;

export async function loadSqlJs() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    locateFile: () => sqlWasmUrl
  });
  return SQL;
}

export async function openEmptyDatabase() {
  const sql = await loadSqlJs();
  const db = new sql.Database();
  migrate(db);
  return db;
}

export function seedSampleData(db) {
  const alphaId = upsertProperty(db, {
    name: "Sample Tower",
    address: "Amsterdam, Netherlands",
    total_floor_area: 12000,
    crrem_country: "Netherlands",
    crrem_property_type: "Office",
    heating_carrier: "natural_gas",
    cooling_carrier: "electric",
    elec_cost_eur_per_kwh: 0.28,
    heating_cost_eur_per_kwh: 0.11,
    cooling_cost_eur_per_kwh: 0.28,
    notes: "Sample property for demo mode."
  });
  const betaId = upsertProperty(db, {
    name: "Sample Works",
    address: "London, United Kingdom",
    total_floor_area: 7600,
    crrem_country: "United Kingdom",
    crrem_property_type: "Office",
    heating_carrier: "natural_gas",
    cooling_carrier: "electric",
    elec_cost_eur_per_kwh: 0.24,
    heating_cost_eur_per_kwh: 0.09,
    cooling_cost_eur_per_kwh: 0.24,
    notes: "Second sample property for filters and exports."
  });

  const alphaTenant = upsertTenant(db, {
    property_id: alphaId,
    tenant_name: "North Anchor",
    tenant_location_id: "AMS-NORTH",
    tenant_floor_area: 4200,
    location_label: "Floors 1-4",
    notes: "Sample tenant."
  });
  upsertTenant(db, {
    property_id: betaId,
    tenant_name: "Studio Lease",
    tenant_location_id: "LDN-STUDIO",
    tenant_floor_area: 3100,
    location_label: "Studio wing",
    notes: "Sample tenant."
  });

  upsertEquipment(db, {
    property_id: alphaId,
    tenant_id: alphaTenant,
    equipment_name: "AHU-01",
    equipment_type: "Air Handling Unit",
    brick_class: "brick:AHU",
    dexma_location_id: "AMS-NORTH",
    dexma_device_id: "AHU-01",
    utility_type: "electricity",
    notes: "Sample air handling unit."
  });
  upsertEquipment(db, {
    property_id: betaId,
    tenant_id: null,
    equipment_name: "Boiler-01",
    equipment_type: "Boiler",
    brick_class: "brick:Boiler",
    dexma_location_id: "LDN-PLANT",
    dexma_device_id: "BOILER-01",
    utility_type: "heating",
    notes: "Sample gas boiler."
  });

  const ledId = upsertEcm(db, {
    property_id: alphaId,
    ref: "S-001",
    title: "LED common area retrofit",
    status: "Implemented",
    investment_eur: 18000,
    utility_type: "electricity",
    energy_saving_kwh: 42000,
    what_why: "Replace legacy lighting in common areas to reduce baseload electricity.",
    pitfall: "Coordinate works outside tenant operating hours.",
    action: "Validate post-install savings during the next reporting cycle.",
    approved: true,
    notes: "Sample implemented ECM."
  });
  upsertEcm(db, {
    property_id: alphaId,
    ref: "S-002",
    title: "Optimise AHU schedules",
    status: "Open",
    investment_eur: 3500,
    utility_type: "electricity",
    energy_saving_kwh: 18000,
    what_why: "Trim overnight and weekend runtime where occupancy data supports it.",
    pitfall: "Confirm comfort constraints with tenant representatives.",
    action: "Review BMS trend data and apply revised schedules.",
    approved: false,
    notes: "Sample open ECM."
  });
  upsertEcm(db, {
    property_id: betaId,
    ref: "S-003",
    title: "Boiler weather compensation",
    status: "In Progress",
    investment_eur: 6000,
    utility_type: "heating",
    energy_saving_kwh: 26000,
    what_why: "Tune flow temperatures to reduce gas consumption.",
    pitfall: "Avoid low-temperature complaints during cold starts.",
    action: "Commission revised compensation curve.",
    approved: true,
    notes: "Sample heating ECM."
  });

  upsertImplementedSaving(db, {
    ecm_id: ledId,
    property_id: alphaId,
    utility_type: "electricity",
    start_date: "2025-01-01",
    end_date: "2025-12-31",
    energy_saving_kwh: 39000,
    unit_cost_eur_per_kwh: 0.28,
    cost_saving_eur: 10920,
    notes: "Sample measured saving."
  });

  for (const year of [2024, 2025]) {
    for (let month = 1; month <= 12; month += 1) {
      const usageMonth = `${year}-${String(month).padStart(2, "0")}`;
      const seasonalHeat = month <= 3 || month >= 10 ? 14500 : 4200;
      const seasonalCool = month >= 6 && month <= 9 ? 5200 : 900;
      const improvement = year === 2025 ? 0.88 : 1;
      upsertMonthlyUsage(db, {
        property_id: alphaId,
        tenant_id: null,
        scope_type: "building",
        usage_month: usageMonth,
        electricity_kwh: Math.round((21500 + month * 120) * improvement),
        heating_kwh: Math.round(seasonalHeat * improvement),
        cooling_kwh: Math.round(seasonalCool * improvement),
        notes: year === 2025 ? "Sample post-ECM usage." : "Sample baseline usage."
      });
    }
  }
  for (const usageMonth of ["2025-10", "2025-11", "2025-12"]) {
    upsertMonthlyUsage(db, {
      property_id: betaId,
      tenant_id: null,
      scope_type: "building",
      usage_month: usageMonth,
      electricity_kwh: 13200,
      heating_kwh: 8100,
      cooling_kwh: 600,
      notes: "Short sample history."
    });
  }

  upsertAdminTracker(db, {
    property_id: alphaId,
    admin_year: 2025,
    admin_month: 12,
    docunite_report: "done",
    ecm_report: "done",
    pre_meeting_notes: "done",
    consumption_tracked: "done",
    meeting_held: "done",
    post_meeting_notes: "open",
    status_quo: "done",
    comments: "Sample month nearly complete."
  });
  upsertAdminTracker(db, {
    property_id: betaId,
    admin_year: 2025,
    admin_month: 12,
    docunite_report: "open",
    ecm_report: "done",
    pre_meeting_notes: "open",
    consumption_tracked: "done",
    meeting_held: "na",
    post_meeting_notes: "na",
    status_quo: "open",
    comments: "Sample onboarding month."
  });
}

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function one(db, sql, params = []) {
  return rows(db, sql, params)[0] || null;
}

export function getPortfolio(db) {
  const properties = rows(db, "SELECT * FROM properties ORDER BY name");
  const ecms = getEcms(db);
  const implementedSavings = getImplementedSavings(db);
  const monthlyUsage = getMonthlyUsage(db);
  const tenants = getTenants(db);
  const equipment = getEquipment(db);
  const adminTracker = getAdminTracker(db);
  return { properties, ecms, implementedSavings, monthlyUsage, tenants, equipment, adminTracker };
}

export function getProperties(db) {
  return rows(db, "SELECT * FROM properties ORDER BY name");
}

export function getTenants(db) {
  return rows(
    db,
    `SELECT t.*, p.name AS property_name
     FROM tenants t
     JOIN properties p ON p.id = t.property_id
     ORDER BY p.name, t.tenant_name`
  );
}

export function getEquipment(db) {
  return rows(
    db,
    `SELECT e.*, p.name AS property_name, t.tenant_name
     FROM equipment e
     JOIN properties p ON p.id = e.property_id
     LEFT JOIN tenants t ON t.id = e.tenant_id
     ORDER BY p.name, e.equipment_name`
  );
}

export function getEcms(db, propertyId = null) {
  const data = rows(
    db,
    `SELECT e.*, p.name AS property_name, p.elec_cost_eur_per_kwh, p.heating_cost_eur_per_kwh, p.cooling_cost_eur_per_kwh
     FROM ecms e
     JOIN properties p ON p.id = e.property_id
     ${propertyId ? "WHERE e.property_id = ?" : ""}
     ORDER BY p.name, e.status, e.ref, e.title`,
    propertyId ? [propertyId] : []
  );
  return data.map((ecm) => {
    const cost = utilityCost(ecm, ecm.utility_type);
    const annual = Number(ecm.energy_saving_kwh || 0) * cost;
    return { ...ecm, approved: Boolean(ecm.approved), annual_saving_eur: annual };
  });
}

export function getAttachments(db, ecmId) {
  return rows(db, "SELECT * FROM ecm_attachments WHERE ecm_id = ? ORDER BY created_at DESC, id DESC", [ecmId]);
}

export function getImplementedSavings(db, propertyId = null) {
  return rows(
    db,
    `SELECT s.*, e.ref, e.title AS ecm_title, p.name AS property_name
     FROM ecm_measured_savings s
     JOIN ecms e ON e.id = s.ecm_id
     JOIN properties p ON p.id = s.property_id
     ${propertyId ? "WHERE s.property_id = ?" : ""}
     ORDER BY s.end_date DESC, s.id DESC`,
    propertyId ? [propertyId] : []
  );
}

export function getProperty(db, id) {
  return one(db, "SELECT * FROM properties WHERE id = ?", [id]);
}

export function upsertProperty(db, input) {
  if (input.id) {
    db.run(
      `UPDATE properties
       SET name=?, address=?, total_floor_area=?, crrem_country=?, crrem_property_type=?,
           heating_carrier=?, cooling_carrier=?, renewable_consumed_kwh=?, renewable_exported_kwh=?,
           heating_emission_factor_kgco2e_per_kwh=?, cooling_emission_factor_kgco2e_per_kwh=?,
           elec_cost_eur_per_kwh=?, heating_cost_eur_per_kwh=?, cooling_cost_eur_per_kwh=?, notes=?,
           updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        input.name,
        input.address || "",
        nullable(input.total_floor_area),
        input.crrem_country || "",
        input.crrem_property_type || "Office",
        input.heating_carrier || "natural_gas",
        input.cooling_carrier || "electric",
        Number(input.renewable_consumed_kwh || 0),
        Number(input.renewable_exported_kwh || 0),
        nullable(input.heating_emission_factor_kgco2e_per_kwh),
        nullable(input.cooling_emission_factor_kgco2e_per_kwh),
        Number(input.elec_cost_eur_per_kwh || 0),
        Number(input.heating_cost_eur_per_kwh || 0),
        Number(input.cooling_cost_eur_per_kwh || 0),
        input.notes || "",
        input.id
      ]
    );
    return input.id;
  }
  db.run(
    `INSERT INTO properties (
      name, address, total_floor_area, crrem_country, crrem_property_type,
      heating_carrier, cooling_carrier, renewable_consumed_kwh, renewable_exported_kwh,
      heating_emission_factor_kgco2e_per_kwh, cooling_emission_factor_kgco2e_per_kwh,
      elec_cost_eur_per_kwh, heating_cost_eur_per_kwh, cooling_cost_eur_per_kwh, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      input.name,
      input.address || "",
      nullable(input.total_floor_area),
      input.crrem_country || "",
      input.crrem_property_type || "Office",
      input.heating_carrier || "natural_gas",
      input.cooling_carrier || "electric",
      Number(input.renewable_consumed_kwh || 0),
      Number(input.renewable_exported_kwh || 0),
      nullable(input.heating_emission_factor_kgco2e_per_kwh),
      nullable(input.cooling_emission_factor_kgco2e_per_kwh),
      Number(input.elec_cost_eur_per_kwh || 0),
      Number(input.heating_cost_eur_per_kwh || 0),
      Number(input.cooling_cost_eur_per_kwh || 0),
      input.notes || ""
    ]
  );
  return Number(one(db, "SELECT last_insert_rowid() AS id").id);
}

export function deleteProperty(db, id) {
  db.run("DELETE FROM properties WHERE id = ?", [id]);
}

export function upsertTenant(db, input) {
  if (input.id) {
    db.run(
      `UPDATE tenants
       SET property_id=?, tenant_name=?, tenant_location_id=?, tenant_floor_area=?,
           location_label=?, notes=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        input.property_id,
        input.tenant_name,
        input.tenant_location_id || "",
        nullable(input.tenant_floor_area),
        input.location_label || "",
        input.notes || "",
        input.id
      ]
    );
    return input.id;
  }
  db.run(
    `INSERT INTO tenants (
      property_id, tenant_name, tenant_location_id, tenant_floor_area,
      location_label, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      input.property_id,
      input.tenant_name,
      input.tenant_location_id || "",
      nullable(input.tenant_floor_area),
      input.location_label || "",
      input.notes || ""
    ]
  );
  return Number(one(db, "SELECT last_insert_rowid() AS id").id);
}

export function deleteTenant(db, id) {
  db.run("DELETE FROM tenants WHERE id = ?", [id]);
}

export function deleteTenantsForProperty(db, propertyId) {
  db.run("DELETE FROM tenants WHERE property_id = ?", [propertyId]);
}

export function upsertEquipment(db, input) {
  if (input.id) {
    db.run(
      `UPDATE equipment
       SET property_id=?, tenant_id=?, equipment_name=?, equipment_type=?, brick_class=?,
           dexma_location_id=?, dexma_device_id=?, utility_type=?, notes=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        input.property_id,
        input.tenant_id || null,
        input.equipment_name,
        input.equipment_type || "",
        input.brick_class || "",
        input.dexma_location_id || "",
        input.dexma_device_id || "",
        input.utility_type || "",
        input.notes || "",
        input.id
      ]
    );
    return input.id;
  }
  db.run(
    `INSERT INTO equipment (
      property_id, tenant_id, equipment_name, equipment_type, brick_class,
      dexma_location_id, dexma_device_id, utility_type, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      input.property_id,
      input.tenant_id || null,
      input.equipment_name,
      input.equipment_type || "",
      input.brick_class || "",
      input.dexma_location_id || "",
      input.dexma_device_id || "",
      input.utility_type || "",
      input.notes || ""
    ]
  );
  return Number(one(db, "SELECT last_insert_rowid() AS id").id);
}

export function deleteEquipment(db, id) {
  db.run("DELETE FROM equipment WHERE id = ?", [id]);
}

export function deleteEquipmentForProperty(db, propertyId) {
  db.run("DELETE FROM equipment WHERE property_id = ?", [propertyId]);
}

export function getMonthlyUsage(db, propertyId = null) {
  return rows(
    db,
    `SELECT u.*, p.name AS property_name, t.tenant_name
     FROM monthly_utility_usage u
     JOIN properties p ON p.id = u.property_id
     LEFT JOIN tenants t ON t.id = u.tenant_id
     ${propertyId ? "WHERE u.property_id = ?" : ""}
     ORDER BY u.usage_month DESC, p.name`,
    propertyId ? [propertyId] : []
  );
}

export function upsertMonthlyUsage(db, input) {
  const existing = one(
    db,
    `SELECT id FROM monthly_utility_usage
     WHERE property_id=? AND COALESCE(tenant_id, 0)=COALESCE(?, 0)
       AND scope_type=? AND usage_month=?`,
    [input.property_id, input.tenant_id || null, input.scope_type || "building", input.usage_month]
  );
  const params = [
    input.property_id,
    input.tenant_id || null,
    input.scope_type || "building",
    input.usage_month,
    Number(input.electricity_kwh || 0),
    Number(input.heating_kwh || 0),
    Number(input.cooling_kwh || 0),
    input.notes || ""
  ];
  if (existing) {
    db.run(
      `UPDATE monthly_utility_usage
       SET property_id=?, tenant_id=?, scope_type=?, usage_month=?, electricity_kwh=?,
           heating_kwh=?, cooling_kwh=?, notes=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [...params, existing.id]
    );
    return existing.id;
  }
  db.run(
    `INSERT INTO monthly_utility_usage (
      property_id, tenant_id, scope_type, usage_month, electricity_kwh,
      heating_kwh, cooling_kwh, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    params
  );
  return Number(one(db, "SELECT last_insert_rowid() AS id").id);
}

export function deleteMonthlyUsage(db, id) {
  db.run("DELETE FROM monthly_utility_usage WHERE id = ?", [id]);
}

export function deleteMonthlyUsageForProperty(db, propertyId) {
  db.run("DELETE FROM monthly_utility_usage WHERE property_id = ?", [propertyId]);
}

export function getAdminTracker(db, propertyId = null) {
  return rows(
    db,
    `SELECT a.*, p.name AS property_name
     FROM monthly_admin_tracker a
     JOIN properties p ON p.id = a.property_id
     ${propertyId ? "WHERE a.property_id = ?" : ""}
     ORDER BY p.name, a.admin_year DESC, a.admin_month DESC`,
    propertyId ? [propertyId] : []
  ).map((row) => ({
    ...row,
    docunite_report: trackerStatus(row.docunite_report),
    ecm_report: trackerStatus(row.ecm_report),
    pre_meeting_notes: trackerStatus(row.pre_meeting_notes),
    consumption_tracked: trackerStatus(row.consumption_tracked),
    meeting_held: trackerStatus(row.meeting_held),
    post_meeting_notes: trackerStatus(row.post_meeting_notes),
    status_quo: trackerStatus(row.status_quo)
  }));
}

export function upsertAdminTracker(db, input) {
  const existing = one(
    db,
    "SELECT id FROM monthly_admin_tracker WHERE property_id=? AND admin_year=? AND admin_month=?",
    [input.property_id, input.admin_year, input.admin_month]
  );
  const params = [
    input.property_id,
    Number(input.admin_year),
    Number(input.admin_month),
    trackerDbValue(input.docunite_report),
    trackerDbValue(input.ecm_report),
    trackerDbValue(input.pre_meeting_notes),
    trackerDbValue(input.consumption_tracked),
    trackerDbValue(input.meeting_held),
    trackerDbValue(input.post_meeting_notes),
    trackerDbValue(input.status_quo),
    input.comments || ""
  ];
  if (existing) {
    db.run(
      `UPDATE monthly_admin_tracker
       SET property_id=?, admin_year=?, admin_month=?, docunite_report=?, ecm_report=?,
           pre_meeting_notes=?, consumption_tracked=?, meeting_held=?, post_meeting_notes=?, status_quo=?,
           comments=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [...params, existing.id]
    );
    return existing.id;
  }
  db.run(
    `INSERT INTO monthly_admin_tracker (
      property_id, admin_year, admin_month, docunite_report, ecm_report,
      pre_meeting_notes, consumption_tracked, meeting_held, post_meeting_notes, status_quo,
      comments, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    params
  );
  return Number(one(db, "SELECT last_insert_rowid() AS id").id);
}

export function deleteAdminTracker(db, id) {
  db.run("DELETE FROM monthly_admin_tracker WHERE id = ?", [id]);
}

export function deleteAdminTrackerForProperty(db, propertyId) {
  db.run("DELETE FROM monthly_admin_tracker WHERE property_id = ?", [propertyId]);
}

function trackerStatus(value) {
  const n = Number(value || 0);
  if (n < 0) return "na";
  return n > 0 ? "done" : "open";
}

function trackerDbValue(value) {
  if (value === "na") return -1;
  if (value === "done" || value === true) return 1;
  return 0;
}

export function tableCount(db, table) {
  return one(db, `SELECT COUNT(*) AS count FROM ${table}`)?.count || 0;
}

export function upsertEcm(db, input) {
  const approved = input.approved ? 1 : 0;
  if (input.id) {
    db.run(
      `UPDATE ecms
       SET property_id=?, ref=?, title=?, status=?, investment_eur=?, utility_type=?,
           energy_saving_kwh=?, what_why=?, pitfall=?, action=?, approved=?, notes=?,
           updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        input.property_id,
        input.ref,
        input.title,
        input.status,
        nullable(input.investment_eur),
        input.utility_type,
        nullable(input.energy_saving_kwh),
        input.what_why,
        input.pitfall || "Not stated in source.",
        input.action,
        approved,
        input.notes || "",
        input.id
      ]
    );
    return input.id;
  }
  db.run(
    `INSERT INTO ecms (
      property_id, ref, title, status, investment_eur, utility_type, energy_saving_kwh,
      what_why, pitfall, action, approved, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      input.property_id,
      input.ref,
      input.title,
      input.status,
      nullable(input.investment_eur),
      input.utility_type,
      nullable(input.energy_saving_kwh),
      input.what_why,
      input.pitfall || "Not stated in source.",
      input.action,
      approved,
      input.notes || ""
    ]
  );
  return Number(one(db, "SELECT last_insert_rowid() AS id").id);
}

export function setEcmObsidianFilename(db, id, filename) {
  db.run("UPDATE ecms SET obsidian_filename=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [filename, id]);
}

export function deleteEcm(db, id) {
  db.run("DELETE FROM ecms WHERE id=?", [id]);
}

export function insertAttachment(db, attachment) {
  db.run(
    `INSERT INTO ecm_attachments (
      ecm_id, original_filename, stored_filename, relative_path, content_type, file_size, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      attachment.ecm_id,
      attachment.original_filename,
      attachment.stored_filename,
      attachment.relative_path,
      attachment.content_type || "",
      attachment.file_size || 0,
      attachment.notes || ""
    ]
  );
}

export function upsertImplementedSaving(db, input) {
  if (input.id) {
    db.run(
      `UPDATE ecm_measured_savings
       SET ecm_id=?, property_id=?, utility_type=?, start_date=?, end_date=?,
           energy_saving_kwh=?, unit_cost_eur_per_kwh=?, cost_saving_eur=?, notes=?,
           updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        input.ecm_id,
        input.property_id,
        input.utility_type,
        input.start_date,
        input.end_date,
        Number(input.energy_saving_kwh || 0),
        Number(input.unit_cost_eur_per_kwh || 0),
        Number(input.cost_saving_eur || 0),
        input.notes || "",
        input.id
      ]
    );
    return input.id;
  }
  db.run(
    `INSERT INTO ecm_measured_savings (
      ecm_id, property_id, utility_type, start_date, end_date,
      energy_saving_kwh, unit_cost_eur_per_kwh, cost_saving_eur, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      input.ecm_id,
      input.property_id,
      input.utility_type,
      input.start_date,
      input.end_date,
      Number(input.energy_saving_kwh || 0),
      Number(input.unit_cost_eur_per_kwh || 0),
      Number(input.cost_saving_eur || 0),
      input.notes || ""
    ]
  );
  return Number(one(db, "SELECT last_insert_rowid() AS id").id);
}

export function setSavingObsidianFilename(db, id, filename) {
  db.run("UPDATE ecm_measured_savings SET obsidian_filename=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [filename, id]);
}

export function deleteImplementedSaving(db, id) {
  db.run("DELETE FROM ecm_measured_savings WHERE id = ?", [id]);
}

export function runSelect(db, sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error("Only SELECT queries are allowed.");
  return rows(db, sql);
}

export function databaseHealth(db) {
  return {
    integrity: rows(db, "PRAGMA integrity_check"),
    foreignKeys: rows(db, "PRAGMA foreign_key_check"),
    tables: rows(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((item) => ({ table: item.name, rows: tableCount(db, item.name) }))
  };
}

function nullable(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
