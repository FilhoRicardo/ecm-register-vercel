CREATE TABLE IF NOT EXISTS properties (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  total_floor_area DOUBLE PRECISION,
  elec_cost_eur_per_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  heating_cost_eur_per_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  cooling_cost_eur_per_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_name TEXT NOT NULL,
  tenant_floor_area DOUBLE PRECISION,
  location_label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  equipment_name TEXT NOT NULL,
  equipment_type TEXT NOT NULL DEFAULT '',
  brick_class TEXT NOT NULL DEFAULT '',
  utility_type TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecms (
  id SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  ref TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  investment_eur DOUBLE PRECISION,
  utility_type TEXT NOT NULL DEFAULT 'electricity',
  energy_saving_kwh DOUBLE PRECISION,
  what_why TEXT NOT NULL DEFAULT '',
  pitfall TEXT NOT NULL DEFAULT 'Not stated in source.',
  action TEXT NOT NULL DEFAULT '',
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecm_measured_savings (
  id SERIAL PRIMARY KEY,
  ecm_id INTEGER NOT NULL REFERENCES ecms(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  utility_type TEXT NOT NULL DEFAULT 'electricity',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  energy_saving_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit_cost_eur_per_kwh DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_saving_eur DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecms_property_id ON ecms(property_id);
CREATE INDEX IF NOT EXISTS idx_tenants_property_id ON tenants(property_id);
CREATE INDEX IF NOT EXISTS idx_equipment_property_id ON equipment(property_id);
CREATE INDEX IF NOT EXISTS idx_measured_savings_property_id ON ecm_measured_savings(property_id);
