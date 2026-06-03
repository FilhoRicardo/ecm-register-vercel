import { idbGet, idbSet } from "./storage.js";

const SETTINGS_KEY = "supabase_backup_settings";

export const DEFAULT_SUPABASE_BACKUP_SETTINGS = {
  enabled: false,
  endpoint: "/api/supabase-backup",
  token: "",
  intervalHours: "24",
  lastBackupAt: "",
  lastBackupPath: "",
  lastBackupError: ""
};

export async function loadSupabaseBackupSettings() {
  const saved = await idbGet(SETTINGS_KEY);
  return { ...DEFAULT_SUPABASE_BACKUP_SETTINGS, ...(saved || {}) };
}

export async function saveSupabaseBackupSettings(settings) {
  const next = { ...DEFAULT_SUPABASE_BACKUP_SETTINGS, ...settings };
  await idbSet(SETTINGS_KEY, next);
  return next;
}

export function backupDue(settings, now = new Date()) {
  if (!settings?.enabled) return false;
  if (!settings.endpoint || !settings.token) return false;
  const hours = Number(settings.intervalHours || 0);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  if (!settings.lastBackupAt) return true;
  const last = new Date(settings.lastBackupAt);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= hours * 60 * 60 * 1000;
}

export async function uploadSupabaseBackup(db, settings, metadata = {}) {
  if (!db) throw new Error("Load a database before backing up to Supabase.");
  if (!settings?.endpoint) throw new Error("Supabase backup endpoint is required.");
  if (!settings?.token) throw new Error("Backup token is required.");

  const timestamp = new Date().toISOString();
  const filename = `ecm_register_backup_${timestamp.replace(/[:.]/g, "-")}.db`;
  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.token}`,
      "Content-Type": "application/octet-stream",
      "X-Backup-Filename": filename,
      "X-Backup-Created-At": timestamp,
      "X-Backup-Metadata": JSON.stringify(metadata)
    },
    body: db.export()
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Supabase backup failed with HTTP ${response.status}.`);
  }
  return {
    ...payload,
    filename,
    createdAt: timestamp
  };
}
