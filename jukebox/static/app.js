const $ = (id) => document.getElementById(id);

const VOL_KEY = "cindy-vinyl-volume";
const CUE_IN = "/static/deck-cue-in.mp4";
const CUE_OUT = "/static/deck-cue-out.mp4";
/** After the arm settles on the outer grooves, loop a short window so the arm
 *  stays parked (a full revolution lets it crawl inward, then snap back).
 *  The spinning CSS label covers any leftover video-label seam. */
const HOLD_LOOP_START = 3.55;
const HOLD_LOOP_END = 4.2;
const VINYL_COLORS = [
  "#8b1a1a", /* oxblood */
  "#1a3a6e", /* navy */
  "#1a4a32", /* forest */
  "#5b2c8a", /* plum */
  "#8a3a12", /* amber resin */
  "#0d5c56", /* teal */
  "#7a1848", /* wine */
  "#6b4a12", /* tobacco */
  "#2a2540", /* midnight */
  "#4a1a2a", /* rosewood */
];

const state = {
  queue: [],
  index: -1,
  album: null,
  /** Album currently open in the Properties modal (may differ from now-playing). */
  editAlbum: null,
  crateType: "newest",
  volumeBeforeMute: 0.85,
  /** @type {'rest'|'cueing-in'|'hold'|'cueing-out'} */
  arm: "rest",
  armToken: 0,
};

const audio = $("audio");

async function api(path, opts = {}) {
  const init = { ...opts };
  if (init.body && typeof init.body === "object" && !(init.body instanceof FormData)) {
    init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const r = await fetch(path, init);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return r.text();
}

function coverUrl(id, size = 300) {
  if (!id) return "";
  return `/api/cover/${encodeURIComponent(id)}?size=${size}`;
}

function setStatus(msg) {
  $("statusLine").textContent = msg;
}

function deckCue() {
  return /** @type {HTMLVideoElement|null} */ ($("deckCue"));
}

function clearCueHandlers(v) {
  if (!v) return;
  v.onended = null;
  v.onerror = null;
  v.ontimeupdate = null;
}

function showStaticDeck() {
  $("deckStage")?.classList.remove("cueing");
  const v = deckCue();
  if (v) {
    clearCueHandlers(v);
    v.pause();
    v.loop = false;
    v.removeAttribute("src");
    v.load();
    v.hidden = true;
  }
  const hold = $("deckCueHold");
  if (hold) {
    hold.pause();
    hold.hidden = true;
  }
}

function pauseCueVideo() {
  const v = deckCue();
  if (v && !v.hidden) v.pause();
}

function playVideoSrc(v, src, token, onReady) {
  const stillCurrent = () => token === state.armToken;
  const kickoff = () => {
    if (!stillCurrent()) return;
    try {
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.catch(() => {
        if (!stillCurrent()) return;
        v.addEventListener(
          "canplay",
          () => {
            if (!stillCurrent()) return;
            v.play().catch(() => {});
          },
          { once: true },
        );
      });
    }
    onReady?.();
  };
  const abs = new URL(src, window.location.href).href;
  clearCueHandlers(v);
  v.hidden = false;
  v.muted = true;
  v.playsInline = true;
  v.loop = false;
  if (v.src === abs && v.readyState >= 2) {
    kickoff();
    return;
  }
  v.addEventListener("loadeddata", kickoff, { once: true });
  v.src = src;
  v.load();
}

/** Play cue-in from the start, then keep the platter spinning (arm stays down). */
function startPlayLoop() {
  const v = deckCue();
  const stage = $("deckStage");
  if (!v || !stage) return;
  const token = ++state.armToken;
  stage.classList.add("cueing");
  state.arm = "cueing-in";

  const holdEl = $("deckCueHold");
  if (holdEl) {
    holdEl.pause();
    holdEl.hidden = true;
  }

  playVideoSrc(v, CUE_IN, token, () => {
    if (token !== state.armToken) return;
    v.ontimeupdate = () => {
      if (token !== state.armToken) return;
      if (state.arm !== "cueing-in" && state.arm !== "hold") return;
      // Seek a hair before the end frame so we never flash a mismatched label phase
      if (v.currentTime >= HOLD_LOOP_END - 0.02) {
        state.arm = "hold";
        try {
          v.currentTime = HOLD_LOOP_START;
        } catch {
          /* ignore */
        }
      } else if (v.currentTime >= HOLD_LOOP_START && state.arm === "cueing-in") {
        state.arm = "hold";
      }
    };
    v.onended = () => {
      if (token !== state.armToken) return;
      state.arm = "hold";
      try {
        v.currentTime = HOLD_LOOP_START;
      } catch {
        /* ignore */
      }
      v.play().catch(() => {});
    };
  });
}

function cueInThenHold() {
  if (state.arm === "cueing-in") return;
  if (state.arm === "hold") {
    const v = deckCue();
    if (v && v.paused) v.play().catch(() => {});
    return;
  }
  startPlayLoop();
}

function cueOutToRest() {
  if (state.arm === "rest" || state.arm === "cueing-out") return;
  const v = deckCue();
  const stage = $("deckStage");
  if (!v || !stage) {
    state.arm = "rest";
    showStaticDeck();
    return;
  }
  state.arm = "cueing-out";
  const token = ++state.armToken;
  stage.classList.add("cueing");
  playVideoSrc(v, CUE_OUT, token, () => {
    if (token !== state.armToken) return;
    v.onended = () => {
      if (token !== state.armToken) return;
      state.arm = "rest";
      showStaticDeck();
    };
  });
}

function resetArmToRest() {
  state.armToken += 1;
  state.arm = "rest";
  showStaticDeck();
}

function preloadCues() {
  [CUE_IN, CUE_OUT].forEach((src) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = src;
  });
}

function currentSong() {
  if (state.index < 0 || state.index >= state.queue.length) return null;
  return state.queue[state.index];
}

function closeMenu() {
  const drop = $("menuDrop");
  const btn = $("menuBtn");
  if (drop) drop.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  const drop = $("menuDrop");
  const btn = $("menuBtn");
  if (!drop || !btn) return;
  const open = drop.hidden;
  drop.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function openModal(id) {
  const el = $(id);
  if (el) el.hidden = false;
  closeMenu();
}

function closeModal(id) {
  const el = $(id);
  if (el) el.hidden = true;
}

async function copyField(inputId) {
  const input = $(inputId);
  if (!input || !input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    setStatus("Copied Cindy path.");
  } catch {
    input.select();
    document.execCommand("copy");
    setStatus("Copied Cindy path.");
  }
}

async function showOnCindy() {
  const song = currentSong();
  if (!song?.id) {
    setStatus("Spin a track first to locate it on Cindy.");
    closeMenu();
    return;
  }
  try {
    const info = await api(`/api/locate/${encodeURIComponent(song.id)}`);
    $("cindyTrackLabel").textContent = `${info.title || song.title || "Track"} · ${info.artist || song.artist || ""}`;
    $("cindyRelPath").value = info.path || "";
    $("cindyUncPath").value = info.unc || "";
    $("cindyFolderUnc").value = info.folderUnc || "";
    openModal("cindyModal");
  } catch (err) {
    setStatus(String(err.message || err).slice(0, 180));
    closeMenu();
  }
}

function fillProperties(album) {
  const al = album || state.editAlbum || state.album || {};
  state.editAlbum = al?.id ? al : state.album;
  const song = currentSong() || {};
  $("propAlbumName").value = al.name || al.title || "";
  $("propAlbumArtist").value = al.artist || al.displayArtist || "";
  $("propTrackTitle").value = song.title || "";
  $("propTrackArtist").value = song.artist || "";
  $("propTrackAlbum").value = song.album || al.name || "";
  const canAlbum = Boolean(state.editAlbum?.id);
  const canTrack = Boolean(song.id);
  $("propSaveAlbum").disabled = !canAlbum;
  $("propSaveTrack").disabled = !canTrack;
  if (canAlbum && canTrack) {
    $("propStatus").textContent = "Edits apply in Vinyl only (Cindy is read-only).";
  } else if (canAlbum) {
    $("propStatus").textContent = "Edit this sleeve’s display name / artist. Track fields need a playing side.";
  } else if (canTrack) {
    $("propStatus").textContent = "Track ready — pick a sleeve’s ⋯ to edit album names.";
  } else {
    $("propStatus").textContent = "Use ⋯ on a crate sleeve to rename it, or spin one first.";
  }
}

function openAlbumEdit(album, e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  if (!album?.id) {
    setStatus("That sleeve has no id to edit.");
    return;
  }
  fillProperties(album);
  openModal("propsModal");
}

async function saveAlbumProps() {
  const album = state.editAlbum || state.album;
  if (!album?.id) {
    $("propStatus").textContent = "No album loaded — use ⋯ on a crate sleeve.";
    return;
  }
  try {
    await api("/api/meta/album", {
      method: "POST",
      body: {
        id: album.id,
        name: $("propAlbumName").value,
        artist: $("propAlbumArtist").value,
      },
    });
    album.name = $("propAlbumName").value.trim() || album.name;
    album.title = album.name;
    album.artist = $("propAlbumArtist").value.trim() || album.artist;
    album.displayArtist = album.artist;
    if (state.album?.id === album.id) {
      state.album.name = album.name;
      state.album.title = album.name;
      state.album.artist = album.artist;
      state.album.displayArtist = album.artist;
      $("nowTitle").textContent = album.name || "Album";
      $("nowArtist").textContent = album.artist || "";
    }
    $("propStatus").textContent = "Album saved for Vinyl.";
    await loadCrates(state.crateType);
  } catch (err) {
    $("propStatus").textContent = String(err.message || err).slice(0, 160);
  }
}

async function saveTrackProps() {
  const song = currentSong();
  if (!song?.id) {
    $("propStatus").textContent = "No track selected.";
    return;
  }
  try {
    await api("/api/meta/song", {
      method: "POST",
      body: {
        id: song.id,
        title: $("propTrackTitle").value,
        artist: $("propTrackArtist").value,
        album: $("propTrackAlbum").value,
      },
    });
    song.title = $("propTrackTitle").value.trim() || song.title;
    song.artist = $("propTrackArtist").value.trim() || song.artist;
    song.album = $("propTrackAlbum").value.trim() || song.album;
    $("deckTitle").textContent = song.title || "Track";
    $("deckArtist").textContent = song.artist || state.album?.artist || "";
    renderQueue();
    $("propStatus").textContent = "Track saved for Vinyl.";
  } catch (err) {
    $("propStatus").textContent = String(err.message || err).slice(0, 160);
  }
}

async function refreshPacks() {
  closeMenu();
  setStatus("Refreshing folder packs…");
  try {
    await api("/api/refresh-packs", { method: "POST" });
    await loadCrates(state.crateType);
    setStatus("Packs refreshed.");
  } catch (err) {
    setStatus(String(err.message || err).slice(0, 180));
  }
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function updateTime() {
  const now = $("timeNow");
  const dur = $("timeDur");
  if (now) now.textContent = fmtTime(audio.currentTime || 0);
  if (dur) dur.textContent = fmtTime(audio.duration || 0);
}

function applyVolume(vol, { persist = true } = {}) {
  const v = Math.max(0, Math.min(1, vol));
  audio.volume = v;
  audio.muted = v === 0;
  const slider = $("volume");
  if (slider) slider.value = String(Math.round(v * 100));
  const mute = $("muteBtn");
  if (mute) {
    mute.classList.toggle("muted", audio.muted);
    mute.textContent = audio.muted || v === 0 ? "🔇" : "🔊";
  }
  if (persist) {
    try {
      localStorage.setItem(VOL_KEY, String(v));
    } catch {
      /* ignore */
    }
  }
}

function toggleMute() {
  if (audio.muted || audio.volume === 0) {
    applyVolume(state.volumeBeforeMute || 0.85);
  } else {
    state.volumeBeforeMute = audio.volume || 0.85;
    applyVolume(0);
  }
}

function togglePlayPause() {
  if (!state.queue.length) return;
  if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => {});
  else {
    audio.pause();
    setPlaying(false);
  }
}

function pickVinylColor() {
  const c = VINYL_COLORS[Math.floor(Math.random() * VINYL_COLORS.length)];
  const stage = $("deckStage");
  if (stage) stage.style.setProperty("--vinyl-color", c);
  const tint = $("vinylTint");
  if (tint) tint.style.background = ""; // let CSS radial use the var
  return c;
}

/** Same size as crate sleeves so a spin reuses the already-cached image. */
const VINYL_ART_SIZE = 300;

function setVinylArt(coverId) {
  const img = $("vinylArt");
  const fb = $("vinylFallback");
  const art = $("deckArt");
  const stage = $("deckStage");
  if (!coverId) {
    if (img) {
      img.hidden = true;
      delete img.dataset.coverId;
    }
    if (fb) fb.hidden = false;
    art?.removeAttribute("src");
    stage?.classList.remove("has-vinyl");
    return;
  }
  const url = coverUrl(coverId, VINYL_ART_SIZE);
  if (img) {
    if (img.dataset.coverId === String(coverId) && img.src) {
      img.hidden = false;
    } else {
      img.dataset.coverId = String(coverId);
      img.src = url;
      img.hidden = false;
      // Warm decode so the next skip feels instant if the browser still has work
      if (typeof img.decode === "function") {
        img.decode().catch(() => {});
      }
    }
  }
  if (fb) fb.hidden = true;
  if (art) art.src = coverUrl(coverId, 120);
  stage?.classList.add("has-vinyl");
}

function prefetchQueueCovers(around = 2) {
  const start = Math.max(0, state.index - around);
  const end = Math.min(state.queue.length - 1, state.index + around);
  for (let i = start; i <= end; i++) {
    const id = state.queue[i]?.coverArt;
    if (!id) continue;
    const url = coverUrl(id, VINYL_ART_SIZE);
    const warm = new Image();
    warm.decoding = "async";
    warm.src = url;
  }
}

function renderQueue() {
  const list = $("queueList");
  const count = $("trackCount");
  if (!list) return;
  if (!state.queue.length) {
    if (count) count.textContent = "—";
    list.innerHTML = `<li class="track-empty">Spin a sleeve and the sides show up here.</li>`;
    return;
  }
  if (count) count.textContent = `${state.queue.length} side${state.queue.length === 1 ? "" : "s"}`;
  list.innerHTML = state.queue
    .map((s, i) => {
      const active = i === state.index ? "active" : "";
      const art = coverUrl(s.coverArt || s.id, 80);
      return `<li class="${active}" data-i="${i}">
        <img src="${art}" alt="">
        <div>
          <div class="t">${escapeHtml(s.title || "Track")}</div>
          <div class="a">${escapeHtml(s.artist || "")}</div>
        </div>
      </li>`;
    })
    .join("");
  list.querySelectorAll("li[data-i]").forEach((li) => {
    li.addEventListener("click", () => playIndex(Number(li.dataset.i)));
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadAlbumIntoQueue(album, { autoplay = true } = {}) {
  const songs = album.song || [];
  if (!songs.length) {
    setStatus("That sleeve is empty.");
    return;
  }
  state.album = album;
  state.queue = songs;
  state.index = 0;
  resetArmToRest();
  $("nowTitle").textContent = album.name || album.title || "Album";
  $("nowArtist").textContent = album.artist || album.displayArtist || "";
  setVinylArt(album.coverArt);
  renderQueue();
  prefetchQueueCovers(3);
  $("playPauseBtn").disabled = false;
  if (autoplay) playIndex(0);
  else setStatus("Ready on the platter.");
}

async function playIndex(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.index = i;
  const song = state.queue[i];
  $("deckTitle").textContent = song.title || "Track";
  $("deckArtist").textContent = song.artist || state.album?.artist || "";
  if (song.coverArt) setVinylArt(song.coverArt);
  else if (state.album?.coverArt) setVinylArt(state.album.coverArt);
  pickVinylColor();
  prefetchQueueCovers(2);
  audio.src = `/api/stream/${encodeURIComponent(song.id)}`;
  try {
    await audio.play();
    setPlaying(true);
  } catch (err) {
    setStatus(`Playback blocked: ${err.message || err}`);
    setPlaying(false);
  }
  updateTime();
  renderQueue();
}

function setPlaying(on) {
  $("deckStage")?.classList.toggle("playing", on);
  $("playPauseBtn").textContent = on ? "Pause" : "Play";
  $("deckPlay").textContent = on ? "⏸" : "▶";
  setStatus(on ? "Needle down." : "Paused.");
  if (on) cueInThenHold();
  else pauseCueVideo();
}

async function spin() {
  $("spinBtn").disabled = true;
  setStatus("Digging through the crates…");
  try {
    const album = await api("/api/random-album");
    loadAlbumIntoQueue(album, { autoplay: true });
    setStatus("Fresh pull.");
  } catch (err) {
    setStatus(String(err.message || err).slice(0, 180));
  } finally {
    $("spinBtn").disabled = false;
  }
}

function sleeveButton(album) {
  const wrap = document.createElement("div");
  wrap.className = "sleeve-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sleeve";
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = coverUrl(album.coverArt, 300);
  const t = document.createElement("div");
  t.className = "t";
  t.textContent = album.name || album.title || "Album";
  const a = document.createElement("div");
  a.className = "a";
  a.textContent = album.artist || "[Unknown Artist]";
  btn.append(img, t, a);
  btn.addEventListener("click", async () => {
    setStatus("Sliding the sleeve out…");
    try {
      const full = await api(`/api/album/${encodeURIComponent(album.id)}`);
      loadAlbumIntoQueue(full, { autoplay: true });
    } catch (err) {
      setStatus(String(err.message || err));
    }
  });

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "sleeve-edit";
  edit.title = "Edit display name / artist";
  edit.setAttribute("aria-label", `Edit ${album.name || album.title || "album"}`);
  edit.textContent = "⋯";
  edit.addEventListener("click", (e) => openAlbumEdit(album, e));

  wrap.append(btn, edit);
  return wrap;
}

async function loadCrates(type) {
  state.crateType = type;
  document.querySelectorAll(".crate-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });
  const rail = $("crateRail");
  rail.innerHTML = "<p class='hint'>Pulling sleeves…</p>";
  try {
    const data = await api(`/api/albums?type=${encodeURIComponent(type)}&size=48`);
    rail.innerHTML = "";
    (data.albums || []).forEach((al) => rail.appendChild(sleeveButton(al)));
    if (!(data.albums || []).length) {
      rail.innerHTML = "<p class='hint'>Still scanning Cindy — check back as albums appear.</p>";
    }
  } catch (err) {
    rail.innerHTML = `<p class='hint'>${escapeHtml(err.message || err)}</p>`;
  }
}

async function runSearch(q) {
  const box = $("searchResults");
  const grid = $("searchGrid");
  if (!q.trim()) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  grid.innerHTML = "<p class='hint'>Searching…</p>";
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    grid.innerHTML = "";
    (data.albums || []).forEach((al) => grid.appendChild(sleeveButton(al)));
    (data.songs || []).slice(0, 12).forEach((song) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sleeve";
      btn.innerHTML = `<img src="${coverUrl(song.coverArt, 200)}" alt="">
        <div class="t">${escapeHtml(song.title)}</div>
        <div class="a">${escapeHtml(song.artist || "")}</div>`;
      btn.addEventListener("click", () => {
        state.queue = [song];
        state.index = 0;
        state.album = { name: song.album, artist: song.artist, coverArt: song.coverArt };
        $("nowTitle").textContent = song.title;
        $("nowArtist").textContent = song.artist || "";
        setVinylArt(song.coverArt);
        renderQueue();
        playIndex(0);
      });
      grid.appendChild(btn);
    });
    if (!grid.children.length) grid.innerHTML = "<p class='hint'>Nothing matched.</p>";
  } catch (err) {
    grid.innerHTML = `<p class='hint'>${escapeHtml(err.message || err)}</p>`;
  }
}

function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function wire() {
  let saved = 0.85;
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw != null) saved = Math.max(0, Math.min(1, Number(raw)));
  } catch {
    /* ignore */
  }
  if (!Number.isFinite(saved)) saved = 0.85;
  state.volumeBeforeMute = saved || 0.85;
  applyVolume(saved, { persist: false });

  $("spinBtn").addEventListener("click", () => spin());
  $("playPauseBtn").addEventListener("click", () => togglePlayPause());
  $("deckPlay").addEventListener("click", () => togglePlayPause());
  $("nextBtn").addEventListener("click", () => playIndex(state.index + 1));
  $("prevBtn").addEventListener("click", () => playIndex(state.index - 1));
  $("muteBtn").addEventListener("click", () => toggleMute());
  $("volume").addEventListener("input", () => {
    const v = Number($("volume").value) / 100;
    if (v > 0) state.volumeBeforeMute = v;
    applyVolume(v);
  });

  audio.addEventListener("ended", () => {
    if (state.index + 1 < state.queue.length) playIndex(state.index + 1);
    else {
      setPlaying(false);
      cueOutToRest();
    }
  });
  audio.addEventListener("timeupdate", () => {
    if (audio.duration) {
      $("seek").value = String(Math.floor((audio.currentTime / audio.duration) * 1000));
    }
    updateTime();
  });
  audio.addEventListener("loadedmetadata", () => updateTime());
  audio.addEventListener("durationchange", () => updateTime());
  $("seek").addEventListener("input", () => {
    if (!audio.duration) return;
    audio.currentTime = (Number($("seek").value) / 1000) * audio.duration;
    updateTime();
  });
  document.querySelectorAll(".crate-tab").forEach((btn) => {
    btn.addEventListener("click", () => loadCrates(btn.dataset.type));
  });
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch($("searchInput").value);
  });

  $("menuBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  $("menuDrop")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "cindy") showOnCindy();
    else if (action === "props") {
      fillProperties(state.album);
      openModal("propsModal");
    } else if (action === "refresh") refreshPacks();
  });
  document.addEventListener("click", (e) => {
    if (!$("topMenu")?.contains(e.target)) closeMenu();
  });
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copyField(btn.dataset.copy));
  });
  $("propSaveAlbum")?.addEventListener("click", () => saveAlbumProps());
  $("propSaveTrack")?.addEventListener("click", () => saveTrackProps());
  ["cindyModal", "propsModal"].forEach((id) => {
    $(id)?.addEventListener("click", (e) => {
      if (e.target === $(id)) closeModal(id);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      closeModal("cindyModal");
      closeModal("propsModal");
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlayPause();
        break;
      case "ArrowLeft":
        e.preventDefault();
        playIndex(state.index - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        playIndex(state.index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        applyVolume(Math.min(1, audio.volume + 0.05));
        if (audio.volume > 0) state.volumeBeforeMute = audio.volume;
        break;
      case "ArrowDown":
        e.preventDefault();
        applyVolume(Math.max(0, audio.volume - 0.05));
        break;
      case "m":
      case "M":
        e.preventDefault();
        toggleMute();
        break;
      default:
        break;
    }
  });
}

async function boot() {
  wire();
  preloadCues();
  try {
    const h = await api("/api/health");
    if (!h.ok) setStatus(`Navidrome: ${h.error || "not ready"}`);
    else setStatus("Tubes warm. Hit SPIN. · Space play · ←→ skip · ↑↓ vol");
  } catch (err) {
    setStatus("Backend starting — retry in a moment.");
  }
  await loadCrates("newest");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();
