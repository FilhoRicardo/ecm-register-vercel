import { describe, it } from "vitest";
import { buildCrremAnalysis } from "../src/lib/crrem.js";
import {
  CRREM_COUNTRIES as DATA_COUNTRIES,
  CRREM_PROPERTY_TYPES as DATA_PROPERTY_TYPES
} from "../src/data/crremV205.js";
import {
  CRREM_COUNTRIES as METADATA_COUNTRIES,
  CRREM_PROPERTY_TYPES as METADATA_PROPERTY_TYPES
} from "../src/lib/crremMetadata.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSameList(name, expected, actual) {
  assert(
    expected.join("|") === actual.join("|"),
    `${name} metadata does not match src/data/crremV205.js`
  );
}

function property(overrides = {}) {
  return {
    id: 1,
    name: "CRREM smoke property",
    address: "Amsterdam",
    total_floor_area: 1000,
    crrem_country: "Netherlands",
    crrem_property_type: "Office",
    heating_carrier: "natural_gas",
    cooling_carrier: "electricity",
    renewable_consumed_kwh: 0,
    renewable_exported_kwh: 0,
    ...overrides
  };
}

function monthlyRows({ scopeType = "building", tenantCount = 1 } = {}) {
  const rows = [];
  for (const year of [2024, 2025]) {
    for (let month = 1; month <= 12; month += 1) {
      for (let tenant = 1; tenant <= tenantCount; tenant += 1) {
        rows.push({
          property_id: 1,
          tenant_id: scopeType === "tenant" ? tenant : null,
          scope_type: scopeType,
          usage_month: `${year}-${String(month).padStart(2, "0")}`,
          electricity_kwh: year === 2024 ? 1000 : 800,
          heating_kwh: year === 2024 ? 500 : 400,
          cooling_kwh: year === 2024 ? 100 : 80
        });
      }
    }
  }
  return rows;
}

describe("CRREM smoke parity", () => {
  it("keeps metadata in sync with src/data/crremV205.js", () => {
    assertSameList("CRREM_COUNTRIES", DATA_COUNTRIES, METADATA_COUNTRIES);
    assertSameList("CRREM_PROPERTY_TYPES", DATA_PROPERTY_TYPES, METADATA_PROPERTY_TYPES);
  });

  it("builds whole-building analysis from complete actual years", () => {
    const buildingAnalysis = buildCrremAnalysis({
      property: property(),
      monthlyUsage: monthlyRows()
    });

    assert(buildingAnalysis.ok, buildingAnalysis.error || "Building analysis failed");
    assert(buildingAnalysis.baseline.year === 2024, "First complete year should be the 2024 baseline");
    assert(buildingAnalysis.projectionBase.year === 2025, "Projection should start from latest complete actual year");
    assert(buildingAnalysis.projected[0].year === 2026, "First projected year should be 2026");
    assert(buildingAnalysis.historical.map((point) => point.year).join(",") === "2024,2025", "Historical points should include 2024 and 2025");
    assert(buildingAnalysis.historical[1].eui < buildingAnalysis.historical[0].eui, "2025 EUI should reflect lower actual usage than 2024");
    assert(buildingAnalysis.usageSource === "Whole-building usage records", "Building rows should be preferred when available");
    assert(buildingAnalysis.historical[0].heatEf === 0.202, "Natural gas factor should come from CRREM Emission Factors v2.05");
  });

  it("aggregates tenant rows when no building rows exist", () => {
    const tenantAnalysis = buildCrremAnalysis({
      property: property(),
      monthlyUsage: monthlyRows({ scopeType: "tenant", tenantCount: 2 })
    });

    assert(tenantAnalysis.ok, tenantAnalysis.error || "Tenant fallback analysis failed");
    assert(tenantAnalysis.usageSource === "Tenant usage rows aggregated", "Tenant rows should be aggregated when no building rows exist");
    assert(tenantAnalysis.baseline.usage.electricity_kwh === 24000, "Tenant electricity rows should aggregate by month and year");
  });

  it("requires district factor overrides when district usage is present", () => {
    const districtWithoutOverride = buildCrremAnalysis({
      property: property({ heating_carrier: "district_heating", cooling_carrier: "district_cooling" }),
      monthlyUsage: monthlyRows()
    });

    assert(!districtWithoutOverride.ok, "District heating/cooling should require an operator emissions factor override when usage is present");
    assert(
      /District Heating|District Cooling/.test(districtWithoutOverride.error),
      "District override error should identify the missing district factor"
    );
  });

  it("uses district factor overrides exactly", () => {
    const districtWithOverride = buildCrremAnalysis({
      property: property({
        heating_carrier: "district_heating",
        cooling_carrier: "district_cooling",
        heating_emission_factor_kgco2e_per_kwh: 0.12,
        cooling_emission_factor_kgco2e_per_kwh: 0.08
      }),
      monthlyUsage: monthlyRows()
    });

    assert(districtWithOverride.ok, districtWithOverride.error || "District override analysis failed");
    assert(districtWithOverride.historical[0].heatEf === 0.12, "District heating override should be used exactly");
    assert(districtWithOverride.historical[0].coolEf === 0.08, "District cooling override should be used exactly");
  });
});
