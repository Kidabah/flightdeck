const $ = (id) => document.getElementById(id);

let selected = null;
let browse = { path: "", name: "" };
let folderBrowse = null;
let addingTo = "";
let printableWas = null;
let pickAnchor = null;
const picked = new Map();
let libraryBrowse = null;
let searchQuery = "";
let searchToken = 0;
let searchTimer = 0;
let galleryOffset = 0;
let cols = "4";
const favourites = new Set();
const thumbCache = new Map();
const thumbQueue = [];
let thumbBusy = false;

function fileUrl(item) {
  const q = new URLSearchParams({ path: item.path, entry: item.entry || "" });
  return `/api/file?${q}`;
}

function previewUrl(item) {
  const q = new URLSearchParams({ path: item.path, entry: item.entry || "" });
  return `/api/preview?${q}`;
}

function thumbRank(item) {
  const kind = item.kind === "stl" ? 0 : 1;
  return kind * 1e15 + (Number(item.size) || 0);
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function hideStage() {
  $("viewer").hidden = true;
  $("picture").hidden = true;
  $("doc").hidden = true;
  $("empty").hidden = true;
  $("gallery").hidden = true;
  window.MeshFinderViewer?.unmountViewer?.();
}

function showEmpty(text) {
  hideStage();
  $("empty").hidden = false;
  $("empty").textContent = text;
  $("backBtn").hidden = !browse.path;
}

function showGallery() {
  hideStage();
  $("gallery").hidden = false;
  $("backBtn").hidden = true;
  $("openFile").disabled = true;
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function pumpThumbs() {
  if (thumbBusy) return;
  if (!window.MeshFinderViewer?.renderThumb) {
    setTimeout(pumpThumbs, 50);
    return;
  }
  const job = thumbQueue.shift();
  if (!job) return;
  if (!job.img.isConnected) {
    pumpThumbs();
    return;
  }
  thumbBusy = true;
  window.MeshFinderViewer.renderThumb(previewUrl(job.item), job.item.kind)
    .then((url) => {
      thumbCache.set(job.key, url);
      if (job.img.isConnected) job.img.src = url;
    })
    .catch(() => {})
    .finally(() => {
      thumbBusy = false;
      pumpThumbs();
    });
}

function queueThumb(item, img) {
  const key = `${item.path}\n${item.entry || ""}`;
  if (thumbCache.has(key)) {
    img.src = thumbCache.get(key);
    return;
  }
  thumbQueue.push({ item, img, key });
  thumbQueue.sort((a, b) => thumbRank(a.item) - thumbRank(b.item));
  pumpThumbs();
}

function favKey(item) {
  return `${item.path}\n${item.entry || ""}`;
}

function zipName(item) {
  if (!item.entry) return "";
  const parts = String(item.path || "").split(/[/\\]/);
  return parts[parts.length - 1] || "";
}

function paintHeart(button, on) {
  button.classList.toggle("on", on);
  button.textContent = on ? "♥" : "♡";
  button.title = on ? "Remove from favourites" : "Add to favourites";
}

async function refreshFavs() {
  const data = await api("/api/favourites");
  favourites.clear();
  for (const item of data.items || []) favourites.add(favKey(item));
  return data.items || [];
}

async function toggleFav(item, button) {
  const key = favKey(item);
  if (favourites.has(key)) {
    const q = new URLSearchParams({ path: item.path, entry: item.entry || "" });
    await api(`/api/favourites?${q}`, { method: "DELETE" });
    favourites.delete(key);
    paintHeart(button, false);
    if (browse.path === "favourites") button.closest(".model-card")?.remove();
    return;
  }
  await api("/api/favourites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: item.path,
      entry: item.entry || "",
      name: item.name,
      kind: item.kind,
      size: item.size || 0,
    }),
  });
  favourites.add(key);
  paintHeart(button, true);
}

function renderCard(item) {
  const card = document.createElement("div");
  card.className = "model-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.dataset.key = favKey(item);
  const thumb = document.createElement("div");
  thumb.className = "model-thumb";
  const img = document.createElement("img");
  img.alt = "";
  const kind = document.createElement("span");
  kind.className = "model-kind";
  kind.textContent = item.kind.toUpperCase();
  thumb.appendChild(kind);
  const heart = document.createElement("button");
  heart.type = "button";
  heart.className = "fav-btn";
  paintHeart(heart, favourites.has(favKey(item)));
  heart.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFav(item, heart).catch((err) => showEmpty(err.message || String(err)));
  });
  thumb.appendChild(heart);
  if (item.kind === "image" || item.kind === "svg") {
    img.src = fileUrl(item);
    thumb.appendChild(img);
    kind.remove();
  } else if (item.kind === "stl" || item.kind === "obj" || item.kind === "3mf" || item.kind === "gcode.3mf") {
    img.src = previewUrl(item);
    thumb.appendChild(img);
    img.addEventListener("load", () => kind.remove());
  }
  const body = document.createElement("div");
  body.className = "model-body";
  const tags = document.createElement("div");
  tags.className = "model-tags";
  const pill = document.createElement("span");
  pill.className = "kind-pill";
  pill.textContent = item.kind.toUpperCase();
  tags.appendChild(pill);
  const zip = zipName(item);
  if (zip) {
    const zipEl = document.createElement("span");
    zipEl.className = "zip-name";
    zipEl.title = zip;
    zipEl.textContent = zip;
    tags.appendChild(zipEl);
  }
  const name = document.createElement("div");
  name.className = "model-name";
  name.textContent = item.name;
  name.title = item.name;
  const meta = document.createElement("div");
  meta.className = "model-meta";
  meta.textContent = fmtBytes(item.size);
  body.appendChild(tags);
  body.appendChild(name);
  body.appendChild(meta);
  card.appendChild(thumb);
  card.appendChild(body);
  card._item = item;
  if (picked.has(favKey(item))) card.classList.add("picked");
  card.addEventListener("click", (event) => {
    if (!addingTo) {
      selectFile(item, card);
      return;
    }
    if (event.shiftKey && pickAnchor) {
      event.preventDefault();
      selectPickRange(pickAnchor, card);
      return;
    }
    togglePick(item, card);
    pickAnchor = card;
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showCardMenu(event.clientX, event.clientY, item, card);
  });
  return card;
}

async function loadGallery(path, name, { append = false } = {}) {
  if (!append) {
    browse = { path, name: name || path };
    galleryOffset = 0;
    thumbQueue.length = 0;
    $("gallery").innerHTML = `<div class="note">Gathering models…</div>`;
    showGallery();
  }
  const q = new URLSearchParams({
    path,
    recursive: $("showAll").checked ? "1" : "0",
    printable: $("printable").checked ? "1" : "0",
    offset: String(galleryOffset),
    limit: "120",
  });
  const data = await api(`/api/gallery?${q}`);
  const host = $("gallery");
  if (!append) host.innerHTML = "";
  host.querySelector(".more-row")?.remove();
  const items = data.items || [];
  if (!items.length && !append) {
    host.innerHTML = `<div class="note">Nothing in this folder. Open one on the left, or turn on All to include subfolders.</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  galleryOffset += items.length;
  const shown = galleryOffset;
  const more = data.truncated ? " · more below" : "";
  $("crumb").textContent = `${browse.name || "Library"} · ${shown} shown${more}`;
  if (data.truncated) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "text-btn more-row";
    moreBtn.textContent = "Show more";
    moreBtn.addEventListener("click", () => {
      loadGallery(browse.path, browse.name, { append: true }).catch((err) => showEmpty(err.message || String(err)));
    });
    host.appendChild(moreBtn);
  }
}

function leaveSearch() {
  searchToken += 1;
  searchQuery = "";
  const back = libraryBrowse;
  if (!back?.path || back.path === "search") return;
  if (back.path === "favourites") {
    showFavourites().catch((err) => showEmpty(err.message || String(err)));
    return;
  }
  loadGallery(back.path, back.name).catch((err) => showEmpty(err.message || String(err)));
}

async function loadSearch(query, { append = false } = {}) {
  const token = ++searchToken;
  const sameQuery = searchQuery === query && browse.path === "search";
  searchQuery = query;
  if (browse.path !== "search") libraryBrowse = { path: browse.path, name: browse.name };
  if (!append) {
    browse = { path: "search", name: "Search" };
    galleryOffset = 0;
    thumbQueue.length = 0;
    if (!sameQuery) $("gallery").innerHTML = `<div class="note">Searching…</div>`;
    showGallery();
  }
  const q = new URLSearchParams({
    q: query,
    printable: $("printable").checked ? "1" : "0",
    offset: String(galleryOffset),
    limit: "120",
  });
  const data = await api(`/api/search?${q}`);
  if (token !== searchToken) return;
  const host = $("gallery");
  if (!append) host.innerHTML = "";
  host.querySelector(".more-row")?.remove();
  const items = data.items || [];
  if (!items.length && !append) {
    const hint = data.indexing
      ? "Searching file names…"
      : ($("printable").checked
        ? "Nothing matched. Turn Printable off to include pictures, SVGs, and documents."
        : "Nothing matched.");
    host.innerHTML = `<div class="note">${hint}</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  galleryOffset += items.length;
  const more = data.truncated ? " · more below" : "";
  const pending = data.indexing ? " · still reading zip files" : "";
  $("crumb").textContent = `Search “${query}” · ${galleryOffset} shown${more}${pending}`;
  if (data.indexing && token === searchToken) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (searchQuery === query) {
        loadSearch(query).catch((err) => showEmpty(err.message || String(err)));
      }
    }, 2000);
  }
  if (data.truncated) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "text-btn more-row";
    moreBtn.textContent = "Show more";
    moreBtn.addEventListener("click", () => {
      loadSearch(searchQuery, { append: true }).catch((err) => showEmpty(err.message || String(err)));
    });
    host.appendChild(moreBtn);
  }
}

async function selectFile(item, card) {
  selected = item;
  document.querySelectorAll(".model-card").forEach((el) => el.classList.remove("active"));
  card?.classList.add("active");
  $("openFile").disabled = false;
  $("backBtn").hidden = false;
  $("crumb").textContent = item.entry ? `${item.name}` : item.path;
  const url = fileUrl(item);
  if (item.kind === "stl" || item.kind === "obj" || item.kind === "3mf" || item.kind === "gcode.3mf") {
    hideStage();
    $("backBtn").hidden = false;
    $("viewer").hidden = false;
    if (!window.MeshFinderViewer?.mountViewer) {
      showEmpty("The 3D viewer did not start.");
      return;
    }
    try {
      await window.MeshFinderViewer.mountViewer($("viewer"), { url, kind: item.kind });
    } catch (err) {
      showEmpty(err.message || String(err));
    }
    return;
  }
  if (item.kind === "image" || item.kind === "svg") {
    hideStage();
    $("backBtn").hidden = false;
    $("picture").hidden = false;
    $("picture").innerHTML = "";
    const img = document.createElement("img");
    img.alt = item.name;
    img.src = url;
    $("picture").appendChild(img);
    return;
  }
  if (item.kind === "doc") {
    hideStage();
    $("backBtn").hidden = false;
    $("doc").hidden = false;
    $("doc").innerHTML = "";
    if (item.name.toLowerCase().endsWith(".pdf")) {
      const frame = document.createElement("iframe");
      frame.src = url;
      $("doc").appendChild(frame);
      return;
    }
    const res = await fetch(url);
    $("doc").textContent = await res.text();
    return;
  }
  showEmpty("This one opens with Open in slicer.");
  $("backBtn").hidden = false;
}

function folderRow(item, depth) {
  const wrap = document.createElement("div");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.dataset.path = item.path;
  row.dataset.depth = String(depth);
  row.style.paddingLeft = `${8 + depth * 14}px`;
  const mark = item.kind === "zip" || item.kind === "zipdir" ? "zip" : "dir";
  row.innerHTML = `<span class="mark">${mark}</span><span class="name"></span>`;
  row.querySelector(".name").textContent = item.name;
  const children = document.createElement("div");
  children.className = "tree-children";
  children.hidden = true;
  row.addEventListener("contextmenu", (event) => {
    if (item.kind === "zipdir") return;
    event.preventDefault();
    event.stopPropagation();
    showTreeMenu(event.clientX, event.clientY, item);
  });
  row.addEventListener("click", async () => {
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    $("search").value = "";
    searchQuery = "";
    searchToken += 1;
    await loadGallery(item.path, item.name);
    children.hidden = false;
    if (children.childElementCount) return;
    const q = new URLSearchParams({ path: item.path });
    if (item.prefix) q.set("prefix", item.prefix);
    const data = await api(`/api/list?${q}`);
    const folders = (data.folders || []).slice(0, 400);
    if (!folders.length) {
      children.innerHTML = `<div class="note">No folders inside.</div>`;
      return;
    }
    for (const folder of folders) children.appendChild(folderRow(folder, depth + 1));
  });
  wrap.appendChild(row);
  wrap.appendChild(children);
  return wrap;
}

function rememberFolder() {
  if (browse.path && !["favourites", "search", "collections"].includes(browse.path)) {
    folderBrowse = { path: browse.path, name: browse.name };
  }
}

function collectionsRow() {
  const wrap = document.createElement("div");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.style.paddingLeft = "8px";
  row.innerHTML = `<span class="mark">col</span><span class="name">Collections</span>`;
  row.addEventListener("click", async () => {
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    $("search").value = "";
    searchQuery = "";
    searchToken += 1;
    await showCollections();
  });
  wrap.appendChild(row);
  return wrap;
}

async function showCollections() {
  rememberFolder();
  browse = { path: "collections", name: "Collections" };
  showGallery();
  const data = await api("/api/collections");
  const groups = data.items || [];
  const host = $("gallery");
  host.innerHTML = "";
  const page = document.createElement("div");
  page.className = "collect-page";
  page.innerHTML = `<div class="collect-head"><div><div class="collect-name">Collections</div><div class="collect-meta">${groups.length} collection${groups.length === 1 ? "" : "s"}</div></div><button type="button" class="open-btn" data-act="new">New collection</button></div>`;
  const list = document.createElement("div");
  list.className = "collect-list";
  if (!groups.length) {
    list.innerHTML = `<div class="note">No collections yet. Create one to group files across folders.</div>`;
  }
  for (const group of groups) list.appendChild(collectionCard(group));
  page.appendChild(list);
  host.appendChild(page);
  $("crumb").textContent = `Collections · ${groups.length}`;
}

function collectionCard(group) {
  const card = document.createElement("div");
  card.className = "collect-card";
  const count = (group.items || []).length;
  const info = document.createElement("div");
  const title = document.createElement("button");
  title.type = "button";
  title.className = "text-btn collect-name";
  title.textContent = group.name;
  title.addEventListener("click", () => showCollection(group));
  const meta = document.createElement("div");
  meta.className = "collect-meta";
  meta.textContent = count === 1 ? "1 item" : `${count} items`;
  info.appendChild(title);
  info.appendChild(meta);
  const actions = document.createElement("div");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "text-btn";
  add.textContent = "Add models";
  add.addEventListener("click", () => startAdding(group.name));
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "text-btn";
  rename.textContent = "Rename";
  rename.addEventListener("click", () => renameCollection(group.name));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-btn";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => deleteCollection(group.name));
  actions.append(add, rename, remove);
  card.append(info, actions);
  return card;
}

async function showCollection(group) {
  rememberFolder();
  browse = { path: "collections", name: group.name };
  showGallery();
  const host = $("gallery");
  host.innerHTML = "";
  const items = group.items || [];
  if (!items.length) {
    host.innerHTML = `<div class="note">Nothing in ${group.name} yet.</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  $("crumb").textContent = `${group.name} · ${items.length}`;
}

let dialogSubmit = null;

function openDialog({ title, placeholder, value, submit, choices, onSubmit }) {
  dialogSubmit = onSubmit;
  $("collectTitle").textContent = title;
  $("collectName").placeholder = placeholder || "";
  $("collectName").value = value || "";
  $("collectSubmit").textContent = submit || "Create";
  const list = $("collectChoices");
  list.innerHTML = "";
  list.hidden = !choices?.length;
  for (const choice of choices || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-btn";
    button.textContent = choice.label;
    button.addEventListener("click", () => {
      closeCollectDialog();
      Promise.resolve(choice.onPick()).catch((err) => showEmpty(err.message || String(err)));
    });
    list.appendChild(button);
  }
  $("collectDialog").hidden = false;
  $("collectName").focus();
  $("collectName").select();
}

function openCollectDialog() {
  openDialog({
    title: "New collection",
    placeholder: "Collection name",
    submit: "Create",
    onSubmit: async (name) => {
      await api("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await showCollections();
    },
  });
}

function closeCollectDialog() {
  $("collectDialog").hidden = true;
  dialogSubmit = null;
}

async function startAdding(name) {
  rememberFolder();
  addingTo = name;
  printableWas = $("printable").checked;
  $("printable").checked = false;
  pickAnchor = null;
  picked.clear();
  $("addTitle").textContent = `Adding to "${name}"`;
  $("addBanner").hidden = false;
  updatePickBar();
  const back = folderBrowse;
  if (back?.path) {
    await loadGallery(back.path, back.name);
    return;
  }
  const data = await api("/api/list");
  const first = (data.folders || [])[0];
  if (first) await loadGallery(first.path, first.name);
}

function stopAdding() {
  const wasOff = printableWas === false;
  addingTo = "";
  pickAnchor = null;
  picked.clear();
  $("addBanner").hidden = true;
  $("pickBar").hidden = true;
  document.querySelectorAll(".model-card.picked").forEach((el) => el.classList.remove("picked"));
  if (printableWas !== null) $("printable").checked = printableWas;
  printableWas = null;
  if (!wasOff && folderBrowse?.path) {
    loadGallery(folderBrowse.path, folderBrowse.name).catch((err) => showEmpty(err.message || String(err)));
  }
}

function selectPickRange(from, to) {
  const cards = [...document.querySelectorAll("#gallery .model-card")];
  let start = cards.indexOf(from);
  let end = cards.indexOf(to);
  if (start < 0) start = end;
  if (end < 0) return;
  if (start > end) [start, end] = [end, start];
  for (let i = start; i <= end; i += 1) {
    const card = cards[i];
    const item = card._item;
    if (!item) continue;
    picked.set(favKey(item), item);
    card.classList.add("picked");
  }
  updatePickBar();
}

function togglePick(item, card) {
  const key = favKey(item);
  if (picked.has(key)) {
    picked.delete(key);
    card.classList.remove("picked");
  } else {
    picked.set(key, item);
    card.classList.add("picked");
  }
  updatePickBar();
}

function updatePickBar() {
  const count = picked.size;
  $("pickBar").hidden = !addingTo || count === 0;
  $("pickCount").textContent = count === 1 ? "1 selected" : `${count} selected`;
  $("pickAdd").textContent = `Add ${count} to "${addingTo}"`;
}

function renameCollection(name) {
  openDialog({
    title: "Rename collection",
    value: name,
    submit: "Rename",
    onSubmit: async (next) => {
      if (next === name) return;
      await api("/api/collections/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, newName: next }),
      });
      await showCollections();
    },
  });
}

async function deleteCollection(name) {
  if (!window.confirm(`Delete the collection "${name}"? The files stay where they are.`)) return;
  const q = new URLSearchParams({ name });
  await api(`/api/collections?${q}`, { method: "DELETE" });
  await showCollections();
}

async function loadTree({ openPath = "", openName = "" } = {}) {
  await refreshFavs().catch(() => {});
  const data = await api("/api/list");
  const host = $("tree");
  host.innerHTML = "";
  host.appendChild(favouritesRow());
  host.appendChild(collectionsRow());
  const folders = data.folders || [];
  for (const folder of folders) host.appendChild(folderRow(folder, 0));
  if (openPath) {
    await loadGallery(openPath, openName || baseName(openPath));
    return;
  }
  if (!folders.length) {
    host.insertAdjacentHTML("beforeend", `<div class="note">Add a folder to start.</div>`);
    return;
  }
  await loadGallery(folders[0].path, folders[0].name);
}

async function showFavourites() {
  rememberFolder();
  browse = { path: "favourites", name: "Favourites" };
  galleryOffset = 0;
  $("gallery").innerHTML = "";
  showGallery();
  const items = await refreshFavs();
  const host = $("gallery");
  if (!items.length) {
    host.innerHTML = `<div class="note">No favourites yet. Use the heart on a card.</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  $("crumb").textContent = `Favourites · ${items.length}`;
}

function favouritesRow() {
  const wrap = document.createElement("div");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.style.paddingLeft = "8px";
  row.innerHTML = `<span class="mark">fav</span><span class="name">Favourites</span>`;
  row.addEventListener("click", async () => {
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    $("search").value = "";
    searchQuery = "";
    searchToken += 1;
    await showFavourites();
  });
  wrap.appendChild(row);
  return wrap;
}

function parentFolder(item) {
  const parts = String(item.path || "").split(/[/\\]/);
  parts.pop();
  return parts.join("\\");
}

function baseName(path) {
  const parts = String(path || "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

async function fillTreeChildren(row) {
  const children = row.nextElementSibling;
  if (!children) return;
  children.hidden = false;
  if (children.childElementCount) return;
  const q = new URLSearchParams({ path: row.dataset.path });
  const data = await api(`/api/list?${q}`);
  const depth = Number(row.dataset.depth || 0) + 1;
  for (const folder of (data.folders || []).slice(0, 400)) {
    children.appendChild(folderRow(folder, depth));
  }
}

async function goToLocation(item) {
  const folder = parentFolder(item);
  const rows = [...document.querySelectorAll(".tree-row[data-path]")];
  const root = rows
    .map((row) => row.dataset.path)
    .filter((path) => folder.toLowerCase() === path.toLowerCase() || folder.toLowerCase().startsWith(`${path.toLowerCase()}\\`))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) {
    showEmpty("That folder is not in the library tree.");
    return;
  }
  let current = root;
  let row = document.querySelector(`.tree-row[data-path="${CSS.escape(current)}"]`);
  const rest = folder.slice(root.length).replace(/^[/\\]/, "");
  for (const part of rest.split(/[/\\]/).filter(Boolean)) {
    if (!row) break;
    await fillTreeChildren(row);
    current = `${current}\\${part}`;
    row = document.querySelector(`.tree-row[data-path="${CSS.escape(current)}"]`);
  }
  document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
  row?.classList.add("active");
  row?.scrollIntoView({ block: "nearest" });
  await loadGallery(folder, baseName(folder));
  const card = document.querySelector(`.model-card[data-key="${CSS.escape(favKey(item))}"]`);
  if (card) {
    document.querySelectorAll(".model-card").forEach((el) => el.classList.remove("active"));
    card.classList.add("active");
    card.scrollIntoView({ block: "center" });
  }
}

let menuItem = null;
let menuCard = null;
let menuMode = "card";

function hideCardMenu() {
  $("cardMenu").hidden = true;
  menuItem = null;
  menuCard = null;
}

function showTreeMenu(x, y, item) {
  menuMode = "tree";
  menuItem = item;
  menuCard = null;
  const menu = $("cardMenu");
  const actions = [
    ["explorer", "Show in Explorer"],
    ["rename", "Rename..."],
    ["exclude", "Exclude from library"],
    ["collection", "Add to collection"],
  ];
  menu.innerHTML = "";
  for (const [act, label] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.act = act;
    button.textContent = label;
    menu.appendChild(button);
  }
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 220))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 46 * actions.length))}px`;
}

async function runTreeAction(act) {
  const item = menuItem;
  hideCardMenu();
  if (!item?.path) return;
  if (act === "explorer") {
    await api("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path }),
    });
    return;
  }
  if (act === "rename") {
    openDialog({
      title: "Rename",
      value: item.name,
      submit: "Rename",
      onSubmit: async (name) => {
        if (name === item.name) return;
        const saved = await api("/api/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: item.path, name }),
        });
        await loadTree({ openPath: saved.path, openName: saved.name });
      },
    });
    return;
  }
  if (act === "exclude") {
    const ok = window.confirm(`Hide ${item.name} from MeshFinder? The files stay where they are.`);
    if (!ok) return;
    await api("/api/exclude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path }),
    });
    await loadTree();
    return;
  }
  if (act === "collection") {
    const data = await api("/api/collections").catch(() => ({ items: [] }));
    const addTo = async (name) => {
      await api("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, name }),
      });
      const keep = browse.path && browse.path !== "favourites" && browse.path !== "search" && browse.path !== "collections";
      await loadTree(keep ? { openPath: browse.path, openName: browse.name } : {});
    };
    openDialog({
      title: "Add to collection",
      placeholder: "New collection name",
      submit: "Create",
      choices: (data.items || []).map((group) => ({ label: group.name, onPick: () => addTo(group.name) })),
      onSubmit: addTo,
    });
  }
}

function showCardMenu(x, y, item, card) {
  menuMode = "card";
  menuItem = item;
  menuCard = card;
  const menu = $("cardMenu");
  const fav = favourites.has(favKey(item));
  const actions = [
    ["open", "Open"],
    ["slicer", "Open in slicer"],
  ];
  if (item.kind === "stl" || item.kind === "obj" || item.kind === "3mf") {
    actions.push(["painter", "Send to STL Painter"]);
  }
  actions.push(
    ["explorer", "Show in Explorer"],
    ["locate", "Go to location"],
    ["fav", fav ? "Remove from favourites" : "Add to favourites"],
  );
  menu.innerHTML = "";
  for (const [act, label] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.act = act;
    button.textContent = label;
    menu.appendChild(button);
  }
  menu.hidden = false;
  const width = 210;
  const height = 46 * actions.length;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height))}px`;
}

async function runMenuAction(act) {
  const item = menuItem;
  const card = menuCard;
  hideCardMenu();
  if (!item) return;
  if (act === "open") {
    await selectFile(item, card);
    return;
  }
  if (act === "painter") {
    await api("/api/painter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path, entry: item.entry || "" }),
    });
    $("crumb").textContent = `${item.name} · opened in the Flightdeck app`;
    return;
  }
  if (act === "slicer") {
    await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path, entry: item.entry || "" }),
    });
    return;
  }
  if (act === "explorer") {
    await api("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path }),
    });
    return;
  }
  if (act === "locate") {
    await goToLocation(item);
    return;
  }
  if (act === "fav") {
    const heart = card?.querySelector(".fav-btn");
    if (heart) await toggleFav(item, heart);
  }
}

$("cardMenu").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const run = menuMode === "tree" ? runTreeAction : runMenuAction;
  run(button.dataset.act).catch((err) => showEmpty(err.message || String(err)));
});
document.addEventListener("click", () => hideCardMenu());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("cardMenu").hidden) {
      hideCardMenu();
      return;
    }
    if (!$("collectDialog").hidden) {
      closeCollectDialog();
      return;
    }
    if (searchQuery || document.activeElement === $("search")) {
      $("search").value = "";
      leaveSearch();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    $("search").focus();
    $("search").select();
  }
});

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const query = $("search").value.trim();
    if (query.length < 2) {
      if (searchQuery) leaveSearch();
      return;
    }
    loadSearch(query).catch((err) => showEmpty(err.message || String(err)));
  }, 280);
});

$("gallery").addEventListener("click", (event) => {
  if (event.target.closest("[data-act='new']")) openCollectDialog();
});

$("collectForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("collectName").value.trim();
  const submit = dialogSubmit;
  if (!name || !submit) return;
  closeCollectDialog();
  Promise.resolve(submit(name)).catch((err) => showEmpty(err.message || String(err)));
});
$("collectCancel").addEventListener("click", closeCollectDialog);
$("collectDismiss").addEventListener("click", closeCollectDialog);
$("collectDialog").addEventListener("click", (event) => {
  if (event.target === $("collectDialog")) closeCollectDialog();
});
$("addDone").addEventListener("click", stopAdding);
$("pickClose").addEventListener("click", stopAdding);
$("pickAdd").addEventListener("click", () => {
  const items = [...picked.values()].map((item) => ({
    path: item.path,
    entry: item.entry || "",
    name: item.name,
    kind: item.kind,
    size: item.size || 0,
  }));
  api("/api/collections/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: addingTo, items }),
  }).then(() => {
    picked.clear();
    pickAnchor = null;
    document.querySelectorAll(".model-card.picked").forEach((el) => el.classList.remove("picked"));
    updatePickBar();
    $("crumb").textContent = `Added ${items.length} to "${addingTo}"`;
  }).catch((err) => showEmpty(err.message || String(err)));
});

$("showAll").addEventListener("change", () => {
  if (!browse.path || browse.path === "favourites" || browse.path === "search" || browse.path === "collections") return;
  loadGallery(browse.path, browse.name).catch((err) => showEmpty(err.message || String(err)));
});

$("printable").addEventListener("change", () => {
  if (browse.path === "search" && searchQuery) {
    loadSearch(searchQuery).catch((err) => showEmpty(err.message || String(err)));
    return;
  }
  if (!browse.path || browse.path === "favourites" || browse.path === "collections") return;
  loadGallery(browse.path, browse.name).catch((err) => showEmpty(err.message || String(err)));
});

$("viewSwitch").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  cols = button.dataset.cols || "4";
  $("gallery").className = `gallery cols-${cols}`;
  $("viewSwitch").querySelectorAll("button").forEach((el) => el.classList.toggle("on", el === button));
});

$("backBtn").addEventListener("click", () => {
  selected = null;
  showGallery();
  $("crumb").textContent = browse.name || "Library";
});

$("addFolder").addEventListener("click", async () => {
  let path = "";
  try {
    if (window.pywebview?.api?.pick_folder) path = await window.pywebview.api.pick_folder();
  } catch {
    path = "";
  }
  if (!path) path = window.prompt("Folder on this PC") || "";
  path = path.trim();
  if (!path) return;
  try {
    await api("/api/roots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    await loadTree();
  } catch (err) {
    showEmpty(err.message || String(err));
  }
});

$("openFile").addEventListener("click", async () => {
  if (!selected) return;
  try {
    await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selected.path, entry: selected.entry || "" }),
    });
  } catch (err) {
    showEmpty(err.message || String(err));
  }
});

loadTree().catch((err) => showEmpty(err.message || String(err)));
