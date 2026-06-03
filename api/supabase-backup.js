import { createClient } from "@supabase/supabase-js";

const DEFAULT_BUCKET = "ecm-register-backups";
const DEFAULT_PREFIX = "ecm-register";

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
      res.status(401).json({ error: "Invalid backup token." });
      return;
    }

    const bytes = await readRequestBody(req);
    if (!bytes.length) {
      res.status(400).json({ error: "Backup payload is empty." });
      return;
    }

    const bucket = process.env.SUPABASE_BACKUP_BUCKET || DEFAULT_BUCKET;
    const prefix = cleanPath(process.env.SUPABASE_BACKUP_PREFIX || DEFAULT_PREFIX);
    const filename = cleanFilename(req.headers["x-backup-filename"] || `ecm_register_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    const path = `${prefix}/${filename}`;
    const latestPath = `${prefix}/latest/ecm_register_latest.db`;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    await ensureBucket(supabase, bucket);
    await uploadObject(supabase, bucket, path, bytes, false);
    await uploadObject(supabase, bucket, latestPath, bytes, true);

    res.status(200).json({
      ok: true,
      bucket,
      path,
      latestPath,
      size: bytes.length
    });
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

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function ensureBucket(supabase, bucket) {
  const { error } = await supabase.storage.getBucket(bucket);
  if (!error) return;
  const created = await supabase.storage.createBucket(bucket, { public: false });
  if (created.error) throw created.error;
}

async function uploadObject(supabase, bucket, path, bytes, upsert) {
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: "application/x-sqlite3",
    upsert
  });
  if (error) throw error;
}

function cleanPath(value) {
  return String(value || DEFAULT_PREFIX)
    .split("/")
    .map((part) => cleanFilename(part))
    .filter(Boolean)
    .join("/") || DEFAULT_PREFIX;
}

function cleanFilename(value) {
  return String(value || "")
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
}
