/** Save multi-file exports as a folder (File System Access API). Falls back to ZIP elsewhere. */

const IDB_NAME = "makerdeck-export-v1";
const IDB_STORE = "handles";
const DOWNLOADS_ROOT_KEY = "downloads-root";

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadRootHandle() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(DOWNLOADS_ROOT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function storeRootHandle(handle) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, DOWNLOADS_ROOT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function folderExportSupported() {
  return typeof window.showDirectoryPicker === "function";
}

async function ensureWritePermission(handle) {
  if (!handle?.queryPermission) return false;
  let perm = await handle.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return true;
  if (!handle.requestPermission) return false;
  perm = await handle.requestPermission({ mode: "readwrite" });
  return perm === "granted";
}

async function pickDownloadsRoot() {
  const handle = await window.showDirectoryPicker({
    mode: "readwrite",
    startIn: "downloads",
  });
  await storeRootHandle(handle);
  return handle;
}

async function getDownloadsRoot({ promptIfNeeded = true } = {}) {
  let handle = await loadRootHandle();
  if (handle && await ensureWritePermission(handle)) return handle;
  if (!promptIfNeeded) return null;
  return pickDownloadsRoot();
}

function normalizeFolderName(raw) {
  let name = String(raw || "").trim().replace(/[/\\?%*:|"<>]/g, "-");
  name = name.replace(/\.zip$/i, "");
  name = name.replace(/^[/\\]+|[/\\]+$/g, "");
  return name || "makerdeck-export";
}

function normalizeFolderFiles(files) {
  return files.map((file) => ({
    name: String(file.name).replace(/^[/\\]+/, ""),
    data: file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data),
  }));
}

export function sanitizeExportFolderName(raw) {
  return normalizeFolderName(raw);
}

/** Write files into `{downloadsRoot}/{folderName}/`. Prompts once to pick Downloads. */
export async function saveFilesToExportFolder(folderName, files) {
  const root = await getDownloadsRoot();
  const safeName = normalizeFolderName(folderName);
  const dir = await root.getDirectoryHandle(safeName, { create: true });
  const entries = normalizeFolderFiles(files);
  for (const file of entries) {
    const fh = await dir.getFileHandle(file.name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(file.data);
    await writable.close();
  }
  return { folderName: safeName, fileCount: entries.length, fileNames: entries.map((f) => f.name) };
}

export function isFolderExportCancelled(err) {
  return err?.name === "AbortError" || err?.name === "NotAllowedError";
}
