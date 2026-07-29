const $ = (id) => document.getElementById(id);

const VOL_KEY = "cindy-vinyl-volume";

const state = {
  queue: [],
  index: -1,
  album: null,
  crateType: "newest",
  volumeBeforeMute: 0.85,
};

const audio = $("audio");

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

function coverUrl(id, size = 300) {
  if (!id) return "";
  return `/api/cover/${encodeURIComponent(id)}?size=${size}`;
}

function setStatus(msg) {
  $("statusLine").textContent = msg;
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

function setVinylArt(coverId) {
  const img = $("vinylArt");
  const fb = $("vinylFallback");
  if (!coverId) {
    if (img) img.hidden = true;
    if (fb) fb.hidden = false;
    $("deckArt")?.removeAttribute("src");
    return;
  }
  const url = coverUrl(coverId, 600);
  if (img) {
    img.src = url;
    img.hidden = false;
  }
  if (fb) fb.hidden = true;
  const art = $("deckArt");
  if (art) art.src = coverUrl(coverId, 120);
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
  $("nowTitle").textContent = album.name || album.title || "Album";
  $("nowArtist").textContent = album.artist || album.displayArtist || "";
  setVinylArt(album.coverArt);
  renderQueue();
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
  $("vinyl")?.classList.toggle("spinning", on);
  $("deckStage")?.classList.toggle("playing", on);
  $("playPauseBtn").textContent = on ? "Pause" : "Play";
  $("deckPlay").textContent = on ? "⏸" : "▶";
  setStatus(on ? "Needle down." : "Paused.");
}

async function spin() {
  $("spinBtn").disabled = true;
  setStatus("Digging through the crates…");
  $("vinyl")?.classList.remove("spinning");
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
  a.textContent = album.artist || "";
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
  return btn;
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
    else setPlaying(false);
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

  document.addEventListener("keydown", (e) => {
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
  try {
    const h = await api("/api/health");
    if (!h.ok) setStatus(`Navidrome: ${h.error || "not ready"}`);
    else setStatus("Tubes warm. Hit SPIN. · Space play · ←→ skip · ↑↓ vol");
  } catch (err) {
    setStatus("Backend starting — retry in a moment.");
  }
  await loadCrates("newest");
}

boot();
