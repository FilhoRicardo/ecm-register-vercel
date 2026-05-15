export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  total_floor_area REAL,
  crrem_country TEXT NOT NULL DEFAULT '',
  crrem_property_type TEXT NOT NULL DEFAULT 'Office',
  heating_carrier TEXT NOT NULL DEFAULT 'natural_gas',
  cooling_carrier TEXT NOT NULL DEFAULT 'electric',
  renewable_consumed_kwh REAL NOT NULL DEFAULT 0,
  renewable_exported_kwh REAL NOT NULL DEFAULT 0,
  heating_emission_factor_kgco2e_per_kwh REAL,
  cooling_emission_factor_kgco2e_per_kwh REAL,
  elec_cost_eur_per_kwh REAL NOT NULL DEFAULT 0,
  heating_cost_eur_per_kwh REAL NOT NULL DEFAULT 0,
  cooling_cost_eur_per_kwh REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  tenant_name TEXT NOT NULL,
  tenant_location_id TEXT NOT NULL DEFAULT '',
  tenant_floor_area REAL,
  location_label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  tenant_id INTEGER,
  equipment_name TEXT NOT NULL,
  equipment_type TEXT NOT NULL DEFAULT '',
  brick_class TEXT NOT NULL DEFAULT '',
  dexma_location_id TEXT NOT NULL DEFAULT '',
  dexma_device_id TEXT NOT NULL DEFAULT '',
  utility_type TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ecms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  investment_eur REAL,
  utility_type TEXT NOT NULL DEFAULT 'electricity',
  energy_saving_kwh REAL,
  what_why TEXT NOT NULL DEFAULT '',
  pitfall TEXT NOT NULL DEFAULT 'Not stated in source.',
  action TEXT NOT NULL DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0,
  obsidian_filename TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ecm_equipment (
  ecm_id INTEGER NOT NULL,
  equipment_id INTEGER NOT NULL,
  PRIMARY KEY (ecm_id, equipment_id),
  FOREIGN KEY (ecm_id) REFERENCES ecms(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ecm_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ecm_id INTEGER NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ecm_id) REFERENCES ecms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS monthly_utility_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  tenant_id INTEGER,
  scope_type TEXT NOT NULL DEFAULT 'building',
  usage_month TEXT NOT NULL,
  electricity_kwh REAL NOT NULL DEFAULT 0,
  heating_kwh REAL NOT NULL DEFAULT 0,
  cooling_kwh REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  UNIQUE (property_id, tenant_id, scope_type, usage_month)
);

CREATE TABLE IF NOT EXISTS ecm_measured_savings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ecm_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  utility_type TEXT NOT NULL DEFAULT 'electricity',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  energy_saving_kwh REAL NOT NULL DEFAULT 0,
  unit_cost_eur_per_kwh REAL NOT NULL DEFAULT 0,
  cost_saving_eur REAL NOT NULL DEFAULT 0,
  obsidian_filename TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ecm_id) REFERENCES ecms(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS monthly_admin_tracker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  admin_year INTEGER NOT NULL,
  docunite_report INTEGER NOT NULL DEFAULT 0,
  ecm_report INTEGER NOT NULL DEFAULT 0,
  status_quo INTEGER NOT NULL DEFAULT 0,
  pre_meeting_notes INTEGER NOT NULL DEFAULT 0,
  post_meeting_notes INTEGER NOT NULL DEFAULT 0,
  comments TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  UNIQUE (property_id, admin_year)
);
`;

const MIGRATIONS = [
  "ALTER TABLE ecms ADD COLUMN obsidian_filename TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE ecm_measured_savings ADD COLUMN obsidian_filename TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE properties ADD COLUMN crrem_country TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE properties ADD COLUMN crrem_property_type TEXT NOT NULL DEFAULT 'Office'",
  "ALTER TABLE properties ADD COLUMN heating_carrier TEXT NOT NULL DEFAULT 'natural_gas'",
  "ALTER TABLE properties ADD COLUMN cooling_carrier TEXT NOT NULL DEFAULT 'electric'",
  "ALTER TABLE properties ADD COLUMN renewable_consumed_kwh REAL NOT NULL DEFAULT 0",
  "ALTER TABLE properties ADD COLUMN renewable_exported_kwh REAL NOT NULL DEFAULT 0",
  "ALTER TABLE properties ADD COLUMN heating_emission_factor_kgco2e_per_kwh REAL",
  "ALTER TABLE properties ADD COLUMN cooling_emission_factor_kgco2e_per_kwh REAL",
  "UPDATE properties SET crrem_property_type = 'Office' WHERE crrem_property_type = '' OR crrem_property_type IS NULL",
  "UPDATE properties SET heating_carrier = 'natural_gas' WHERE heating_carrier = '' OR heating_carrier IS NULL",
  "UPDATE properties SET cooling_carrier = 'electric' WHERE cooling_carrier = '' OR cooling_carrier IS NULL",
  "UPDATE properties SET crrem_country = 'Netherlands' WHERE (crrem_country = '' OR crrem_country IS NULL) AND (LOWER(name) LIKE '%keizers%' OR LOWER(name) LIKE '%akzo%' OR LOWER(name) LIKE '%un studio%' OR LOWER(address) LIKE '%amsterdam%')",
  "UPDATE properties SET crrem_country = 'United Kingdom' WHERE (crrem_country = '' OR crrem_country IS NULL) AND (LOWER(name) LIKE '%ito%' OR LOWER(name) LIKE '%som%' OR LOWER(name) LIKE '%xyz%' OR LOWER(address) LIKE '%london%' OR LOWER(address) LIKE '%manchester%' OR LOWER(address) LIKE '%united kingdom%')"
];

export function migrate(db) {
  db.run(SCHEMA_SQL);
  for (const sql of MIGRATIONS) {
    try {
      db.run(sql);
    } catch {
      // Column already exists.
    }
  }
}
