const $ = (id) => document.getElementById(id);

let folders = [];
let selectedId = null;
let activeKind = "";
let libraryItems = [];
let selectedIds = new Set();
/** Last file selected without Shift — used as the start of a Shift range. */
let lastSelectAnchorId = null;
let browseMode = "folders"; // folders | all
let browseRootId = null;
let browseFolder = "";
let scanWatchTimer = null;
let scanWatchTicks = 0;
let lastScanRunning = false;
let lastThumbsRunning = false;
let statusPollTimer = null;
let psModalResolver = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** PrintShelf toast — replaces browser alert(). */
function psToast(title, detail = "", kind = "info", ms = 4200) {
  const host = $("psToasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `ps-toast ${kind === "ok" || kind === "error" ? kind : ""}`.trim();
  el.innerHTML = `
    <div class="ps-toast-mark">PS</div>
    <div class="ps-toast-copy">
      <p class="ps-toast-title">${escapeHtml(title)}</p>
      ${detail ? `<p class="ps-toast-detail">${escapeHtml(detail)}</p>` : ""}
    </div>
    <button type="button" class="ps-toast-close" aria-label="Dismiss">×</button>`;
  const dismiss = () => {
    if (el.classList.contains("leaving")) return;
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector(".ps-toast-close")?.addEventListener("click", dismiss);
  host.appendChild(el);
  if (ms > 0) setTimeout(dismiss, ms);
}

/** PrintShelf confirm modal — replaces browser confirm(). */
function psConfirm({
  title = "Confirm",
  body = "",
  eyebrow = "Confirm",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  const root = $("psModalRoot");
  if (!root) {
    const plain = `${title}\n\n${String(body).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")}`;
    return Promise.resolve(window.confirm(plain));
  }
  if (psModalResolver) {
    psModalResolver(false);
    psModalResolver = null;
  }
  $("psModalEyebrow").textContent = eyebrow;
  $("psModalTitle").textContent = title;
  $("psModalBody").innerHTML = body;
  const confirmBtn = $("psModalConfirm");
  const cancelBtn = $("psModalCancel");
  confirmBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  confirmBtn.classList.toggle("danger", !!danger);
  confirmBtn.classList.toggle("card-open", true);
  root.hidden = false;
  confirmBtn.focus();
  return new Promise((resolve) => {
    psModalResolver = (value) => {
      root.hidden = true;
      psModalResolver = null;
      resolve(value);
    };
  });
}

function closePsModal(value) {
  if (psModalResolver) psModalResolver(value);
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fileCountLabel(n) {
  const count = Number(n) || 0;
  return count === 1 ? "1 file" : `${count} files`;
}

function idsForAction(fallbackId) {
  /** Prefer multi-select; otherwise the open detail asset. */
  if (selectedIds.size > 0) return [...selectedIds];
  if (fallbackId != null) return [Number(fallbackId)];
  return [];
}

async function hideIds(ids) {
  if (!ids.length) return;
  if (ids.length === 1) {
    await api(`/api/assets/${ids[0]}/hide`, { method: "POST", body: "{}" });
  } else {
    await api("/api/assets/bulk/hide", { method: "POST", body: JSON.stringify({ ids }) });
  }
  clearSelection();
  selectedId = null;
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  $("detail").innerHTML = `<div class="detail-empty">Hidden ${fileCountLabel(ids.length)} from library. Use “Show hidden” to find ${ids.length === 1 ? "it" : "them"} again.</div>`;
  await refreshStats();
  await loadLibrary();
}

async function unhideIds(ids) {
  if (!ids.length) return;
  if (ids.length === 1) {
    await api(`/api/assets/${ids[0]}/unhide`, { method: "POST", body: "{}" });
  } else {
    await api("/api/assets/bulk/unhide", { method: "POST", body: JSON.stringify({ ids }) });
  }
  clearSelection();
  await refreshStats();
  await loadLibrary();
}

async function deleteIdsFromDisk(ids, { names = [] } = {}) {
  if (!ids.length) return;
  const label = fileCountLabel(ids.length);
  const sample = names.filter(Boolean).slice(0, 8);
  const more = ids.length > sample.length
    ? `<br>…and ${ids.length - sample.length} more`
    : "";
  const listBit = sample.length
    ? `<br><br><strong>${sample.map(escapeHtml).join("<br>")}</strong>${more}`
    : `<br><br>${escapeHtml(label)} will be removed from the NAS/disk and the library.`;
  const ok = await psConfirm({
    eyebrow: "Destructive action",
    title: `Delete ${label} from disk?`,
    body: `This permanently removes the file${ids.length === 1 ? "" : "s"} from disk and the library.${listBit}<br><br>This cannot be undone.`,
    confirmLabel: "Delete permanently",
    danger: true,
  });
  if (!ok) return false;
  const ok2 = await psConfirm({
    eyebrow: "Last check",
    title: "Delete for real?",
    body: `Confirm once more: permanently delete <strong>${escapeHtml(label)}</strong> from disk.`,
    confirmLabel: "Yes, delete",
    danger: true,
  });
  if (!ok2) return false;

  let deletedCount = 0;
  let failed = [];
  if (ids.length === 1) {
    await api(`/api/assets/${ids[0]}/delete`, { method: "POST", body: "{}" });
    deletedCount = 1;
  } else {
    const res = await api("/api/assets/bulk/delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    deletedCount = res.deleted_count || 0;
    failed = res.failed || [];
  }
  clearSelection();
  selectedId = null;
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  $("detail").innerHTML = `<div class="detail-empty">Deleted ${fileCountLabel(deletedCount)} from disk${failed.length ? ` · ${failed.length} failed` : ""}.</div>`;
  if (failed.length) {
    psToast(
      `Deleted ${deletedCount}, ${failed.length} failed`,
      failed.slice(0, 8).map((f) => `${f.id}: ${f.error}`).join("\n"),
      "error",
      8000,
    );
  } else {
    psToast("Deleted from disk", fileCountLabel(deletedCount), "ok");
  }
  await refreshStats();
  await loadLibrary();
  return true;
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("hidden", el.id !== `view-${name}`));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === name));
}

function updateTypeTabCounts(byKind, total) {
  document.querySelectorAll(".type-count").forEach((el) => {
    const key = el.dataset.countFor || "";
    el.textContent = String(key ? (byKind[key] || 0) : (total || 0));
  });
}

function updateScanBanner(scan, byKind, totalAssets) {
  const banner = $("scanBanner");
  if (!banner) return;
  const running = !!(scan && scan.running);
  banner.hidden = !running;
  if (!running) return;
  const where = scan.current_path ? scan.current_path : "walking folders…";
  $("scanBannerTitle").textContent = "Scanning library…";
  $("scanBannerDetail").textContent =
    `${scan.files_seen || 0} seen · ${scan.files_upserted || 0} new · ${scan.files_skipped || 0} unchanged`
    + (scan.files_failed ? ` · ${scan.files_failed} failed` : "")
    + ` · ${where}`;
  const order = ["zip", "stl", "obj", "3mf", "gcode.3mf"];
  const parts = order
    .filter((k) => byKind[k] != null)
    .map((k) => `<span class="pill">${escapeHtml(k)} ${byKind[k]}</span>`);
  if (totalAssets != null) {
    parts.unshift(`<span class="pill">all ${totalAssets}</span>`);
  }
  $("scanBannerKinds").innerHTML = parts.join("");
}

function formatStatusLine(scan, thumbs) {
  const bits = [];
  if (scan?.running) {
    const where = scan.current_path ? ` · ${scan.current_path}` : "";
    bits.push(
      `Scanning… ${scan.files_seen || 0} seen / ${scan.files_upserted || 0} new / ${scan.files_skipped || 0} unchanged${where}`,
    );
  }
  if (thumbs?.running) {
    bits.push(`Thumbs… ${thumbs.updated || 0}/${thumbs.checked || 0}`);
  }
  if (bits.length) return bits.join(" · ");
  if (thumbs?.status === "ok" && thumbs.updated) {
    return `Thumbs rebuilt: ${thumbs.updated}`
      + (scan?.status === "ok"
        ? ` · Last scan: ${scan.files_upserted || 0} new / ${scan.files_seen || 0} total`
        : "");
  }
  if (scan?.status === "ok") {
    return `Last scan: ${scan.files_upserted || 0} new · ${scan.files_skipped || 0} unchanged · ${scan.files_seen || 0} total`
      + (scan.files_failed ? ` · ${scan.files_failed} failed` : "");
  }
  return scan?.status || thumbs?.status || "idle";
}

function ensureStatusWatch(scanRunning, thumbsRunning) {
  const need = !!(scanRunning || thumbsRunning);
  if (need && !statusPollTimer) {
    scanWatchTicks = 0;
    statusPollTimer = setInterval(() => {
      watchStatusTick().catch(console.error);
    }, 2000);
  }
  if (!need && statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  // Keep legacy alias in sync for any stray references.
  scanWatchTimer = statusPollTimer;
}

async function refreshLibraryView({ reloadGrid = true } = {}) {
  await refreshStats();
  if (reloadGrid) await loadLibrary();
}

async function watchStatusTick() {
  const live = $("scanLiveRefresh");
  const s = await api("/api/stats");
  const scan = s.scan || {};
  const thumbs = s.thumbs || {};
  const byKind = s.by_kind || {};
  const kinds = Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no files yet";
  const hiddenBit = s.hidden ? `<br><span class="pill">hidden ${s.hidden}</span>` : "";
  $("railStats").innerHTML = `<strong>${s.assets}</strong> assets<br>${kinds}${hiddenBit}`;
  updateTypeTabCounts(byKind, s.assets || 0);
  updateScanBanner(scan, byKind, s.assets || 0);
  $("scanStatus").textContent = formatStatusLine(scan, thumbs);

  scanWatchTicks += 1;
  // Reload the grid every ~10s while a scan is live (not during thumbs-only).
  if (live?.checked && scan.running && scanWatchTicks % 5 === 0) {
    await loadLibrary({ preserveScroll: true });
  }

  const scanWas = lastScanRunning;
  const thumbsWas = lastThumbsRunning;
  lastScanRunning = !!scan.running;
  lastThumbsRunning = !!thumbs.running;

  if (!scan.running && !thumbs.running) {
    ensureStatusWatch(false, false);
    $("scanBtn").disabled = false;
    $("rebuildThumbsBtn").disabled = false;
    if (scanWas || thumbsWas) {
      await loadLibrary({ preserveScroll: true });
    }
  } else {
    ensureStatusWatch(!!scan.running, !!thumbs.running);
  }
}

async function refreshStats() {
  const s = await api("/api/stats");
  const byKind = s.by_kind || {};
  const kinds = Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no files yet";
  const hiddenBit = s.hidden ? `<br><span class="pill">hidden ${s.hidden}</span>` : "";
  $("railStats").innerHTML = `<strong>${s.assets}</strong> assets<br>${kinds}${hiddenBit}`;
  updateTypeTabCounts(byKind, s.assets || 0);
  const scan = s.scan || {};
  const thumbs = s.thumbs || {};
  updateScanBanner(scan, byKind, s.assets || 0);
  ensureStatusWatch(!!scan.running, !!thumbs.running);
  lastScanRunning = !!scan.running;
  lastThumbsRunning = !!thumbs.running;
  $("scanStatus").textContent = formatStatusLine(scan, thumbs);
}

function setActiveKind(kind) {
  activeKind = kind || "";
  document.querySelectorAll(".type-tab").forEach((btn) => {
    const on = (btn.dataset.kind || "") === activeKind;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function updateBulkBar() {
  const bar = $("bulkBar");
  if (!bar) return;
  const n = selectedIds.size;
  bar.hidden = n === 0;
  if ($("bulkCount")) $("bulkCount").textContent = `${n} selected`;
}

function syncSelectionUi() {
  document.querySelectorAll(".card:not(.folder-card)").forEach((card) => {
    const id = Number(card.dataset.id);
    const on = selectedIds.has(id);
    card.classList.toggle("selected", on);
    const cb = card.querySelector(".card-check");
    if (cb) cb.checked = on;
  });
  updateBulkBar();
}

function libraryIndexOf(id) {
  const num = Number(id);
  return libraryItems.findIndex((x) => Number(x.id) === num);
}

function toggleSelected(id, on, { setAnchor = true } = {}) {
  const num = Number(id);
  if (on) selectedIds.add(num);
  else selectedIds.delete(num);
  const card = document.querySelector(`.card[data-id="${num}"]`);
  if (card) {
    card.classList.toggle("selected", on);
    const cb = card.querySelector(".card-check");
    if (cb) cb.checked = on;
  }
  if (setAnchor) lastSelectAnchorId = num;
  updateBulkBar();
}

/** Select every visible file from anchor → target (inclusive). Shift alone replaces; Ctrl/Cmd+Shift adds. */
function selectRangeInclusive(fromId, toId, { additive = false } = {}) {
  const a = libraryIndexOf(fromId);
  const b = libraryIndexOf(toId);
  if (a < 0 || b < 0) {
    toggleSelected(toId, true);
    return;
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!additive) selectedIds.clear();
  for (let i = lo; i <= hi; i++) {
    selectedIds.add(Number(libraryItems[i].id));
  }
  // Keep the original anchor so further Shift-clicks extend from the same top/start.
  if (lastSelectAnchorId == null) lastSelectAnchorId = Number(fromId);
  syncSelectionUi();
}

function clearSelection() {
  selectedIds.clear();
  lastSelectAnchorId = null;
  document.querySelectorAll(".card.selected").forEach((c) => c.classList.remove("selected"));
  document.querySelectorAll(".card-check").forEach((cb) => { cb.checked = false; });
  updateBulkBar();
}

function filterParams() {
  const params = new URLSearchParams();
  const q = $("search").value.trim();
  if (q) params.set("q", q);
  if (activeKind) params.set("kind", activeKind);
  const source = $("filterSource").value;
  if (source) params.set("source_kind", source);
  if ($("filterTextures").checked) params.set("has_textures", "true");
  if ($("filterSliced").checked) params.set("is_sliced", "true");
  if ($("filterHidden")?.checked) params.set("hidden", "true");
  else params.set("hidden", "false");
  return params;
}

function renderCrumbs(crumbs) {
  const el = $("crumbs");
  if (!el) return;
  if (browseMode !== "folders" || !crumbs?.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = crumbs.map((c, i) => {
    const btn = `<button type="button" class="crumb" data-root="${escapeHtml(c.root_id || "")}" data-folder="${escapeHtml(c.folder || "")}">${escapeHtml(c.label)}</button>`;
    return i ? `<span class="crumb-sep">/</span>${btn}` : btn;
  }).join("");
  el.querySelectorAll(".crumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const root = btn.dataset.root || "";
      browseRootId = root || null;
      browseFolder = btn.dataset.folder || "";
      clearSelection();
      loadLibrary().catch(console.error);
    });
  });
}

function appendFolderCard(grid, { title, meta, onOpen }) {
  const card = document.createElement("article");
  card.className = "card folder-card";
  card.innerHTML = `
    <div class="card-thumb"><span class="folder-mark">▣</span></div>
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(title)}</h3>
      <div class="card-meta">${meta}</div>
    </div>`;
  card.addEventListener("click", onOpen);
  grid.appendChild(card);
}

function appendAssetCard(grid, item) {
  const card = document.createElement("article");
  const checked = selectedIds.has(item.id);
  card.className = "card"
    + (item.id === selectedId ? " active" : "")
    + (checked ? " selected" : "");
  card.dataset.id = String(item.id);
  card.innerHTML = `
    <input type="checkbox" class="card-check" ${checked ? "checked" : ""} aria-label="Select ${escapeHtml(item.file_name)}">
    <div class="card-thumb">${item.thumb_path
      ? `<img src="/api/thumbs/${encodeURIComponent(item.thumb_path)}?v=${encodeURIComponent((item.content_hash || item.thumb_path).slice(0, 12))}" alt="" loading="lazy">`
      : `<span class="pill">${escapeHtml(item.kind)}</span>`}</div>
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(item.file_name)}</h3>
      <div class="card-meta">
        <span class="pill">${escapeHtml(item.kind)}</span>
        <span>${escapeHtml(item.source_kind)}</span>
        ${item.hidden ? "<span class=\"pill warn\">hidden</span>" : ""}
        ${item.has_textures ? "<span>textures</span>" : ""}
        ${item.is_sliced ? "<span>sliced</span>" : ""}
      </div>
    </div>`;
  const check = card.querySelector(".card-check");
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
      const anchor = lastSelectAnchorId ?? item.id;
      selectRangeInclusive(anchor, item.id, { additive: e.ctrlKey || e.metaKey });
    }
  });
  check.addEventListener("change", (e) => {
    // Shift range is handled on click (preventDefault skips the toggle/change).
    toggleSelected(item.id, e.target.checked);
  });
  const img = card.querySelector(".card-thumb img");
  if (img) {
    img.addEventListener("error", () => {
      const host = card.querySelector(".card-thumb");
      if (host) host.innerHTML = `<span class="pill">${escapeHtml(item.kind)}</span>`;
    });
  }
  card.addEventListener("click", (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      const anchor = lastSelectAnchorId ?? item.id;
      selectRangeInclusive(anchor, item.id, { additive: e.ctrlKey || e.metaKey });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleSelected(item.id, !selectedIds.has(item.id));
      return;
    }
    lastSelectAnchorId = Number(item.id);
    selectAsset(item.id);
  });
  grid.appendChild(card);
}

async function loadLibrary({ preserveScroll = false } = {}) {
  const q = $("search").value.trim();
  // Search forces flat "all files" results
  const useFolders = browseMode === "folders" && !q;
  const params = filterParams();
  params.set("limit", "1000");
  const grid = $("grid");
  const pane = $("gridPane");
  const scrollTop = preserveScroll && pane ? pane.scrollTop : 0;
  // Build off-DOM so the grid doesn't flash empty while the API loads.
  const next = document.createElement("div");
  next.className = "grid";

  try {
    if (useFolders) {
      if (browseRootId) params.set("root_id", browseRootId);
      if (browseFolder) params.set("folder", browseFolder);
      const data = await api(`/api/browse?${params}`);
      renderCrumbs(data.crumbs || []);
      libraryItems = data.items || [];
      const visible = new Set(libraryItems.map((i) => i.id));
      selectedIds = new Set([...selectedIds].filter((id) => visible.has(id)));

      if (data.mode === "roots") {
        if (!(data.roots || []).length) {
          next.innerHTML = `<div class="detail-empty">No files yet. Add folders and hit Rescan.</div>`;
        } else {
          for (const root of data.roots) {
            appendFolderCard(next, {
              title: root.label || root.id,
              meta: `<span class="pill">${escapeHtml(root.source_kind)}</span><span>${root.asset_count} files</span>`,
              onOpen: () => {
                browseRootId = root.id;
                browseFolder = "";
                clearSelection();
                loadLibrary().catch(console.error);
              },
            });
          }
        }
        grid.replaceWith(next);
        next.id = "grid";
        updateBulkBar();
        if (pane && preserveScroll) pane.scrollTop = scrollTop;
        return;
      }

      for (const folder of data.folders || []) {
        appendFolderCard(next, {
          title: folder.name,
          meta: `<span class="pill">folder</span><span>${folder.asset_count} files</span>`,
          onOpen: () => {
            browseFolder = folder.folder;
            clearSelection();
            loadLibrary().catch(console.error);
          },
        });
      }
      for (const item of libraryItems) appendAssetCard(next, item);
      if (!(data.folders || []).length && !libraryItems.length) {
        next.innerHTML = `<div class="detail-empty">Empty folder.</div>`;
      } else if (data.truncated) {
        const note = document.createElement("div");
        note.className = "detail-empty";
        note.textContent = `Showing first ${libraryItems.length} of ${data.total_files} files in this folder.`;
        next.appendChild(note);
      }
      grid.replaceWith(next);
      next.id = "grid";
      updateBulkBar();
      if (pane && preserveScroll) pane.scrollTop = scrollTop;
      return;
    }

    renderCrumbs([]);
    const data = await api(`/api/assets?${params}`);
    libraryItems = data.items || [];
    const visible = new Set(libraryItems.map((i) => i.id));
    selectedIds = new Set([...selectedIds].filter((id) => visible.has(id)));
    if (!libraryItems.length) {
      next.innerHTML = `<div class="detail-empty">${$("filterHidden")?.checked
        ? "No hidden files."
        : "No files yet. Add folders and hit Rescan."}</div>`;
    } else {
      for (const item of libraryItems) appendAssetCard(next, item);
    }
    grid.replaceWith(next);
    next.id = "grid";
    updateBulkBar();
    if (pane && preserveScroll) pane.scrollTop = scrollTop;
  } catch (err) {
    console.error(err);
    // Leave existing grid intact on failure so the pane doesn't go black.
    if (!grid.children.length) {
      grid.innerHTML = `<div class="detail-empty">Couldn't load library: ${escapeHtml(err.message || err)}</div>`;
    }
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

async function copyText(btn, text, okLabel = "Copied") {
  if (!text) {
    btn.textContent = "No path";
    psToast("Nothing to copy", "No path available for this file.", "error");
    return;
  }
  const prev = btn.dataset.label || btn.textContent;
  let ok = false;
  // navigator.clipboard often fails on plain http:// LAN hosts (not a secure context).
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) ok = fallbackCopy(text);
  btn.textContent = ok ? okLabel : "Copy failed";
  if (ok) psToast(okLabel, text, "ok", 2600);
  else psToast("Copy failed", "Could not copy to the clipboard.", "error");
  setTimeout(() => { btn.textContent = prev; }, 1600);
}

function isMacOS() {
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  return /Mac|iPhone|iPad|iPod/i.test(plat) || /Macintosh|Mac OS X/i.test(ua);
}

function isMobileClient() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function buildSlicerProtocolUrl(fileUrl) {
  // Windows: bambustudio://open?file=<urlencoded https url>
  // macOS: bambustudioopen://<raw https url> (MakerWorld style — do not encode the whole URL)
  if (isMacOS()) return `bambustudioopen://${fileUrl}`;
  return `bambustudio://open?file=${encodeURIComponent(fileUrl)}`;
}

function slicerDownloadName(item, zipEntry = "") {
  let name = zipEntry
    ? (String(zipEntry).split(/[/\\]/).pop() || "model.stl")
    : (item.file_name || "model.stl");
  name = String(name).replace(/[\\/]/g, "_").trim() || "model.stl";
  // Bambu/Orca decide how to import from the URL path extension.
  if (!/\.(stl|obj|3mf)$/i.test(name)) {
    const kind = item.kind || "";
    const ext = kind === "obj" ? ".obj"
      : kind === "3mf" || kind === "gcode.3mf" ? ".3mf"
      : ".stl";
    name += ext;
  }
  return name;
}

function slicerFileUrlForAsset(item, { zipEntry = "" } = {}) {
  const kind = item.kind || "";
  const openable = ["stl", "obj", "3mf", "gcode.3mf"].includes(kind);
  const isZip = kind === "zip";
  if (!openable && !isZip) return { url: "", reason: "Not a slicer file type" };
  if (isZip && !zipEntry) {
    return { url: "", reason: "Pick a printable inside the ZIP first" };
  }
  // Always HTTPS download with a real filename.ext — file:// UNC does not load onto the plate.
  const name = slicerDownloadName(item, zipEntry);
  const u = new URL(
    `/api/assets/${item.id}/file/${encodeURIComponent(name)}`,
    window.location.origin,
  );
  if (isZip && zipEntry) u.searchParams.set("entry", zipEntry);
  return { url: u.toString(), reason: "", via: "download" };
}

const SLICER_TIP_KEY = "printshelf.slicerProtocolTip.v2";

function launchSlicerProtocol(fileUrl, fileName = "") {
  // Edge/Chrome own this “Open BambuStudio?” prompt — web apps cannot replace it.
  // Once the user ticks Always allow for this site, it stops appearing.
  psToast(
    "Handing off to Bambu Studio",
    localStorage.getItem(SLICER_TIP_KEY)
      ? (fileName || "Studio should open the plate…")
      : "If Edge asks, tick Always allow — then this prompt won’t come back.",
    "ok",
    5200,
  );
  window.location.href = buildSlicerProtocolUrl(fileUrl);
}

async function openInSlicer(item, { zipEntry = "" } = {}) {
  if (isMobileClient()) {
    psToast(
      "Open on a PC",
      "Bambu Studio / Orca need a desktop. On your phone, use Copy Windows path instead.",
      "info",
    );
    return false;
  }
  const { url, reason } = slicerFileUrlForAsset(item, { zipEntry });
  if (!url) {
    psToast("Can't open in slicer", reason || "Not available for this file.", "error");
    return false;
  }

  // First time: PrintShelf tip, then launch. Browser protocol gate still follows (OS security).
  if (!localStorage.getItem(SLICER_TIP_KEY)) {
    const go = await psConfirm({
      eyebrow: "Open in slicer",
      title: "Edge will ask once",
      body:
        "Two prompts you may see (neither is a PrintShelf dialog):<br><br>"
        + "1) Edge <strong>Open BambuStudio?</strong> — tick <strong>Always allow</strong> for this site.<br>"
        + "2) Studio <strong>not from a trusted site</strong> — click <strong>Yes</strong> "
        + "(MakerWorld is the only built-in trusted host; PrintShelf is yours).<br><br>"
        + "After that, Studio downloads the mesh over Tailscale.",
      confirmLabel: "Open Bambu Studio",
      cancelLabel: "Cancel",
      danger: false,
    });
    if (!go) return false;
    localStorage.setItem(SLICER_TIP_KEY, "1");
  }

  launchSlicerProtocol(url, item.file_name || "");
  return true;
}

async function selectAsset(id) {
  selectedId = Number(id);
  document.querySelectorAll(".card:not(.folder-card)").forEach((c) => {
    c.classList.toggle("active", Number(c.dataset.id) === selectedId);
  });
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  let item;
  try {
    item = await api(`/api/assets/${id}`);
  } catch (err) {
    $("detail").innerHTML = `<p class="detail-hint" style="color:var(--danger)">Failed to load details: ${escapeHtml(String(err.message || err))}</p>`;
    return;
  }
  try {
  const filaments = item.meta?.filaments || [];
  const sidecars = item.sidecars || [];
  const winPath = item.windows_path || "";
  const winFolder = item.windows_folder || "";
  const isZip = item.kind === "zip";
  const zipMeta = item.meta || {};
  const zipEntries = zipMeta.entries || [];
  let zipPrintables = [...(zipMeta.printables || [])];
  let zipKinds = { ...(zipMeta.printable_by_kind || {}) };
  const nestedZips = (zipMeta.nested_zips && zipMeta.nested_zips.length)
    ? zipMeta.nested_zips
    : zipEntries.filter((e) => /\.zip$/i.test(e.name || ""));
  const hasNested = nestedZips.length > 0;
  const canOrbit = item.can_orbit
    || item.kind === "stl"
    || item.kind === "obj"
    || item.kind === "3mf"
    || item.kind === "gcode.3mf"
    || (isZip && (zipPrintables.length > 0 || hasNested));
  const slicerKinds = ["stl", "obj", "3mf", "gcode.3mf"];
  const canSlicer = slicerKinds.includes(item.kind)
    || (isZip && (zipPrintables.length > 0 || hasNested));
  let zipEntry = isZip ? (zipPrintables[0]?.name || "") : "";
  const slicerInfo = () => slicerFileUrlForAsset(item, { zipEntry });
  const slicerDisabledReason = () => {
    if (slicerKinds.includes(item.kind)) {
      if (isMobileClient()) return "Use on PC with Bambu/Orca";
      return slicerInfo().url ? "" : (slicerInfo().reason || "Unavailable");
    }
    if (isZip) {
      if (!zipEntry) return hasNested ? "Peek a nested ZIP, then pick a printable" : "Pick a printable inside the ZIP first";
      if (isMobileClient()) return "Use on PC with Bambu/Orca";
      return slicerInfo().url ? "" : (slicerInfo().reason || "Unavailable");
    }
    return "Not a slicer file type";
  };
  const renderPrintablesList = (list, count) => {
    const host = $("zipPrintables");
    if (!host) return;
    if (!list.length) {
      host.innerHTML = `<li class="detail-hint" style="list-style:none">No printables in this archive.</li>`;
      return;
    }
    host.innerHTML = list.map((e, idx) => `
      <li>
        <button type="button" class="zip-entry-btn" data-entry="${escapeHtml(e.name)}" data-idx="${idx}">
          <strong>${escapeHtml(e.kind)}</strong> · ${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}
        </button>
      </li>`).join("");
    const note = $("zipPrintablesNote");
    if (note) {
      note.textContent = (count || 0) > list.length
        ? `Showing first ${list.length} of ${count}.`
        : "";
      note.hidden = !note.textContent;
    }
  };
  $("detail").innerHTML = `
    <h2>${escapeHtml(item.file_name)}</h2>
    <div class="detail-path">${escapeHtml(item.abs_path)}</div>
    ${winPath ? `<div class="detail-path" title="Windows path">${escapeHtml(winPath)}</div>` : ""}
    <div class="detail-section viewer-section">
      <h3>3D preview</h3>
      ${canOrbit
        ? `<div class="viewer-toolbar">
             ${isZip ? `<span class="viewer-entry-label" id="orbitEntryLabel"></span>` : ""}
             <label class="check viewer-detail-toggle">
               <input type="checkbox" id="orbitHighDetail"> Higher detail
             </label>
           </div>
           <div class="orbit-viewer" id="orbitViewer"></div>
           <p class="viewer-note" id="orbitNote" hidden></p>
           ${isZip ? `<p class="detail-hint" id="orbitHint">${zipPrintables.length
             ? "Click a printable below to load it in the viewer."
             : "Peek a nested archive below, then click a printable to orbit."}</p>` : ""}`
        : isZip
          ? `<p class="detail-hint">No printable meshes (STL/OBJ/3MF) found inside this ZIP.</p>`
          : `<p class="detail-hint">No 3D orbit for this file type.</p>`}
    </div>
    <div class="kv">
      <div><span>Design</span><span>${escapeHtml(item.design_name)}</span></div>
      <div><span>Type</span><span>${escapeHtml(item.kind)}</span></div>
      <div><span>Source</span><span>${escapeHtml(item.source_kind)} · ${escapeHtml(item.root_id)}</span></div>
      <div><span>Size</span><span>${fmtBytes(item.size_bytes)}</span></div>
      ${isZip ? `
        <div><span>Files in zip</span><span>${zipMeta.entry_count ?? "—"}</span></div>
        <div><span>Uncompressed</span><span>${fmtBytes(zipMeta.uncompressed_bytes || 0)}</span></div>
        <div><span>Printables inside</span><span id="zipPrintableCount">${zipMeta.printable_count ?? 0}</span></div>
        <div><span>Nested zips</span><span>${nestedZips.length}</span></div>
        <div><span>Inside types</span><span id="zipInsideTypes">${Object.keys(zipKinds).length
          ? Object.entries(zipKinds).map(([k, v]) => `${k}: ${v}`).join(" · ")
          : "—"}</span></div>
      ` : `
        <div><span>Triangles / faces</span><span>${item.triangle_count ?? "—"}</span></div>
        <div><span>Textures</span><span>${item.has_textures ? "yes" : "no"}</span></div>
        <div><span>Sliced</span><span>${item.is_sliced ? "yes" : "no"}</span></div>
      `}
    </div>
    ${isZip && hasNested ? `
      <div class="detail-section">
        <h3>Nested archives</h3>
        <p class="detail-hint">Peek opens one level inside without extracting to the NAS.</p>
        <ul class="sidecar-list zip-nested" id="zipNested">
          ${nestedZips.map((e) => `
            <li>
              <button type="button" class="zip-nested-btn" data-entry="${escapeHtml(e.name)}">
                <strong>zip</strong> · ${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}
                <span class="pill">Peek</span>
              </button>
            </li>`).join("")}
        </ul>
        <p class="detail-hint" id="zipPeekStatus" hidden></p>
      </div>` : ""}
    ${isZip ? `
      <div class="detail-section" id="zipPrintablesSection" ${zipPrintables.length || hasNested ? "" : "hidden"}>
        <h3 id="zipPrintablesTitle">Printables in zip</h3>
        <ul class="sidecar-list zip-printables" id="zipPrintables">
          ${zipPrintables.length ? zipPrintables.map((e, idx) => `
            <li>
              <button type="button" class="zip-entry-btn" data-entry="${escapeHtml(e.name)}" data-idx="${idx}">
                <strong>${escapeHtml(e.kind)}</strong> · ${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}
              </button>
            </li>`).join("") : `<li class="detail-hint" style="list-style:none">Peek a nested archive to list printables.</li>`}
        </ul>
        <p class="detail-hint" id="zipPrintablesNote" hidden></p>
      </div>` : ""}
    ${isZip && zipEntries.length ? `
      <div class="detail-section">
        <h3>Zip contents</h3>
        <ul class="sidecar-list zip-entries">
          ${zipEntries.map((e) => `
            <li>${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}</li>
          `).join("")}
        </ul>
        ${zipMeta.list_truncated
          ? `<p class="detail-hint">Showing first ${zipEntries.length} of ${zipMeta.entry_count} files.</p>`
          : ""}
        ${item.meta?.error ? `<p class="detail-hint" style="color:var(--danger)">${escapeHtml(item.meta.error)}</p>` : ""}
      </div>` : ""}
    ${filaments.length ? `
      <div class="detail-section">
        <h3>Filaments</h3>
        <div class="filament-row">
          ${filaments.map((f) => `
            <div title="${escapeHtml(f.type || "")}">
              <div class="swatch" style="background:${escapeHtml(f.colour || "#888")}"></div>
            </div>`).join("")}
        </div>
      </div>` : ""}
    ${item.meta?.plates?.length ? `
      <div class="detail-section">
        <h3>Plates</h3>
        <div class="kv">
          ${item.meta.plates.map((p) => `<div><span>${escapeHtml(p.name || "plate")}</span><span>${(p.filament_ids || []).length} filaments</span></div>`).join("")}
        </div>
      </div>` : ""}
    ${item.meta?.texture_refs || sidecars.length ? `
      <div class="detail-section">
        <h3>Sidecars / textures</h3>
        <ul class="sidecar-list">
          ${sidecars.map((s) => `<li><strong>${escapeHtml(s.role)}</strong> · ${escapeHtml(s.file_name)} · ${fmtBytes(s.size_bytes)}</li>`).join("") || "<li>None found</li>"}
        </ul>
        ${item.meta?.missing_textures?.length ? `<p class="lede">Missing: ${escapeHtml(item.meta.missing_textures.join(", "))}</p>` : ""}
      </div>` : ""}
    <div class="detail-section">
      <div class="detail-actions">
        <button class="card-open slicer-btn" type="button" id="openSlicerBtn"
          ${slicerDisabledReason() ? "disabled" : ""}
          title="${escapeHtml(slicerDisabledReason() || "Open in Bambu Studio or Orca")}">Open in slicer</button>
        <button class="card-open" type="button" id="copyWinPathBtn" data-label="Copy Windows path" ${winPath ? "" : "disabled"}>Copy Windows path</button>
        <button class="card-open secondary" type="button" id="copyWinFolderBtn" data-label="Copy Windows folder" ${winFolder ? "" : "disabled"}>Copy Windows folder</button>
        <button class="card-open secondary" type="button" id="copyPiPathBtn" data-label="Copy Pi path">Copy Pi path</button>
      </div>
      <div class="detail-actions danger-actions">
        ${item.hidden
          ? `<button class="card-open secondary" type="button" id="unhideBtn">${selectedIds.size > 1 ? `Unhide ${selectedIds.size}` : "Unhide"}</button>`
          : `<button class="card-open secondary" type="button" id="hideBtn">${selectedIds.size > 1 ? `Hide ${selectedIds.size} from library` : "Hide from library"}</button>`}
        <button class="card-open danger" type="button" id="deleteDiskBtn">${selectedIds.size > 1 ? `Delete ${selectedIds.size} from disk…` : "Delete from disk…"}</button>
      </div>
      <p class="detail-hint" id="slicerHint">${canSlicer
        ? (isMobileClient()
          ? "Open in slicer needs Bambu/Orca on a PC. On your phone, use Copy Windows path."
          : "Open in slicer hands the file to Bambu Studio / Orca. Edge may ask once — tick Always allow for this site. Big files can take a moment over Tailscale.")
        : "Slicer open is for STL, OBJ, 3MF, and ZIP printables."}</p>
      <p class="detail-hint">${winPath
        ? "Paste Windows path into Bambu/Orca, or folder into Explorer (Ctrl+L → Ctrl+V)."
        : "Set a Windows path on this watched folder in Folders to enable PC copy."}</p>
      <p class="detail-hint">${selectedIds.size > 1
        ? `Selection active: Hide/Delete will apply to all ${selectedIds.size} selected files.`
        : `Hide keeps the file on disk. Delete removes the file${sidecars.length ? " and indexed sidecars/textures" : ""} permanently.`}</p>
    </div>`;
  const syncSlicerBtn = () => {
    const btn = $("openSlicerBtn");
    if (!btn) return;
    const reason = slicerDisabledReason();
    btn.disabled = Boolean(reason);
    btn.title = reason || "Open in Bambu Studio or Orca";
  };
  $("openSlicerBtn")?.addEventListener("click", () => {
    openInSlicer(item, { zipEntry });
  });
  $("copyWinPathBtn")?.addEventListener("click", () => copyText($("copyWinPathBtn"), winPath));
  $("copyWinFolderBtn")?.addEventListener("click", () => copyText($("copyWinFolderBtn"), winFolder, "Folder copied"));
  $("copyPiPathBtn")?.addEventListener("click", () => copyText($("copyPiPathBtn"), item.abs_path));
  $("hideBtn")?.addEventListener("click", async () => {
    try {
      const ids = idsForAction(id);
      await hideIds(ids);
      psToast("Hidden from library", fileCountLabel(ids.length), "ok");
    } catch (err) {
      psToast("Hide failed", String(err.message || err), "error");
    }
  });
  $("unhideBtn")?.addEventListener("click", async () => {
    try {
      const ids = idsForAction(id);
      await unhideIds(ids);
      psToast("Unhidden", fileCountLabel(ids.length), "ok");
      if (ids.length === 1) await selectAsset(ids[0]);
    } catch (err) {
      psToast("Unhide failed", String(err.message || err), "error");
    }
  });
  $("deleteDiskBtn")?.addEventListener("click", async () => {
    try {
      const ids = idsForAction(id);
      const names = ids.length === 1
        ? [item.file_name]
        : libraryItems.filter((x) => ids.includes(x.id)).map((x) => x.file_name);
      await deleteIdsFromDisk(ids, { names });
    } catch (err) {
      psToast("Delete failed", String(err.message || err), "error");
    }
  });
  if (canOrbit) {
    const mountOrbit = async (highDetail) => {
      for (let i = 0; i < 40 && !window.PrintShelfViewer?.mountOrbitViewer; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!window.PrintShelfViewer?.mountOrbitViewer) {
        if ($("orbitViewer")) {
          $("orbitViewer").innerHTML = `<div class="viewer-status error">3D viewer failed to load (check network / CDN).</div>`;
        }
        return;
      }
      const detail = highDetail ? "high" : "standard";
      let url = `/api/assets/${id}/model?detail=${detail}`;
      if (isZip) {
        if (!zipEntry) {
          if ($("orbitViewer")) {
            $("orbitViewer").innerHTML = `<div class="viewer-status">Pick a printable in the list below.</div>`;
          }
          return;
        }
        url += `&entry=${encodeURIComponent(zipEntry)}`;
        if ($("orbitEntryLabel")) {
          $("orbitEntryLabel").textContent = zipEntry.split("/").pop() || zipEntry;
        }
      }
      await window.PrintShelfViewer.mountOrbitViewer($("orbitViewer"), {
        url,
        noteEl: $("orbitNote"),
      });
    };
    $("orbitHighDetail")?.addEventListener("change", (e) => {
      mountOrbit(Boolean(e.target.checked)).catch(console.error);
    });
    $("zipPrintables")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".zip-entry-btn");
      if (!btn) return;
      zipEntry = btn.dataset.entry || "";
      document.querySelectorAll(".zip-entry-btn").forEach((b) => b.classList.toggle("active", b === btn));
      syncSlicerBtn();
      mountOrbit(Boolean($("orbitHighDetail")?.checked)).catch(console.error);
    });
    if (isZip && zipPrintables.length) {
      const firstBtn = document.querySelector(".zip-entry-btn");
      if (firstBtn) firstBtn.classList.add("active");
      await mountOrbit(false);
    } else if ($("orbitViewer")) {
      $("orbitViewer").innerHTML = `<div class="viewer-status">${hasNested
        ? "Peek a nested archive below to load printables."
        : "Pick a printable in the list below."}</div>`;
    }
  } else if (isZip && zipPrintables.length) {
    $("zipPrintables")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".zip-entry-btn");
      if (!btn) return;
      zipEntry = btn.dataset.entry || "";
      document.querySelectorAll(".zip-entry-btn").forEach((b) => b.classList.toggle("active", b === btn));
      syncSlicerBtn();
    });
    const firstBtn = document.querySelector(".zip-entry-btn");
    if (firstBtn) firstBtn.classList.add("active");
  }

  $("zipNested")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".zip-nested-btn");
    if (!btn) return;
    const nestedEntry = btn.dataset.entry || "";
    const status = $("zipPeekStatus");
    document.querySelectorAll(".zip-nested-btn").forEach((b) => b.classList.toggle("active", b === btn));
    if (status) {
      status.hidden = false;
      status.textContent = `Peeking ${nestedEntry}…`;
    }
    try {
      const data = await api(`/api/assets/${id}/nested?entry=${encodeURIComponent(nestedEntry)}`);
      zipPrintables = data.printables || [];
      zipKinds = data.printable_by_kind || {};
      zipEntry = zipPrintables[0]?.name || "";
      const section = $("zipPrintablesSection");
      if (section) section.hidden = false;
      if ($("zipPrintablesTitle")) {
        $("zipPrintablesTitle").textContent = `Printables in ${nestedEntry.split("/").pop()}`;
      }
      if ($("zipPrintableCount")) $("zipPrintableCount").textContent = String(data.printable_count ?? zipPrintables.length);
      if ($("zipInsideTypes")) {
        $("zipInsideTypes").textContent = Object.keys(zipKinds).length
          ? Object.entries(zipKinds).map(([k, v]) => `${k}: ${v}`).join(" · ")
          : "—";
      }
      if ($("orbitHint")) {
        $("orbitHint").textContent = zipPrintables.length
          ? "Click a printable below to load it in the viewer."
          : "No printables found in that nested archive.";
      }
      renderPrintablesList(zipPrintables, data.printable_count);
      if (status) {
        status.textContent = data.error
          ? `Peek failed: ${data.error}`
          : `Found ${data.printable_count || 0} printable(s) in ${nestedEntry.split("/").pop()}.`;
      }
      syncSlicerBtn();
      if (zipEntry && $("orbitViewer") && window.PrintShelfViewer?.mountOrbitViewer) {
        const firstBtn = document.querySelector(".zip-entry-btn");
        if (firstBtn) firstBtn.classList.add("active");
        // Re-bind isn't needed — zipPrintables click is on parent.
        const high = Boolean($("orbitHighDetail")?.checked);
        const detail = high ? "high" : "standard";
        let url = `/api/assets/${id}/model?detail=${detail}&entry=${encodeURIComponent(zipEntry)}`;
        if ($("orbitEntryLabel")) {
          $("orbitEntryLabel").textContent = zipEntry.split("/").pop() || zipEntry;
        }
        await window.PrintShelfViewer.mountOrbitViewer($("orbitViewer"), {
          url,
          noteEl: $("orbitNote"),
        });
      }
    } catch (err) {
      if (status) status.textContent = String(err.message || err);
    }
  });

  syncSlicerBtn();
  // Do not reload the library here — that flashed/cleared the thumb grid.
  } catch (err) {
    $("detail").innerHTML = `<p class="detail-hint" style="color:var(--danger)">Failed to render details: ${escapeHtml(String(err.message || err))}</p>`;
  }
}

async function loadFolders() {
  const cfg = await api("/api/config");
  folders = cfg.watched_folders || [];
  renderFolders();
}

function renderFolders() {
  const el = $("folderList");
  if (!folders.length) {
    el.innerHTML = `<p class="lede">No folders yet.</p>`;
    return;
  }
  el.innerHTML = folders.map((f, i) => `
    <div class="folder-row">
      <div><strong>${escapeHtml(f.label || f.id)}</strong><br><span class="pill">${escapeHtml(f.source_kind)}</span></div>
      <div class="detail-path" style="margin:0">
        ${escapeHtml(f.path)}
        ${f.windows_path ? `<br><span class="pill">win</span> ${escapeHtml(f.windows_path)}` : "<br><span class=\"pill\">no Windows path</span>"}
      </div>
      <button type="button" data-i="${i}" class="secondary remove-folder">Remove</button>
    </div>`).join("");
  el.querySelectorAll(".remove-folder").forEach((btn) => {
    btn.addEventListener("click", () => {
      folders.splice(Number(btn.dataset.i), 1);
      renderFolders();
    });
  });
}

async function saveFolders() {
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({ watched_folders: folders }),
  });
  await refreshStats();
}

function bind() {
  $("psModalCancel")?.addEventListener("click", () => closePsModal(false));
  $("psModalConfirm")?.addEventListener("click", () => closePsModal(true));
  $("psModalRoot")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-ps-modal-dismiss]")) closePsModal(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("psModalRoot") && !$("psModalRoot").hidden) {
      closePsModal(false);
    }
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  ["search", "filterSource", "filterTextures", "filterSliced", "filterHidden"].forEach((id) => {
    $(id)?.addEventListener("input", () => loadLibrary().catch(console.error));
    $(id)?.addEventListener("change", () => loadLibrary().catch(console.error));
  });
  $("typeTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".type-tab");
    if (!btn) return;
    setActiveKind(btn.dataset.kind || "");
    clearSelection();
    loadLibrary().catch(console.error);
  });
  $("viewModes")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-mode");
    if (!btn) return;
    browseMode = btn.dataset.mode || "folders";
    document.querySelectorAll(".view-mode").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    if (browseMode === "folders") {
      // keep current place; if coming from all-files, start at roots
      if (!browseRootId) browseFolder = "";
    }
    clearSelection();
    loadLibrary().catch(console.error);
  });
  $("bulkSelectAllBtn")?.addEventListener("click", () => {
    for (const item of libraryItems) selectedIds.add(item.id);
    lastSelectAnchorId = libraryItems[0] ? Number(libraryItems[0].id) : null;
    syncSelectionUi();
  });
  $("bulkClearBtn")?.addEventListener("click", () => clearSelection());
  $("bulkHideBtn")?.addEventListener("click", async () => {
    try {
      const ids = [...selectedIds];
      await hideIds(ids);
      psToast("Hidden from library", fileCountLabel(ids.length), "ok");
    } catch (err) {
      psToast("Hide failed", String(err.message || err), "error");
    }
  });
  $("bulkUnhideBtn")?.addEventListener("click", async () => {
    try {
      const ids = [...selectedIds];
      await unhideIds(ids);
      psToast("Unhidden", fileCountLabel(ids.length), "ok");
    } catch (err) {
      psToast("Unhide failed", String(err.message || err), "error");
    }
  });
  $("bulkDeleteBtn")?.addEventListener("click", async () => {
    try {
      const ids = [...selectedIds];
      const names = libraryItems.filter((x) => ids.includes(x.id)).map((x) => x.file_name);
      await deleteIdsFromDisk(ids, { names });
    } catch (err) {
      psToast("Delete failed", String(err.message || err), "error");
    }
  });
  $("refreshLibraryBtn")?.addEventListener("click", () => {
    refreshLibraryView().catch(console.error);
  });
  $("scanBannerRefreshBtn")?.addEventListener("click", () => {
    refreshLibraryView().catch(console.error);
  });
  $("scanBtn").addEventListener("click", async () => {
    $("scanBtn").disabled = true;
    try {
      await api("/api/scan", { method: "POST", body: "{}" });
      await refreshStats(); // starts live scan banner + watch
    } catch (err) {
      $("scanStatus").textContent = String(err.message || err);
      $("scanBtn").disabled = false;
    }
  });
  $("rebuildThumbsBtn").addEventListener("click", async () => {
    $("rebuildThumbsBtn").disabled = true;
    try {
      await api("/api/thumbs/rebuild", { method: "POST", body: "{}" });
      await refreshStats(); // status line shows Thumbs… and Scan… together
    } catch (err) {
      $("scanStatus").textContent = String(err.message || err);
      $("rebuildThumbsBtn").disabled = false;
    }
  });
  $("folderForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    folders.push({
      id: String(fd.get("id") || "").trim(),
      label: String(fd.get("label") || "").trim(),
      path: String(fd.get("path") || "").trim(),
      windows_path: String(fd.get("windows_path") || "").trim(),
      source_kind: String(fd.get("source_kind") || "local"),
    });
    e.target.reset();
    renderFolders();
  });
  $("saveFoldersBtn").addEventListener("click", () => saveFolders().catch(console.error));
}

async function boot() {
  bind();
  await loadFolders();
  await refreshStats();
  await loadLibrary();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot().catch((err) => {
  $("railStats").textContent = String(err.message || err);
});
