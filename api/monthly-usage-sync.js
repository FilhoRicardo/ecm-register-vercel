import { createClient } from "@supabase/supabase-js";

const TABLE = "monthly_utility_usage";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    requireEnv("BACKUP_UPLOAD_TOKEN");

    const token = authToken(req);
    if (!token || token !== process.env.BACKUP_UPLOAD_TOKEN) {
      res.status(401).json({ error: "Invalid sync token." });
      return;
    }

    const payload = await readJsonBody(req);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (payload.action === "delete") {
      const id = Number(payload.id);
      if (!Number.isFinite(id) || id <= 0) throw new Error("Monthly usage id is required.");
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      res.status(200).json({ ok: true, action: "delete", id });
      return;
    }

    if (payload.action !== "upsert") throw new Error("Unsupported monthly usage sync action.");
    const row = normaliseMonthlyUsageRow(payload.row);
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "id" });
    if (error) throw error;
    res.status(200).json({ ok: true, action: "upsert", id: row.id });
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`${name} is not configured.`);
}

function authToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function normaliseMonthlyUsageRow(row = {}) {
  const id = Number(row.id);
  const propertyId = Number(row.property_id);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Monthly usage id is required.");
  if (!Number.isFinite(propertyId) || propertyId <= 0) throw new Error("Monthly usage property_id is required.");
  if (!row.usage_month) throw new Error("Monthly usage month is required.");

  return {
    id,
    property_id: propertyId,
    tenant_id: row.tenant_id ? Number(row.tenant_id) : null,
    scope_type: row.scope_type || "building",
    usage_month: row.usage_month,
    electricity_kwh: Number(row.electricity_kwh || 0),
    heating_kwh: Number(row.heating_kwh || 0),
    cooling_kwh: Number(row.cooling_kwh || 0),
    notes: row.notes || "",
    updated_at: new Date().toISOString()
  };
}
