const $ = (id) => document.getElementById(id);

let selected = null;

function fileUrl(item) {
  const q = new URLSearchParams({ path: item.path, entry: item.entry || "" });
  return `/api/file?${q}`;
}

function hideStage() {
  $("viewer").hidden = true;
  $("picture").hidden = true;
  $("doc").hidden = true;
  $("empty").hidden = true;
  window.MeshFinderViewer?.unmountViewer?.();
}

function showEmpty(text) {
  hideStage();
  $("empty").hidden = false;
  $("empty").textContent = text;
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function crumbFor(path, prefix) {
  if (!path) return "Library";
  const tail = prefix ? `${path} / ${prefix}` : path;
  return tail;
}

async function loadFiles(path, prefix, title) {
  const q = new URLSearchParams();
  if (path) q.set("path", path);
  if (prefix) q.set("prefix", prefix);
  const data = await api(`/api/list?${q}`);
  $("filesTitle").textContent = title || "Files";
  $("crumb").textContent = crumbFor(data.path, data.prefix);
  const host = $("files");
  host.innerHTML = "";
  const files = data.files || [];
  const shown = files.slice(0, 500);
  if (!shown.length) {
    host.innerHTML = `<div class="note">No models or pictures in this folder.</div>`;
  }
  for (const item of shown) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "file-row";
    row.innerHTML = `<span class="kind">${item.kind}</span><span class="name"></span>`;
    row.querySelector(".name").textContent = item.name;
    row.addEventListener("click", () => selectFile(item, row));
    host.appendChild(row);
  }
  if (files.length > shown.length) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = `Showing ${shown.length} of ${files.length}.`;
    host.appendChild(note);
  }
  return data;
}

async function selectFile(item, row) {
  selected = item;
  document.querySelectorAll(".file-row").forEach((el) => el.classList.remove("active"));
  row.classList.add("active");
  $("openFile").disabled = false;
  $("crumb").textContent = item.entry ? `${item.path} / ${item.entry}` : item.path;
  const url = fileUrl(item);
  if (item.kind === "stl" || item.kind === "obj") {
    hideStage();
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
  showEmpty("This stage opens STL, OBJ, pictures, PDF, and text. Use Open in slicer for the rest.");
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
    const prefix = item.prefix || "";
    await loadFiles(item.path, prefix, item.name);
    children.hidden = false;
    if (children.childElementCount) return;
    const q = new URLSearchParams({ path: item.path });
    if (prefix) q.set("prefix", prefix);
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
  for (const folder of data.folders || []) host.appendChild(folderRow(folder, 0));
  if (!(data.folders || []).length) {
    host.innerHTML = `<div class="note">Add a folder to start.</div>`;
  }
}

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
