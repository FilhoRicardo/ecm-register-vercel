import type { Ecm, Property } from "./types";

export const seedProperties: Property[] = [
  {
    id: 1,
    name: "5 Keizers",
    address: "1016 ED Amsterdam, Keizersgracht 271-287",
    total_floor_area: 14893,
    elec_cost_eur_per_kwh: 0.12,
    heating_cost_eur_per_kwh: 0.9,
    cooling_cost_eur_per_kwh: 0.12,
    notes: "Demo seed copied from the local ECM Register structure."
  },
  {
    id: 2,
    name: "UN Studio Tower",
    address: "Amsterdam",
    total_floor_area: null,
    elec_cost_eur_per_kwh: 0.12,
    heating_cost_eur_per_kwh: 0.9,
    cooling_cost_eur_per_kwh: 0.12,
    notes: ""
  }
];

export const seedEcms: Ecm[] = [
  {
    id: 1,
    property_id: 1,
    property_name: "5 Keizers",
    ref: "5K - 202504 - ECM 5",
    title: "Adjust AHU schedules",
    status: "Implemented",
    approved: true,
    utility_type: "electricity",
    investment_eur: null,
    energy_saving_kwh: 41699,
    annual_saving_eur: 5004,
    simple_payback_years: null,
    what_why: "AHU schedule optimisation to reduce out-of-hours fan energy.",
    pitfall: "Confirm all AHUs are covered before reporting final savings.",
    action: "Trend AHU power and zone temperatures after implementation.",
    notes: ""
  },
  {
    id: 2,
    property_id: 1,
    property_name: "5 Keizers",
    ref: "5K - 202504 - ECM 8",
    title: "Reduce out-of-hours tenant baseload",
    status: "Open",
    approved: false,
    utility_type: "electricity",
    investment_eur: null,
    energy_saving_kwh: 114274,
    annual_saving_eur: 13713,
    simple_payback_years: null,
    what_why: "Site-wide out-of-hours baseload reduction opportunity.",
    pitfall: "Needs tenant engagement to separate essential from avoidable loads.",
    action: "Run out-of-hours walkthrough and set tenant-specific baseline targets.",
    notes: ""
  }
];
