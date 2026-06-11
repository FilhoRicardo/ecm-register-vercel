import { describe, expect, it } from "vitest";
import {
  buildAdminTrackerMarkdown,
  buildEcmMarkdown,
  buildEquipmentMarkdown,
  buildMeetingMarkdown,
  buildMonthlyUsageMarkdown,
  buildPropertyNoteMarkdown,
  buildSavingMarkdown,
  buildTenantsMarkdown,
  extractMeetingSections,
  parseAdminTrackerMarkdown,
  parseEcmMarkdown,
  parseEquipmentMarkdown,
  parseMonthlyUsageMarkdown,
  parsePropertyFieldsTable,
  parseSavingMarkdown,
  parseTenantsMarkdown,
  replaceMeetingSections
} from "../src/lib/markdown.js";

const property = {
  id: 12,
  name: "Keizersgracht & Sons | North",
  address: "Herengracht 1, Amsterdam",
  total_floor_area: 12345.67,
  crrem_country: "Netherlands",
  crrem_property_type: "Office",
  heating_carrier: "natural_gas",
  cooling_carrier: "electric",
  renewable_consumed_kwh: 1000,
  renewable_exported_kwh: 200,
  heating_emission_factor_kgco2e_per_kwh: "",
  cooling_emission_factor_kgco2e_per_kwh: "",
  elec_cost_eur_per_kwh: 0.28,
  heating_cost_eur_per_kwh: 0.11,
  cooling_cost_eur_per_kwh: 0.28,
  notes: "Pipe | ampersand & accented Ä notes"
};

describe("markdown round trips", () => {
  it("round trips property field notes", () => {
    expect(parsePropertyFieldsTable(buildPropertyNoteMarkdown(property))).toEqual({
      id: "12",
      name: "Keizersgracht & Sons | North",
      address: "Herengracht 1, Amsterdam",
      total_floor_area: "12345.67",
      crrem_country: "Netherlands",
      crrem_property_type: "Office",
      heating_carrier: "natural_gas",
      cooling_carrier: "electric",
      renewable_consumed_kwh: "1000",
      renewable_exported_kwh: "200",
      elec_cost_eur_per_kwh: "0.28",
      heating_cost_eur_per_kwh: "0.11",
      cooling_cost_eur_per_kwh: "0.28",
      notes: "Pipe | ampersand & accented Ä notes"
    });
  });

  it("round trips tenant notes", () => {
    const tenants = [
      {
        id: 1,
        tenant_name: "North Anchor & Co.",
        tenant_location_id: "AMS-N-01",
        location_label: "Floors 1-4",
        tenant_floor_area: 4200,
        notes: "Primary tenant"
      },
      {
        id: 2,
        tenant_name: "Empty Optional Fields Ltd.",
        tenant_location_id: "",
        location_label: "",
        tenant_floor_area: "",
        notes: ""
      }
    ];

    expect(parseTenantsMarkdown(buildTenantsMarkdown(property, tenants))).toEqual({
      property_id: 12,
      property: "Keizersgracht & Sons | North",
      rows: [
        {
          id: 1,
          tenant_name: "North Anchor & Co.",
          tenant_location_id: "AMS-N-01",
          location_label: "Floors 1-4",
          tenant_floor_area: "4200",
          notes: "Primary tenant"
        },
        {
          id: 2,
          tenant_name: "Empty Optional Fields Ltd.",
          tenant_location_id: "",
          location_label: "",
          tenant_floor_area: "",
          notes: ""
        }
      ]
    });
  });

  it("round trips equipment notes", () => {
    const equipment = [
      {
        id: 3,
        equipment_name: "AHU-01 / North",
        tenant_name: "North Anchor & Co.",
        equipment_type: "Air Handling Unit",
        brick_class: "brick:AHU",
        utility_type: "electricity",
        dexma_location_id: "AMS-N-01",
        dexma_device_id: "AHU-01",
        notes: "Serves tenant floors"
      },
      {
        id: 4,
        equipment_name: "Whole-building meter",
        tenant_name: "",
        equipment_type: "Meter",
        brick_class: "brick:Meter",
        utility_type: "heating",
        dexma_location_id: "",
        dexma_device_id: "",
        notes: ""
      }
    ];

    expect(parseEquipmentMarkdown(buildEquipmentMarkdown(property, equipment))).toEqual({
      property_id: 12,
      property: "Keizersgracht & Sons | North",
      rows: [
        {
          id: 3,
          equipment_name: "AHU-01 / North",
          tenant_name: "North Anchor & Co.",
          equipment_type: "Air Handling Unit",
          brick_class: "brick:AHU",
          utility_type: "electricity",
          dexma_location_id: "AMS-N-01",
          dexma_device_id: "AHU-01",
          notes: "Serves tenant floors"
        },
        {
          id: 4,
          equipment_name: "Whole-building meter",
          tenant_name: "",
          equipment_type: "Meter",
          brick_class: "brick:Meter",
          utility_type: "heating",
          dexma_location_id: "",
          dexma_device_id: "",
          notes: ""
        }
      ]
    });
  });

  it("round trips monthly usage tables", () => {
    const usageRows = [
      {
        usage_month: "2025-01",
        scope_type: "building",
        electricity_kwh: 12345.678,
        heating_kwh: 456.7,
        cooling_kwh: "",
        notes: "Landlord reading | verified"
      },
      {
        usage_month: "2025-01",
        scope_type: "tenant",
        tenant_id: 8,
        tenant_name: "North Anchor & Co.",
        electricity_kwh: 987.65,
        heating_kwh: 0,
        cooling_kwh: 12,
        notes: ""
      }
    ];

    expect(parseMonthlyUsageMarkdown(buildMonthlyUsageMarkdown(property, usageRows))).toEqual({
      property_id: 12,
      property: "Keizersgracht & Sons | North",
      rows: [
        {
          usage_month: "2025-01",
          scope: "Landlord",
          scope_type: "building",
          electricity_kwh: 12345.68,
          heating_kwh: 456.7,
          cooling_kwh: 0,
          notes: "Landlord reading | verified"
        },
        {
          usage_month: "2025-01",
          scope: "North Anchor & Co.",
          scope_type: "tenant",
          electricity_kwh: 987.65,
          heating_kwh: 0,
          cooling_kwh: 12,
          notes: ""
        }
      ]
    });
  });

  it("round trips admin tracker tables", () => {
    expect(parseAdminTrackerMarkdown(buildAdminTrackerMarkdown(property, [
      {
        admin_year: 2025,
        admin_month: 1,
        docunite_report: "done",
        ecm_report: "open",
        pre_meeting_notes: "na",
        consumption_tracked: true,
        meeting_held: false,
        post_meeting_notes: "done",
        status_quo: "open",
        comments: "Client asked for follow-up | PM"
      },
      {
        admin_year: 2025,
        admin_month: 2,
        docunite_report: "open",
        ecm_report: "done",
        pre_meeting_notes: "done",
        consumption_tracked: "open",
        meeting_held: "na",
        post_meeting_notes: "open",
        status_quo: "done",
        comments: ""
      }
    ]))).toEqual({
      property_id: 12,
      property: "Keizersgracht & Sons | North",
      rows: [
        {
          admin_year: "2025",
          admin_month: 1,
          docunite_report: "done",
          ecm_report: "open",
          pre_meeting_notes: "na",
          consumption_tracked: "done",
          meeting_held: "open",
          post_meeting_notes: "done",
          status_quo: "open",
          comments: "Client asked for follow-up | PM"
        },
        {
          admin_year: "2025",
          admin_month: 2,
          docunite_report: "open",
          ecm_report: "done",
          pre_meeting_notes: "done",
          consumption_tracked: "open",
          meeting_held: "na",
          post_meeting_notes: "open",
          status_quo: "done",
          comments: ""
        }
      ]
    });
  });

  it("round trips ECM notes", () => {
    const ecm = {
      id: 5,
      property_id: 12,
      ref: "ECM-Å-01",
      title: "Optimise AHU schedules & valves",
      status: "Open",
      approved: true,
      utility_type: "electricity",
      investment_eur: "",
      energy_saving_kwh: 18000.5,
      created_at: "2025-01-02",
      updated_at: "2025-01-03",
      what_why: "Trim overnight runtime while preserving comfort.",
      pitfall: "Coordinate with tenant representatives.",
      action: "Review BMS trend data.",
      notes: ""
    };

    expect(parseEcmMarkdown(buildEcmMarkdown(ecm, property))).toEqual({
      property_id: 12,
      property: "Keizersgracht & Sons | North",
      ref: "ECM-Å-01",
      title: "Optimise AHU schedules & valves",
      status: "Open",
      approved: true,
      utility_type: "electricity",
      investment_eur: null,
      energy_saving_kwh: 18000.5,
      what_why: "Trim overnight runtime while preserving comfort.",
      pitfall: "Coordinate with tenant representatives.",
      action: "Review BMS trend data.",
      notes: ""
    });
  });

  it("round trips implemented saving notes", () => {
    const saving = {
      id: 7,
      ecm_id: 5,
      property_id: 12,
      ref: "ECM-Å-01",
      ecm_title: "Optimise AHU schedules & valves",
      utility_type: "electricity",
      start_date: "2025-01-01",
      end_date: "2025-12-31",
      energy_saving_kwh: 1234.56,
      unit_cost_eur_per_kwh: 0.28,
      cost_saving_eur: 345.68,
      notes: "Verified against monthly metering."
    };

    expect(parseSavingMarkdown(buildSavingMarkdown(saving, null, property))).toEqual({
      property_id: 12,
      property: "Keizersgracht & Sons | North",
      ecm_id: 5,
      ecm_ref: "ECM-Å-01",
      ecm_title: "Optimise AHU schedules & valves",
      utility_type: "electricity",
      start_date: "2025-01-01",
      end_date: "2025-12-31",
      energy_saving_kwh: 1234.56,
      unit_cost_eur_per_kwh: 0.28,
      cost_saving_eur: 345.68,
      notes: "Verified against monthly metering."
    });
  });

  it("extracts and replaces meeting sections", () => {
    const markdown = buildMeetingMarkdown({
      property,
      reportMonth: "2025-12",
      performance: {
        currentLabel: "Jan-Dec 2025",
        previousLabel: "Jan-Dec 2024",
        utilities: {
          electricity: { current: 10, previous: 12, diff: -2, percentDiff: -16.7 },
          heating: { current: 5, previous: 6, diff: -1, percentDiff: -16.7 },
          cooling: { current: 1, previous: 2, diff: -1, percentDiff: -50 }
        }
      },
      openEcms: [],
      preMeeting: "Discuss tenant comfort.",
      postMeeting: "Owner approved schedule change.",
      meetingDate: "2026-01-10"
    });

    expect(extractMeetingSections(markdown)).toEqual({
      pre: "Discuss tenant comfort.",
      post: "Owner approved schedule change."
    });

    expect(extractMeetingSections(replaceMeetingSections(markdown, {
      pre: "Updated pre-meeting note.",
      post: ""
    }))).toEqual({
      pre: "Updated pre-meeting note.",
      post: "_Add comments after the meeting._"
    });
  });
});

describe("markdown parser fixtures", () => {
  it("parses a realistic property note fixture with special characters and empty optional fields", () => {
    const note = `# Keizersgracht & Sons | North

<!-- ecm-register:property-fields:start -->
## ECM Register Property Fields

- **Database ID**: 12
- **Name**: Keizersgracht & Sons | North
- **Address**: Herengracht 1, Amsterdam
- **Total floor area m2**: 12345.67
- **CRREM country**: Netherlands
- **CRREM property type**: Office
- **Heating carrier**: natural_gas
- **Cooling carrier**: electric
- **On-site renewable consumed kWh/a**: 1000
- **On-site renewable exported kWh/a**: 
- **Heating emissions factor override**: 
- **Cooling emissions factor override**: 
- **Electricity cost EUR/kWh**: 0.28
- **Heating cost EUR/kWh**: 0.11
- **Cooling cost EUR/kWh**: 0.28
- **Notes**: Pipe | ampersand & accented Ä notes
<!-- ecm-register:property-fields:end -->
`;

    expect(parsePropertyFieldsTable(note)).toMatchObject({
      id: "12",
      name: "Keizersgracht & Sons | North",
      renewable_consumed_kwh: "1000",
      notes: "Pipe | ampersand & accented Ä notes"
    });
  });

  it("parses a realistic monthly usage fixture with escaped pipes and multiple rows", () => {
    const note = `---
record_type: monthly_usage
property: "[[Sample Tower]]"
property_id: 1
---

# Sample Tower - Monthly Usage

| Month | Scope | Electricity kWh | Heating kWh | Cooling kWh | Notes |
|---|---|---:|---:|---:|---|
| 2025-10 | Landlord | 21,500.00 | 14,500.00 | 900.00 | Actual read \\| checked |
| 2025-10 | North Anchor | 4,200.00 | 800.00 | 120.00 |  |
`;

    expect(parseMonthlyUsageMarkdown(note)).toEqual({
      property_id: 1,
      property: "Sample Tower",
      rows: [
        {
          usage_month: "2025-10",
          scope: "Landlord",
          scope_type: "building",
          electricity_kwh: 21500,
          heating_kwh: 14500,
          cooling_kwh: 900,
          notes: "Actual read | checked"
        },
        {
          usage_month: "2025-10",
          scope: "North Anchor",
          scope_type: "tenant",
          electricity_kwh: 4200,
          heating_kwh: 800,
          cooling_kwh: 120,
          notes: ""
        }
      ]
    });
  });

  it("parses a realistic equipment fixture with empty optional fields", () => {
    const note = `---
record_type: equipment
property: "[[Sample Tower]]"
property_id: 1
---

# Sample Tower - Equipment

- **AHU-01**
  - Database ID: 2
  - Tenant: Whole property
  - Type: Air Handling Unit
  - Brick class: brick:AHU
  - Utility: electricity
  - DEXMA location ID: 
  - DEXMA device ID: AHU-01
  - Notes: Serves floors 1-4
- **Heat meter & valve**
  - Database ID: 
  - Tenant: North Anchor
  - Type: Meter
  - Brick class: brick:Meter
  - Utility: heating
  - DEXMA location ID: AMS-N-01
  - DEXMA device ID: 
  - Notes: 
`;

    expect(parseEquipmentMarkdown(note)).toEqual({
      property_id: 1,
      property: "Sample Tower",
      rows: [
        {
          id: 2,
          equipment_name: "AHU-01",
          tenant_name: "",
          equipment_type: "Air Handling Unit",
          brick_class: "brick:AHU",
          utility_type: "electricity",
          dexma_location_id: "",
          dexma_device_id: "AHU-01",
          notes: "Serves floors 1-4"
        },
        {
          id: null,
          equipment_name: "Heat meter & valve",
          tenant_name: "North Anchor",
          equipment_type: "Meter",
          brick_class: "brick:Meter",
          utility_type: "heating",
          dexma_location_id: "AMS-N-01",
          dexma_device_id: "",
          notes: ""
        }
      ]
    });
  });
});

describe("markdown malformed input handling", () => {
  it("does not throw uncaught errors on malformed or partial markdown", () => {
    const malformed = [
      "",
      "# Partial note\n| Month | Scope |\n| broken",
      "---\nrecord_type: ecm\nproperty_id:\n---\n# Heading only",
      "<!-- ecm-register:property-fields:start -->\n| Field | Value |\n|---|---|\n| Name"
    ];

    const parsers = [
      parsePropertyFieldsTable,
      parseTenantsMarkdown,
      parseEquipmentMarkdown,
      parseAdminTrackerMarkdown,
      parseMonthlyUsageMarkdown,
      parseEcmMarkdown,
      parseSavingMarkdown,
      extractMeetingSections
    ];

    for (const parser of parsers) {
      for (const markdown of malformed) {
        expect(() => parser(markdown)).not.toThrow();
      }
    }
  });
});
