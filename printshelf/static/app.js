const $ = (id) => document.getElementById(id);

let folders = [];
let selectedId = null;
let activeKind = "";

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

async function refreshStats() {
  const s = await api("/api/stats");
  const byKind = s.by_kind || {};
  const kinds = Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no files yet";
  $("railStats").innerHTML = `<strong>${s.assets}</strong> assets<br>${kinds}`;
  updateTypeTabCounts(byKind, s.assets || 0);
  const scan = s.scan || {};
  const thumbs = s.thumbs || {};
  if (thumbs.running) {
    $("scanStatus").textContent = `Rebuilding thumbs… ${thumbs.updated || 0}/${thumbs.checked || 0}`;
  } else if (scan.running) {
    $("scanStatus").textContent = `Scanning… ${scan.files_seen || 0} seen`;
  } else if (thumbs.status === "ok" && thumbs.updated) {
    $("scanStatus").textContent = `Thumbs rebuilt: ${thumbs.updated}`;
  } else {
    $("scanStatus").textContent = scan.status === "ok"
      ? `Last scan: ${scan.files_upserted || 0} indexed`
      : (scan.status || "idle");
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

async function loadLibrary() {
  const params = new URLSearchParams();
  const q = $("search").value.trim();
  const kind = activeKind;
  const source = $("filterSource").value;
  if (q) params.set("q", q);
  if (kind) params.set("kind", kind);
  if (source) params.set("source_kind", source);
  if ($("filterTextures").checked) params.set("has_textures", "true");
  if ($("filterSliced").checked) params.set("is_sliced", "true");
  params.set("limit", "300");
  const data = await api(`/api/assets?${params}`);
  const grid = $("grid");
  grid.innerHTML = "";
  if (!data.items.length) {
    grid.innerHTML = `<div class="detail-empty">No files yet. Add folders and hit Rescan.</div>`;
    return;
  }
  for (const item of data.items) {
    const card = document.createElement("article");
    card.className = "card" + (item.id === selectedId ? " active" : "");
    card.innerHTML = `
      <div class="card-thumb">${item.thumb_path ? `<img src="/api/thumbs/${encodeURIComponent(item.thumb_path)}?v=${encodeURIComponent((item.content_hash || item.thumb_path).slice(0, 12))}" alt="" loading="lazy">` : `<span class="pill">${item.kind}</span>`}</div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(item.file_name)}</h3>
        <div class="card-meta">
          <span class="pill">${escapeHtml(item.kind)}</span>
          <span>${escapeHtml(item.source_kind)}</span>
          ${item.has_textures ? "<span>textures</span>" : ""}
          ${item.is_sliced ? "<span>sliced</span>" : ""}
        </div>
      </div>`;
    card.addEventListener("click", () => selectAsset(item.id));
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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
  setTimeout(() => { btn.textContent = prev; }, 1600);
}

async function selectAsset(id) {
  selectedId = id;
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("active"));
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  const item = await api(`/api/assets/${id}`);
  const filaments = item.meta?.filaments || [];
  const sidecars = item.sidecars || [];
  const winPath = item.windows_path || "";
  const winFolder = item.windows_folder || "";
  const canOrbit = item.can_orbit || item.kind === "stl" || item.kind === "obj";
  $("detail").innerHTML = `
    <h2>${escapeHtml(item.file_name)}</h2>
    <div class="detail-path">${escapeHtml(item.abs_path)}</div>
    ${winPath ? `<div class="detail-path" title="Windows path">${escapeHtml(winPath)}</div>` : ""}
    <div class="detail-section viewer-section">
      <h3>3D preview</h3>
      ${canOrbit
        ? `<div class="orbit-viewer" id="orbitViewer"></div>
           <p class="viewer-note" id="orbitNote" hidden></p>`
        : `<p class="detail-hint">Orbit preview is available for STL and OBJ. 3MF stays thumbnail-only for now.</p>`}
    </div>
    <div class="kv">
      <div><span>Design</span><span>${escapeHtml(item.design_name)}</span></div>
      <div><span>Type</span><span>${escapeHtml(item.kind)}</span></div>
      <div><span>Source</span><span>${escapeHtml(item.source_kind)} · ${escapeHtml(item.root_id)}</span></div>
      <div><span>Size</span><span>${fmtBytes(item.size_bytes)}</span></div>
      <div><span>Triangles / faces</span><span>${item.triangle_count ?? "—"}</span></div>
      <div><span>Textures</span><span>${item.has_textures ? "yes" : "no"}</span></div>
      <div><span>Sliced</span><span>${item.is_sliced ? "yes" : "no"}</span></div>
    </div>
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
        <button class="card-open" type="button" id="copyWinPathBtn" data-label="Copy Windows path" ${winPath ? "" : "disabled"}>Copy Windows path</button>
        <button class="card-open secondary" type="button" id="copyWinFolderBtn" data-label="Copy Windows folder" ${winFolder ? "" : "disabled"}>Copy Windows folder</button>
        <button class="card-open secondary" type="button" id="copyPiPathBtn" data-label="Copy Pi path">Copy Pi path</button>
      </div>
      <p class="detail-hint">${winPath
        ? "Paste Windows path into Bambu/Orca, or folder into Explorer (Ctrl+L → Ctrl+V)."
        : "Set a Windows path on this watched folder in Folders to enable PC copy."}</p>
    </div>`;
  $("copyWinPathBtn")?.addEventListener("click", () => copyText($("copyWinPathBtn"), winPath));
  $("copyWinFolderBtn")?.addEventListener("click", () => copyText($("copyWinFolderBtn"), winFolder, "Folder copied"));
  $("copyPiPathBtn")?.addEventListener("click", () => copyText($("copyPiPathBtn"), item.abs_path));
  if (canOrbit) {
    for (let i = 0; i < 40 && !window.PrintShelfViewer?.mountOrbitViewer; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (window.PrintShelfViewer?.mountOrbitViewer) {
      await window.PrintShelfViewer.mountOrbitViewer($("orbitViewer"), {
        url: `/api/assets/${id}/model`,
        noteEl: $("orbitNote"),
      });
    } else if ($("orbitViewer")) {
      $("orbitViewer").innerHTML = `<div class="viewer-status error">3D viewer failed to load (check network / CDN).</div>`;
    }
  }
  await loadLibrary();
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
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  ["search", "filterSource", "filterTextures", "filterSliced"].forEach((id) => {
    $(id).addEventListener("input", () => loadLibrary().catch(console.error));
    $(id).addEventListener("change", () => loadLibrary().catch(console.error));
  });
  $("typeTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".type-tab");
    if (!btn) return;
    setActiveKind(btn.dataset.kind || "");
    loadLibrary().catch(console.error);
  });
  $("scanBtn").addEventListener("click", async () => {
    $("scanBtn").disabled = true;
    try {
      await api("/api/scan", { method: "POST", body: "{}" });
      const poll = setInterval(async () => {
        const st = await api("/api/scan");
        $("scanStatus").textContent = st.running
          ? `Scanning… ${st.files_seen || 0} seen / ${st.files_upserted || 0} indexed`
          : `Done · ${st.files_upserted || 0} indexed`;
        if (!st.running) {
          clearInterval(poll);
          $("scanBtn").disabled = false;
          await refreshStats();
          await loadLibrary();
        }
      }, 800);
    } catch (err) {
      $("scanStatus").textContent = String(err.message || err);
      $("scanBtn").disabled = false;
    }
  });
  $("rebuildThumbsBtn").addEventListener("click", async () => {
    $("rebuildThumbsBtn").disabled = true;
    try {
      await api("/api/thumbs/rebuild", { method: "POST", body: "{}" });
      const poll = setInterval(async () => {
        const st = await api("/api/thumbs/rebuild");
        $("scanStatus").textContent = st.running
          ? `Rebuilding thumbs… ${st.updated || 0} updated / ${st.checked || 0} checked`
          : `Thumbs done · ${st.updated || 0} updated`;
        if (!st.running) {
          clearInterval(poll);
          $("rebuildThumbsBtn").disabled = false;
          await refreshStats();
          await loadLibrary();
        }
      }, 1000);
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
