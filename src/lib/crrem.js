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
    propertyType: property.crrem_property_type || DEFAULT_PROPERTY_TYPE
  };
}

export function getCrremDataAvailability(monthlyUsage, propertyId) {
  const annual = annualUsageByYear(monthlyUsage, propertyId);
  const years = Object.keys(annual).map(Number).sort((a, b) => a - b);
  const fullYears = years.filter((year) => annual[year].months.size === 12);
  const months = wholeBuildingMonthlyUsage(monthlyUsage, propertyId).map((row) => row.usage_month).sort();
  return {
    firstYear: years[0] || null,
    latestYear: years.at(-1) || null,
    fullYears,
    latestMonth: months.at(-1) || ""
  };
}

export function buildCrremAnalysis({ property, monthlyUsage, mode = "average_full_years", reportingYear, rollingEndMonth }) {
  if (!property) return { ok: false, error: "Select a property." };
  const area = Number(property.total_floor_area || 0);
  if (!area) return { ok: false, error: "Property total floor area is required for CRREM analysis." };

  const { country, propertyType } = normaliseCrremSettings(property);
  const pathway = findPathway(country, propertyType);
  if (!pathway) return { ok: false, error: `No CRREM pathway found for ${country} / ${propertyType}.` };

  const baseline = selectBaselineUsage(monthlyUsage, property.id, mode, reportingYear, rollingEndMonth);
  if (!baseline.ok) return baseline;

  const historicalAnnual = annualUsageByYear(monthlyUsage, property.id);
  const historical = Object.entries(historicalAnnual)
    .filter(([, usage]) => usage.months.size === 12)
    .map(([year, usage]) => calculateYearPoint(Number(year), usage, area, pathway, country, false))
    .filter(Boolean);

  const startYear = Math.max(CRREM_YEARS[0], baseline.year);
  const projected = [];
  for (let year = startYear; year <= 2050; year += 1) {
    projected.push(calculateYearPoint(year, baseline.usage, area, pathway, country, true));
  }

  const baselinePoint = calculateYearPoint(baseline.year, baseline.usage, area, pathway, country, false);
  const projectedWithBaseline = projected.filter((point) => point.year >= baseline.year);

  return {
    ok: true,
    property,
    country,
    propertyType,
    regionCode: pathway.regionCode,
    mode,
    baseline,
    baselinePoint,
    historical,
    projected,
    carbonMisalignmentYear: firstCrossing(projectedWithBaseline, "carbonIntensity", "carbonPathway"),
    euiMisalignmentYear: firstCrossing(projectedWithBaseline, "eui", "euiPathway")
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

  if (!fullYears.length) return { ok: false, error: "At least one complete calendar year of whole-building monthly usage is required." };
  const total = { electricity_kwh: 0, heating_kwh: 0, cooling_kwh: 0 };
  for (const year of fullYears) addUsage(total, annual[year].totals);
  return {
    ok: true,
    year: fullYears.at(-1),
    label: `Average of complete years: ${fullYears.join(", ")}`,
    months: fullYears.flatMap((year) => [...annual[year].months].sort()),
    usage: divideUsage(total, fullYears.length)
  };
}

function calculateYearPoint(year, usage, area, pathway, country, projected) {
  const index = CRREM_YEARS.indexOf(year);
  if (index < 0) return null;
  const electricity = Number(usage.electricity_kwh || 0);
  const heating = Number(usage.heating_kwh || 0);
  const cooling = Number(usage.cooling_kwh || 0);
  const totalEnergy = electricity + heating + cooling;
  const gridEf = getGridEf(country, year);
  const heatEf = districtEf(country, year);
  const coolEf = districtEf(country, year);
  const carbonKg = (electricity * gridEf) + (heating * heatEf) + (cooling * coolEf);
  return {
    year,
    projected,
    electricity,
    heating,
    cooling,
    totalEnergy,
    eui: totalEnergy / area,
    carbonIntensity: carbonKg / area,
    carbonPathway: pathway.co2[index],
    euiPathway: pathway.eui[index],
    gridEf,
    heatEf,
    coolEf
  };
}

function wholeBuildingMonthlyUsage(monthlyUsage, propertyId) {
  return (monthlyUsage || [])
    .filter((row) => row.property_id === Number(propertyId) && row.scope_type === "building")
    .filter((row) => row.usage_month);
}

function annualUsageByYear(monthlyUsage, propertyId) {
  const annual = {};
  for (const row of wholeBuildingMonthlyUsage(monthlyUsage, propertyId)) {
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
  for (const row of wholeBuildingMonthlyUsage(monthlyUsage, propertyId)) {
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

function divideUsage(usage, divisor) {
  return {
    electricity_kwh: usage.electricity_kwh / divisor,
    heating_kwh: usage.heating_kwh / divisor,
    cooling_kwh: usage.cooling_kwh / divisor
  };
}

function latestUsageMonth(monthlyUsage, propertyId) {
  return wholeBuildingMonthlyUsage(monthlyUsage, propertyId).map((row) => row.usage_month).sort().at(-1) || "";
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

function firstCrossing(points, actualKey, pathwayKey) {
  const crossing = points.find((point) => Number(point[actualKey]) > Number(point[pathwayKey]));
  return crossing ? crossing.year : "Beyond 2050";
}
