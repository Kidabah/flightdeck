import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(process.env.CAMERA_APP_JS || new URL('../app/static/app.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const end = source.indexOf('\nfunction ', start + 1);
  const asyncEnd = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, Math.min(...[end, asyncEnd].filter(i => i >= 0)));
}
function setup() {
  let now = 100000;
  const listeners = {};
  const img = {
    dataset: { cameraId: 'x1c' }, src: '/api/camera/x1c/stream',
    complete: true, naturalWidth: 960,
    getBoundingClientRect: () => ({ width: 400, height: 300, top: 0, left: 0, bottom: 300, right: 400 }),
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const root = { hidden: false, querySelectorAll: () => [img] };
  const context = vm.createContext({
    Date: { now: () => now }, FLIGHTDECK_DEMO: false, document: root,
    window: { innerHeight: 900, innerWidth: 1400 },
    _cameraUrlCache: { x1c: '/api/camera/x1c/stream' }, _cameraMetaCache: {}, _cameraHealthCache: {},
    _CAMERA_STREAM_REFRESH_MS: 25000, _CAMERA_HEALTH_STALE_MS: 12000, _CAMERA_SIGNAL_STALE_MS: 12000,
    _setCameraSignal: (image, state) => { image.dataset.cameraSignalState = state; },
    _refreshCameraSignals: () => {},
    fetch: async () => ({ ok: true, json: async () => ({ alive: true, frame_seq: now, changed_seq: now }) }),
  });
  vm.runInContext([
    declaration('_setCameraImageSrc'), declaration('_attachCameraRetries'),
    declaration('_refreshVisibleCameraStreams'), `async ${declaration('_pollCameraHealth')}`,
  ].join('\n'), context);
  context._attachCameraRetries(root);
  return { context, img, root, listeners, advance: ms => { now += ms; } };
}

test('healthy server frames cannot postpone renewal of a frozen browser connection', async () => {
  const s = setup();
  await s.context._pollCameraHealth();
  s.advance(25000);
  await s.context._pollCameraHealth();
  assert.equal(s.img.dataset.cameraFrameAt, '125000');
  s.context._refreshVisibleCameraStreams();
  assert.match(s.img.src, /refresh=125000$/);
});

test('image load events and repeated attachment cannot postpone connection renewal', () => {
  const s = setup();
  s.advance(24000);
  s.listeners.load();
  s.context._attachCameraRetries(s.root);
  s.context._refreshVisibleCameraStreams();
  assert.equal(s.img.src, '/api/camera/x1c/stream');
  s.advance(1000);
  s.context._refreshVisibleCameraStreams();
  assert.match(s.img.src, /refresh=125000$/);
});

test('renewal resets its own timer to prevent repeated reconnects', () => {
  const s = setup();
  s.advance(25000);
  s.context._refreshVisibleCameraStreams();
  s.advance(5000);
  s.context._refreshVisibleCameraStreams();
  assert.match(s.img.src, /refresh=125000$/);
  assert.equal(s.img.dataset.cameraConnectionAt, '125000');
});

test('background, offscreen and simulated still feeds are left alone', () => {
  for (const kind of ['background', 'offscreen', 'still', 'demo']) {
    const s = setup();
    s.advance(30000);
    if (kind === 'background') s.root.hidden = true;
    if (kind === 'offscreen') s.img.getBoundingClientRect = () => ({ width: 400, height: 300, top: 1000, left: 0, bottom: 1300, right: 400 });
    if (kind === 'still') s.img.dataset.fleetStill = '1';
    if (kind === 'demo') s.context.FLIGHTDECK_DEMO = true;
    s.context._refreshVisibleCameraStreams();
    assert.equal(s.img.src, '/api/camera/x1c/stream', kind);
  }
});

test('returning to foreground can renew a young connection immediately', () => {
  const s = setup();
  s.advance(1000);
  s.context._refreshVisibleCameraStreams(true);
  assert.match(s.img.src, /refresh=101000$/);
});
