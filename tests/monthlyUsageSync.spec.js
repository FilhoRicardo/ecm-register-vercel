import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteMonthlyUsageFromSupabase,
  syncMonthlyUsageToSupabase
} from "../src/lib/monthlyUsageSync.js";

describe("monthly usage Supabase sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shapes upsert payloads for the sync endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, id: 42 })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncMonthlyUsageToSupabase({
      id: "7",
      property_id: "3",
      tenant_id: "",
      scope_type: "",
      usage_month: "2025-11",
      electricity_kwh: "123.4",
      heating_kwh: "",
      cooling_kwh: "5.6",
      notes: ""
    }, { token: "sync-token" })).resolves.toEqual({ ok: true, id: 42 });

    expect(fetchMock).toHaveBeenCalledWith("/api/monthly-usage-sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer sync-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "upsert",
        row: {
          id: 7,
          property_id: 3,
          tenant_id: null,
          scope_type: "building",
          usage_month: "2025-11",
          electricity_kwh: 123.4,
          heating_kwh: 0,
          cooling_kwh: 5.6,
          notes: ""
        }
      })
    });
  });

  it("shapes delete payloads for the sync endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, deleted: true })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteMonthlyUsageFromSupabase("9", { token: "sync-token" })).resolves.toEqual({ ok: true, deleted: true });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "delete",
      id: 9
    });
  });

  it("returns the UI-surfaced skipped result when no token is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncMonthlyUsageToSupabase({ id: 1 }, {})).resolves.toEqual({
      skipped: true,
      reason: "No Supabase sync token configured."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces network fetch failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(syncMonthlyUsageToSupabase({ id: 1 }, { token: "sync-token" })).rejects.toThrow("network down");
  });

  it("surfaces non-200 sync responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "Supabase unavailable" })
    })));

    await expect(syncMonthlyUsageToSupabase({ id: 1 }, { token: "sync-token" })).rejects.toThrow("Supabase unavailable");
  });
});
