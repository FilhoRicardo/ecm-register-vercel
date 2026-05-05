import type { Ecm, Property, UtilityType } from "./types";

export function utilityCost(property: Property, utility: UtilityType): number {
  if (utility === "heating") return property.heating_cost_eur_per_kwh;
  if (utility === "cooling") return property.cooling_cost_eur_per_kwh;
  return property.elec_cost_eur_per_kwh;
}

export function annualSaving(ecm: Pick<Ecm, "energy_saving_kwh" | "utility_type">, property: Property): number {
  return Math.round((ecm.energy_saving_kwh ?? 0) * utilityCost(property, ecm.utility_type) * 100) / 100;
}

export function paybackYears(investment: number | null, annual: number): number | null {
  if (!investment || !annual) return null;
  return Math.round((investment / annual) * 10) / 10;
}

export function money(value: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);
}

export function kwh(value: number): string {
  return `${new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(value)} kWh`;
}
