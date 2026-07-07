/** MakerDeck design library — auto-save exports for reloading prior designs. */

export function libraryApiAvailable() {
  return window.location.protocol !== "file:" && window.location.origin.length > 0;
}

export function capturePreviewThumbnail(renderer) {
  if (!renderer?.domElement) return "";
  try {
    return renderer.domElement.toDataURL("image/jpeg", 0.82);
  } catch {
    return "";
  }
}

export async function saveExportToLibrary({ blob, filename, format, part, state, stamp, thumbnail, traceImage }) {
  if (!libraryApiAvailable() || !blob) return null;
  const form = new FormData();
  form.append("file", blob, filename);
  form.append(
    "meta",
    JSON.stringify({
      name: filename.replace(/\.[^.]+$/, ""),
      format,
      part,
      exported_at: new Date().toISOString(),
      watermark_serial: stamp?.serial ?? null,
      thumbnail: thumbnail || "",
      state: state || {},
      traceImage: traceImage || null,
    }),
  );
  const res = await fetch("/api/makerdeck/exports", { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Design library save failed (${res.status})`);
  }
  return res.json();
}

export async function listLibraryDesigns(limit = 50) {
  if (!libraryApiAvailable()) return [];
  const res = await fetch(`/api/makerdeck/designs?limit=${limit}`);
  if (!res.ok) throw new Error(`Could not load design library (${res.status})`);
  const payload = await res.json();
  return Array.isArray(payload?.designs) ? payload.designs : [];
}

export async function fetchDesignParams(designId) {
  const res = await fetch(`/api/makerdeck/designs/${encodeURIComponent(designId)}/params`);
  if (!res.ok) throw new Error(`Could not load design (${res.status})`);
  return res.json();
}

export async function deleteLibraryDesign(designId) {
  const res = await fetch(`/api/makerdeck/designs/${encodeURIComponent(designId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Could not delete design (${res.status})`);
  return res.json();
}
