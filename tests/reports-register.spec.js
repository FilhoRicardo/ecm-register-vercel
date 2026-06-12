import { describe, it } from "vitest";
import { annualEnergyTotalsByYear } from "../src/lib/crrem.js";
import { registerEnergyYearValues } from "../src/lib/reports.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function monthlyRows(year, propertyId, values, monthCount = 12) {
  const rows = [];
  for (let month = 1; month <= monthCount; month += 1) {
    rows.push({
      property_id: propertyId,
      scope_type: "building",
      usage_month: `${year}-${String(month).padStart(2, "0")}`,
      electricity_kwh: values.electricity_kwh,
      heating_kwh: values.heating_kwh,
      cooling_kwh: values.cooling_kwh
    });
  }
  return rows;
}

describe("Excel register energy year values", () => {
  it("uses the first complete calendar year and leaves partial later years blank", () => {
    const annualTotals = annualEnergyTotalsByYear([
      ...monthlyRows(2024, 1, { electricity_kwh: 100.2, heating_kwh: 20.3, cooling_kwh: 5.5 }),
      ...monthlyRows(2025, 1, { electricity_kwh: 200, heating_kwh: 30, cooling_kwh: 10 }, 6)
    ], 1);

    const values = registerEnergyYearValues(annualTotals);

    assert(values[0] === 1512, "Year 0 should be rounded total energy for complete 2024");
    assert(values[1] === "-", "Year 1 should stay blank for partial 2025");
    assert(values[2] === "-", "Year 2 should stay blank when missing");
    assert(values[3] === "-", "Year 3 should stay blank when missing");
  });

  it("populates Year 0 and Year 1 from two consecutive complete calendar years", () => {
    const annualTotals = annualEnergyTotalsByYear([
      ...monthlyRows(2024, 1, { electricity_kwh: 100, heating_kwh: 20, cooling_kwh: 5 }),
      ...monthlyRows(2025, 1, { electricity_kwh: 80, heating_kwh: 10, cooling_kwh: 4 })
    ], 1);

    const values = registerEnergyYearValues(annualTotals);

    assert(values[0] === 1500, "Year 0 should use 2024 total energy");
    assert(values[1] === 1128, "Year 1 should use 2025 total energy");
    assert(values[2] === "-", "Year 2 should stay blank when missing");
    assert(values[3] === "-", "Year 3 should stay blank when missing");
  });

  it("keeps a gap year blank instead of relabeling a later year's figure", () => {
    // 2024 complete, 2025 partial (gap), 2026 complete. Year 1 must be "-"
    // (the 2026 figure must NOT slide into the Year 1 column).
    const annualTotals = annualEnergyTotalsByYear([
      ...monthlyRows(2024, 1, { electricity_kwh: 100, heating_kwh: 0, cooling_kwh: 0 }),
      ...monthlyRows(2025, 1, { electricity_kwh: 999, heating_kwh: 0, cooling_kwh: 0 }, 5),
      ...monthlyRows(2026, 1, { electricity_kwh: 50, heating_kwh: 0, cooling_kwh: 0 })
    ], 1);

    const values = registerEnergyYearValues(annualTotals);

    assert(values[0] === 1200, "Year 0 should be complete 2024 (100 kWh x 12)");
    assert(values[1] === "-", "Year 1 (2025) is incomplete -> blank, not 2026's figure");
    assert(values[2] === 600, "Year 2 should be complete 2026 (50 kWh x 12)");
    assert(values[3] === "-", "Year 3 should stay blank when missing");
  });
});
