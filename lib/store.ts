import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { annualSaving, paybackYears } from "./calculations";
import { seedEcms, seedProperties } from "./seed";
import type { Ecm, EcmInput, EcmStatus, PortfolioSummary, Property } from "./types";

type PropertyRow = Omit<Property, "total_floor_area"> & {
  total_floor_area: number | null;
};

type EcmRow = Omit<Ecm, "approved" | "annual_saving_eur" | "simple_payback_years"> & {
  approved: number | boolean;
};

let db: Database.Database | null = null;

function dbPath(): string {
  const configuredPath = process.env.LOCAL_SQLITE_PATH || "./data/ecm_register.db";
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(process.cwd(), configuredPath);
}

function getDb(): Database.Database {
  if (db) return db;

  const filePath = dbPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  initDb(db);
  return db;
}

function initDb(database: Database.Database) {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  database.exec(schema);

  const propertyCount = database.prepare("SELECT COUNT(*) AS count FROM properties").get() as { count: number };
  if (propertyCount.count === 0) {
    const insertProperty = database.prepare(`
      INSERT INTO properties (
        id, name, address, total_floor_area,
        elec_cost_eur_per_kwh, heating_cost_eur_per_kwh, cooling_cost_eur_per_kwh,
        notes, created_at, updated_at
      )
      VALUES (@id, @name, @address, @total_floor_area, @elec_cost_eur_per_kwh, @heating_cost_eur_per_kwh, @cooling_cost_eur_per_kwh, @notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const insertEcm = database.prepare(`
      INSERT INTO ecms (
        id, property_id, ref, title, status, approved, utility_type,
        investment_eur, energy_saving_kwh, what_why, pitfall, action, notes,
        created_at, updated_at
      )
      VALUES (@id, @property_id, @ref, @title, @status, @approved, @utility_type, @investment_eur, @energy_saving_kwh, @what_why, @pitfall, @action, @notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const seed = database.transaction(() => {
      for (const property of seedProperties) insertProperty.run(property);
      for (const ecm of seedEcms) insertEcm.run({ ...ecm, approved: ecm.approved ? 1 : 0 });
    });
    seed();
  }
}

function toEcm(row: EcmRow, properties: Property[]): Ecm {
  const property = properties.find((item) => item.id === row.property_id);
  const base: Ecm = {
    ...row,
    approved: Boolean(row.approved),
    property_name: property?.name ?? row.property_name,
    annual_saving_eur: 0,
    simple_payback_years: null
  };
  const annual = property ? annualSaving(base, property) : 0;
  return {
    ...base,
    annual_saving_eur: annual,
    simple_payback_years: paybackYears(base.investment_eur, annual)
  };
}

export async function listProperties(): Promise<Property[]> {
  const rows = getDb().prepare("SELECT * FROM properties ORDER BY name").all() as PropertyRow[];
  return rows.map((row) => ({ ...row }));
}

export async function listEcms(propertyId?: number): Promise<Ecm[]> {
  const database = getDb();
  const properties = await listProperties();
  const rows = (
    propertyId
      ? database
          .prepare(
            `
            SELECT e.*, p.name AS property_name
            FROM ecms e
            JOIN properties p ON p.id = e.property_id
            WHERE e.property_id = ?
            ORDER BY p.name, e.status, e.ref, e.title
          `
          )
          .all(propertyId)
      : database
          .prepare(
            `
            SELECT e.*, p.name AS property_name
            FROM ecms e
            JOIN properties p ON p.id = e.property_id
            ORDER BY p.name, e.status, e.ref, e.title
          `
          )
          .all()
  ) as EcmRow[];
  return rows.map((row) => toEcm(row, properties));
}

export async function createEcm(input: EcmInput): Promise<Ecm> {
  const result = getDb()
    .prepare(
      `
      INSERT INTO ecms (
        property_id, ref, title, status, approved, utility_type,
        investment_eur, energy_saving_kwh, what_why, pitfall, action, notes,
        created_at, updated_at
      )
      VALUES (@property_id, @ref, @title, @status, @approved, @utility_type, @investment_eur, @energy_saving_kwh, @what_why, @pitfall, @action, @notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `
    )
    .run({ ...input, approved: input.approved ? 1 : 0 });

  const ecms = await listEcms(input.property_id);
  return ecms.find((ecm) => ecm.id === Number(result.lastInsertRowid)) as Ecm;
}

export async function updateEcmStatus(id: number, status: EcmStatus, approved: boolean): Promise<Ecm | null> {
  const result = getDb()
    .prepare("UPDATE ecms SET status = ?, approved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, approved ? 1 : 0, id);
  if (result.changes === 0) return null;
  const ecms = await listEcms();
  return ecms.find((ecm) => ecm.id === id) ?? null;
}

export async function deleteEcm(id: number): Promise<boolean> {
  const result = getDb().prepare("DELETE FROM ecms WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function portfolioSummary(propertyId?: number): Promise<PortfolioSummary> {
  const properties = await listProperties();
  const ecms = await listEcms(propertyId);
  const open = ecms.filter((ecm) => ecm.status === "Open");
  const implemented = ecms.filter((ecm) => ecm.status === "Implemented");

  return {
    properties: propertyId ? 1 : properties.length,
    ecms: ecms.length,
    open: open.length,
    implemented: implemented.length,
    openAnnualSaving: open.reduce((sum, ecm) => sum + ecm.annual_saving_eur, 0),
    implementedAnnualSaving: implemented.reduce((sum, ecm) => sum + ecm.annual_saving_eur, 0),
    totalEnergySaving: ecms.reduce((sum, ecm) => sum + (ecm.energy_saving_kwh ?? 0), 0)
  };
}
