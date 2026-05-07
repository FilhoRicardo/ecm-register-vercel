import {
  CRREM_COUNTRIES,
  CRREM_DATA_ATTRIBUTION,
  CRREM_DATA_VERSION,
  CRREM_GRID_EF,
  CRREM_PATHWAYS,
  CRREM_PROPERTY_TYPES,
  CRREM_YEARS
} from "../data/crremV205.js";

const DEFAULT_COUNTRY = "United Kingdom";
const DEFAULT_PROPERTY_TYPE = "Office";
const UK_GRID_2020 = getGridEf(DEFAULT_COUNTRY, 2020) || 0.20431;
const DISTRICT_BASE_EF = 0.20431;
const GAS_EF = 0.18316;
const OIL_EF = 0.281;
const BIOMASS_EF = 0;

export const HEATING_CARRIER_OPTIONS = [
  { value: "district_heating", label: "District heating" },
  { value: "natural_gas", label: "Natural gas" },
  { value: "heating_oil", label: "Heating oil" },
  { value: "electric", label: "Electric / heat pump" },
  { value: "biomass", label: "Biomass" },
  { value: "none", label: "None / not applicable" }
];

export const COOLING_CARRIER_OPTIONS = [
  { value: "district_cooling", label: "District cooling" },
  { value: "electric", label: "Electric chiller / heat pump" },
  { value: "none", label: "None / not applicable" }
];

export {
  CRREM_COUNTRIES,
  CRREM_DATA_ATTRIBUTION,
  CRREM_DATA_VERSION,
  CRREM_PROPERTY_TYPES,
  CRREM_YEARS
};

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
    heatingCarrier: property.heating_carrier || "district_heating",
    coolingCarrier: property.cooling_carrier || "district_cooling",
    renewableConsumed: Number(property.renewable_consumed_kwh || 0),
    renewableExported: Number(property.renewable_exported_kwh || 0)
  };
}

export function getCrremDataAvailability(monthlyUsage, propertyId) {
  const annual = annualUsageByYear(monthlyUsage, propertyId);
  const years = Object.keys(annual).map(Number).sort((a, b) => a - b);
  const fullYears = years.filter((year) => annual[year].months.size === 12);
  const months = crremMonthlyUsage(monthlyUsage, propertyId).map((row) => row.usage_month).sort();
  return {
    firstYear: years[0] || null,
    latestYear: years.at(-1) || null,
    fullYears,
    latestMonth: months.at(-1) || "",
    usageSource: crremUsageSource(monthlyUsage, propertyId)
  };
}

export function buildCrremAnalysis({ property, monthlyUsage, mode = "first_complete_year", reportingYear, rollingEndMonth }) {
  if (!property) return { ok: false, error: "Select a property." };
  const area = Number(property.total_floor_area || 0);
  if (!area) return { ok: false, error: "Property total floor area is required for CRREM analysis." };

  const settings = normaliseCrremSettings(property);
  const { country, propertyType } = settings;
  const pathway = findPathway(country, propertyType);
  if (!pathway) return { ok: false, error: `No CRREM pathway found for ${country} / ${propertyType}.` };

  const baseline = selectBaselineUsage(monthlyUsage, property.id, mode, reportingYear, rollingEndMonth);
  if (!baseline.ok) return baseline;

  const historicalAnnual = annualUsageByYear(monthlyUsage, property.id);
  const completeYears = Object.keys(historicalAnnual)
    .map(Number)
    .filter((year) => historicalAnnual[year].months.size === 12)
    .sort((a, b) => a - b);
  const historical = completeYears
    .map((year) => [year, historicalAnnual[year]])
    .map(([year, usage]) => calculateYearPoint(Number(year), usage.totals, area, pathway, country, property, false))
    .filter(Boolean);

  const latestActualProjectionYear = completeYears.filter((year) => year >= baseline.year).at(-1);
  const projectionBase = latestActualProjectionYear
    ? {
        year: latestActualProjectionYear,
        label: `${latestActualProjectionYear} latest complete actual year`,
        usage: historicalAnnual[latestActualProjectionYear].totals
      }
    : baseline;
  const startYear = Math.max(CRREM_YEARS[0], projectionBase.year + (latestActualProjectionYear ? 1 : 0));
  const projected = [];
  for (let year = startYear; year <= 2050; year += 1) {
    projected.push(calculateYearPoint(year, projectionBase.usage, area, pathway, country, property, true));
  }

  const baselinePoint = calculateYearPoint(baseline.year, baseline.usage, area, pathway, country, property, false);
  const alignmentSeries = [
    ...historical.filter((point) => point.year >= baseline.year),
    ...projected
  ].sort((a, b) => a.year - b.year);

  return {
    ok: true,
    property,
    country,
    propertyType,
    regionCode: pathway.regionCode,
    settings,
    mode,
    baseline,
    projectionBase,
    baselinePoint,
    usageSource: crremUsageSource(monthlyUsage, property.id),
    historical,
    projected,
    carbonMisalignmentYear: firstCrossing(alignmentSeries, "carbonIntensity", "carbonPathway"),
    euiMisalignmentYear: firstCrossing(alignmentSeries, "eui", "euiPathway")
  };
}

function selectBaselineUsage(monthlyUsage, propertyId, mode, reportingYear, rollingEndMonth) {
  const annual = annualUsageByYear(monthlyUsage, propertyId);
  const fullYears = Object.keys(annual).map(Number).filter((year) => annual[year].months.size === 12).sort((a, b) => a - b);

  if (mode === "reporting_year") {
    const year = Number(reportingYear);
    const usage = annual[year];
    if (!usage || usage.months.size !== 12) return { ok: false, error: `No complete monthly usage set found for ${year}.` };
    return { ok: true, year, label: `${year} reporting year`, months: [...usage.months].sort(), usage: usage.totals };
  }

  if (mode === "rolling_12") {
    const endMonth = rollingEndMonth || latestUsageMonth(monthlyUsage, propertyId);
    const months = monthRange(endMonth, 12);
    const usage = sumMonths(monthlyUsage, propertyId, months);
    if (usage.monthsFound < 12) return { ok: false, error: `Rolling 12 months ending ${endMonth || "latest month"} is incomplete.` };
    return { ok: true, year: Number(endMonth.slice(0, 4)), label: `Rolling 12 months to ${endMonth}`, months, usage: usage.totals };
  }

  if (mode === "first_complete_year") {
    if (!fullYears.length) return { ok: false, error: "At least one complete calendar year of monthly usage is required." };
    const year = fullYears[0];
    return { ok: true, year, label: `${year} first complete year`, months: [...annual[year].months].sort(), usage: annual[year].totals };
  }

  if (!fullYears.length) return { ok: false, error: "At least one complete calendar year of monthly usage is required." };
  const year = fullYears[0];
  return { ok: true, year, label: `${year} first complete year`, months: [...annual[year].months].sort(), usage: annual[year].totals };
}

function calculateYearPoint(year, usage, area, pathway, country, property, projected) {
  const index = CRREM_YEARS.indexOf(year);
  if (index < 0) return null;
  const electricity = Number(usage.electricity_kwh || 0);
  const heating = Number(usage.heating_kwh || 0);
  const cooling = Number(usage.cooling_kwh || 0);
  const renewableConsumed = Number(property.renewable_consumed_kwh || 0);
  const renewableExported = Number(property.renewable_exported_kwh || 0);
  const totalEnergy = electricity + heating + cooling + renewableConsumed;
  const gridEf = getGridEf(country, year);
  const heatEf = carrierEf(property.heating_carrier || "district_heating", country, year, nullableNumber(property.heating_emission_factor_kgco2e_per_kwh));
  const coolEf = carrierEf(property.cooling_carrier || "district_cooling", country, year, nullableNumber(property.cooling_emission_factor_kgco2e_per_kwh));
  const electricityCarbon = electricity * gridEf;
  const heatingCarbon = heating * heatEf;
  const coolingCarbon = cooling * coolEf;
  const grossCarbonKg = electricityCarbon + heatingCarbon + coolingCarbon;
  const exportCreditKg = Math.min(renewableExported * gridEf, electricityCarbon);
  const carbonKg = Math.max(0, grossCarbonKg - exportCreditKg);
  return {
    year,
    projected,
    electricity,
    heating,
    cooling,
    renewableConsumed,
    renewableExported,
    totalEnergy,
    eui: totalEnergy / area,
    carbonIntensity: carbonKg / area,
    grossCarbonKg,
    exportCreditKg,
    netCarbonKg: carbonKg,
    electricityCarbon,
    heatingCarbon,
    coolingCarbon,
    carbonPathway: pathway.co2[index],
    euiPathway: pathway.eui[index],
    gridEf,
    heatEf,
    coolEf,
    heatingCarrier: property.heating_carrier || "district_heating",
    coolingCarrier: property.cooling_carrier || "district_cooling"
  };
}

function crremMonthlyUsage(monthlyUsage, propertyId) {
  const rows = propertyMonthlyUsage(monthlyUsage, propertyId);
  const buildingRows = rows.filter((row) => row.scope_type === "building");
  return buildingRows.length ? buildingRows : rows.filter((row) => row.scope_type === "tenant");
}

function crremUsageSource(monthlyUsage, propertyId) {
  const rows = propertyMonthlyUsage(monthlyUsage, propertyId);
  if (rows.some((row) => row.scope_type === "building")) return "Whole-building usage records";
  if (rows.some((row) => row.scope_type === "tenant")) return "Tenant usage rows aggregated";
  return "No usage records";
}

function propertyMonthlyUsage(monthlyUsage, propertyId) {
  return (monthlyUsage || [])
    .filter((row) => row.property_id === Number(propertyId))
    .filter((row) => row.usage_month);
}

function annualUsageByYear(monthlyUsage, propertyId) {
  const annual = {};
  for (const row of crremMonthlyUsage(monthlyUsage, propertyId)) {
    const year = Number(String(row.usage_month).slice(0, 4));
    if (!annual[year]) annual[year] = { months: new Set(), totals: { electricity_kwh: 0, heating_kwh: 0, cooling_kwh: 0 } };
    annual[year].months.add(row.usage_month);
    annual[year].totals.electricity_kwh += Number(row.electricity_kwh || 0);
    annual[year].totals.heating_kwh += Number(row.heating_kwh || 0);
    annual[year].totals.cooling_kwh += Number(row.cooling_kwh || 0);
  }
  return annual;
}

function sumMonths(monthlyUsage, propertyId, months) {
  const wanted = new Set(months);
  const totals = { electricity_kwh: 0, heating_kwh: 0, cooling_kwh: 0 };
  const found = new Set();
  for (const row of crremMonthlyUsage(monthlyUsage, propertyId)) {
    if (!wanted.has(row.usage_month)) continue;
    found.add(row.usage_month);
    addUsage(totals, row);
  }
  return { monthsFound: found.size, totals };
}

function addUsage(target, source) {
  target.electricity_kwh += Number(source.electricity_kwh || 0);
  target.heating_kwh += Number(source.heating_kwh || 0);
  target.cooling_kwh += Number(source.cooling_kwh || 0);
}

function latestUsageMonth(monthlyUsage, propertyId) {
  return crremMonthlyUsage(monthlyUsage, propertyId).map((row) => row.usage_month).sort().at(-1) || "";
}

function monthRange(endMonth, count) {
  if (!endMonth) return [];
  const months = [];
  const [year, month] = endMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  for (let i = count - 1; i >= 0; i -= 1) {
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - i, 1));
    months.push(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function findPathway(country, propertyType) {
  return CRREM_PATHWAYS.find((row) => row.country === country && row.propertyType === propertyType);
}

function getGridEf(country, year) {
  const values = CRREM_GRID_EF[country];
  if (Array.isArray(values)) return Number(values[CRREM_YEARS.indexOf(year)] || 0);
  return Number(values?.[String(year)] || values?.[year] || 0);
}

function districtEf(country, year) {
  const grid = getGridEf(country, year);
  if (!grid || !UK_GRID_2020) return DISTRICT_BASE_EF;
  return DISTRICT_BASE_EF * (grid / UK_GRID_2020);
}

function carrierEf(carrier, country, year, override) {
  if (override !== null) return override;
  if (carrier === "natural_gas") return GAS_EF;
  if (carrier === "heating_oil") return OIL_EF;
  if (carrier === "electric") return getGridEf(country, year);
  if (carrier === "biomass") return BIOMASS_EF;
  if (carrier === "none") return 0;
  return districtEf(country, year);
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstCrossing(points, actualKey, pathwayKey) {
  const crossing = points.find((point) => Number(point[actualKey]) > Number(point[pathwayKey]));
  return crossing ? crossing.year : "Beyond 2050";
}
