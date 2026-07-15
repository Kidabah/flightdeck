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
  return !!window.isSecureContext && typeof window.showDirectoryPicker === "function";
}

export function folderExportBlockedReason() {
  if (folderExportSupported()) return "";
  if (!window.isSecureContext) {
    return "Folder export needs a secure connection (https://). A ZIP will download instead.";
  }
  return "This browser can't save folders directly. A ZIP will download instead.";
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

/** Call from Export dialog submit (user click) before any async mesh work. */
export async function prepareExportFolderAccess() {
  let handle = await loadRootHandle();
  if (handle && await ensureWritePermission(handle)) return handle;
  handle = await pickDownloadsRoot();
  return handle;
}

function normalizeFolderName(raw) {
  let name = String(raw || "").trim().replace(/[/\\?%*:|"<>]/g, "-");
  name = name.replace(/\.zip$/i, "");
  name = name.replace(/^[/\\]+|[/\\]+$/g, "");
  return name || "makerdeck-export";
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array(data);
}

function normalizeFolderFiles(files) {
  return files.map((file) => ({
    name: String(file.name).replace(/^[/\\]+/, ""),
    data: toBytes(file.data),
  }));
}

export function sanitizeExportFolderName(raw) {
  return normalizeFolderName(raw);
}

/** Write files into `{downloadsRoot}/{folderName}/`. Requires handle from prepareExportFolderAccess(). */
export async function saveFilesToExportFolder(folderName, files, rootHandle) {
  if (!rootHandle) throw new Error("No export folder access");
  const safeName = normalizeFolderName(folderName);
  const dir = await rootHandle.getDirectoryHandle(safeName, { create: true });
  const entries = normalizeFolderFiles(files);
  for (const file of entries) {
    const fh = await dir.getFileHandle(file.name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(file.data);
    await writable.close();
  }
  const rootLabel = rootHandle.name || "Downloads";
  return {
    folderName: safeName,
    rootLabel,
    fileCount: entries.length,
    fileNames: entries.map((f) => f.name),
  };
}

export function isFolderExportCancelled(err) {
  return err?.name === "AbortError" || err?.name === "NotAllowedError";
}
