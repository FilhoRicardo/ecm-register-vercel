import initSqlJs from "sql.js";
import { migrate } from "./schema.js";
import { writeBinaryFile } from "./storage.js";
import { utilityCost } from "./format.js";

let SQL = null;

export async function loadSqlJs() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    locateFile: (file) => `https://sql.js.org/dist/${file}`
  });
  return SQL;
}

export async function openDatabaseFromHandle(fileHandle) {
  const sql = await loadSqlJs();
  const file = await fileHandle.getFile();
  const bytes = file.size ? new Uint8Array(await file.arrayBuffer()) : null;
  const db = bytes ? new sql.Database(bytes) : new sql.Database();
  migrate(db);
  return db;
}

export async function openDatabaseFromFile(file) {
  const sql = await loadSqlJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const db = new sql.Database(bytes);
  migrate(db);
  return db;
}

export async function saveDatabase(db, fileHandle) {
  const bytes = db.export();
  await writeBinaryFile(fileHandle, bytes);
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
  const implementedSavings = rows(db, "SELECT * FROM ecm_measured_savings");
  const monthlyUsage = rows(db, "SELECT * FROM monthly_utility_usage");
  return { properties, ecms, implementedSavings, monthlyUsage };
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

export function runSelect(db, sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error("Only SELECT queries are allowed.");
  return rows(db, sql);
}

function nullable(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
