/* Voice-opened live printer cameras. This only displays existing Flightdeck feeds. */
(() => {
  'use strict';
  const panel = document.createElement('aside');
  panel.id = 'amy-camera-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'amy-camera-title');
  panel.innerHTML = `
    <div class="amy-camera-head"><h2 id="amy-camera-title">Printer camera</h2><button type="button" id="amy-camera-close" aria-label="Close camera">×</button></div>
    <p id="amy-camera-status" role="status">Connecting to the live feed…</p>
    <div id="amy-camera-feeds"></div>
    <small>Live view from Flightdeck.</small>`;
  document.body.append(panel);
  const title = document.getElementById('amy-camera-title');
  const status = document.getElementById('amy-camera-status');
  const feeds = document.getElementById('amy-camera-feeds');
  const close = document.getElementById('amy-camera-close');
  function browserUrl(raw) {
    const parsed = new URL(raw, window.location.href);
    const loopback = host => /^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(host || '');
    // The Pi backend talks to Flightdeck over localhost; a remote Amy browser must use its Tailscale host.
    if (loopback(parsed.hostname) && !loopback(window.location.hostname)) {
      parsed.protocol = window.location.protocol;
      parsed.hostname = window.location.hostname;
      parsed.port = '';
    }
    return parsed.href;
  }
  function positionPanel() {
    if (panel.hidden || window.matchMedia('(max-width: 720px)').matches) return;
    const card = document.querySelector('#hud .face-card');
    const pad = 16, gap = 28;
    const width = Math.min(420, Math.max(280, window.innerWidth - pad * 2));
    const rect = card?.getBoundingClientRect();
    let left = rect ? rect.right + gap : window.innerWidth - width - pad;
    if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad;
    const top = rect ? Math.max(pad, Math.min(rect.top, window.innerHeight - 260)) : pad;
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(pad, left)}px`;
    panel.style.top = `${top}px`;
  }
  function hide() {
    feeds.replaceChildren();
    panel.hidden = true;
    panel.classList.remove('is-open');
  }
  function renderCamera(camera) {
    const tile = document.createElement('figure');
    tile.className = 'amy-camera-tile';
    const caption = document.createElement('figcaption');
    const name = document.createElement('strong');
    name.textContent = camera.name || 'Printer';
    const state = document.createElement('span');
    state.className = 'amy-camera-tile-state';
    state.textContent = 'CONNECTING';
    caption.append(name, state);
    const image = document.createElement('img');
    image.alt = `${camera.name || 'Printer'} live camera feed`;
    image.onerror = () => { state.textContent = 'UNAVAILABLE'; };
    image.onload = () => { state.textContent = 'LIVE'; };
    const streamUrl = browserUrl(camera.url);
    image.src = streamUrl + (streamUrl.includes('?') ? '&' : '?') + 'amy=' + Date.now();
    tile.append(caption, image);
    return tile;
  }
  function show(cameraData) {
    const cameras = Array.isArray(cameraData) ? cameraData : [cameraData];
    const usable = cameras.filter(camera => camera?.url);
    if (!usable.length) {
      status.textContent = 'Amy could not find a live camera feed for that printer.';
      return;
    }
    title.textContent = usable.length > 1 ? 'Printer cameras' : `${usable[0].name || 'Printer'} camera`;
    status.textContent = usable.length > 1 ? `Connecting to ${usable.length} live feeds…` : 'Connecting to the live feed…';
    feeds.replaceChildren(...usable.map(renderCamera));
    panel.hidden = false;
    panel.classList.add('is-open');
    positionPanel();
  }
  close.addEventListener('click', hide);
  window.addEventListener('resize', positionPanel);
  window.AmyCameraView = {
    receive(payload) {
      if (payload?.tool === 'camera_view_close') { hide(); return; }
      if (payload?.tool !== 'camera_view') return;
      show(payload.cameras || payload.camera);
    },
  };
})();