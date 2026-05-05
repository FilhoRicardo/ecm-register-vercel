import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.resolve(root, process.argv[2] || "../ecm_register_app/ecm_register.db");
const target = path.resolve(root, process.env.LOCAL_SQLITE_PATH || "data/ecm_register.db");

if (!fs.existsSync(source)) {
  console.error(`Source database not found: ${source}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });

if (fs.existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${target}.${stamp}.bak`;
  fs.copyFileSync(target, backup);
  console.log(`Existing local database backed up to: ${backup}`);
}

fs.copyFileSync(source, target);

console.log(`Copied Streamlit database`);
console.log(`From: ${source}`);
console.log(`To:   ${target}`);
