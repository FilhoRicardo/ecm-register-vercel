const DEFAULT_MONTHLY_USAGE_SYNC_ENDPOINT = "/api/monthly-usage-sync";

export async function syncMonthlyUsageToSupabase(row, settings = {}) {
  if (!row) return { skipped: true };
  return sendMonthlyUsageSync({
    action: "upsert",
    row: normaliseMonthlyUsageRow(row)
  }, settings);
}

export async function deleteMonthlyUsageFromSupabase(id, settings = {}) {
  if (!id) return { skipped: true };
  return sendMonthlyUsageSync({
    action: "delete",
    id: Number(id)
  }, settings);
}

async function sendMonthlyUsageSync(payload, settings) {
  const token = settings?.token || "";
  if (!token) return { skipped: true, reason: "No Supabase sync token configured." };

  const response = await fetch(DEFAULT_MONTHLY_USAGE_SYNC_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Supabase monthly usage sync failed with HTTP ${response.status}.`);
  }
  return data;
}

function normaliseMonthlyUsageRow(row) {
  return {
    id: Number(row.id),
    property_id: Number(row.property_id),
    tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
    scope_type: row.scope_type || "building",
    usage_month: row.usage_month || "",
    electricity_kwh: Number(row.electricity_kwh || 0),
    heating_kwh: Number(row.heating_kwh || 0),
    cooling_kwh: Number(row.cooling_kwh || 0),
    notes: row.notes || ""
  };
}
