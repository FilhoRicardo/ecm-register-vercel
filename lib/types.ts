export type UtilityType = "electricity" | "heating" | "cooling";

export type EcmStatus =
  | "Open"
  | "Approved"
  | "In Progress"
  | "Implemented"
  | "Rejected"
  | "On Hold";

export type Property = {
  id: number;
  name: string;
  address: string;
  total_floor_area: number | null;
  elec_cost_eur_per_kwh: number;
  heating_cost_eur_per_kwh: number;
  cooling_cost_eur_per_kwh: number;
  notes: string;
};

export type Ecm = {
  id: number;
  property_id: number;
  property_name?: string;
  ref: string;
  title: string;
  status: EcmStatus;
  approved: boolean;
  utility_type: UtilityType;
  investment_eur: number | null;
  energy_saving_kwh: number | null;
  annual_saving_eur: number;
  simple_payback_years: number | null;
  what_why: string;
  pitfall: string;
  action: string;
  notes: string;
};

export type EcmInput = {
  property_id: number;
  ref: string;
  title: string;
  status: EcmStatus;
  approved: boolean;
  utility_type: UtilityType;
  investment_eur: number | null;
  energy_saving_kwh: number | null;
  what_why: string;
  pitfall: string;
  action: string;
  notes: string;
};

export type PortfolioSummary = {
  properties: number;
  ecms: number;
  open: number;
  implemented: number;
  openAnnualSaving: number;
  implementedAnnualSaving: number;
  totalEnergySaving: number;
};
