export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

export function kwh(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function slug(value, fallback = "record") {
  const clean = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
  return clean || fallback;
}

export function yamlQuote(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "'")}"`;
}

export function utilityCost(property, utility) {
  if (!property) return 0;
  if (utility === "heating") return Number(property.heating_cost_eur_per_kwh || 0);
  if (utility === "cooling") return Number(property.cooling_cost_eur_per_kwh || 0);
  return Number(property.elec_cost_eur_per_kwh || 0);
}

export const EQUIPMENT_TYPE_TO_BRICK_CLASS = {
  "Air Handling Unit": "brick:AHU",
  "Fan Coil Unit": "brick:Fan_Coil_Unit",
  Chiller: "brick:Chiller",
  Boiler: "brick:Boiler",
  "Heat Pump": "brick:Heat_Pump",
  Pump: "brick:Pump",
  Fan: "brick:Fan",
  "Cooling Tower": "brick:Cooling_Tower",
  "Heat Exchanger": "brick:Heat_Exchanger",
  "Variable Air Volume Box": "brick:VAV",
  Meter: "brick:Meter",
  "Electric Meter": "brick:Electrical_Meter",
  "Thermal Meter": "brick:Thermal_Meter",
  "Gas Meter": "brick:Gas_Meter",
  "Water Meter": "brick:Water_Meter",
  "Lighting System": "brick:Lighting_System",
  "BMS / Controls": "brick:BMS",
  Sensor: "brick:Sensor",
  Valve: "brick:Valve",
  Damper: "brick:Damper",
  Other: ""
};
