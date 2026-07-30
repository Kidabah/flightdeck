const $ = (id) => document.getElementById(id);

const VOL_KEY = "cindy-vinyl-volume";
const CUE_IN = "/static/deck-cue-in.mp4";
const CUE_OUT = "/static/deck-cue-out.mp4";
/** After the arm settles on the outer grooves, loop a short window so the arm
 *  stays parked (a full revolution lets it crawl inward, then snap back).
 *  The spinning CSS label covers any leftover video-label seam. */
const HOLD_LOOP_START = 3.55;
const HOLD_LOOP_END = 4.2;
/** Wait for the tonearm cue-in before audio so needle-down matches the sound. */
const AUDIO_CUE_DELAY_MS = 4000;
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
  /** Album key the current vinyl tint belongs to — colour only changes when this changes. */
  vinylColorAlbumKey: null,
  crateType: "newest",
  crateLetter: "A",
  crateGenre: "",
  genresCache: null,
  genreFilterToken: 0,
  volumeBeforeMute: 0.85,
  /** @type {'rest'|'cueing-in'|'hold'|'cueing-out'} */
  arm: "rest",
  armToken: 0,
  /** Bumped to cancel a pending delayed audio start. */
  playDelayToken: 0,
  /** True while waiting for the arm before audio.play(). */
  awaitingAudio: false,
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
    const stage = $("deckStage");
    stage?.classList.add("cueing");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cancelPendingAudio() {
  state.playDelayToken += 1;
  state.awaitingAudio = false;
}

function togglePlayPause() {
  if (!state.queue.length) return;
  // Abort a cue-in that hasn't started audio yet.
  if (state.awaitingAudio) {
    cancelPendingAudio();
    audio.pause();
    setPlaying(false);
    cueOutToRest();
    setStatus("Paused.");
    return;
  }
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

function albumColorKey(album, song) {
  if (album?.id) return `a:${album.id}`;
  if (song?.albumId) return `a:${song.albumId}`;
  const name = album?.name || album?.title || song?.album || "";
  const artist = album?.artist || album?.displayArtist || song?.artist || "";
  if (name || artist) return `n:${name}|${artist}`;
  return song?.id ? `s:${song.id}` : "";
}

/** New random tint only when the record (album) changes — not every track skip. */
function ensureVinylColorForAlbum(album, song) {
  const key = albumColorKey(album, song);
  if (!key || key === state.vinylColorAlbumKey) return;
  state.vinylColorAlbumKey = key;
  pickVinylColor();
}

/** Same size as crate sleeves so a spin reuses the already-cached image. */
const VINYL_ART_SIZE = 300;

function setVinylArt(coverId) {
  const img = $("vinylArt");
  const fb = $("vinylFallback");
  const art = $("deckArt");
  const stage = $("deckStage");
  const wall = $("wallSleeve");
  const wallImg = $("wallArt");
  if (!coverId) {
    if (img) {
      img.hidden = true;
      delete img.dataset.coverId;
    }
    if (fb) fb.hidden = false;
    art?.removeAttribute("src");
    if (wall) {
      wall.hidden = true;
      wall.setAttribute("aria-hidden", "true");
    }
    if (wallImg) {
      wallImg.removeAttribute("src");
      delete wallImg.dataset.coverId;
    }
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
      if (typeof img.decode === "function") {
        img.decode().catch(() => {});
      }
    }
  }
  if (fb) fb.hidden = true;
  if (art) art.src = coverUrl(coverId, 120);
  if (wallImg) {
    if (wallImg.dataset.coverId !== String(coverId)) {
      wallImg.dataset.coverId = String(coverId);
      wallImg.src = coverUrl(coverId, 400);
    }
  }
  if (wall) {
    wall.hidden = false;
    wall.setAttribute("aria-hidden", "false");
  }
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
  const n = state.queue.length;
  if (count) count.textContent = `${n} side${n === 1 ? "" : "s"}`;

  // Folder packs can be 100–600 tracks — don't mount every cover at once.
  const MAX_DOM = 80;
  let start = 0;
  let end = n;
  if (n > MAX_DOM) {
    start = Math.max(0, state.index - 24);
    end = Math.min(n, start + MAX_DOM);
    start = Math.max(0, end - MAX_DOM);
  }

  const parts = [];
  if (start > 0) {
    parts.push(
      `<li class="track-more" data-jump="${Math.max(0, start - MAX_DOM)}">↑ ${start} earlier sides…</li>`,
    );
  }
  for (let i = start; i < end; i++) {
    const s = state.queue[i];
    const active = i === state.index ? "active" : "";
    const near = Math.abs(i - state.index) <= 6;
    const art = near ? coverUrl(s.coverArt || s.id, 80) : "";
    parts.push(`<li class="${active}" data-i="${i}">
        ${near ? `<img src="${art}" alt="" loading="lazy">` : `<span class="track-art-ph" aria-hidden="true"></span>`}
        <div>
          <div class="t">${escapeHtml(s.title || "Track")}</div>
          <div class="a">${escapeHtml(s.artist || "")}</div>
        </div>
      </li>`);
  }
  if (end < n) {
    parts.push(
      `<li class="track-more" data-jump="${end}">↓ ${n - end} more sides…</li>`,
    );
  }
  list.innerHTML = parts.join("");
  list.querySelectorAll("li[data-i]").forEach((li) => {
    const i = Number(li.dataset.i);
    li.addEventListener("click", () => {
      if (suppressSleeveClick) return;
      playIndex(i);
    });
    bindQueueDrag(li, i);
  });
  list.querySelectorAll("li.track-more").forEach((li) => {
    li.addEventListener("click", () => {
      state.index = Number(li.dataset.jump) || 0;
      renderQueue();
      list.querySelector(`li[data-i="${state.index}"]`)?.scrollIntoView({ block: "nearest" });
    });
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Pointer-based sleeve→deck drag (not HTML5 DnD).
 * Edge/Chromium app windows often show the ⊘ “can’t drop” cursor for HTML5
 * drag-and-drop even when we call preventDefault — pointer drag avoids that.
 */
let sleeveDrag = null; // { payload, el, x0, y0, started, pointerId }
let suppressSleeveClick = false;

function markDropTargets(on) {
  document.body.classList.toggle("sleeve-dragging", on);
  document.querySelectorAll(".deck-stage, .hero-main").forEach((el) => {
    el.classList.toggle("drop-ready", on);
    if (!on) el.classList.remove("drag-over");
  });
}

function dropZoneUnder(x, y) {
  const stack = document.elementsFromPoint?.(x, y) || [];
  for (const node of stack) {
    if (node?.closest?.("#deckStage, .hero-main")) return true;
  }
  const el = document.elementFromPoint(x, y);
  return !!el?.closest?.("#deckStage, .hero-main");
}

function bindPointerDrag(el, payload) {
  if (!el || !payload?.kind) return;
  el.draggable = false;
  el.classList.add("draggable");
  el.querySelectorAll("img").forEach((img) => {
    img.draggable = false;
  });
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest?.(".sleeve-edit")) return;
    sleeveDrag = {
      payload,
      el,
      x0: e.clientX,
      y0: e.clientY,
      started: false,
      pointerId: e.pointerId,
    };
  });
}

function bindAlbumDrag(el, album) {
  if (!el || !album?.id) return;
  bindPointerDrag(el, { kind: "album", id: String(album.id) });
}

function bindSongDrag(el, song) {
  if (!el || !song?.id) return;
  bindPointerDrag(el, {
    kind: "song",
    song: {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumId: song.albumId,
      coverArt: song.coverArt,
    },
  });
}

function bindQueueDrag(el, index) {
  if (!el) return;
  bindPointerDrag(el, { kind: "queue", index });
}

function playSongSolo(song) {
  state.queue = [song];
  state.index = 0;
  state.album = {
    id: song.albumId || undefined,
    name: song.album,
    artist: song.artist,
    coverArt: song.coverArt,
  };
  $("nowTitle").textContent = song.title || "Track";
  $("nowArtist").textContent = song.artist || "";
  setVinylArt(song.coverArt);
  ensureVinylColorForAlbum(state.album, song);
  $("playPauseBtn").disabled = false;
  renderQueue();
  playIndex(0);
}

async function handleDeckDrop(payload) {
  if (!payload?.kind) {
    setStatus("That drop didn’t stick — grab the sleeve again.");
    return;
  }
  if (payload.kind === "album" && payload.id) {
    const id = String(payload.id);
    setStatus(
      id.startsWith("folder:")
        ? "Loading the whole folder pack…"
        : "Dropping the sleeve on the platter…",
    );
    try {
      const full = await api(`/api/album/${encodeURIComponent(id)}`);
      const n = (full.song || []).length;
      loadAlbumIntoQueue(full, { autoplay: true });
      setStatus(n > 40 ? `Packed ${n} sides — needle down.` : "Needle down.");
    } catch (err) {
      setStatus(String(err.message || err).slice(0, 180));
    }
    return;
  }
  if (payload.kind === "queue" && Number.isFinite(Number(payload.index))) {
    playIndex(Number(payload.index));
    return;
  }
  if (payload.kind === "song" && payload.song?.id) {
    playSongSolo(payload.song);
  }
}

function wireDeckDrop() {
  const stage = $("deckStage");

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!sleeveDrag || e.pointerId !== sleeveDrag.pointerId) return;
      const dx = e.clientX - sleeveDrag.x0;
      const dy = e.clientY - sleeveDrag.y0;
      if (!sleeveDrag.started) {
        if (dx * dx + dy * dy < 64) return;
        sleeveDrag.started = true;
        sleeveDrag.el.classList.add("dragging");
        markDropTargets(true);
        setStatus("Drop on the deck to play…");
        try {
          sleeveDrag.el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      const onDeck = dropZoneUnder(e.clientX, e.clientY);
      stage?.classList.toggle("drag-over", onDeck);
      document.querySelector(".hero-main")?.classList.toggle("drag-over", onDeck);
    },
    { passive: true },
  );

  const endPointerDrag = (e) => {
    if (!sleeveDrag || e.pointerId !== sleeveDrag.pointerId) return;
    const drag = sleeveDrag;
    sleeveDrag = null;
    drag.el.classList.remove("dragging");
    markDropTargets(false);
    try {
      drag.el.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!drag.started) return;
    suppressSleeveClick = true;
    setTimeout(() => {
      suppressSleeveClick = false;
    }, 0);
    if (dropZoneUnder(e.clientX, e.clientY)) {
      handleDeckDrop(drag.payload);
    } else {
      setStatus("Drop on the deck photo to play.");
    }
  };

  document.addEventListener("pointerup", endPointerDrag, true);
  document.addEventListener("pointercancel", endPointerDrag, true);

  // If someone drags a Windows folder onto the page, explain (HTML5 Files).
  const rejectOsFiles = (e) => {
    const types = e.dataTransfer?.types;
    let list = [];
    try {
      list = types ? Array.from(types) : [];
    } catch {
      list = [];
    }
    if (!list.includes("Files")) return;
    e.preventDefault();
    if (e.type === "drop") {
      e.stopPropagation();
      setStatus("Use a sleeve from the crates — Windows folders can’t drop here.");
    }
  };
  document.addEventListener("dragover", rejectOsFiles, true);
  document.addEventListener("drop", rejectOsFiles, true);
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
  ensureVinylColorForAlbum(album);
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
  ensureVinylColorForAlbum(state.album, song);
  prefetchQueueCovers(2);

  const playGen = ++state.playDelayToken;
  state.awaitingAudio = false;
  audio.src = `/api/stream/${encodeURIComponent(song.id)}`;

  // Arm already on the record (skip / resume) — start sound immediately.
  const armReady = state.arm === "hold" || state.arm === "cueing-in";
  if (!armReady) {
    state.awaitingAudio = true;
    cueInThenHold();
    $("playPauseBtn").disabled = false;
    $("playPauseBtn").textContent = "Pause";
    $("deckPlay").textContent = "⏸";
    setStatus("Needle dropping…");
    await sleep(AUDIO_CUE_DELAY_MS);
    if (playGen !== state.playDelayToken) return;
    state.awaitingAudio = false;
  }

  try {
    await audio.play();
    if (playGen !== state.playDelayToken) {
      audio.pause();
      return;
    }
    setPlaying(true);
  } catch (err) {
    if (playGen !== state.playDelayToken) return;
    state.awaitingAudio = false;
    setStatus(`Playback blocked: ${err.message || err}`);
    setPlaying(false);
  }
  updateTime();
  renderQueue();
}

function setPlaying(on) {
  const stage = $("deckStage");
  stage?.classList.toggle("playing", on);
  $("playPauseBtn").textContent = on ? "Pause" : "Play";
  $("deckPlay").textContent = on ? "⏸" : "▶";
  if (!on) {
    cancelPendingAudio();
    setStatus("Paused.");
    pauseCueVideo();
    // Keep arm-down video frame, but stop platter spin (`.cueing` also animates).
    stage?.classList.remove("cueing");
    return;
  }
  setStatus("Needle down.");
  cueInThenHold();
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

  // Use a div (not <button>) so HTML5 drag-and-drop can start from the cover.
  const btn = document.createElement("div");
  btn.className = "sleeve";
  btn.setAttribute("role", "button");
  btn.tabIndex = 0;
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.loading = "lazy";
  img.decoding = "async";
  img.src = coverUrl(album.coverArt, 180);
  const t = document.createElement("div");
  t.className = "t";
  t.textContent = album.name || album.title || "Album";
  const a = document.createElement("div");
  a.className = "a";
  a.textContent = album.artist || "[Unknown Artist]";
  btn.append(img, t, a);
  const openSleeve = async () => {
    setStatus("Sliding the sleeve out…");
    try {
      const full = await api(`/api/album/${encodeURIComponent(album.id)}`);
      loadAlbumIntoQueue(full, { autoplay: true });
    } catch (err) {
      setStatus(String(err.message || err));
    }
  };
  btn.addEventListener("click", (e) => {
    if (suppressSleeveClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    openSleeve();
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSleeve();
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
  bindAlbumDrag(wrap, album);
  return wrap;
}

async function loadCrates(type) {
  state.crateType = type;
  document.querySelectorAll(".crate-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });
  updateCrateFilters();
  const rail = $("crateRail");
  const hint =
    type === "alphabeticalByName"
      ? "Flipping to that letter…"
      : type === "byGenre"
        ? "Pulling that category…"
        : "Pulling sleeves…";
  rail.innerHTML = `<p class='hint'>${hint}</p>`;
  try {
    const params = new URLSearchParams({
      type,
      size: type === "alphabeticalByName" ? "36" : "48",
    });
    if (type === "alphabeticalByName") params.set("letter", state.crateLetter || "A");
    if (type === "byGenre") {
      if (!state.crateGenre) {
        await ensureGenres();
        const first = (state.genresCache || [])[0];
        state.crateGenre = first?.value || "";
        updateCrateFilters();
      }
      if (!state.crateGenre) {
        rail.innerHTML = "<p class='hint'>No genres tagged on Cindy yet.</p>";
        return;
      }
      params.set("genre", state.crateGenre);
    }
    const data = await api(`/api/albums?${params}`);
    if (state.crateType !== type) return;
    rail.innerHTML = "";
    (data.albums || []).forEach((al) => rail.appendChild(sleeveButton(al)));
    if (!(data.albums || []).length) {
      rail.innerHTML = "<p class='hint'>Nothing in this crate — try another letter or category.</p>";
    }
  } catch (err) {
    if (state.crateType !== type) return;
    rail.innerHTML = `<p class='hint'>${escapeHtml(err.message || err)}</p>`;
  }
}

async function ensureGenres() {
  // Always refresh so canonical buckets stay current after backend changes.
  try {
    const data = await api("/api/genres");
    state.genresCache = data.genres || [];
  } catch {
    state.genresCache = [];
  }
  return state.genresCache;
}

function updateCrateFilters() {
  const filters = $("crateFilters");
  const letters = $("letterRow");
  const genres = $("genreRow");
  if (!filters || !letters || !genres) return;

  const showLetters = state.crateType === "alphabeticalByName";
  const showGenres = state.crateType === "byGenre";
  filters.hidden = !(showLetters || showGenres);
  letters.hidden = !showLetters;
  genres.hidden = !showGenres;
  if (!showGenres) genres.innerHTML = "";

  if (showLetters && !letters.dataset.ready) {
    const chars = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "VA", "#"];
    letters.innerHTML = chars
      .map(
        (ch) =>
          `<button type="button" class="crate-chip${ch === state.crateLetter ? " active" : ""}" data-letter="${ch}">${ch}</button>`,
      )
      .join("");
    letters.dataset.ready = "1";
    letters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-letter]");
      if (!btn) return;
      state.crateLetter = btn.dataset.letter || "A";
      letters.querySelectorAll(".crate-chip").forEach((b) => {
        b.classList.toggle("active", b.dataset.letter === state.crateLetter);
      });
      loadCrates("alphabeticalByName");
    });
  } else if (showLetters) {
    letters.querySelectorAll(".crate-chip").forEach((b) => {
      b.classList.toggle("active", b.dataset.letter === state.crateLetter);
    });
  }

  if (showGenres) {
    const token = ++state.genreFilterToken;
    ensureGenres().then((list) => {
      if (token !== state.genreFilterToken || state.crateType !== "byGenre") return;
      if (!genres.dataset.bound) {
        genres.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-genre]");
          if (!btn) return;
          state.crateGenre = btn.dataset.genre || "";
          genres.querySelectorAll(".crate-chip").forEach((b) => {
            b.classList.toggle("active", b.dataset.genre === state.crateGenre);
          });
          loadCrates("byGenre");
        });
        genres.dataset.bound = "1";
      }
      if (!list.length) {
        genres.innerHTML = `<span class="hint">No genres yet</span>`;
        return;
      }
      if (!state.crateGenre || !list.some((g) => g.value === state.crateGenre)) {
        state.crateGenre = list[0].value;
      }
      genres.innerHTML = list
        .map((g) => {
          const active = g.value === state.crateGenre ? " active" : "";
          return `<button type="button" class="crate-chip${active}" data-genre="${escapeHtml(g.value)}">${escapeHtml(g.value)}</button>`;
        })
        .join("");
    });
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
      const wrap = document.createElement("div");
      wrap.className = "sleeve-wrap";
      const btn = document.createElement("div");
      btn.className = "sleeve";
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;
      btn.innerHTML = `<img src="${coverUrl(song.coverArt, 180)}" alt="" draggable="false">
        <div class="t">${escapeHtml(song.title)}</div>
        <div class="a">${escapeHtml(song.artist || "")}</div>`;
      const play = () => playSongSolo(song);
      btn.addEventListener("click", (e) => {
        if (suppressSleeveClick) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        play();
      });
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play();
        }
      });
      wrap.append(btn);
      bindSongDrag(wrap, song);
      grid.appendChild(wrap);
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

  wireDeckDrop();

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
    else setStatus("Tubes warm. Hit SPIN · drag a sleeve onto the deck · Space play · ←→ skip");
  } catch (err) {
    setStatus("Backend starting — retry in a moment.");
  }
  await loadCrates("newest");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();
