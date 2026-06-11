import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_TYPE_TO_BRICK_CLASS,
  kwh,
  money,
  nowStamp,
  slug,
  todayIso,
  utilityCost,
  yamlQuote
} from "../src/lib/format.js";

function localMoney(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function localKwh(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

describe("format helpers", () => {
  it("formats dates and timestamps with stable shapes", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nowStamp()).toMatch(/^\d{8}_\d{6}$/);
  });

  it("formats money boundary values", () => {
    expect(money(0)).toBe(localMoney(0));
    expect(money(-1234.567)).toBe(localMoney(-1234.567));
    expect(money(9876543210.129)).toBe(localMoney(9876543210.129));
    expect(money("")).toBe(localMoney(0));
    expect(money(null)).toBe(localMoney(0));
    expect(money(undefined)).toBe("");
    expect(money("not a number")).toBe("");
  });

  it("formats kWh boundary values", () => {
    expect(kwh(0)).toBe(localKwh(0));
    expect(kwh(-1234.56)).toBe(localKwh(-1234.56));
    expect(kwh(9876543210.9)).toBe(localKwh(9876543210.9));
    expect(kwh("")).toBe(localKwh(0));
    expect(kwh(null)).toBe(localKwh(0));
    expect(kwh(undefined)).toBe("");
    expect(kwh("not a number")).toBe("");
  });

  it("slugs names while preserving fallback behaviour", () => {
    expect(slug("Keizersgracht & Sons / Phase 2")).toBe("Keizersgracht_Sons_Phase_2");
    expect(slug("Äkzo HQ: North Wing")).toBe("Akzo_HQ_North_Wing");
    expect(slug("")).toBe("record");
    expect(slug(null, "property")).toBe("property");
  });

  it("quotes YAML scalars", () => {
    expect(yamlQuote("A \"quoted\" path \\ folder")).toBe("\"A 'quoted' path \\\\ folder\"");
    expect(yamlQuote("")).toBe("\"\"");
    expect(yamlQuote(null)).toBe("\"\"");
  });

  it("reads utility costs with expected defaults", () => {
    const property = {
      elec_cost_eur_per_kwh: "0.28",
      heating_cost_eur_per_kwh: "0.11",
      cooling_cost_eur_per_kwh: "0.08"
    };

    expect(utilityCost(property, "electricity")).toBe(0.28);
    expect(utilityCost(property, "heating")).toBe(0.11);
    expect(utilityCost(property, "cooling")).toBe(0.08);
    expect(utilityCost(property, "")).toBe(0.28);
    expect(utilityCost(null, "heating")).toBe(0);
  });

  it("keeps known equipment Brick mappings available", () => {
    expect(EQUIPMENT_TYPE_TO_BRICK_CLASS["Air Handling Unit"]).toBe("brick:AHU");
    expect(EQUIPMENT_TYPE_TO_BRICK_CLASS.Other).toBe("");
  });
});
