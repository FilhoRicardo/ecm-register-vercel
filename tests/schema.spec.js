import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/lib/schema.js";

const require = createRequire(import.meta.url);
let SQL = null;

async function loadTestSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });
  }
  return SQL;
}

async function migratedDatabase() {
  const sql = await loadTestSqlJs();
  const db = new sql.Database();
  migrate(db);
  return db;
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(db, sql, params = []) {
  return queryAll(db, sql, params)[0] || null;
}

function insertProperty(db, name = "Default House") {
  db.run("INSERT INTO properties (name) VALUES (?)", [name]);
  return Number(queryOne(db, "SELECT last_insert_rowid() AS id").id);
}

describe("schema migration", () => {
  it("creates core tables with property defaults", async () => {
    const db = await migratedDatabase();

    db.run("INSERT INTO properties (name) VALUES (?)", ["Default House"]);
    const row = queryOne(db, "SELECT * FROM properties WHERE name = ?", ["Default House"]);

    expect(row).toMatchObject({
      address: "",
      crrem_country: "",
      crrem_property_type: "Office",
      heating_carrier: "natural_gas",
      cooling_carrier: "electric",
      renewable_consumed_kwh: 0,
      renewable_exported_kwh: 0,
      elec_cost_eur_per_kwh: 0,
      heating_cost_eur_per_kwh: 0,
      cooling_cost_eur_per_kwh: 0,
      notes: ""
    });
    expect(row.created_at).toEqual(expect.any(String));
    expect(row.updated_at).toEqual(expect.any(String));
  });

  it("creates monthly usage defaults and uniqueness constraints", async () => {
    const db = await migratedDatabase();
    const propertyId = insertProperty(db, "Usage House");

    db.run(
      "INSERT INTO monthly_utility_usage (property_id, usage_month) VALUES (?, ?)",
      [propertyId, "2025-12"]
    );
    const row = queryOne(db, "SELECT * FROM monthly_utility_usage WHERE property_id = ?", [propertyId]);

    expect(row).toMatchObject({
      property_id: propertyId,
      tenant_id: null,
      scope_type: "building",
      usage_month: "2025-12",
      electricity_kwh: 0,
      heating_kwh: 0,
      cooling_kwh: 0,
      notes: ""
    });
    db.run("INSERT INTO tenants (property_id, tenant_name) VALUES (?, ?)", [propertyId, "Tenant A"]);
    const tenantId = Number(queryOne(db, "SELECT last_insert_rowid() AS id").id);
    db.run(
      "INSERT INTO monthly_utility_usage (property_id, tenant_id, scope_type, usage_month) VALUES (?, ?, ?, ?)",
      [propertyId, tenantId, "tenant", "2025-12"]
    );
    expect(() => db.run(
      "INSERT INTO monthly_utility_usage (property_id, tenant_id, scope_type, usage_month) VALUES (?, ?, ?, ?)",
      [propertyId, tenantId, "tenant", "2025-12"]
    )).toThrow(/UNIQUE/);
  });

  it("creates foreign keys for cascade and SET NULL relationships", async () => {
    const db = await migratedDatabase();
    const propertyId = insertProperty(db, "Cascade House");
    db.run("INSERT INTO tenants (property_id, tenant_name) VALUES (?, ?)", [propertyId, "Tenant A"]);
    const tenantId = Number(queryOne(db, "SELECT last_insert_rowid() AS id").id);
    db.run(
      "INSERT INTO monthly_utility_usage (property_id, tenant_id, scope_type, usage_month, electricity_kwh) VALUES (?, ?, ?, ?, ?)",
      [propertyId, tenantId, "tenant", "2025-10", 10]
    );

    db.run("DELETE FROM tenants WHERE id = ?", [tenantId]);
    expect(queryOne(db, "SELECT tenant_id FROM monthly_utility_usage WHERE property_id = ?", [propertyId]).tenant_id).toBe(null);

    db.run("DELETE FROM properties WHERE id = ?", [propertyId]);
    expect(queryAll(db, "SELECT * FROM monthly_utility_usage WHERE property_id = ?", [propertyId])).toEqual([]);
  });

  it("normalises legacy property CRREM fields during migration", async () => {
    const sql = await loadTestSqlJs();
    const db = new sql.Database();
    db.run(`
      CREATE TABLE properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT ''
      )
    `);
    db.run("INSERT INTO properties (name, address) VALUES (?, ?)", ["Keizersgracht Legacy", "Amsterdam"]);

    migrate(db);

    expect(queryOne(
      db,
      "SELECT crrem_country, crrem_property_type, heating_carrier, cooling_carrier FROM properties WHERE name = ?",
      ["Keizersgracht Legacy"]
    )).toEqual({
      crrem_country: "Netherlands",
      crrem_property_type: "Office",
      heating_carrier: "natural_gas",
      cooling_carrier: "electric"
    });
  });

  it("migrates legacy yearly admin tracker rows to monthly records", async () => {
    const sql = await loadTestSqlJs();
    const db = new sql.Database();
    db.run("CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '')");
    db.run(`
      CREATE TABLE monthly_admin_tracker (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL,
        admin_year INTEGER NOT NULL,
        docunite_report INTEGER NOT NULL DEFAULT 0,
        ecm_report INTEGER NOT NULL DEFAULT 0,
        pre_meeting_notes INTEGER NOT NULL DEFAULT 0,
        post_meeting_notes INTEGER NOT NULL DEFAULT 0,
        status_quo INTEGER NOT NULL DEFAULT 0,
        comments TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (property_id, admin_year)
      )
    `);
    db.run("INSERT INTO properties (name) VALUES (?)", ["Admin House"]);
    db.run(
      `INSERT INTO monthly_admin_tracker (
        property_id, admin_year, docunite_report, ecm_report, pre_meeting_notes,
        post_meeting_notes, status_quo, comments
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [1, 2025, 1, 0, 1, 0, 1, "Legacy row"]
    );

    migrate(db);

    expect(queryOne(db, "SELECT * FROM monthly_admin_tracker WHERE property_id = 1")).toMatchObject({
      property_id: 1,
      admin_year: 2025,
      admin_month: 1,
      docunite_report: 1,
      ecm_report: 0,
      pre_meeting_notes: 1,
      consumption_tracked: 0,
      meeting_held: 0,
      post_meeting_notes: 0,
      status_quo: 1,
      comments: "Legacy row"
    });
    expect(queryAll(db, "PRAGMA index_info(sqlite_autoindex_monthly_admin_tracker_1)").map((row) => row.name)).toEqual([
      "property_id",
      "admin_year",
      "admin_month"
    ]);
  });
});
