import { nowStamp, slug } from "./format.js";
import { writeFile } from "./storage.js";

export async function writeTextIntoFolder(folderHandle, filename, content) {
  if (!folderHandle) throw new Error("Folder is not configured.");
  const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
  await writeFile(fileHandle, content);
  return filename;
}

export async function routeCalculationFile(folderHandle, { file, property, ecm }) {
  if (!folderHandle || !file) return null;
  const ext = extension(file.name);
  const stored = `${nowStamp()}_${slug(property?.name, "Property")}_${slug(ecm.ref || `ECM_${ecm.id}`)}_${slug(file.name.replace(/\.[^.]+$/, ""), "Calculation")}${ext}`;
  const fileHandle = await folderHandle.getFileHandle(stored, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return {
    original_filename: file.name,
    stored_filename: stored,
    relative_path: stored,
    content_type: file.type || "",
    file_size: file.size || 0
  };
}

export async function listMarkdownFiles(folderHandle) {
  if (!folderHandle) return [];
  const out = [];
  for await (const [name, handle] of folderHandle.entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".md")) {
      const file = await handle.getFile();
      out.push({ name, handle, text: await file.text(), lastModified: file.lastModified });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function extension(name) {
  const match = String(name || "").match(/(\.[a-zA-Z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : "";
}
