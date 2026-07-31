const $ = (id) => document.getElementById(id);

const VOL_KEY = "cindy-vinyl-volume";
const THEME_KEY = "cindy-vinyl-theme";

/** Room / deck themes. Amp-rack footage is shared by dark + light; crate photo
 * and page chrome (`room`) differ. `cueOut: null` → fade instead of lift clip. */
const AMP_RACK_OVERLAY = {
  restImage: "/static/deck-theme2-rest.jpg",
  cueIn: "/static/deck-theme2-cue-in.mp4",
  cueOut: null,
  holdLoopStart: 8.0,
  holdLoopEnd: 9.0,
  audioCueDelayMs: 1800,
  labelLeft: "45.0%",
  labelTop: "19.5%",
  labelSize: "19.0%",
  labelTilt: "73deg",
  tintLeft: "47.5%",
  tintTop: "19.5%",
  tintSize: "47.5%",
  tintTilt: "63deg",
};

const DECK_THEMES = [
  {
    id: "technics-amp-rack",
    name: "Dark · Amp rack",
    room: "dark",
    crateImage: "/static/crate-front.png",
    ...AMP_RACK_OVERLAY,
  },
  {
    id: "technics-amp-rack-light",
    name: "Light · Amp rack",
    room: "light",
    crateImage: "/static/crate-front-light.png",
    ...AMP_RACK_OVERLAY,
  },
  {
    id: "technics-lounge",
    name: "Dark · Lounge",
    room: "dark",
    crateImage: "/static/crate-front.png",
    restImage: "/static/deck.png",
    cueIn: "/static/deck-cue-in.mp4",
    cueOut: "/static/deck-cue-out.mp4",
    holdLoopStart: 3.55,
    holdLoopEnd: 4.2,
    audioCueDelayMs: 4000,
    labelLeft: "41.6%",
    labelTop: "55%",
    labelSize: "13.2%",
    labelTilt: "50deg",
    tintLeft: "41.6%",
    tintTop: "55%",
    tintSize: "33%",
    tintTilt: "50deg",
  },
];
let currentTheme = DECK_THEMES[0];

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
  crateType: "alphabeticalByName",
  crateLetter: "A",
  crateGenre: "",
  genresCache: null,
  genreFilterToken: 0,
  /** Non-empty A–Z/VA/# buckets, fetched once from /api/letters. */
  crateLettersCache: null,
  crateLetterIdx: 0,
  /** A–Z paging: how many sleeves already in the crate for this letter. */
  crateLetterLoaded: 0,
  crateLetterTotal: 0,
  crateLetterHasMore: false,
  crateLetterLoadingMore: false,
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

/** Feeds the OS media overlay (title/artist/art + prev/play/pause/next) so it's
 * not just a bare album-art tile. Guarded: not all browsers support this. */
function updateMediaSession(song, album) {
  if (!("mediaSession" in navigator)) return;
  try {
    const coverId = song?.coverArt || album?.coverArt;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song?.title || "Track",
      artist: song?.artist || album?.artist || "",
      album: album?.name || "",
      artwork: coverId
        ? [{ src: coverUrl(coverId, 300), sizes: "300x300", type: "image/jpeg" }]
        : [],
    });
  } catch {
    /* ignore -- cosmetic only */
  }
}

function wireMediaSessionActions() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler("play", () => togglePlayPause());
    navigator.mediaSession.setActionHandler("pause", () => togglePlayPause());
    navigator.mediaSession.setActionHandler("previoustrack", () => playIndex(state.index - 1));
    navigator.mediaSession.setActionHandler("nexttrack", () => playIndex(state.index + 1));
  } catch {
    /* ignore -- cosmetic only */
  }
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

  const theme = currentTheme;
  playVideoSrc(v, theme.cueIn, token, () => {
    if (token !== state.armToken) return;
    v.ontimeupdate = () => {
      if (token !== state.armToken) return;
      if (state.arm !== "cueing-in" && state.arm !== "hold") return;
      // Seek a hair before the end frame so we never flash a mismatched label phase
      if (v.currentTime >= theme.holdLoopEnd - 0.02) {
        state.arm = "hold";
        try {
          v.currentTime = theme.holdLoopStart;
        } catch {
          /* ignore */
        }
      } else if (v.currentTime >= theme.holdLoopStart && state.arm === "cueing-in") {
        state.arm = "hold";
      }
    };
    v.onended = () => {
      if (token !== state.armToken) return;
      state.arm = "hold";
      try {
        v.currentTime = theme.holdLoopStart;
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

  if (!currentTheme.cueOut) {
    // No lift-off clip for this theme yet -- fade the frozen frame out instead
    // of trying to play footage that doesn't exist.
    v.classList.add("fade-out");
    setTimeout(() => {
      if (token !== state.armToken) return;
      state.arm = "rest";
      v.classList.remove("fade-out");
      showStaticDeck();
    }, 400);
    return;
  }

  playVideoSrc(v, currentTheme.cueOut, token, () => {
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
  [currentTheme.cueIn, currentTheme.cueOut].filter(Boolean).forEach((src) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = src;
  });
}

function buildThemeMenuDom() {
  const section = $("themeMenuSection");
  if (!section || section.children.length) return;
  DECK_THEMES.forEach((theme) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.dataset.action = "theme";
    btn.dataset.themeId = theme.id;
    btn.textContent = theme.name;
    section.appendChild(btn);
  });
  updateThemeMenuHighlight();
}

function updateThemeMenuHighlight() {
  document.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeId === currentTheme.id);
  });
}

function syncThemeChrome() {
  const room = currentTheme.room || "dark";
  const isLight = room === "light";
  document.documentElement.dataset.room = room;
  document.body.dataset.room = room;
  document.documentElement.classList.toggle("theme-light", isLight);
  document.body.classList.toggle("theme-light", isLight);
  const photo = document.querySelector(".deck-photo");
  if (photo) {
    photo.src = currentTheme.restImage;
    photo.alt = currentTheme.name;
  }
  const crate = $("crateCarouselPhoto") || document.querySelector(".crate-carousel-photo");
  if (crate && currentTheme.crateImage) crate.src = currentTheme.crateImage;
  const tag = $("deckTag");
  if (tag) tag.textContent = currentTheme.name;
  const meta = $("themeColorMeta");
  if (meta) meta.content = isLight ? "#71788A" : "#0a090b";
  updateThemeMenuHighlight();
}

function applyDeckTheme(themeId, { persist = true } = {}) {
  const theme = DECK_THEMES.find((t) => t.id === themeId);
  if (!theme) return;
  const same = theme.id === currentTheme.id;
  if (!same) {
    // Never mix footage from two themes -- always return to a clean rest state first.
    resetArmToRest();
    currentTheme = theme;
    _applyOverlayVars();
    preloadCues();
  }
  syncThemeChrome();
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme.id);
    } catch {
      /* ignore */
    }
  }
}

/** Live calibration tool for the per-theme spinning-label position (see
 * DECK_THEMES.labelLeft/labelTop/labelSize/labelTilt). Press L to toggle:
 * arrows move it (Shift+arrow for bigger steps), +/- resize it, ,/. tilt it
 * (rotateX) -- reads the live values back in the status line so it can be
 * dialed in by eye instead of guessed from screenshots. Not persisted; once
 * it looks right, copy the numbers into DECK_THEMES by hand.
 *
 * L nudges the label, O nudges the colour-tint overlay -- separately, since
 * they're independent fields (labelLeft/labelTop/labelSize/labelTilt vs.
 * tintLeft/tintTop/tintSize/tintTilt). Only one target nudges at a time. */
let labelNudgeMode = false;
let tintNudgeMode = false;

function _nudgeTarget() {
  return labelNudgeMode ? "label" : tintNudgeMode ? "tint" : null;
}

function _readout(prefix) {
  const t = currentTheme;
  return `${t[`${prefix}Left`]}, ${t[`${prefix}Top`]}, size ${t[`${prefix}Size`]}, tilt ${t[`${prefix}Tilt`]}`;
}

function toggleLabelNudge() {
  tintNudgeMode = false;
  labelNudgeMode = !labelNudgeMode;
  if (labelNudgeMode) {
    setStatus(
      `Label nudge ON (${_readout("label")}) — arrows move, Shift+arrow = bigger step, +/- resize, ,/. tilt, L to exit.`,
    );
  } else {
    setStatus(`Label nudge off. Final: ${_readout("label")}`);
  }
}

function toggleTintNudge() {
  labelNudgeMode = false;
  tintNudgeMode = !tintNudgeMode;
  if (tintNudgeMode) {
    setStatus(
      `Tint nudge ON (${_readout("tint")}) — arrows move, Shift+arrow = bigger step, +/- resize, ,/. tilt, O to exit.`,
    );
  } else {
    setStatus(`Tint nudge off. Final: ${_readout("tint")}`);
  }
}

function _applyOverlayVars() {
  const stage = $("deckStage");
  if (!stage) return;
  const t = currentTheme;
  stage.style.setProperty("--label-left", t.labelLeft);
  stage.style.setProperty("--label-top", t.labelTop);
  stage.style.setProperty("--label-size", t.labelSize);
  stage.style.setProperty("--label-tilt", t.labelTilt);
  stage.style.setProperty("--tint-left", t.tintLeft);
  stage.style.setProperty("--tint-top", t.tintTop);
  stage.style.setProperty("--tint-size", t.tintSize);
  stage.style.setProperty("--tint-tilt", t.tintTilt);
}

function nudgePosition(dx, dy) {
  const prefix = _nudgeTarget();
  if (!prefix) return;
  const leftKey = `${prefix}Left`;
  const topKey = `${prefix}Top`;
  const left = Math.max(0, Math.min(100, (parseFloat(currentTheme[leftKey]) || 0) + dx));
  const top = Math.max(0, Math.min(100, (parseFloat(currentTheme[topKey]) || 0) + dy));
  currentTheme[leftKey] = `${left.toFixed(1)}%`;
  currentTheme[topKey] = `${top.toFixed(1)}%`;
  _applyOverlayVars();
  setStatus(`${prefix === "label" ? "Label" : "Tint"}: ${_readout(prefix)}`);
}

function nudgeSize(delta) {
  const prefix = _nudgeTarget();
  if (!prefix) return;
  const sizeKey = `${prefix}Size`;
  const size = Math.max(1, Math.min(100, (parseFloat(currentTheme[sizeKey]) || 0) + delta));
  currentTheme[sizeKey] = `${size.toFixed(1)}%`;
  _applyOverlayVars();
  setStatus(`${prefix === "label" ? "Label" : "Tint"}: ${_readout(prefix)}`);
}

function nudgeTilt(delta) {
  const prefix = _nudgeTarget();
  if (!prefix) return;
  const tiltKey = `${prefix}Tilt`;
  // Capped short of 90deg -- CSS 3D perspective transforms have a near-
  // singularity right at the exact boundary (the projection math blows up).
  const tilt = Math.max(0, Math.min(85, (parseFloat(currentTheme[tiltKey]) || 0) + delta));
  currentTheme[tiltKey] = `${tilt.toFixed(0)}deg`;
  _applyOverlayVars();
  setStatus(`${prefix === "label" ? "Label" : "Tint"}: ${_readout(prefix)}`);
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
    const remoteArt = s.coverArt && !String(s.id || "").startsWith("local:");
    const art = near && remoteArt ? coverUrl(s.coverArt, 80) : "";
    parts.push(`<li class="${active}" data-i="${i}">
        ${art ? `<img src="${art}" alt="" loading="lazy">` : `<span class="track-art-ph" aria-hidden="true"></span>`}
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

const LOCAL_AUDIO_RE = /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|aiff|aif)$/i;

function transferHasFiles(dt) {
  try {
    return Array.from(dt?.types || []).includes("Files");
  } catch {
    return false;
  }
}

function revokeLocalQueueUrls(songs) {
  for (const s of songs || []) {
    if (!s?.localUrl) continue;
    try {
      URL.revokeObjectURL(s.localUrl);
    } catch {
      /* ignore */
    }
  }
}

function readAllDirectoryEntries(dirEntry) {
  const reader = dirEntry.createReader();
  return new Promise((resolve, reject) => {
    const all = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        pump();
      }, reject);
    };
    pump();
  });
}

async function walkFsEntry(entry, pathPrefix = "") {
  const out = [];
  if (!entry) return out;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    if (LOCAL_AUDIO_RE.test(file.name)) {
      out.push({ file, name: file.name, relativePath: `${pathPrefix}${file.name}` });
    }
    return out;
  }
  if (entry.isDirectory) {
    const kids = await readAllDirectoryEntries(entry);
    const base = `${pathPrefix}${entry.name}/`;
    for (const kid of kids) {
      out.push(...(await walkFsEntry(kid, base)));
    }
  }
  return out;
}

async function collectAudioFromDataTransfer(dt) {
  const items = [...(dt.items || [])];
  const found = [];
  let folderName = "Dropped folder";

  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() || item.getAsEntry?.();
    if (entry) {
      if (entry.isDirectory && entry.name) folderName = entry.name;
      found.push(...(await walkFsEntry(entry, "")));
      continue;
    }
    const file = item.getAsFile?.();
    if (file && LOCAL_AUDIO_RE.test(file.name)) {
      found.push({
        file,
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
      });
    }
  }

  if (!found.length) {
    for (const file of dt.files || []) {
      if (!LOCAL_AUDIO_RE.test(file.name)) continue;
      found.push({
        file,
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
      });
    }
  }

  found.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return { files: found, folderName };
}

async function loadLocalFolderDrop(dt) {
  setStatus("Reading that folder…");
  try {
    const { files, folderName } = await collectAudioFromDataTransfer(dt);
    if (!files.length) {
      setStatus("No playable audio in that folder (mp3, flac, m4a…).");
      return;
    }
    revokeLocalQueueUrls(state.queue);
    const songs = files.map((f, i) => {
      const stem = f.name.replace(/\.[^.]+$/, "");
      const parts = f.relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
      const artistGuess = parts.length >= 3 ? parts[parts.length - 3] : "Local folder";
      return {
        id: `local:${i}:${f.name}`,
        title: stem,
        artist: artistGuess,
        album: folderName,
        albumId: `local-folder:${folderName}`,
        coverArt: null,
        localUrl: URL.createObjectURL(f.file),
      };
    });
    loadAlbumIntoQueue(
      {
        id: `local-folder:${folderName}`,
        name: folderName,
        artist: "Local folder",
        displayArtist: "Local folder",
        coverArt: null,
        song: songs,
        local: true,
      },
      { autoplay: true },
    );
    const fb = $("vinylFallback");
    if (fb) {
      fb.hidden = false;
      fb.textContent = (folderName || "L").charAt(0).toUpperCase();
    }
    $("deckStage")?.classList.add("has-vinyl");
    setStatus(
      `${songs.length} local side${songs.length === 1 ? "" : "s"} from “${folderName}”.`,
    );
  } catch (err) {
    setStatus(`Couldn’t read that folder: ${String(err.message || err).slice(0, 140)}`);
  }
}

function wireDeckDrop() {
  const stage = $("deckStage");
  const heroMain = document.querySelector(".hero-main");

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
      heroMain?.classList.toggle("drag-over", onDeck);
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

  // Windows Explorer folder / file drops → play locally in the browser.
  const overPlaySurface = (e) =>
    dropZoneUnder(e.clientX, e.clientY) ||
    !!e.target?.closest?.("#deckStage, .hero-main, #hero, #stage");

  const allowOsFiles = (e) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    const onDeck = overPlaySurface(e);
    stage?.classList.toggle("drag-over", onDeck);
    heroMain?.classList.toggle("drag-over", onDeck);
    if (onDeck) markDropTargets(true);
  };
  const onOsDrop = (e) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    markDropTargets(false);
    if (!overPlaySurface(e)) {
      setStatus("Drop the folder on the deck to play it.");
      return;
    }
    loadLocalFolderDrop(e.dataTransfer);
  };
  document.addEventListener("dragenter", allowOsFiles, true);
  document.addEventListener("dragover", allowOsFiles, true);
  document.addEventListener("drop", onOsDrop, true);
  document.addEventListener(
    "dragleave",
    (e) => {
      if (!transferHasFiles(e.dataTransfer)) return;
      if (e.relatedTarget && document.body.contains(e.relatedTarget)) return;
      markDropTargets(false);
    },
    true,
  );
}

function loadAlbumIntoQueue(album, { autoplay = true } = {}) {
  const songs = album.song || [];
  if (!songs.length) {
    setStatus("That sleeve is empty.");
    return;
  }
  if (!album.local) revokeLocalQueueUrls(state.queue);
  state.album = album;
  state.queue = songs;
  state.index = 0;
  resetArmToRest();
  $("nowTitle").textContent = album.name || album.title || "Album";
  $("nowArtist").textContent = album.artist || album.displayArtist || "";
  setVinylArt(album.coverArt);
  if (album.local) {
    const fb = $("vinylFallback");
    if (fb) {
      fb.hidden = false;
      fb.textContent = (album.name || "L").charAt(0).toUpperCase();
    }
    $("deckStage")?.classList.add("has-vinyl");
  }
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
  $("nowTrackTitle").textContent = song.title || "Track";
  $("nextTrackTitle").textContent = state.queue[i + 1]?.title || "—";
  if (song.coverArt) setVinylArt(song.coverArt);
  else if (state.album?.coverArt) setVinylArt(state.album.coverArt);
  ensureVinylColorForAlbum(state.album, song);
  prefetchQueueCovers(2);
  updateMediaSession(song, state.album);

  const playGen = ++state.playDelayToken;
  state.awaitingAudio = false;
  audio.src = song.localUrl || `/api/stream/${encodeURIComponent(song.id)}`;

  // Arm already on the record (skip / resume) — start sound immediately.
  const armReady = state.arm === "hold" || state.arm === "cueing-in";
  if (!armReady) {
    state.awaitingAudio = true;
    cueInThenHold();
    $("playPauseBtn").disabled = false;
    $("playPauseBtn").textContent = "Pause";
    $("deckPlay").textContent = "⏸";
    setStatus("Needle dropping…");
    await sleep(currentTheme.audioCueDelayMs);
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

const CRATE_LETTER_PAGE = 36;

function updateCratePageUi() {
  const bar = $("cratePageBar");
  const hint = $("cratePageHint");
  const btn = $("crateMoreBtn");
  if (!bar || !hint || !btn) return;
  const show = state.crateType === "alphabeticalByName";
  bar.hidden = !show;
  if (!show) {
    btn.hidden = true;
    return;
  }
  const loaded = state.crateLetterLoaded;
  const total = state.crateLetterTotal;
  if (!total && !loaded) {
    hint.textContent = "";
    btn.hidden = true;
    return;
  }
  hint.textContent = total
    ? `${loaded} of ${total} sleeve${total === 1 ? "" : "s"}`
    : `${loaded} sleeve${loaded === 1 ? "" : "s"}`;
  btn.hidden = !state.crateLetterHasMore;
  btn.disabled = !!state.crateLetterLoadingMore;
  btn.textContent = state.crateLetterLoadingMore ? "Digging…" : "More sleeves";
}

async function loadCrates(type, { append = false } = {}) {
  state.crateType = type;
  document.querySelectorAll(".crate-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });
  updateCrateFilters();
  const isLetter = type === "alphabeticalByName";
  const rail = isLetter ? $("crateCarouselRail") : $("crateRail");
  if (!append) {
    if (isLetter) {
      state.crateLetterLoaded = 0;
      state.crateLetterTotal = 0;
      state.crateLetterHasMore = false;
    }
    const hint =
      isLetter
        ? "Flipping to that letter…"
        : type === "byGenre"
          ? "Pulling that category…"
          : "Pulling sleeves…";
    rail.innerHTML = `<p class='hint'>${hint}</p>`;
    updateCratePageUi();
  }
  try {
    const pageSize = isLetter ? CRATE_LETTER_PAGE : 48;
    const offset = isLetter && append ? state.crateLetterLoaded : 0;
    const params = new URLSearchParams({
      type,
      size: String(pageSize),
      offset: String(offset),
    });
    if (isLetter) params.set("letter", state.crateLetter || "A");
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
    const albums = data.albums || [];
    // Build off-DOM first -- appending sleeves one at a time into the live
    // rail forces a reflow per node.
    const frag = document.createDocumentFragment();
    albums.forEach((al) => frag.appendChild(sleeveButton(al)));
    if (append) {
      rail.querySelector(".hint")?.remove();
      rail.appendChild(frag);
    } else {
      rail.innerHTML = "";
      rail.appendChild(frag);
      if (!albums.length) {
        rail.innerHTML = "<p class='hint'>Nothing in this crate — try another letter or category.</p>";
      }
    }
    if (isLetter) {
      state.crateLetterLoaded = append
        ? state.crateLetterLoaded + albums.length
        : albums.length;
      state.crateLetterTotal = Number(data.total) || state.crateLetterLoaded;
      state.crateLetterHasMore = !!data.hasMore;
      updateCratePageUi();
      if (append && albums.length) {
        rail.querySelector(".sleeve-wrap:last-child")?.scrollIntoView({
          behavior: "smooth",
          inline: "end",
          block: "nearest",
        });
      }
    } else {
      updateCratePageUi();
    }
  } catch (err) {
    if (state.crateType !== type) return;
    if (!append) {
      rail.innerHTML = `<p class='hint'>${escapeHtml(err.message || err)}</p>`;
    }
    setStatus(String(err.message || err).slice(0, 160));
  } finally {
    state.crateLetterLoadingMore = false;
    updateCratePageUi();
  }
}

async function loadMoreLetterSleeves() {
  if (
    state.crateType !== "alphabeticalByName" ||
    !state.crateLetterHasMore ||
    state.crateLetterLoadingMore
  ) {
    return;
  }
  state.crateLetterLoadingMore = true;
  updateCratePageUi();
  await loadCrates("alphabeticalByName", { append: true });
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

async function ensureCrateLetters() {
  if (state.crateLettersCache) return state.crateLettersCache;
  try {
    const data = await api("/api/letters");
    state.crateLettersCache = (data.letters || []).length
      ? data.letters
      : [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "VA", "#"];
  } catch {
    state.crateLettersCache = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "VA", "#"];
  }
  return state.crateLettersCache;
}

function syncCrateCarouselUi() {
  const list = state.crateLettersCache || [];
  const idx = list.indexOf(state.crateLetter);
  state.crateLetterIdx = idx >= 0 ? idx : 0;
  $("crateCarouselLetter").textContent = state.crateLetter || "";
  $("crateCarouselPrev").disabled = state.crateLetterIdx <= 0;
  $("crateCarouselNext").disabled = !list.length || state.crateLetterIdx >= list.length - 1;
}

function stepCrateLetter(delta) {
  const list = state.crateLettersCache || [];
  if (!list.length) return;
  const next = Math.min(list.length - 1, Math.max(0, state.crateLetterIdx + delta));
  if (next === state.crateLetterIdx) return;
  state.crateLetterIdx = next;
  state.crateLetter = list[next];
  state.crateLetterLoaded = 0;
  state.crateLetterHasMore = false;
  loadCrates("alphabeticalByName");
}

function updateCrateFilters() {
  const filters = $("crateFilters");
  const genres = $("genreRow");
  const carousel = $("crateCarousel");
  const rail = $("crateRail");
  if (!filters || !genres || !carousel || !rail) return;

  const showLetters = state.crateType === "alphabeticalByName";
  const showGenres = state.crateType === "byGenre";
  filters.hidden = !showGenres;
  carousel.hidden = !showLetters;
  rail.hidden = showLetters;
  genres.hidden = !showGenres;
  if (!showGenres) genres.innerHTML = "";

  if (showLetters) {
    ensureCrateLetters().then((list) => {
      if (state.crateType !== "alphabeticalByName") return;
      if (!list.includes(state.crateLetter)) state.crateLetter = list[0] || "A";
      syncCrateCarouselUi();
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
    const frag = document.createDocumentFragment();
    (data.albums || []).forEach((al) => frag.appendChild(sleeveButton(al)));
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
      frag.appendChild(wrap);
    });
    grid.innerHTML = "";
    grid.appendChild(frag);
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

  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) applyDeckTheme(savedTheme, { persist: false });
    else syncThemeChrome();
  } catch {
    syncThemeChrome();
  }

  wireDeckDrop();
  buildThemeMenuDom();
  wireMediaSessionActions();

  $("spinBtn").addEventListener("click", () => spin());
  $("playPauseBtn").addEventListener("click", () => togglePlayPause());
  $("deckPlay").addEventListener("click", () => togglePlayPause());
  $("nextBtn").addEventListener("click", () => playIndex(state.index + 1));
  $("prevBtn").addEventListener("click", () => playIndex(state.index - 1));
  $("muteBtn").addEventListener("click", () => toggleMute());
  $("volume")?.addEventListener("input", () => {
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
  $("crateCarouselPrev")?.addEventListener("click", () => stepCrateLetter(-1));
  $("crateCarouselNext")?.addEventListener("click", () => stepCrateLetter(1));
  $("crateMoreBtn")?.addEventListener("click", () => loadMoreLetterSleeves());
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
    else if (action === "theme") applyDeckTheme(btn.dataset.themeId);
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
    if (
      (labelNudgeMode || tintNudgeMode) &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      const step = e.shiftKey ? 2 : 0.5;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      nudgePosition(dx, dy);
      return;
    }
    if ((labelNudgeMode || tintNudgeMode) && ["+", "=", "-", "_", ",", "."].includes(e.key)) {
      e.preventDefault();
      if (e.key === "+" || e.key === "=") nudgeSize(0.5);
      else if (e.key === "-" || e.key === "_") nudgeSize(-0.5);
      else if (e.key === ",") nudgeTilt(-2);
      else if (e.key === ".") nudgeTilt(2);
      return;
    }
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
      case "[":
        if (state.crateType === "alphabeticalByName") {
          e.preventDefault();
          stepCrateLetter(-1);
        }
        break;
      case "]":
        if (state.crateType === "alphabeticalByName") {
          e.preventDefault();
          stepCrateLetter(1);
        }
        break;
      case "PageDown":
        if (state.crateType === "alphabeticalByName" && state.crateLetterHasMore) {
          e.preventDefault();
          loadMoreLetterSleeves();
        }
        break;
      case "d":
      case "D":
        if (state.crateType === "alphabeticalByName") {
          e.preventDefault();
          $("crateCarouselDropzone")?.classList.toggle("debug-outline");
        }
        break;
      case "l":
      case "L":
        e.preventDefault();
        toggleLabelNudge();
        break;
      case "o":
      case "O":
        e.preventDefault();
        toggleTintNudge();
        break;
      default:
        break;
    }
  });
}

async function boot() {
  wire();
  // Health check and the initial crate load don't depend on each other --
  // run them in parallel instead of back-to-back so startup isn't paying
  // for both round trips in sequence. Cue videos wait until crates paint
  // so first dig isn't fighting megabytes of MP4 preload.
  const health = api("/api/health")
    .then((h) => {
      if (!h.ok) setStatus(`Navidrome: ${h.error || "not ready"}`);
      else setStatus("Tubes warm. Hit SPIN · drag a sleeve onto the deck · Space play · ←→ skip");
    })
    .catch(() => setStatus("Backend starting — retry in a moment."));
  await Promise.all([health, loadCrates("alphabeticalByName")]);
  preloadCues();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();
