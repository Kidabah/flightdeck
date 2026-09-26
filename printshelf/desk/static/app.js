const $ = (id) => document.getElementById(id);

let selected = null;
let browse = { path: "", name: "" };
let galleryOffset = 0;
let cols = "4";
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

function renderCard(item) {
  const card = document.createElement("div");
  card.className = "model-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  const thumb = document.createElement("div");
  thumb.className = "model-thumb";
  const img = document.createElement("img");
  img.alt = "";
  const kind = document.createElement("span");
  kind.className = "model-kind";
  kind.textContent = item.kind.toUpperCase();
  thumb.appendChild(kind);
  if (item.kind === "image") {
    img.src = fileUrl(item);
    thumb.appendChild(img);
    kind.remove();
  } else if (item.kind === "stl" || item.kind === "obj") {
    thumb.appendChild(img);
    queueThumb(item, img);
    img.addEventListener("load", () => kind.remove());
  }
  const body = document.createElement("div");
  body.className = "model-body";
  const name = document.createElement("div");
  name.className = "model-name";
  name.textContent = item.name;
  const meta = document.createElement("div");
  meta.className = "model-meta";
  meta.textContent = `${item.kind.toUpperCase()} · ${fmtBytes(item.size)}`;
  body.appendChild(name);
  body.appendChild(meta);
  card.appendChild(thumb);
  card.appendChild(body);
  card.addEventListener("click", () => selectFile(item, card));
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
    offset: String(galleryOffset),
    limit: "120",
  });
  const data = await api(`/api/gallery?${q}`);
  const host = $("gallery");
  if (!append) host.innerHTML = "";
  host.querySelector(".more-row")?.remove();
  const items = data.items || [];
  if (!items.length && !append) {
    host.innerHTML = `<div class="note">No models or pictures here.</div>`;
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

async function selectFile(item, card) {
  selected = item;
  document.querySelectorAll(".model-card").forEach((el) => el.classList.remove("active"));
  card?.classList.add("active");
  $("openFile").disabled = false;
  $("backBtn").hidden = false;
  $("crumb").textContent = item.entry ? `${item.name}` : item.path;
  const url = fileUrl(item);
  if (item.kind === "stl" || item.kind === "obj") {
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
  if (item.kind === "image") {
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
  row.style.paddingLeft = `${8 + depth * 14}px`;
  const mark = item.kind === "zip" || item.kind === "zipdir" ? "zip" : "dir";
  row.innerHTML = `<span class="mark">${mark}</span><span class="name"></span>`;
  row.querySelector(".name").textContent = item.name;
  const children = document.createElement("div");
  children.className = "tree-children";
  children.hidden = true;
  row.addEventListener("click", async () => {
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
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

async function loadTree() {
  const data = await api("/api/list");
  const host = $("tree");
  host.innerHTML = "";
  const folders = data.folders || [];
  for (const folder of folders) host.appendChild(folderRow(folder, 0));
  if (!folders.length) {
    host.innerHTML = `<div class="note">Add a folder to start.</div>`;
    return;
  }
  await loadGallery(folders[0].path, folders[0].name);
}

$("showAll").addEventListener("change", () => {
  if (!browse.path) return;
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
