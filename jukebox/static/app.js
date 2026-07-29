const $ = (id) => document.getElementById(id);

const state = {
  queue: [],
  index: -1,
  album: null,
  crateType: "newest",
  /** @type {'rest'|'cueing-in'|'hold'|'cueing-out'} */
  arm: "rest",
  armToken: 0,
};

/** Seconds — freeze here while audio plays (needle down). */
const ARM_HOLD_AT = 2.1;

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

function deckArm() {
  return /** @type {HTMLVideoElement|null} */ ($("deckArm"));
}

function freezeArm(t) {
  const v = deckArm();
  if (!v) return;
  v.pause();
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : ARM_HOLD_AT;
  v.currentTime = Math.max(0, Math.min(t, dur - 0.01));
}

function restFrame() {
  const v = deckArm();
  if (!v) return;
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
  freezeArm(dur);
  state.arm = "rest";
}

/** Cue tonearm onto the record, then hold. */
async function cueIn() {
  const v = deckArm();
  if (!v) return;
  const token = ++state.armToken;

  // Already needle-down (pause/resume or track skip) — snap to hold.
  if (state.arm === "hold" || state.arm === "cueing-in") {
    freezeArm(ARM_HOLD_AT);
    state.arm = "hold";
    return;
  }

  state.arm = "cueing-in";
  freezeArm(0);
  try {
    await v.play();
  } catch {
    freezeArm(ARM_HOLD_AT);
    state.arm = "hold";
    return;
  }

  await new Promise((resolve) => {
    const tick = () => {
      if (token !== state.armToken) {
        v.removeEventListener("timeupdate", tick);
        resolve();
        return;
      }
      if (v.currentTime >= ARM_HOLD_AT) {
        freezeArm(ARM_HOLD_AT);
        state.arm = "hold";
        v.removeEventListener("timeupdate", tick);
        resolve();
      }
    };
    v.addEventListener("timeupdate", tick);
  });
}

/** Lift tonearm off the record back to rest. */
async function cueOut() {
  const v = deckArm();
  if (!v) return;
  if (state.arm === "rest" || state.arm === "cueing-out") return;

  const token = ++state.armToken;
  state.arm = "cueing-out";
  if (v.currentTime < ARM_HOLD_AT - 0.05) freezeArm(ARM_HOLD_AT);

  try {
    await v.play();
  } catch {
    restFrame();
    return;
  }

  await new Promise((resolve) => {
    const finish = () => {
      if (token !== state.armToken) {
        cleanup();
        resolve();
        return;
      }
      restFrame();
      cleanup();
      resolve();
    };
    const tick = () => {
      if (token !== state.armToken) {
        cleanup();
        resolve();
        return;
      }
      if (v.ended || (v.duration && v.currentTime >= v.duration - 0.08)) finish();
    };
    function cleanup() {
      v.removeEventListener("ended", finish);
      v.removeEventListener("timeupdate", tick);
    }
    v.addEventListener("ended", finish);
    v.addEventListener("timeupdate", tick);
  });
}

function setVinylArt(coverId) {
  const art = $("deckArt");
  if (!coverId) {
    art?.removeAttribute("src");
    return;
  }
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
    cueIn();
  } catch (err) {
    setStatus(`Playback blocked: ${err.message || err}`);
    setPlaying(false);
    cueOut();
  }
  renderQueue();
}

function setPlaying(on) {
  $("deckStage")?.classList.toggle("playing", on);
  $("playPauseBtn").textContent = on ? "Pause" : "Play";
  $("deckPlay").textContent = on ? "⏸" : "▶";
  setStatus(on ? "Needle down." : "Paused.");
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

function wire() {
  $("spinBtn").addEventListener("click", () => spin());
  $("playPauseBtn").addEventListener("click", () => {
    if (!state.queue.length) return;
    if (audio.paused) {
      // Resume — keep needle down, don't re-cue.
      audio
        .play()
        .then(() => {
          setPlaying(true);
          if (state.arm !== "hold") cueIn();
          else freezeArm(ARM_HOLD_AT);
        })
        .catch(() => {});
    } else {
      audio.pause();
      setPlaying(false);
      // Pause mid-track: leave needle down (plan).
    }
  });
  $("deckPlay").addEventListener("click", () => $("playPauseBtn").click());
  $("nextBtn").addEventListener("click", () => playIndex(state.index + 1));
  $("prevBtn").addEventListener("click", () => playIndex(state.index - 1));
  audio.addEventListener("ended", () => {
    if (state.index + 1 < state.queue.length) {
      playIndex(state.index + 1);
    } else {
      setPlaying(false);
      cueOut();
      setStatus("Side finished.");
    }
  });
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    $("seek").value = String(Math.floor((audio.currentTime / audio.duration) * 1000));
  });
  $("seek").addEventListener("input", () => {
    if (!audio.duration) return;
    audio.currentTime = (Number($("seek").value) / 1000) * audio.duration;
  });
  document.querySelectorAll(".crate-tab").forEach((btn) => {
    btn.addEventListener("click", () => loadCrates(btn.dataset.type));
  });
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch($("searchInput").value);
  });

  const v = deckArm();
  if (v) {
    v.muted = true;
    const park = () => restFrame();
    if (v.readyState >= 1) park();
    else v.addEventListener("loadedmetadata", park, { once: true });
  }
}

async function boot() {
  wire();
  try {
    const h = await api("/api/health");
    if (!h.ok) setStatus(`Navidrome: ${h.error || "not ready"}`);
    else setStatus("Tubes warm. Hit SPIN.");
  } catch (err) {
    setStatus("Backend starting — retry in a moment.");
  }
  await loadCrates("newest");
}

boot();
