// Keep CRREM_COUNTRIES and CRREM_PROPERTY_TYPES in sync with src/data/crremV205.js;
// they are inlined here so the generated pathway data can stay bundle-split.
export const CRREM_DATA_VERSION = "v2.05";
export const CRREM_DATA_ATTRIBUTION = "CRREM Foundation, CRREM Global Pathways and Emission Factors v2.05, https://crrem.org/learn/";
export const CRREM_EMISSION_FACTORS_SOURCE = "CRREM Foundation, Emission Factors v2.05, https://crrem.org/learn/";
export const CRREM_EMISSION_FACTORS_VERSION = "v2.05";

export const CRREM_COUNTRIES = [
  "Australia",
  "Austria",
  "Belgium",
  "Brazil",
  "Bulgaria",
  "Canada",
  "China",
  "Croatia",
  "Cyprus",
  "Czech Republic",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hong Kong",
  "Hungary",
  "India",
  "Ireland",
  "Italy",
  "Japan",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malaysia",
  "Malta",
  "Mexico",
  "Netherlands",
  "New Zealand",
  "Norway",
  "Philippines",
  "Poland",
  "Portugal",
  "Romania",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "USA",
  "United Kingdom"
];

export const CRREM_PROPERTY_TYPES = [
  "Distribution Warehouse Cold",
  "Distribution Warehouse Warm",
  "Enclosed Retail Mall",
  "Healthcare",
  "Hotel",
  "Inpatient Healthcare",
  "Large Multi-Family - High Rise (>20 Units)",
  "Large Multi-Family - Low Rise (>20 Units)",
  "Leisure",
  "Leisure/Lodging",
  "Office",
  "Outpatient Healthcare",
  "Refrigerated Warehouse Cool",
  "Residential",
  "Residential Multi-Family",
  "Residential Single-Family",
  "Retail High Street",
  "Retail Store",
  "Retail Warehouse",
  "Self Storage",
  "Shipping/Distribution Warehouse",
  "Shopping Center",
  "Small Multi-Family - High Rise (<20 Units)",
  "Strip Shopping Center"
];

export const HEATING_CARRIER_OPTIONS = [
  { value: "district_heating", label: "District heating" },
  { value: "natural_gas", label: "Natural gas" },
  { value: "heating_oil", label: "Heating oil" },
  { value: "lpg", label: "LPG" },
  { value: "coal", label: "Coal" },
  { value: "electric", label: "Electric / heat pump" },
  { value: "biomass", label: "Biomass" },
  { value: "none", label: "None / not applicable" }
];

export const COOLING_CARRIER_OPTIONS = [
  { value: "district_cooling", label: "District cooling" },
  { value: "electric", label: "Electric chiller / heat pump" },
  { value: "none", label: "None / not applicable" }
];

const DEFAULT_COUNTRY = "United Kingdom";
const DEFAULT_PROPERTY_TYPE = "Office";

export function inferCrremCountry(property = {}) {
  const text = `${property.name || ""} ${property.address || ""} ${property.notes || ""}`.toLowerCase();
  if (text.includes("amsterdam") || text.includes("netherlands") || text.includes("keizers") || text.includes("akzo") || text.includes("un studio")) {
    return "Netherlands";
  }
  if (text.includes("london") || text.includes("manchester") || text.includes("united kingdom") || text.includes(" uk ") || text.includes("ito") || text.includes("som") || text.includes("xyz")) {
    return "United Kingdom";
  }
  return "";
}

export function normaliseCrremSettings(property = {}) {
  const inferredCountry = inferCrremCountry(property);
  return {
    country: property.crrem_country || inferredCountry || DEFAULT_COUNTRY,
    propertyType: property.crrem_property_type || DEFAULT_PROPERTY_TYPE,
    heatingCarrier: property.heating_carrier || "natural_gas",
    coolingCarrier: property.cooling_carrier || "electric",
    renewableConsumed: Number(property.renewable_consumed_kwh || 0),
    renewableExported: Number(property.renewable_exported_kwh || 0)
  };
}
