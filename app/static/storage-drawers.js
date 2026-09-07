const DRAWER_RE = /^D([1-6]) R([1-3]) #(\d{1,3})$/;
const LEGACY_RE = /^Shelf #\d+$/i;
const SUNLU_NAME = "SUNLU Dryer";

let refreshTimer = null;
let observer = null;
let assigning = false;
let selectedSpoolId = null;
let lastSnapshot = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function activeOnSpoolsPage() {
  return location.hash === "#/spools" || location.hash.startsWith("#/spools/");
}

function drawerMeta(location) {
  const match = DRAWER_RE.exec(String(location?.name || "").trim());
  if (!match) return null;
  return {
    drawer: Number(match[1]),
    row: Number(match[2]),
    number: Number(match[3]),
  };
}

function spoolDisplayId(spool) {
  return spool?.display_id ?? spool?.id ?? "?";
}

function spoolName(spool) {
  const material = spool?.material || "Filament";
  const subtype = spool?.subtype ? ` ${spool.subtype}` : "";
  const colour = spool?.color_name || spool?.colour_name || "Unknown colour";
  return `${material}${subtype} · ${colour}`;
}

function spoolBrand(spool) {
  return spool?.brand || "Unknown brand";
}

function spoolColour(spool) {
  const raw = String(spool?.color_hex || spool?.colour_hex || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : "#64748b";
}

function isArchived(spool) {
  return Boolean(spool?.archived_at);
}

function currentLocationId(spool) {
  const value = spool?.storage_location_id;
  return value == null ? null : Number(value);
}

function homeLocationId(spool) {
  const value = spool?.home_storage_location_id;
  return value == null ? null : Number(value);
}

function currentPrinter(spool) {
  return spool?.location_printer_id || null;
}

function currentPrinterSlot(spool) {
  const value = spool?.location_slot;
  return value == null ? null : Number(value);
}

function locationsById(locations) {
  return new Map(locations.map(loc => [Number(loc.id), loc]));
}

function locationName(id, byId) {
  if (id == null) return "Unassigned";
  return byId.get(Number(id))?.name || `Location ${id}`;
}

function effectiveHome(spool, byId) {
  const homeId = homeLocationId(spool);
  if (homeId != null) return byId.get(homeId) || null;
  const currentId = currentLocationId(spool);
  const current = currentId != null ? byId.get(currentId) : null;
  return drawerMeta(current) ? current : null;
}

function quickAssignReason(spool, byId) {
  const existingHome = effectiveHome(spool, byId);
  if (drawerMeta(existingHome)) return { eligible: false, label: "Drawer home already set" };
  if (currentPrinter(spool)) {
    const slot = currentPrinterSlot(spool);
    return { eligible: false, label: `Currently loaded${slot != null ? ` · slot ${slot + 1}` : ""}` };
  }
  const current = byId.get(currentLocationId(spool));
  if (current?.name === SUNLU_NAME) return { eligible: false, label: "Currently in SUNLU · home preserved" };
  if (!current) return { eligible: false, label: "No current storage location" };
  if (drawerMeta(current)) return { eligible: false, label: "Already in drawer storage" };
  return { eligible: true, label: `Stored at ${current.name}` };
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) { /* response may be empty */ }
  if (!response.ok) {
    const detail = payload?.detail?.message || payload?.detail || payload?.message || `HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return payload;
}

async function loadSnapshot() {
  const [spools, locations] = await Promise.all([
    apiJson("/api/spools"),
    apiJson("/api/spool-locations"),
  ]);
  return {
    spools: Array.isArray(spools) ? spools.filter(s => !isArchived(s)) : [],
    locations: Array.isArray(locations) ? locations : [],
  };
}

function statusForHomeSpool(spool, homeLoc, byId) {
  if (!spool) return { text: "Empty", className: "empty" };
  const printer = currentPrinter(spool);
  if (printer) {
    const slot = currentPrinterSlot(spool);
    return { text: `Away · ${printer}${slot != null ? ` slot ${slot + 1}` : ""}`, className: "away" };
  }
  const currentId = currentLocationId(spool);
  if (currentId === Number(homeLoc.id)) return { text: "Home", className: "home" };
  const current = byId.get(currentId);
  if (current?.name === SUNLU_NAME) return { text: "Away · SUNLU", className: "sunlu" };
  if (current) return { text: `Away · ${current.name}`, className: "away" };
  return { text: "Home reserved", className: "away" };
}

function buildSnapshotModel(snapshot) {
  const byId = locationsById(snapshot.locations);
  const drawers = snapshot.locations
    .map(loc => ({ loc, meta: drawerMeta(loc) }))
    .filter(item => item.meta)
    .sort((a, b) => a.meta.number - b.meta.number);

  const homeSpoolByLocation = new Map();
  for (const spool of snapshot.spools) {
    const home = effectiveHome(spool, byId);
    if (home && drawerMeta(home) && !homeSpoolByLocation.has(Number(home.id))) {
      homeSpoolByLocation.set(Number(home.id), spool);
    }
  }

  const quickCandidates = snapshot.spools
    .map(spool => ({ spool, reason: quickAssignReason(spool, byId) }))
    .filter(item => !drawerMeta(effectiveHome(item.spool, byId)))
    .sort((a, b) => Number(spoolDisplayId(a.spool)) - Number(spoolDisplayId(b.spool)));

  return { byId, drawers, homeSpoolByLocation, quickCandidates };
}

function drawerHtml(drawerNumber, rows, model) {
  const used = rows.filter(item => model.homeSpoolByLocation.has(Number(item.loc.id))).length;
  const first = rows[0]?.meta?.number ?? "?";
  const last = rows.at(-1)?.meta?.number ?? "?";
  const rowGroups = [1, 2, 3].map(rowNumber => {
    const slots = rows.filter(item => item.meta.row === rowNumber);
    return `
      <div class="fd-storage-row">
        <div class="fd-storage-row-label">R${rowNumber}</div>
        <div class="fd-storage-slots">
          ${slots.map(item => slotHtml(item, model)).join("")}
        </div>
      </div>`;
  }).join("");

  return `
    <section class="fd-storage-drawer" data-drawer="${drawerNumber}">
      <header class="fd-storage-drawer-head">
        <div>
          <strong>D${drawerNumber}</strong>
          <span>#${first}–#${last}</span>
        </div>
        <span class="fd-storage-count">${used}/27 home slots</span>
      </header>
      ${rowGroups}
    </section>`;
}

function slotHtml(item, model) {
  const loc = item.loc;
  const spool = model.homeSpoolByLocation.get(Number(loc.id));
  const status = statusForHomeSpool(spool, loc, model.byId);
  const selected = assigning && selectedSpoolId != null;
  const occupied = Boolean(spool);
  const targetClass = selected && !occupied ? " assign-target" : "";
  const colour = spool ? spoolColour(spool) : "transparent";
  const tooltip = spool
    ? `Spool #${spoolDisplayId(spool)} · ${spoolBrand(spool)} · ${spoolName(spool)} · ${status.text}`
    : `${loc.name} · empty`;
  return `
    <button class="fd-storage-slot ${occupied ? "occupied" : "empty"}${targetClass}"
            type="button"
            data-location-id="${loc.id}"
            data-slot-number="${item.meta.number}"
            ${occupied ? "data-occupied=\"1\"" : ""}
            title="${esc(tooltip)}">
      <span class="fd-storage-slot-no">#${item.meta.number}</span>
      ${spool ? `<span class="fd-storage-swatch" style="--spool-colour:${esc(colour)}"></span>` : `<span class="fd-storage-plus">+</span>`}
      <span class="fd-storage-slot-main">${spool ? `S${esc(spoolDisplayId(spool))}` : "Empty"}</span>
      <span class="fd-storage-slot-status ${status.className}">${esc(status.text)}</span>
    </button>`;
}

function quickAssignHtml(model) {
  const candidates = model.quickCandidates;
  const eligible = candidates.filter(item => item.reason.eligible);
  const blocked = candidates.filter(item => !item.reason.eligible);
  const selected = eligible.find(item => Number(item.spool.id) === Number(selectedSpoolId));

  return `
    <section class="fd-storage-quick ${assigning ? "is-open" : ""}" ${assigning ? "" : "hidden"}>
      <div class="fd-storage-quick-head">
        <div>
          <strong>Fast initial assignment</strong>
          <span>Pick the spool in your hand, then click its empty drawer position.</span>
        </div>
        <button type="button" class="fd-storage-btn ghost" data-storage-action="close-quick">Done</button>
      </div>
      <div class="fd-storage-quick-grid">
        <div class="fd-storage-candidates">
          <div class="fd-storage-candidate-title">Ready to assign <span>${eligible.length}</span></div>
          ${eligible.length ? eligible.map(item => candidateHtml(item, model, true)).join("") : `<div class="fd-storage-empty-note">No legacy-stored spools need a drawer home. 🎉</div>`}
        </div>
        <div class="fd-storage-quick-info">
          <div class="fd-storage-selected ${selected ? "has-selection" : ""}">
            ${selected ? `
              <span class="fd-storage-swatch big" style="--spool-colour:${esc(spoolColour(selected.spool))}"></span>
              <div><b>Spool #${esc(spoolDisplayId(selected.spool))}</b><span>${esc(spoolBrand(selected.spool))} · ${esc(spoolName(selected.spool))}</span></div>
              <strong>Now click an empty drawer slot →</strong>` : `
              <div><b>Select a spool</b><span>Then the empty drawer slots light up.</span></div>`}
          </div>
          ${blocked.length ? `
            <details class="fd-storage-protected">
              <summary>${blocked.length} protected / away spool${blocked.length === 1 ? "" : "s"}</summary>
              <div class="fd-storage-protected-list">${blocked.map(item => candidateHtml(item, model, false)).join("")}</div>
            </details>` : ""}
        </div>
      </div>
    </section>`;
}

function candidateHtml(item, model, enabled) {
  const spool = item.spool;
  const selected = enabled && Number(spool.id) === Number(selectedSpoolId);
  return `
    <button type="button"
            class="fd-storage-candidate ${selected ? "selected" : ""} ${enabled ? "" : "blocked"}"
            ${enabled ? `data-spool-id="${spool.id}"` : "disabled"}>
      <span class="fd-storage-swatch" style="--spool-colour:${esc(spoolColour(spool))}"></span>
      <span class="fd-storage-candidate-copy">
        <b>#${esc(spoolDisplayId(spool))} · ${esc(spoolBrand(spool))}</b>
        <span>${esc(spoolName(spool))}</span>
      </span>
      <em>${esc(item.reason.label)}</em>
    </button>`;
}

function storageHtml(snapshot) {
  const model = buildSnapshotModel(snapshot);
  const drawerLocations = model.drawers.length;
  const occupiedHomes = model.homeSpoolByLocation.size;
  const sunlu = snapshot.locations.find(loc => loc.name === SUNLU_NAME);
  const sunluSpools = sunlu
    ? snapshot.spools.filter(spool => currentLocationId(spool) === Number(sunlu.id))
    : [];
  const legacySpools = model.quickCandidates.filter(item => item.reason.eligible).length;

  const drawers = [1, 2, 3, 4, 5, 6].map(number => {
    const rows = model.drawers.filter(item => item.meta.drawer === number);
    return drawerHtml(number, rows, model);
  }).join("");

  return `
    <div class="fd-storage-shell">
      <section class="fd-storage-hero">
        <div>
          <span class="fd-storage-kicker">FLIGHTDECK STORAGE</span>
          <h2>Six-drawer spool home</h2>
          <p>D1–D6 · R1–R3 · positions #1–162. Home stays reserved while a spool is loaded or visiting SUNLU.</p>
        </div>
        <div class="fd-storage-actions">
          <button type="button" class="fd-storage-btn primary" data-storage-action="quick">${assigning ? "Assigning…" : "Fast assign"}</button>
          <button type="button" class="fd-storage-btn" data-storage-action="refresh">Refresh</button>
        </div>
      </section>

      <section class="fd-storage-stats">
        <div><b>${drawerLocations}</b><span>drawer positions</span></div>
        <div><b>${occupiedHomes}</b><span>homes assigned</span></div>
        <div><b>${162 - occupiedHomes}</b><span>homes free</span></div>
        <div class="${legacySpools ? "needs-action" : ""}"><b>${legacySpools}</b><span>legacy spools to place</span></div>
        <div class="sunlu"><b>${sunluSpools.length}</b><span>currently in SUNLU</span></div>
      </section>

      ${quickAssignHtml(model)}

      <div class="fd-storage-drawers">${drawers}</div>

      <section class="fd-storage-legend">
        <span><i class="home"></i> At home</span>
        <span><i class="away"></i> Home reserved, spool away</span>
        <span><i class="sunlu"></i> In SUNLU temporarily</span>
        <span><i class="empty"></i> Empty home</span>
      </section>
    </div>`;
}

function ensureRoot() {
  if (!activeOnSpoolsPage()) return null;
  const body = document.getElementById("spools-body");
  if (!body) return null;
  let root = document.getElementById("fd-drawer-storage");
  if (!root) {
    root = document.createElement("div");
    root.id = "fd-drawer-storage";
    body.prepend(root);
  } else if (body.firstElementChild !== root) {
    body.prepend(root);
  }
  return root;
}

function bindInteractions(root, snapshot) {
  root.querySelector('[data-storage-action="refresh"]')?.addEventListener("click", () => refresh(true));
  root.querySelector('[data-storage-action="quick"]')?.addEventListener("click", () => {
    assigning = true;
    renderSnapshot(snapshot);
  });
  root.querySelector('[data-storage-action="close-quick"]')?.addEventListener("click", () => {
    assigning = false;
    selectedSpoolId = null;
    renderSnapshot(snapshot);
  });

  root.querySelectorAll("[data-spool-id]").forEach(button => {
    button.addEventListener("click", () => {
      selectedSpoolId = Number(button.dataset.spoolId);
      renderSnapshot(snapshot);
    });
  });

  root.querySelectorAll(".fd-storage-slot.assign-target").forEach(button => {
    button.addEventListener("click", async () => {
      if (!selectedSpoolId || button.dataset.occupied === "1") return;
      const locationId = Number(button.dataset.locationId);
      const slotNumber = Number(button.dataset.slotNumber);
      await assignSelectedSpool(locationId, slotNumber);
    });
  });
}

function renderSnapshot(snapshot) {
  lastSnapshot = snapshot;
  const root = ensureRoot();
  if (!root) return;
  root.innerHTML = storageHtml(snapshot);
  bindInteractions(root, snapshot);
}

function flash(message, kind = "ok") {
  const root = document.getElementById("fd-drawer-storage");
  if (!root) return;
  let node = root.querySelector(".fd-storage-toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "fd-storage-toast";
    root.append(node);
  }
  node.className = `fd-storage-toast ${kind}`;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

async function assignSelectedSpool(locationId, slotNumber) {
  if (!selectedSpoolId) return;
  const spool = lastSnapshot?.spools?.find(s => Number(s.id) === Number(selectedSpoolId));
  const model = lastSnapshot ? buildSnapshotModel(lastSnapshot) : null;
  const eligibility = spool && model ? quickAssignReason(spool, model.byId) : null;
  if (!spool || !eligibility?.eligible) {
    flash("That spool is no longer safe for Fast Assign. Refreshing…", "warn");
    await refresh(true);
    return;
  }

  const oldId = selectedSpoolId;
  try {
    await apiJson(`/api/spools/${oldId}/move`, {
      method: "POST",
      body: JSON.stringify({
        printer_id: null,
        slot: null,
        storage_location_id: locationId,
        replace_existing: false,
        sync_ams: false,
      }),
    });
    selectedSpoolId = null;
    const snapshot = await loadSnapshot();
    const nextModel = buildSnapshotModel(snapshot);
    const next = nextModel.quickCandidates.find(item => item.reason.eligible);
    if (assigning && next) selectedSpoolId = Number(next.spool.id);
    renderSnapshot(snapshot);
    flash(`Spool #${spoolDisplayId(spool)} → position #${slotNumber}. Home and current updated.`, "ok");
  } catch (error) {
    selectedSpoolId = oldId;
    flash(`Could not assign: ${error.message}`, "error");
  }
}

async function refresh(showFeedback = false) {
  if (!activeOnSpoolsPage()) return;
  const root = ensureRoot();
  if (!root) return;
  root.classList.add("is-loading");
  try {
    const snapshot = await loadSnapshot();
    renderSnapshot(snapshot);
    if (showFeedback) flash("Drawer storage refreshed.", "ok");
  } catch (error) {
    root.innerHTML = `
      <div class="fd-storage-load-error">
        <b>Drawer storage could not load</b>
        <span>${esc(error.message)}</span>
        <button type="button" class="fd-storage-btn" data-storage-action="refresh">Try again</button>
      </div>`;
    root.querySelector('[data-storage-action="refresh"]')?.addEventListener("click", () => refresh(true));
  } finally {
    root.classList.remove("is-loading");
  }
}

function scheduleRefresh() {
  clearTimeout(scheduleRefresh._timer);
  scheduleRefresh._timer = setTimeout(() => refresh(false), 120);
}

function boot() {
  window.addEventListener("hashchange", scheduleRefresh);
  observer = new MutationObserver(() => {
    if (!activeOnSpoolsPage()) return;
    const body = document.getElementById("spools-body");
    if (!body) return;
    const root = document.getElementById("fd-drawer-storage");
    if (!root || root.parentElement !== body) scheduleRefresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleRefresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
