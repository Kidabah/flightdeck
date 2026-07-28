const $ = (id) => document.getElementById(id);

let folders = [];
let selectedId = null;
let activeKind = "";
let libraryItems = [];
let selectedIds = new Set();
/** Last file selected without Shift — used as the start of a Shift range. */
let lastSelectAnchorId = null;
let browseMode = "all"; // folders | all
let browseRootId = null;
let browseFolder = "";
const PAGE_SIZE = 200;
let libraryTotal = 0;
let libraryHasMore = false;
let ignoreGlobs = [];
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
  const altBtn = $("psModalAlt");
  confirmBtn.hidden = false;
  if (altBtn) altBtn.hidden = true;
  confirmBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  confirmBtn.classList.toggle("danger", !!danger);
  confirmBtn.classList.toggle("card-open", true);
  confirmBtn.onclick = () => closePsModal(true);
  cancelBtn.onclick = () => closePsModal(false);
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

/** Choice modal — returns the selected option value, or null if cancelled. */
function psChoice({
  title = "Choose",
  body = "",
  eyebrow = "Choose",
  options = [],
  cancelLabel = "Cancel",
} = {}) {
  const root = $("psModalRoot");
  if (!root || !options.length) return Promise.resolve(null);
  if (psModalResolver) {
    psModalResolver(null);
    psModalResolver = null;
  }
  $("psModalEyebrow").textContent = eyebrow;
  $("psModalTitle").textContent = title;
  const list = options.map((opt) => {
    const last = opt.last ? " is-last" : "";
    return `<li><button type="button" class="ps-choice-opt${last}" data-ps-choice="${escapeHtml(opt.value)}">
      <strong>${escapeHtml(opt.label)}</strong>
      ${opt.detail ? `<span>${escapeHtml(opt.detail)}</span>` : ""}
    </button></li>`;
  }).join("");
  $("psModalBody").innerHTML = `${body ? `<p style="margin:0 0 12px">${body}</p>` : ""}
    <ul class="ps-slicer-choice">${list}</ul>`;
  const confirmBtn = $("psModalConfirm");
  const cancelBtn = $("psModalCancel");
  const altBtn = $("psModalAlt");
  confirmBtn.hidden = true;
  if (altBtn) altBtn.hidden = true;
  cancelBtn.textContent = cancelLabel;
  cancelBtn.onclick = () => closePsModal(null);
  root.hidden = false;
  cancelBtn.focus();
  const onClick = (ev) => {
    const btn = ev.target.closest("[data-ps-choice]");
    if (!btn || !root.contains(btn)) return;
    closePsModal(btn.getAttribute("data-ps-choice"));
  };
  root.addEventListener("click", onClick);
  return new Promise((resolve) => {
    psModalResolver = (value) => {
      root.removeEventListener("click", onClick);
      root.hidden = true;
      confirmBtn.hidden = false;
      psModalResolver = null;
      resolve(value);
    };
  });
}

function closePsModal(value) {
  if (psModalResolver) psModalResolver(value);
}

const SLICER_TARGET_KEY = "printshelf.slicerTarget.v1";

function slicerTargetLabel(target) {
  return target === "desktop_orca" ? "OrcaSlicer" : "Bambu Studio";
}

function manifoldToastDetail(manifold, fallback = "") {
  if (!manifold || manifold.skipped) return fallback;
  const before = Number(manifold.before) || 0;
  const after = Number(manifold.after) || 0;
  if (before === 0) return fallback ? `${fallback} · Manifold OK` : "Manifold OK";
  if (manifold.repaired) {
    const line = after === 0
      ? `Repaired ${before} → 0 open edges`
      : `Repaired ${before} → ${after} left`;
    return fallback ? `${fallback} · ${line}` : line;
  }
  // Checked but not improved (e.g. Luban chops with intentional open edges).
  const line = `${before} open edges (unchanged)`;
  return fallback ? `${fallback} · ${line}` : line;
}

async function pickSlicerTarget() {
  const last = localStorage.getItem(SLICER_TARGET_KEY) || "bambu_studio";
  const choice = await psChoice({
    eyebrow: "Open in slicer",
    title: "Which slicer?",
    body: "Same handoff as Flightdeck — opens the real file on your Windows PC.",
    options: [
      {
        value: "bambu_studio",
        label: "Bambu Studio",
        detail: "Desktop Bambu Studio on your PC",
        last: last === "bambu_studio",
      },
      {
        value: "desktop_orca",
        label: "OrcaSlicer",
        detail: "Desktop Orca on your PC",
        last: last === "desktop_orca",
      },
    ],
  });
  if (!choice) return null;
  localStorage.setItem(SLICER_TARGET_KEY, choice);
  return choice;
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

  // Check for identical byte-copies elsewhere in the library (common with Thingiverse dumps).
  let copyExtra = 0;
  let copyPaths = [];
  try {
    const seen = new Set(ids.map(Number));
    for (const id of ids.slice(0, 20)) {
      const data = await api(`/api/assets/${id}/copies`);
      for (const c of data.copies || []) {
        if (seen.has(Number(c.id))) continue;
        seen.add(Number(c.id));
        copyExtra += 1;
        if (copyPaths.length < 6) copyPaths.push(c.rel_path || c.file_name || String(c.id));
      }
    }
  } catch (err) {
    console.warn("copies lookup failed", err);
  }

  const copyBit = copyExtra
    ? `<br><br><strong>${copyExtra} identical cop${copyExtra === 1 ? "y" : "ies"}</strong> still exist in other folders`
      + (copyPaths.length ? `:<br>${copyPaths.map(escapeHtml).join("<br>")}` : ".")
      + `<br>Deleting only the selected file leaves those copies for the next scan.`
    : "";

  const ok = await psConfirm({
    eyebrow: "Destructive action",
    title: `Delete ${label} from disk?`,
    body: `This permanently removes the file${ids.length === 1 ? "" : "s"} from disk and the library.${listBit}${copyBit}<br><br>This cannot be undone.`,
    confirmLabel: "Delete permanently",
    danger: true,
  });
  if (!ok) return false;

  let deleteDuplicates = false;
  if (copyExtra) {
    deleteDuplicates = await psConfirm({
      eyebrow: "Identical copies found",
      title: `Also delete ${copyExtra} identical cop${copyExtra === 1 ? "y" : "ies"}?`,
      body: `Same file bytes live in other folders. Choose <strong>Delete all copies</strong> to remove every matching copy from disk, or cancel this step to delete only your selection.`,
      confirmLabel: "Delete all copies",
      danger: true,
    });
  } else {
    const ok2 = await psConfirm({
      eyebrow: "Last check",
      title: "Delete for real?",
      body: `Confirm once more: permanently delete <strong>${escapeHtml(label)}</strong> from disk.`,
      confirmLabel: "Yes, delete",
      danger: true,
    });
    if (!ok2) return false;
  }

  const q = deleteDuplicates ? "?delete_duplicates=true" : "";
  let deletedCount = 0;
  let failed = [];
  let leftover = 0;
  if (ids.length === 1) {
    const res = await api(`/api/assets/${ids[0]}/delete${q}`, { method: "POST", body: "{}" });
    deletedCount = res.deleted_count || 1;
    leftover = res.other_copies_count || 0;
  } else {
    const res = await api(`/api/assets/bulk/delete${q}`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    deletedCount = res.deleted_count || 0;
    failed = res.failed || [];
    leftover = res.other_copies_count || 0;
  }
  clearSelection();
  selectedId = null;
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  await refreshStats();
  // Prefer live stats after delete — bulk leftover mid-batch was misleading.
  let stillDup = 0;
  try {
    const s = await api("/api/stats");
    stillDup = Number(s.duplicates || 0);
  } catch {
    stillDup = leftover;
  }
  $("detail").innerHTML = `<div class="detail-empty">Deleted ${fileCountLabel(deletedCount)} from disk${failed.length ? ` · ${failed.length} failed` : ""}${stillDup ? ` · ${stillDup} duplicate files still in library` : ""}.</div>`;
  if (failed.length) {
    psToast(
      `Deleted ${deletedCount}, ${failed.length} failed`,
      failed.slice(0, 8).map((f) => `${f.id}: ${f.error}`).join("\n"),
      "error",
      8000,
    );
  } else if (stillDup) {
    psToast(
      "Deleted — some duplicates remain",
      `${stillDup} duplicate file(s) still in the library. Open the Duplicates tab to finish.`,
      "error",
      7000,
    );
  } else {
    psToast("Deleted from disk", `${fileCountLabel(deletedCount)} · no duplicates left`, "ok");
  }
  await loadLibrary();
  return true;
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("hidden", el.id !== `view-${name}`));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === name));
}

function updateTypeTabCounts(byKind, total, duplicates = 0) {
  document.querySelectorAll(".type-count").forEach((el) => {
    const key = el.dataset.countFor || "";
    if (key === "__duplicates__") {
      el.textContent = String(duplicates || 0);
      return;
    }
    el.textContent = String(key ? (byKind[key] || 0) : (total || 0));
  });
  const dupTab = document.querySelector('.type-tab[data-kind="__duplicates__"]');
  if (dupTab) {
    const n = Number(duplicates || 0);
    dupTab.hidden = n <= 0;
    if (n <= 0 && activeKind === "__duplicates__") {
      setActiveKind("");
    }
  }
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
  const order = ["zip", "stl", "obj", "3mf", "gcode.3mf", "gcode"];
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
  const dupBit = s.duplicates ? `<br><span class="pill warn">duplicates ${s.duplicates}</span>` : "";
  const hiddenBit = s.hidden ? `<br><span class="pill">hidden ${s.hidden}</span>` : "";
  $("railStats").innerHTML = `<strong>${s.assets}</strong> assets<br>${kinds}${dupBit}${hiddenBit}`;
  updateTypeTabCounts(byKind, s.assets || 0, s.duplicates || 0);
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
  const dupBit = s.duplicates ? `<br><span class="pill warn">duplicates ${s.duplicates}</span>` : "";
  const hiddenBit = s.hidden ? `<br><span class="pill">hidden ${s.hidden}</span>` : "";
  $("railStats").innerHTML = `<strong>${s.assets}</strong> assets<br>${kinds}${dupBit}${hiddenBit}`;
  updateTypeTabCounts(byKind, s.assets || 0, s.duplicates || 0);
  const scan = s.scan || {};
  const thumbs = s.thumbs || {};
  updateScanBanner(scan, byKind, s.assets || 0);
  ensureStatusWatch(!!scan.running, !!thumbs.running);
  lastScanRunning = !!scan.running;
  lastThumbsRunning = !!thumbs.running;
  $("scanStatus").textContent = formatStatusLine(scan, thumbs);
  // If we were on Duplicates and they all cleared, jump back to All and reload.
  if (activeKind === "__duplicates__" && !(s.duplicates > 0)) {
    setActiveKind("");
    await loadLibrary();
  }
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
  if (activeKind === "__duplicates__") {
    params.set("duplicates", "true");
  } else if (activeKind) {
    params.set("kind", activeKind);
  }
  const source = $("filterSource").value;
  if (source) params.set("source_kind", source);
  const root = $("filterRoot")?.value;
  if (root) params.set("root_id", root);
  const sort = $("sortBy")?.value;
  if (sort && sort !== "seen") params.set("sort", sort);
  else if (sort) params.set("sort", "seen");
  if ($("filterTextures").checked) params.set("has_textures", "true");
  if ($("filterSliced").checked) params.set("is_sliced", "true");
  if ($("filterHidden")?.checked) params.set("hidden", "true");
  else params.set("hidden", "false");
  return params;
}

function parseTagsInput(raw) {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function fillRootFilter() {
  const sel = $("filterRoot");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">All folders</option>`
    + folders.map((f) => {
      const id = escapeHtml(f.id || "");
      const label = escapeHtml(f.label || f.id || "folder");
      return `<option value="${id}">${label}</option>`;
    }).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
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
      ? `<img src="/api/thumbs/${encodeURIComponent(item.thumb_path)}?v=${encodeURIComponent(
          item.kind === "zip" ? "zip2" : ((item.content_hash || item.thumb_path).slice(0, 12))
        )}" alt="" loading="lazy">`
      : `<span class="pill">${escapeHtml(item.kind)}</span>`}</div>
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(item.file_name)}</h3>
      <div class="card-meta">
        <span class="pill">${escapeHtml(item.kind)}</span>
        <span>${escapeHtml(item.source_kind)}</span>
        ${item.copy_count > 1 ? `<span class="pill warn">${item.copy_count} copies</span>` : ""}
        ${item.hidden ? "<span class=\"pill warn\">hidden</span>" : ""}
        ${item.has_textures ? "<span>textures</span>" : ""}
        ${item.is_sliced ? "<span>sliced</span>" : ""}
        ${(item.tags || []).slice(0, 3).map((t) => `<span class="pill tag">${escapeHtml(t)}</span>`).join("")}
        ${activeKind === "__duplicates__" && item.rel_path
          ? `<span title="${escapeHtml(item.rel_path)}">${escapeHtml(item.rel_path.length > 48 ? `…${item.rel_path.slice(-46)}` : item.rel_path)}</span>`
          : ""}
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

function removeLoadMoreBar() {
  $("loadMoreBar")?.remove();
}

function renderLoadMoreBar(host) {
  removeLoadMoreBar();
  if (!libraryHasMore || !host) return;
  const bar = document.createElement("div");
  bar.id = "loadMoreBar";
  bar.className = "load-more-bar";
  bar.innerHTML = `
    <span>Showing ${libraryItems.length.toLocaleString()} of ${libraryTotal.toLocaleString()}</span>
    <button type="button" class="secondary" id="loadMoreBtn">Load more</button>`;
  host.appendChild(bar);
  $("loadMoreBtn")?.addEventListener("click", () => {
    loadLibrary({ preserveScroll: true, append: true }).catch(console.error);
  });
}

async function loadLibrary({ preserveScroll = false, append = false } = {}) {
  const q = $("search").value.trim();
  const dupMode = activeKind === "__duplicates__";
  // Search / Duplicates force flat "all files" results
  const useFolders = browseMode === "folders" && !q && !dupMode;
  const params = filterParams();
  const grid = $("grid");
  const pane = $("gridPane");
  const scrollTop = preserveScroll && pane ? pane.scrollTop : 0;

  if (useFolders || !append) {
    libraryHasMore = false;
    removeLoadMoreBar();
  }

  try {
    if (useFolders) {
      if (browseRootId) params.set("root_id", browseRootId);
      if (browseFolder) params.set("folder", browseFolder);
      const data = await api(`/api/browse?${params}`);
      renderCrumbs(data.crumbs || []);
      libraryItems = data.items || [];
      libraryTotal = Number(data.total_files || libraryItems.length) || 0;
      libraryHasMore = false;
      const visible = new Set(libraryItems.map((i) => i.id));
      selectedIds = new Set([...selectedIds].filter((id) => visible.has(id)));
      const next = document.createElement("div");
      next.className = "grid";

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
    const offset = append ? libraryItems.length : 0;
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    const data = await api(`/api/assets?${params}`);
    const page = data.items || [];
    libraryTotal = Number(data.total || 0) || 0;
    if (append) {
      const seen = new Set(libraryItems.map((i) => i.id));
      for (const item of page) {
        if (!seen.has(item.id)) libraryItems.push(item);
      }
    } else {
      libraryItems = page;
    }
    libraryHasMore = libraryItems.length < libraryTotal;
    const visible = new Set(libraryItems.map((i) => i.id));
    selectedIds = new Set([...selectedIds].filter((id) => visible.has(id)));

    if (append) {
      removeLoadMoreBar();
      for (const item of page) {
        if (!grid.querySelector(`.card[data-id="${item.id}"]`)) appendAssetCard(grid, item);
      }
      renderLoadMoreBar(pane || grid.parentElement);
      updateBulkBar();
      if (pane && preserveScroll) pane.scrollTop = scrollTop;
      return;
    }

    const next = document.createElement("div");
    next.className = "grid";
    if (!libraryItems.length) {
      next.innerHTML = `<div class="detail-empty">${dupMode
        ? "No duplicate files — nice. This tab will hide itself."
        : ($("filterHidden")?.checked
          ? "No hidden files."
          : "No files yet. Add folders and hit Rescan.")}</div>`;
    } else {
      if (dupMode) {
        const note = document.createElement("div");
        note.className = "detail-empty";
        note.style.gridColumn = "1 / -1";
        note.textContent = `${libraryTotal || libraryItems.length} duplicate files (same bytes in more than one place). Delete extras — keep one. Tab disappears when none are left.`;
        next.appendChild(note);
      }
      for (const item of libraryItems) appendAssetCard(next, item);
    }
    grid.replaceWith(next);
    next.id = "grid";
    renderLoadMoreBar(pane || next.parentElement);
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

async function openInSlicer(item, { zipEntry = "" } = {}) {
  if (isMobileClient()) {
    psToast(
      "Open on a PC",
      "Bambu Studio / Orca need a desktop. On your phone, use Copy Windows path instead.",
      "info",
    );
    return false;
  }

  const kind = item.kind || "";
  const openable = ["stl", "obj", "3mf", "gcode.3mf"].includes(kind);
  const isZip = kind === "zip";
  if (!openable && !isZip) {
    psToast("Can't open in slicer", "Not a slicer file type.", "error");
    return false;
  }
  if (isZip && !zipEntry) {
    psToast("Can't open in slicer", "Pick a printable inside the ZIP first.", "error");
    return false;
  }

  const target = await pickSlicerTarget();
  if (!target) return false;
  const label = slicerTargetLabel(target);

  // Same handoff as Flightdeck: Pi → Windows worker → slicer.exe <path>.
  const u = new URL(`/api/assets/${item.id}/open-slicer`, window.location.origin);
  u.searchParams.set("target", target);
  if (isZip && zipEntry) u.searchParams.set("entry", zipEntry);

  psToast(`Opening in ${label}`, "Flightdeck Windows worker handoff…", "ok", 4000);
  let data = {};
  try {
    const r = await fetch(u.toString(), { method: "POST" });
    data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = typeof data.detail === "string" ? data.detail : "Slicer handoff failed";
      psToast("Couldn't open slicer", detail, "error", 10000);
      return false;
    }
  } catch (err) {
    psToast("Couldn't open slicer", String(err.message || err), "error", 8000);
    return false;
  }

  const via = data.via === "open-path" ? "NAS path (File → Open style)" : (data.filename || "model");
  psToast(`Opened in ${label}`, manifoldToastDetail(data.manifold, via), "ok", 7000);
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
  const slicerDisabledReason = () => {
    if (slicerKinds.includes(item.kind)) {
      if (isMobileClient()) return "Use on PC with Bambu/Orca";
      return "";
    }
    if (isZip) {
      if (!zipEntry) return hasNested ? "Peek a nested ZIP, then pick a printable" : "Pick a printable inside the ZIP first";
      if (isMobileClient()) return "Use on PC with Bambu/Orca";
      return "";
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
          : item.kind === "gcode"
            ? `<p class="detail-hint">Sliced G-code — no mesh orbit. Thumbnails come from Prusa/Cura embeds when present.</p>`
            : `<p class="detail-hint">No 3D orbit for this file type.</p>`}
    </div>
    <div class="detail-section">
      <h3>Tags &amp; notes</h3>
      <label class="meta-label">Tags <span class="meta-hint">comma-separated</span></label>
      <input type="text" id="designTagsInput" class="meta-input" value="${escapeHtml((item.tags || []).join(", "))}" placeholder="to print, gift, junk…">
      <label class="meta-label">Notes</label>
      <textarea id="designNotesInput" class="meta-input meta-notes" rows="3" placeholder="Anything useful about this design…">${escapeHtml(item.design_notes || "")}</textarea>
      <button type="button" class="card-open secondary" id="saveDesignMetaBtn">Save tags &amp; notes</button>
    </div>
    <div class="kv">
      <div><span>Design</span><span>${escapeHtml(item.design_name)}</span></div>
      <div><span>Type</span><span>${escapeHtml(item.kind === "gcode" ? (item.meta?.extension === ".gco" ? "gcode (.gco)" : "gcode") : item.kind)}</span></div>
      <div><span>Source</span><span>${escapeHtml(item.source_kind)} · ${escapeHtml(item.root_id)}</span></div>
      <div><span>Size</span><span>${fmtBytes(item.size_bytes)}</span></div>
      ${(item.kind === "stl" || item.kind === "obj")
        ? `<div><span>Manifold</span><span id="manifoldStatus">Checking…</span></div>`
        : ""}
      ${isZip ? `
        <div><span>Files in zip</span><span>${zipMeta.entry_count ?? "—"}</span></div>
        <div><span>Uncompressed</span><span>${fmtBytes(zipMeta.uncompressed_bytes || 0)}</span></div>
        <div><span>Printables inside</span><span id="zipPrintableCount">${zipMeta.printable_count ?? 0}</span></div>
        <div><span>Nested zips</span><span>${nestedZips.length}</span></div>
        <div><span>Inside types</span><span id="zipInsideTypes">${Object.keys(zipKinds).length
          ? Object.entries(zipKinds).map(([k, v]) => `${k}: ${v}`).join(" · ")
          : "—"}</span></div>
      ` : item.kind === "gcode" ? `
        <div><span>Slicer</span><span>${escapeHtml(item.meta?.generator || "—")}</span></div>
        <div><span>Print time</span><span>${escapeHtml(item.meta?.print_time || "—")}</span></div>
        <div><span>Filament</span><span>${escapeHtml(
          item.meta?.filament_used
            || (item.meta?.filament_used_g ? `${item.meta.filament_used_g} g` : "")
            || item.meta?.filament_used_mm
            || "—"
        )}</span></div>
        <div><span>Layer height</span><span>${escapeHtml(item.meta?.layer_height || "—")}</span></div>
        <div><span>Layers</span><span>${item.meta?.layer_count ?? "—"}</span></div>
        <div><span>Printer</span><span>${escapeHtml(item.meta?.printer_model || item.meta?.flavor || "—")}</span></div>
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
        <button class="card-open" type="button" id="copyWinFolderBtn" data-label="Copy folder path" ${winFolder ? "" : "disabled"}
          title="${winFolder ? "Copy folder path — paste into Explorer (Ctrl+L)" : "Set a Windows path on this watched folder in Folders"}">Copy folder path</button>
        <button class="card-open secondary slicer-btn" type="button" id="openSlicerBtn"
          ${slicerDisabledReason() ? "disabled" : ""}
          title="${escapeHtml(slicerDisabledReason() || "Open in Bambu Studio or Orca")}">Open in slicer</button>
        <button class="card-open secondary" type="button" id="copyWinPathBtn" data-label="Copy file path" ${winPath ? "" : "disabled"}>Copy file path</button>
        <button class="card-open secondary" type="button" id="copyPiPathBtn" data-label="Copy Pi path">Copy Pi path</button>
      </div>
      <div class="detail-actions danger-actions">
        ${item.hidden
          ? `<button class="card-open secondary" type="button" id="unhideBtn">${selectedIds.size > 1 ? `Unhide ${selectedIds.size}` : "Unhide"}</button>`
          : `<button class="card-open secondary" type="button" id="hideBtn">${selectedIds.size > 1 ? `Hide ${selectedIds.size} from library` : "Hide from library"}</button>`}
        <button class="card-open danger" type="button" id="deleteDiskBtn">${selectedIds.size > 1 ? `Delete ${selectedIds.size} from disk…` : "Delete from disk…"}</button>
      </div>
      <p class="detail-hint">${winFolder
        ? "Copy folder path → Explorer address bar (Ctrl+L → Ctrl+V) to jump straight to the file’s folder."
        : "Set a Windows path on this watched folder in Folders to enable folder / file copy."}</p>
      <p class="detail-hint" id="slicerHint">${canSlicer
        ? (isMobileClient()
          ? "Open in slicer needs Bambu/Orca on a PC. On your phone, use Copy file path."
          : "Open in slicer asks Bambu or Orca, checks manifold (MakerDeck-style sanitize if needed), then hands off via the Windows worker.")
        : item.kind === "gcode"
          ? "Raw G-code is already sliced — open it from the printer or slicer’s G-code preview, or copy the file path."
          : "Slicer open is for STL, OBJ, 3MF, and ZIP printables."}</p>
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
  if ((item.kind === "stl" || item.kind === "obj") && $("manifoldStatus")) {
    api(`/api/assets/${item.id}/manifold?repair=false`)
      .then((m) => {
        const el = $("manifoldStatus");
        if (!el) return;
        if (m.skipped) {
          el.textContent = "—";
          return;
        }
        const before = Number(m.before) || 0;
        el.textContent = before === 0 ? "OK" : `${before.toLocaleString()} open edges`;
        el.style.color = before === 0 ? "var(--ok, #34d399)" : "var(--warn, #fbbf24)";
      })
      .catch(() => {
        const el = $("manifoldStatus");
        if (el) el.textContent = "—";
      });
  }
  $("copyWinPathBtn")?.addEventListener("click", () => copyText($("copyWinPathBtn"), winPath));
  $("copyWinFolderBtn")?.addEventListener("click", () => copyText($("copyWinFolderBtn"), winFolder, "Folder path copied"));
  $("copyPiPathBtn")?.addEventListener("click", () => copyText($("copyPiPathBtn"), item.abs_path));
  $("saveDesignMetaBtn")?.addEventListener("click", async () => {
    const btn = $("saveDesignMetaBtn");
    const tags = parseTagsInput($("designTagsInput")?.value);
    const notes = $("designNotesInput")?.value ?? "";
    if (btn) btn.disabled = true;
    try {
      await api(`/api/assets/${item.id}/design`, {
        method: "PATCH",
        body: JSON.stringify({ tags, notes }),
      });
      psToast("Saved", "Tags and notes updated.", "ok");
      await loadLibrary({ preserveScroll: true });
      await selectAsset(item.id);
    } catch (err) {
      psToast("Save failed", String(err.message || err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
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
    if (isZip) {
      if (zipPrintables.length) {
        const firstBtn = document.querySelector(".zip-entry-btn");
        if (firstBtn) firstBtn.classList.add("active");
        await mountOrbit(false);
      } else if ($("orbitViewer")) {
        $("orbitViewer").innerHTML = `<div class="viewer-status">${hasNested
          ? "Peek a nested archive below to load printables."
          : "No printables loaded yet — peek a nested archive or pick one below."}</div>`;
      }
    } else {
      // STL / OBJ / 3MF — mount immediately (zip-only branch used to skip these).
      await mountOrbit(false);
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

function renderIgnoreGlobs() {
  const el = $("ignoreGlobsInput");
  if (el) el.value = (ignoreGlobs || []).join("\n");
}

async function loadFolders() {
  const cfg = await api("/api/config");
  folders = cfg.watched_folders || [];
  ignoreGlobs = cfg.ignore_globs || [];
  fillRootFilter();
  renderFolders();
  renderIgnoreGlobs();
}

async function saveIgnoreGlobs() {
  const raw = $("ignoreGlobsInput")?.value || "";
  const patterns = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({ watched_folders: folders, ignore_globs: patterns }),
  });
  folders = out.watched_folders || folders;
  ignoreGlobs = out.ignore_globs || patterns;
  fillRootFilter();
  renderFolders();
  renderIgnoreGlobs();
  psToast("Exclude patterns saved", "Takes effect on the next Rescan.", "ok");
}

function renderFolders() {
  const el = $("folderList");
  if (!folders.length) {
    el.innerHTML = `<p class="lede">No folders yet.</p>`;
    return;
  }
  el.innerHTML = folders.map((f, i) => {
    const hint = f.path_hint || (!f.path_ok ? "Path not found on the Pi" : "");
    return `
    <div class="folder-row${f.path_ok === false ? " folder-row-warn" : ""}">
      <div>
        <strong>${escapeHtml(f.label || f.id)}</strong><br>
        <span class="pill">${escapeHtml(f.source_kind)}</span>
        ${f.path_ok === false ? `<span class="pill warn">missing on Pi</span>` : ""}
      </div>
      <div class="detail-path" style="margin:0">
        ${escapeHtml(f.path)}
        ${f.windows_path ? `<br><span class="pill">win</span> ${escapeHtml(f.windows_path)}` : "<br><span class=\"pill\">no Windows path</span>"}
        ${hint ? `<br><span class="folder-path-warn">${escapeHtml(hint)}</span>` : ""}
      </div>
      <button type="button" data-i="${i}" class="secondary remove-folder">Remove</button>
    </div>`;
  }).join("");
  el.querySelectorAll(".remove-folder").forEach((btn) => {
    btn.addEventListener("click", () => {
      folders.splice(Number(btn.dataset.i), 1);
      renderFolders();
    });
  });
}

async function saveFolders() {
  const out = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({ watched_folders: folders }),
  });
  folders = out.watched_folders || folders;
  fillRootFilter();
  renderFolders();
  await refreshStats();
  if (out.warnings?.length) {
    psToast("Folders saved — path problem", out.warnings.join(" · "), "error");
  } else {
    psToast("Folders saved", "Paths look good on the Pi.", "ok");
  }
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
  ["search", "filterSource", "filterRoot", "sortBy", "filterTextures", "filterSliced", "filterHidden"].forEach((id) => {
    $(id)?.addEventListener("input", () => loadLibrary().catch(console.error));
    $(id)?.addEventListener("change", () => loadLibrary().catch(console.error));
  });
  $("typeTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".type-tab");
    if (!btn || btn.hidden) return;
    setActiveKind(btn.dataset.kind || "");
    clearSelection();
    // Duplicates is a flat sweep across the library.
    if ((btn.dataset.kind || "") === "__duplicates__") {
      browseMode = "all";
      document.querySelectorAll(".view-mode").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === "all");
      });
    }
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
    const path = String(fd.get("path") || "").trim();
    const looksWindows = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || (path.includes("\\") && !path.startsWith("/"));
    if (looksWindows) {
      psToast(
        "Use a Pi path",
        "PrintShelf scans from the Pi. Put files on the NAS (/mnt/koko-kidabah/…) or mount that folder on the Pi — C:\\… won’t work here.",
        "error",
      );
      return;
    }
    folders.push({
      id: String(fd.get("id") || "").trim(),
      label: String(fd.get("label") || "").trim(),
      path,
      windows_path: String(fd.get("windows_path") || "").trim(),
      source_kind: String(fd.get("source_kind") || "local"),
    });
    e.target.reset();
    renderFolders();
  });
  $("saveFoldersBtn").addEventListener("click", () => saveFolders().catch(console.error));
  $("saveIgnoreBtn")?.addEventListener("click", () => saveIgnoreGlobs().catch(console.error));
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
