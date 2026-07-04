import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildContainer, buildLid, orientLidForPrint, toBufferGeometry, DEFAULTS, shapeSupportsJoiner, shapeSupportsDecor, shapeSupportsLid, LID_TYPES, VASE_STYLES, PENCIL_PRESET, TEARDROP_PRESET, STAR_PRESET, HEART_PRESET } from "./geometry.js";
import { EMBOSS_FONTS, ensureEmbossFontLoaded, embossFontSpec } from "./features.js";
import { loadImageFromFile, loadImageFromDataUrl, traceCanvasAsync, drawTracePreview, rasterizeSvgToCanvas, MAX_TRACE_RECTS, MAX_TRACE_POLYGONS } from "./trace.js";
import { meshToStl, downloadBlob, filenameFor } from "./stl.js";

const SESSION_KEY = "makerdeck-session-v1";
let saveSessionTimer = null;
let sessionBooting = true;

const PRESET_SHAPES = new Set(["pencil", "teardrop", "star", "heart"]);

const PRESET_CONFIG = {
  pencil: { preset: PENCIL_PRESET, profile: "pencil" },
  teardrop: { preset: TEARDROP_PRESET, profile: "teardrop" },
  star: { preset: STAR_PRESET, profile: "jewel" },
  heart: { preset: HEART_PRESET, profile: "jewel" },
};

const state = { ...DEFAULTS, shape: "rect" };
let meshCache = null;
let lidCache = null;
let accentCache = null;
let debossCutterCache = null;
let traceSourceCanvas = null;
let traceLastResult = null;
let traceLastSvg = "";
const BED_LIFT = 0.35;
const LID_PREVIEW_GAP = 0.35;
const LID_ANIM_LIFT = 14;

const viewport = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x070b12, 1);
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070b12, 0.0022);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
camera.position.set(120, 95, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, BED_LIFT + 20, 0);

const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x1a2438, 0.9);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(80, 120, 60);
key.castShadow = true;
scene.add(key);

const fill = new THREE.DirectionalLight(0x60a5fa, 0.35);
fill.position.set(-60, 40, -40);
scene.add(fill);

const grid = new THREE.GridHelper(260, 26, 0x2a3f5f, 0x162033);
grid.position.y = 0;
grid.renderOrder = 0;
for (const mat of Array.isArray(grid.material) ? grid.material : [grid.material]) {
  mat.depthWrite = false;
  mat.transparent = true;
  mat.opacity = 0.55;
}
scene.add(grid);

const previewRoot = new THREE.Group();
previewRoot.position.y = BED_LIFT;
scene.add(previewRoot);

const material = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  metalness: 0.15,
  roughness: 0.42,
  flatShading: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 2,
});

const edgeMaterial = new THREE.LineBasicMaterial({
  color: 0x93c5fd,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

const guideRimMaterial = new THREE.LineBasicMaterial({
  color: 0xffb020,
  transparent: true,
  opacity: 0.98,
  depthWrite: false,
});

const guideSkirtOuterMaterial = new THREE.LineBasicMaterial({
  color: 0x34d399,
  transparent: true,
  opacity: 0.98,
  depthWrite: false,
});

const guideSkirtInnerMaterial = new THREE.LineBasicMaterial({
  color: 0x22d3ee,
  transparent: true,
  opacity: 0.88,
  depthWrite: false,
});

const guidePlateMaterial = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.92,
  depthWrite: false,
});

let bodyMesh = null;
let edgeLines = null;
let lidMesh = null;
let lidGuideLoops = [];
let lidAnim = null;
let accentMesh = null;
let accentEdgeLines = null;
let labelMesh = null;
let labelEdgeLines = null;

const lidMaterial = new THREE.MeshStandardMaterial({
  color: 0x93c5fd,
  emissive: 0x000000,
  emissiveIntensity: 0,
  metalness: 0.12,
  roughness: 0.48,
  flatShading: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 3,
});

let previewXRayOn = false;
let lidFitOkTimer = null;

const LID_FIT_OK_PHRASES = ["Good as gold!", "She'll be right!", "No worries, mate!"];

const accentMaterial = new THREE.MeshStandardMaterial({
  color: 0xf97316,
  metalness: 0.1,
  roughness: 0.5,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 3,
  polygonOffsetUnits: 4,
});

const labelMaterial = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  metalness: 0.05,
  roughness: 0.55,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const debossPreviewMaterial = new THREE.MeshStandardMaterial({
  color: 0xdc2626,
  emissive: 0x991b1b,
  emissiveIntensity: 0.35,
  metalness: 0.05,
  roughness: 0.4,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});

function buildParams() {
  return {
    shape: state.shape === "rounded" ? "rect" : state.shape,
    innerWidth: state.innerWidth,
    innerDepth: state.innerDepth,
    innerHeight: state.innerHeight,
    wall: state.wall,
    floor: state.floor,
    cornerRadius: state.shape === "rounded" ? state.cornerRadius : 0,
    vertexFillet: state.vertexFillet,
    sides: state.sides,
    starPoints: state.starPoints,
    starInset: state.starInset,
    lidSkirt: state.lidSkirt,
    lidThickness: state.lidThickness,
    lidClearance: state.lidClearance,
    lidType: state.lidType,
    lidWall: state.wall,
    joinerEnabled: state.joinerEnabled,
    joinerHand: state.joinerHand,
    joinerWidth: state.joinerWidth,
    joinerNeck: state.joinerNeck,
    joinerProtrusion: state.joinerProtrusion,
    joinerClearance: state.joinerClearance,
    joinerAutoScale: state.joinerAutoScale,
    accentEnabled: state.accentEnabled,
    accentFace: state.accentFace,
    accentHeight: state.accentHeight,
    accentInset: state.accentInset,
    embossText: state.embossText,
    embossFont: state.embossFont,
    embossDepth: state.embossDepth,
    embossHeight: state.embossHeight,
    embossFace: state.embossFace,
    embossDeboss: state.embossDeboss,
    embossSvgEnabled: state.embossSvgEnabled,
    embossSvgText: state.embossSvgText,
    embossTraceEnabled: state.embossTraceEnabled,
    embossTraceRects: state.embossTraceRects,
    embossTraceSize: state.embossTraceSize,
    honeycombEnabled: state.honeycombEnabled,
    honeycombFace: state.honeycombFace,
    honeycombSize: state.honeycombSize,
    honeycombDepth: state.honeycombDepth,
    stackableEnabled: state.stackableEnabled,
    stackHexSize: state.stackHexSize,
    stackFootHeight: state.stackFootHeight,
    stackClearance: state.stackClearance,
    vaseStyle: state.vaseStyle,
    vaseDiameter: state.vaseDiameter,
    vaseHeight: state.vaseHeight,
    vaseWall: state.vaseWall,
    vaseFloor: state.vaseFloor,
    vaseDrainage: state.vaseDrainage,
    vaseDrainageSize: state.vaseDrainageSize,
    vaseSaucerEnabled: state.vaseSaucerEnabled,
  };
}

function disposeLabelPreview() {
  if (labelMesh) {
    previewRoot.remove(labelMesh);
    labelMesh.geometry.dispose();
    labelMesh = null;
  }
  if (labelEdgeLines) {
    previewRoot.remove(labelEdgeLines);
    labelEdgeLines.geometry.dispose();
    labelEdgeLines = null;
  }
}

function disposeAccentPreview() {
  if (accentMesh) {
    previewRoot.remove(accentMesh);
    accentMesh.geometry.dispose();
    accentMesh = null;
  }
  if (accentEdgeLines) {
    previewRoot.remove(accentEdgeLines);
    accentEdgeLines.geometry.dispose();
    accentEdgeLines = null;
  }
  accentCache = null;
}

function disposeLidGuides() {
  for (const loop of lidGuideLoops) {
    if (loop.mesh) {
      previewRoot.remove(loop.mesh);
      loop.mesh.geometry.dispose();
    }
  }
  lidGuideLoops = [];
}

function profileLoopPoints(profile, yLevel) {
  const vecs = [];
  for (const [x, py] of profile) {
    vecs.push(new THREE.Vector3(x, yLevel, -py));
  }
  return vecs;
}

function addLidGuideLoop(profile, yLevel, mat, fixed) {
  const vecs = profileLoopPoints(profile, yLevel);
  if (vecs.length < 3) return;
  const geom = new THREE.BufferGeometry().setFromPoints(vecs);
  const mesh = new THREE.LineLoop(geom, mat);
  mesh.visible = false;
  mesh.renderOrder = fixed ? 11 : 12;
  previewRoot.add(mesh);
  lidGuideLoops.push({ profile, cadY: yLevel, fixed, mat, mesh });
}

function buildLidGuideLoops() {
  disposeLidGuides();
  const g = lidCache?.fitGuides;
  if (!g) return;

  addLidGuideLoop(g.boxOuter, g.seatZ, guideRimMaterial, true);

  if (g.lidType === "slip") {
    addLidGuideLoop(g.skirtOuter, 0, guideSkirtOuterMaterial, false);
    addLidGuideLoop(g.skirtOuter, g.skirtDepth, guideSkirtOuterMaterial, false);
    addLidGuideLoop(g.skirtInner, 0, guideSkirtInnerMaterial, false);
  } else if (g.lidType === "plug") {
    addLidGuideLoop(g.skirtOuter, 0, guideSkirtOuterMaterial, false);
    addLidGuideLoop(g.skirtOuter, g.skirtDepth, guideSkirtOuterMaterial, false);
    addLidGuideLoop(g.plateOuter, g.lidHeight, guidePlateMaterial, false);
  } else {
    addLidGuideLoop(g.plateOuter, 0, guidePlateMaterial, false);
    addLidGuideLoop(g.plateOuter, g.lidHeight, guidePlateMaterial, false);
  }

  syncLidGuideLoops(lidRestY());
}

function syncLidGuideLoops(lidY) {
  for (const loop of lidGuideLoops) {
    const y = loop.fixed ? loop.cadY : loop.cadY + lidY;
    const pos = loop.mesh.geometry.attributes.position;
    for (let i = 0; i < loop.profile.length; i++) {
      pos.setXYZ(i, loop.profile[i][0], y, -loop.profile[i][1]);
    }
    pos.needsUpdate = true;
    loop.mesh.visible = previewXRayOn;
  }
}

function lidFitHintText() {
  const t = lidCache?.fitGuides?.lidType || state.lidType;
  if (t === "plug") {
    return "Orange = box rim. Green loops = plug skirt inside the opening. White = top plate on the rim.";
  }
  if (t === "flat") {
    return "Orange = box rim. White plate loops rest directly on the rim — no skirt.";
  }
  return "Orange = box rim. Green loops = skirt wrapping outside the walls (larger than the rim).";
}

function disposeLidPreview() {
  if (lidMesh) {
    previewRoot.remove(lidMesh);
    lidMesh.geometry.dispose();
    lidMesh = null;
  }
  disposeLidGuides();
  lidCache = null;
  stopLidAnimation(false);
}

function lidRestY() {
  if (!lidCache) return LID_PREVIEW_GAP;
  return lidCache.seatZ + LID_PREVIEW_GAP;
}

function lidOpenY() {
  if (!lidCache) return LID_PREVIEW_GAP;
  return lidCache.seatZ + LID_PREVIEW_GAP + LID_ANIM_LIFT;
}

function lidClosedY() {
  if (!lidCache) return 0;
  return lidCache.seatZ + 0.02;
}

function setLidPreviewY(y) {
  if (lidMesh) lidMesh.position.y = y;
  syncLidGuideLoops(y);
}

function setPreviewXRayMode(on) {
  if (previewXRayOn === on) return;
  previewXRayOn = on;

  material.transparent = on;
  material.opacity = on ? 0.14 : 1;
  material.depthWrite = !on;
  material.metalness = on ? 0.05 : 0.15;
  material.color.setHex(on ? 0x475569 : 0x38bdf8);

  lidMaterial.transparent = on;
  lidMaterial.opacity = on ? 0.42 : 1;
  lidMaterial.depthWrite = !on;
  lidMaterial.emissive.setHex(on ? 0x0ea5e9 : 0x000000);
  lidMaterial.emissiveIntensity = on ? 0.28 : 0;
  lidMaterial.color.setHex(on ? 0x7dd3fc : 0x93c5fd);
  lidMaterial.polygonOffsetFactor = on ? 5 : 2;
  lidMaterial.polygonOffsetUnits = on ? 8 : 3;

  edgeMaterial.opacity = on ? 0.22 : 0.55;

  labelMaterial.transparent = on;
  labelMaterial.opacity = on ? 0.35 : 1;
  labelMaterial.depthWrite = !on;

  accentMaterial.transparent = on;
  accentMaterial.opacity = on ? 0.35 : 1;
  accentMaterial.depthWrite = !on;

  if (bodyMesh) {
    bodyMesh.castShadow = !on;
    bodyMesh.renderOrder = on ? 1 : 2;
  }
  if (lidMesh) {
    lidMesh.castShadow = !on;
    lidMesh.renderOrder = on ? 8 : 4;
  }
  if (edgeLines) {
    edgeLines.renderOrder = on ? 2 : 3;
    edgeLines.visible = !on;
  }
  if (accentEdgeLines) accentEdgeLines.visible = !on;
  if (labelEdgeLines) labelEdgeLines.visible = !on;
  syncLidGuideLoops(lidMesh?.position.y ?? lidRestY());
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function hideLidFitOk() {
  const el = document.getElementById("lid-fit-ok");
  if (!el) return;
  el.classList.remove("visible");
  clearTimeout(lidFitOkTimer);
  lidFitOkTimer = setTimeout(() => el.classList.add("hidden"), 280);
}

function showLidFitOk() {
  const el = document.getElementById("lid-fit-ok");
  if (!el) return;
  const phrase = LID_FIT_OK_PHRASES[Math.floor(Math.random() * LID_FIT_OK_PHRASES.length)];
  const text = el.querySelector(".lid-fit-ok-text");
  if (text) text.textContent = phrase;
  clearTimeout(lidFitOkTimer);
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("visible"));
  lidFitOkTimer = setTimeout(hideLidFitOk, 1100);
}

function stopLidAnimation(resetToRest = true) {
  const wasAnimating = !!lidAnim;
  lidAnim = null;
  hideLidFitOk();
  if (wasAnimating || previewXRayOn) setPreviewXRayMode(false);
  const btn = document.getElementById("btn-lid-preview-fit");
  if (btn) btn.disabled = false;
  if (resetToRest && lidMesh && lidCache) setLidPreviewY(lidRestY());
}

function playLidFitPreview() {
  if (!state.lidEnabled || !lidCache || !lidMesh) return;
  traceJob += 1;
  clearTimeout(traceDebounceTimer);
  stopLidAnimation(false);
  hideLidFitOk();
  setPreviewXRayMode(true);
  const hint = document.getElementById("lid-xray-hint");
  if (hint) hint.textContent = lidFitHintText();
  const btn = document.getElementById("btn-lid-preview-fit");
  if (btn) btn.disabled = true;
  setLidPreviewY(lidOpenY());
  lidAnim = {
    openY: lidOpenY(),
    closedY: lidClosedY(),
    restY: lidRestY(),
    phaseIndex: 0,
    phaseStart: performance.now(),
    phases: [
      { y0Key: "openY", y1Key: "closedY", duration: 900 },
      { y0Key: "closedY", y1Key: "closedY", duration: 650 },
      { y0Key: "closedY", y1Key: "restY", duration: 900 },
    ],
  };
}

function updateLidAnimation(now) {
  if (!lidAnim || !lidMesh) return;
  const a = lidAnim;
  const phase = a.phases[a.phaseIndex];
  if (!phase) {
    stopLidAnimation(true);
    return;
  }
  const t = Math.min(1, (now - a.phaseStart) / phase.duration);
  const y0 = a[phase.y0Key];
  const y1 = a[phase.y1Key];
  setLidPreviewY(y0 + (y1 - y0) * easeInOutCubic(t));
  if (t >= 1) {
    if (a.phaseIndex === 0) showLidFitOk();
    a.phaseIndex += 1;
    a.phaseStart = now;
    if (a.phaseIndex >= a.phases.length) stopLidAnimation(true);
  }
}

function fitCamera(meta) {
  const { w, d, h } = meta.outer;
  let totalH = h;
  if (state.lidEnabled && lidCache) {
    totalH = lidOpenY() + lidCache.lidHeight;
  }
  const span = Math.max(w, d, totalH);
  controls.target.set(0, BED_LIFT + totalH / 2, 0);
  const dist = span * 1.8 + 40;
  camera.position.set(dist * 0.85, BED_LIFT + dist * 0.65, dist * 0.9);
  controls.update();
}

function rebuild() {
  try {
    rebuildMesh();
    scheduleSaveSession();
  } catch (err) {
    console.error("MakerDeck rebuild failed:", err);
    if (state.embossTraceEnabled) {
      clearEmbossTrace();
      updateTraceUi();
      try {
        rebuildMesh();
        scheduleSaveSession();
      } catch (retryErr) {
        console.error("MakerDeck rebuild retry failed:", retryErr);
      }
    }
  }
}

function uint8ToB64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToUint8(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function serializeEmbossTraceRects(rects) {
  if (!rects) return null;
  const out = cloneEmbossTraceRects(rects);
  if (out.mask?.length) {
    const bytes = out.mask instanceof Uint8Array ? out.mask : new Uint8Array(out.mask);
    out.maskB64 = uint8ToB64(bytes);
    delete out.mask;
  }
  return out;
}

function deserializeEmbossTraceRects(stored) {
  if (!stored) return null;
  const out = { ...stored };
  if (stored.maskB64) {
    out.mask = Array.from(b64ToUint8(stored.maskB64));
    delete out.maskB64;
  }
  return cloneEmbossTraceRects(out);
}

function stateForSession() {
  const snap = {};
  for (const key of Object.keys(DEFAULTS)) snap[key] = state[key];
  snap.shape = state.shape;
  if (state.embossTraceRects) {
    snap.embossTraceRects = serializeEmbossTraceRects(state.embossTraceRects);
  }
  return snap;
}

function scheduleSaveSession() {
  if (sessionBooting) return;
  clearTimeout(saveSessionTimer);
  saveSessionTimer = setTimeout(saveSession, 500);
}

function saveSession() {
  try {
    const payload = {
      v: 1,
      state: stateForSession(),
      traceImage: traceSourceCanvas ? traceSourceCanvas.toDataURL("image/jpeg", 0.82) : null,
      activeTab: document.querySelector(".tab.active")?.dataset?.tab || "design",
      savedAt: Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("MakerDeck could not save session:", err);
  }
}

async function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.state) return null;

    for (const key of Object.keys(DEFAULTS)) {
      if (payload.state[key] !== undefined) state[key] = payload.state[key];
    }
    if (payload.state.shape) state.shape = payload.state.shape;
    if (payload.state.embossTraceRects) {
      state.embossTraceRects = deserializeEmbossTraceRects(payload.state.embossTraceRects);
    }

    if (payload.traceImage) {
      const loaded = await loadImageFromDataUrl(payload.traceImage);
      traceSourceCanvas = loaded.canvas;
      traceLastResult = null;
      traceLastSvg = "";
      payload.needsRestoreTrace = true;
    } else if (
      payload.state.embossSvgEnabled &&
      payload.state.embossSvgText?.trim() &&
      !payload.state.embossTraceEnabled
    ) {
      try {
        await importSvgAsTrace(payload.state.embossSvgText, { fileName: "restored" });
      } catch (err) {
        console.warn("Could not re-import saved SVG:", err);
      }
    }

    return payload;
  } catch (err) {
    console.warn("MakerDeck could not restore session:", err);
    return null;
  }
}

function syncUiFromState() {
  document.querySelectorAll(".shape-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.shape === state.shape);
  });

  const profileKey = PRESET_CONFIG[state.shape]?.profile || "default";
  applySliderProfile(profileKey);
  syncSliderUi("wall", "wall", { min: 1.2, max: 6, value: state.wall, parseKind: "float" });
  syncSliderUi("floor", "floor", { min: 1.2, max: 6, value: state.floor, parseKind: "float" });
  syncSliderUi("corner-radius", "cornerRadius", { min: 0, max: 30, value: state.cornerRadius, parseKind: "float" });
  syncSliderUi("vertex-fillet", "vertexFillet", { min: 0, max: 12, value: state.vertexFillet, parseKind: "float" });
  syncSliderUi("sides", "sides", { min: 5, max: 12, value: state.sides });
  syncSliderUi("lid-skirt", "lidSkirt", { min: 4, max: 25, value: state.lidSkirt });
  syncSliderUi("lid-thickness", "lidThickness", { min: 2, max: 6, value: state.lidThickness, parseKind: "float" });
  syncSliderUi("lid-clearance", "lidClearance", { min: 0.15, max: 0.8, value: state.lidClearance, parseKind: "float" });
  syncSliderUi("joiner-width", "joinerWidth", { min: 5, max: 22, value: state.joinerWidth, parseKind: "float" });
  syncSliderUi("joiner-neck", "joinerNeck", { min: 3, max: 16, value: state.joinerNeck, parseKind: "float" });
  syncSliderUi("joiner-protrusion", "joinerProtrusion", { min: 2, max: 10, value: state.joinerProtrusion, parseKind: "float" });
  syncSliderUi("accent-height", "accentHeight", { min: 2, max: 10, value: state.accentHeight, parseKind: "float" });
  syncSliderUi("emboss-depth", "embossDepth", { min: 0.3, max: 2, value: state.embossDepth, parseKind: "float" });
  syncSliderUi("emboss-height", "embossHeight", { min: 3, max: 18, value: state.embossHeight, parseKind: "float" });
  syncSliderUi("trace-threshold", "traceThreshold", { min: 20, max: 235, value: state.traceThreshold });
  syncSliderUi("trace-size", "embossTraceSize", { min: 6, max: 40, value: state.embossTraceSize, parseKind: "float" });
  syncSliderUi("vase-diameter", "vaseDiameter", { min: 30, max: 220, value: state.vaseDiameter, parseKind: "float" });
  syncSliderUi("vase-height", "vaseHeight", { min: 20, max: 280, value: state.vaseHeight, parseKind: "float" });
  syncSliderUi("vase-wall", "vaseWall", { min: 1.0, max: 3, value: state.vaseWall, parseKind: "float" });
  syncSliderUi("vase-floor", "vaseFloor", { min: 1.4, max: 6, value: state.vaseFloor, parseKind: "float" });
  syncSliderUi("vase-drainage-size", "vaseDrainageSize", { min: 4, max: 30, value: state.vaseDrainageSize, parseKind: "float" });
  const vaseStyleSel = document.getElementById("vase-style");
  if (vaseStyleSel) vaseStyleSel.value = state.vaseStyle || "cylinder";
  document.getElementById("vase-drainage").checked = !!state.vaseDrainage;
  document.getElementById("vase-saucer").checked = !!state.vaseSaucerEnabled;

  document.getElementById("emboss-text").value = state.embossText || "";
  document.getElementById("accent-color").value = state.accentColor || "#f97316";
  const embossFontSelect = document.getElementById("emboss-font");
  if (embossFontSelect) embossFontSelect.value = state.embossFont || "inter";
  updateEmbossTextPreviewStyle();
  updateLabels();
  updateLidUi();
  updateJoinerUi();
  updateDecorUi();
  updateTraceUi();
}

function rebuildMesh() {
  if (bodyMesh) {
    previewRoot.remove(bodyMesh);
    bodyMesh.geometry.dispose();
  }
  if (edgeLines) {
    previewRoot.remove(edgeLines);
    edgeLines.geometry.dispose();
  }
  disposeAccentPreview();
  disposeLabelPreview();

  const params = buildParams();

  meshCache = buildContainer(params);
  debossCutterCache = meshCache.debossCutterMesh || null;
  if (meshCache.meta.shape === "rect" && state.shape === "rounded") {
    meshCache.meta.shape = "rounded";
  }
  if (state.shape === "hex" && state.sides !== 6) {
    meshCache.meta.shape = "polygon";
  }
  if (PRESET_SHAPES.has(state.shape)) {
    meshCache.meta.shape = state.shape;
  }

  const shellMesh = meshCache.shellMesh || meshCache;
  const geom = toBufferGeometry(THREE, shellMesh);
  bodyMesh = new THREE.Mesh(geom, material);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.renderOrder = 2;
  previewRoot.add(bodyMesh);

  try {
    const edges = new THREE.EdgesGeometry(geom, 18);
    edgeLines = new THREE.LineSegments(edges, edgeMaterial);
    edgeLines.renderOrder = 3;
    previewRoot.add(edgeLines);
  } catch {
    edgeLines = null;
  }

  if (meshCache.labelMesh) {
    const labelGeom = toBufferGeometry(THREE, meshCache.labelMesh);
    const mat = state.embossDeboss ? debossPreviewMaterial : labelMaterial;
    labelMesh = new THREE.Mesh(labelGeom, mat);
    labelMesh.castShadow = true;
    labelMesh.receiveShadow = true;
    labelMesh.renderOrder = 8;
    previewRoot.add(labelMesh);
    try {
      const labelEdges = new THREE.EdgesGeometry(labelGeom, 20);
      labelEdgeLines = new THREE.LineSegments(labelEdges, edgeMaterial);
      labelEdgeLines.renderOrder = 9;
      previewRoot.add(labelEdgeLines);
    } catch {
      labelEdgeLines = null;
    }
  }

  if (meshCache.accentMesh) {
    accentCache = meshCache.accentMesh;
    accentMaterial.color.set(state.accentColor);
    const accentGeom = toBufferGeometry(THREE, accentCache);
    accentMesh = new THREE.Mesh(accentGeom, accentMaterial);
    accentMesh.castShadow = true;
    accentMesh.renderOrder = 6;
    previewRoot.add(accentMesh);
    const accentEdges = new THREE.EdgesGeometry(accentGeom, 18);
    accentEdgeLines = new THREE.LineSegments(accentEdges, edgeMaterial);
    accentEdgeLines.renderOrder = 7;
    previewRoot.add(accentEdgeLines);
  }

  disposeLidPreview();
  if (state.lidEnabled && shapeSupportsLid(state.shape)) {
    lidCache = buildLid(params);
    const lidGeom = toBufferGeometry(THREE, lidCache);
    lidMesh = new THREE.Mesh(lidGeom, lidMaterial);
    setLidPreviewY(lidRestY());
    lidMesh.castShadow = true;
    lidMesh.receiveShadow = true;
    lidMesh.renderOrder = 4;
    previewRoot.add(lidMesh);

    buildLidGuideLoops();
  }

  updateStats(meshCache.meta);
  updateLabels();
  updateLidUi();
  updateJoinerUi();
  updateDecorUi();
  updateVaseUiVisibility();
}

function updateStats(meta) {
  const { outer, cavityMl, materialMl, estGrams } = meta;
  if (meta.shape === "vase") {
    document.getElementById("stat-outer").textContent = `${meta.styleLabel || "Vase"} · ⌀${outer.w} × ${outer.h}`;
  } else if (meta.shape === "circle") {
    document.getElementById("stat-outer").textContent = `⌀${outer.w} × ${outer.h}`;
  } else if (PRESET_SHAPES.has(meta.shape)) {
    if (meta.shape === "star") {
      document.getElementById("stat-outer").textContent = `${meta.starPoints}-pt ${outer.w} × ${outer.h}`;
    } else {
      document.getElementById("stat-outer").textContent = `${outer.w} × ${outer.d} × ${outer.h}`;
    }
  } else if (meta.shape === "hex" || meta.shape === "polygon") {
    const sideLabel = meta.sides === 6 ? "hex" : `${meta.sides}-gon`;
    document.getElementById("stat-outer").textContent = `${sideLabel} ${outer.w} flat × ${outer.h}`;
  } else {
    document.getElementById("stat-outer").textContent = `${outer.w} × ${outer.d} × ${outer.h}`;
  }
  document.getElementById("stat-cavity").textContent = `${cavityMl} ml`;
  document.getElementById("stat-material").textContent = `${materialMl} ml`;
  document.getElementById("stat-grams").textContent = `~${estGrams} g`;
}

function syncSliderUi(sliderId, key, { min, max, value, parseKind = "int" }) {
  const slider = document.getElementById(sliderId);
  const out = document.querySelector(`.value-edit[data-slider="${sliderId}"]`);
  slider.min = String(min);
  slider.max = String(max);
  const display = formatSliderValue(value, slider.step);
  slider.value = display;
  state[key] = parseKind === "float" ? parseFloat(display) : Number(display);
  if (out) out.textContent = display;
}

const SLIDER_PROFILES = {
  default: {
    width: { min: 20, max: 300 },
    depth: { min: 20, max: 300 },
    height: { min: 10, max: 250 },
  },
  pencil: {
    width: { min: 120, max: 300 },
    depth: { min: 40, max: 100 },
    height: { min: 15, max: 60 },
  },
  teardrop: {
    width: { min: 60, max: 280 },
    depth: { min: 40, max: 160 },
    height: { min: 15, max: 120 },
  },
  jewel: {
    width: { min: 40, max: 200 },
    depth: { min: 35, max: 180 },
    height: { min: 15, max: 120 },
  },
};

function applyPreset(shape) {
  const cfg = PRESET_CONFIG[shape];
  if (!cfg) return;
  Object.assign(state, cfg.preset);
  applySliderProfile(cfg.profile);
}

function applySliderProfile(profileKey) {
  const profile = SLIDER_PROFILES[profileKey] || SLIDER_PROFILES.default;
  syncSliderUi("inner-width", "innerWidth", { ...profile.width, value: state.innerWidth });
  syncSliderUi("inner-depth", "innerDepth", { ...profile.depth, value: state.innerDepth });
  syncSliderUi("inner-height", "innerHeight", { ...profile.height, value: state.innerHeight });
}

function updateLabels() {
  const { shape } = state;
  const hex = shape === "hex";
  const circle = shape === "circle";
  const rounded = shape === "rounded";
  const preset = PRESET_SHAPES.has(shape);
  const poly = hex;
  const star = shape === "star";
  const heart = shape === "heart";

  document.getElementById("label-width").textContent = shape === "pencil"
    ? "Length"
    : star
      ? "Tip span"
      : circle
        ? "Diameter"
        : hex
          ? "Flat width"
          : heart
            ? "Width"
            : preset
              ? "Length"
              : "Width";
  document.getElementById("label-depth").textContent = star
    ? "Tip span"
    : preset && !heart
      ? "Width"
      : "Depth";

  const sizeHeading = {
    pencil: "Case size",
    teardrop: "Drop size",
    star: "Star size",
    heart: "Heart size",
  };
  document.getElementById("label-inner-size").innerHTML = sizeHeading[shape]
    ? `${sizeHeading[shape]} <span class="unit">mm</span>`
    : circle
      ? 'Size <span class="unit">mm</span>'
      : hex
        ? 'Flat size <span class="unit">mm</span>'
        : 'Inner size <span class="unit">mm</span>';

  document.getElementById("field-depth").classList.toggle("hidden", hex || circle || star);
  document.getElementById("field-corner").classList.toggle("hidden", !rounded);
  document.getElementById("field-sides").classList.toggle("hidden", !poly);
  document.getElementById("field-vertex-fillet").classList.toggle("hidden", circle || rounded || (preset && !star && !heart));
  document.getElementById("section-edges").classList.toggle("hidden", preset && !star && !heart);

  const filletLabel = document.getElementById("label-vertex-fillet");
  filletLabel.textContent = poly ? "Vertex fillet" : "Edge fillet";

  updateDimensionTabOrder();
  updateDimensionAriaLabels();
}

function updateLidUi() {
  const supported = shapeSupportsLid(state.shape);
  const on = state.lidEnabled && supported;
  const type = LID_TYPES.find((t) => t.id === state.lidType) || LID_TYPES[0];
  const isFlat = state.lidType === "flat";
  document.getElementById("lid-enabled").checked = !!state.lidEnabled && supported;
  document.getElementById("lid-type").value = type.id;
  document.getElementById("btn-export-lid").classList.toggle("hidden", !on);
  document.getElementById("btn-lid-preview-fit").classList.toggle("hidden", !on);
  document.getElementById("lid-xray-hint")?.classList.toggle("hidden", !on);
  document.getElementById("field-lid-type").classList.toggle("hidden", !on);
  document.getElementById("field-lid-skirt").classList.toggle("hidden", !on || isFlat);
  document.getElementById("field-lid-thickness").classList.toggle("hidden", !on);
  document.getElementById("field-lid-clearance").classList.toggle("hidden", !on || isFlat);
  const hint = document.getElementById("lid-type-hint");
  if (hint) {
    hint.textContent = on
      ? `${type.hint} Exports plate-down on the bed.`
      : supported
        ? "Enable to preview and export a separate lid STL."
        : "Lids are not available for vase / pot shapes.";
  }
  const title = document.getElementById("lid-section-title");
  if (title) title.textContent = on ? type.label : "Lid";
}

function joinerUiShape() {
  if (state.shape === "rounded") return "rounded";
  if (PRESET_SHAPES.has(state.shape)) return state.shape;
  return state.shape;
}

function decorUiShape() {
  if (state.shape === "rounded") return "rounded";
  if (state.shape === "pencil") return "pencil";
  return state.shape === "rect" ? "rect" : null;
}

function setTab(tabId) {
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === tabId;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    const on = p.id === `tab-${tabId}`;
    p.classList.toggle("active", on);
    p.hidden = !on;
  });
  scheduleSaveSession();
}

function clearEmbossTrace() {
  state.embossTraceEnabled = false;
  state.embossTraceRects = null;
}

function cloneEmbossTraceRects(rects) {
  if (!rects) return null;
  return {
    rects: rects.rects?.map((r) => ({ ...r })) || [],
    mask: rects.mask ? [...rects.mask] : [],
    polygons: rects.polygons?.map((poly) => poly.map(([x, y]) => [x, y])) || [],
    shapeGroups: rects.shapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) || [],
    strokePaths: rects.strokePaths?.map((p) => p.map(([x, y]) => [x, y])) || [],
    strokeWidth: rects.strokeWidth,
    mode: rects.mode || "silhouette",
    width: rects.width,
    height: rects.height,
  };
}

function snapshotApp() {
  return {
    state: stateForSession(),
    traceImage: traceSourceCanvas ? traceSourceCanvas.toDataURL("image/jpeg", 0.82) : null,
  };
}

function appSnapshotsEqual(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

let appHistory = [];
let appHistoryIndex = -1;
let appHistoryLock = false;

function pushAppHistory() {
  if (appHistoryLock || sessionBooting) return;
  const snap = snapshotApp();
  if (appHistoryIndex >= 0 && appSnapshotsEqual(appHistory[appHistoryIndex], snap)) {
    updateHistoryUi();
    return;
  }
  appHistory = appHistory.slice(0, appHistoryIndex + 1);
  appHistory.push(snap);
  appHistoryIndex = appHistory.length - 1;
  if (appHistory.length > 50) {
    appHistory.shift();
    appHistoryIndex -= 1;
  }
  updateHistoryUi();
}

async function restoreAppHistory(index) {
  if (index < 0 || index >= appHistory.length) return;
  const snap = appHistory[index];
  if (!snap?.state) return;
  appHistoryLock = true;

  const s = snap.state;
  for (const key of Object.keys(DEFAULTS)) {
    if (s[key] !== undefined) state[key] = s[key];
  }
  if (s.shape) state.shape = s.shape;
  if (s.embossTraceRects) {
    state.embossTraceRects = deserializeEmbossTraceRects(s.embossTraceRects);
  } else {
    state.embossTraceRects = null;
  }

  if (snap.traceImage) {
    try {
      const loaded = await loadImageFromDataUrl(snap.traceImage);
      traceSourceCanvas = loaded.canvas;
      traceLastResult = null;
      traceLastSvg = "";
      await runTraceAsync();
    } catch {
      traceSourceCanvas = null;
      traceLastResult = null;
      traceLastSvg = "";
    }
  } else {
    traceSourceCanvas = null;
    traceLastResult = null;
    traceLastSvg = "";
  }

  appHistoryIndex = index;
  appHistoryLock = false;
  syncUiFromState();
  updateHistoryUi();
  rebuild();
}

function undoApp() {
  if (appHistoryIndex <= 0) return;
  restoreAppHistory(appHistoryIndex - 1);
}

function redoApp() {
  if (appHistoryIndex < 0 || appHistoryIndex >= appHistory.length - 1) return;
  restoreAppHistory(appHistoryIndex + 1);
}

function boxHasDecor() {
  const traceData = state.embossTraceRects;
  return (
    state.embossTraceEnabled ||
    !!traceData?.shapeGroups?.length ||
    !!traceData?.strokePaths?.length ||
    !!state.embossText?.trim() ||
    (state.embossSvgEnabled && !!state.embossSvgText?.trim())
  );
}

function updateHistoryUi() {
  const clearBtn = document.getElementById("btn-clear-box");
  const undoBtn = document.getElementById("btn-undo");
  const redoBtn = document.getElementById("btn-redo");
  if (!undoBtn) return;
  if (clearBtn) clearBtn.disabled = !boxHasDecor();
  undoBtn.disabled = appHistoryIndex <= 0;
  redoBtn.disabled = appHistoryIndex < 0 || appHistoryIndex >= appHistory.length - 1;
}

function clearDecorFromBox() {
  if (!boxHasDecor()) return;
  traceJob++;
  clearEmbossTrace();
  state.embossText = "";
  state.embossSvgEnabled = false;
  state.embossSvgText = "";
  document.getElementById("emboss-text").value = "";
  document.getElementById("emboss-svg-enabled").checked = false;
  pushAppHistory();
  updateDecorUi();
  updateTraceUi();
  updateHistoryUi();
  rebuild();
  scheduleSaveSession();
}

function isImportTabActive() {
  const panel = document.getElementById("tab-import");
  return panel && !panel.hidden;
}

function pasteImageFromClipboard(e) {
  if (!isImportTabActive()) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) handleTraceFile(file);
      return;
    }
  }
}

function updateTraceUi() {
  const hasImage = !!traceSourceCanvas;
  const hasTrace = !!(
    traceLastResult?.shapeGroups?.length ||
    traceLastResult?.strokePaths?.length ||
    traceLastResult?.polygons?.length ||
    traceLastResult?.rects?.length
  );
  document.getElementById("btn-trace").disabled = !hasImage;
  document.getElementById("btn-trace-apply").disabled = !hasTrace;
  document.getElementById("btn-trace-svg").disabled = !hasTrace;
  document.getElementById("btn-trace-svg").classList.toggle("hidden", !hasTrace);
  document.getElementById("trace-preview-wrap").classList.toggle("hidden", !hasImage);
  document.getElementById("trace-mode").value = state.traceMode || "silhouette";
  document.getElementById("trace-invert").checked = !!state.traceInvert;

  const meta = document.getElementById("trace-meta");
  if (!hasImage) {
    meta.textContent = "";
    return;
  }
  if (!hasTrace) {
    meta.textContent = "Adjust settings and hit Trace.";
    return;
  }
  const count = traceLastResult.polygonCount ?? 0;
  const effectiveMode = traceLastResult.mode || state.traceMode;
  const isOutline = effectiveMode === "outline";
  let msg = isOutline
    ? `${count} path${count === 1 ? "" : "s"} · line art`
    : `${count} island${count === 1 ? "" : "s"} · single colour`;
  if (traceLastResult.outlineFallback) {
    msg = `${count} island${count === 1 ? "" : "s"} · silhouette (auto — this art is double-edge, not single stroke)`;
  }
  if (traceLastResult.colorLayers >= 2) {
    msg = `${count} island${count === 1 ? "" : "s"} · ${traceLastResult.colorLayers} colour layers`;
  }
  if (traceLastResult.tracePx) msg += ` · ${traceLastResult.tracePx}px`;
  if (traceLastResult.simplified) msg += " · auto-simplified for print";
  if (traceLastResult.tooComplex) {
    msg = `Too detailed — raise threshold or use Silhouette (max ${MAX_TRACE_POLYGONS} islands)`;
    document.getElementById("btn-trace-apply").disabled = true;
  }
  if (state.embossTraceEnabled && !traceLastResult.tooComplex) {
    const faceLabel = { front: "front", back: "back", left: "left side", right: "right side" }[state.embossFace] || "front";
    msg += ` · applied to ${faceLabel} face`;
  }
  meta.textContent = msg;
  updateHistoryUi();
}

let traceJob = 0;
let traceDebounceTimer = null;

async function runTraceAsync() {
  if (!traceSourceCanvas) return;
  const job = ++traceJob;
  const meta = document.getElementById("trace-meta");
  const btn = document.getElementById("btn-trace");
  if (meta) meta.textContent = "Tracing at high resolution…";
  if (btn) btn.disabled = true;
  await new Promise((r) => setTimeout(r, 0));
  try {
    const result = await traceCanvasAsync(traceSourceCanvas, {
      threshold: state.traceThreshold,
      invert: state.traceInvert,
      mode: state.traceMode,
    });
    if (job !== traceJob) return;
    traceLastResult = result;
    traceLastSvg = result.svg || "";
    const preview = document.getElementById("trace-preview");
    drawTracePreview(preview, traceSourceCanvas, traceLastResult);
    updateTraceUi();
    scheduleSaveSession();
  } catch (err) {
    if (job !== traceJob) return;
    if (meta) meta.textContent = err?.message || "Trace failed";
    console.error("MakerDeck trace failed:", err);
  } finally {
    if (job === traceJob && btn) btn.disabled = false;
  }
}

function scheduleTrace() {
  clearTimeout(traceDebounceTimer);
  traceDebounceTimer = setTimeout(() => runTraceAsync(), 350);
}

async function handleTraceFile(file) {
  try {
    const loaded = await loadImageFromFile(file);
    traceSourceCanvas = loaded.canvas;
    traceLastResult = null;
    traceLastSvg = "";
    await runTraceAsync();
  } catch (err) {
    document.getElementById("trace-meta").textContent = err.message || "Could not load image";
    document.getElementById("trace-preview-wrap").classList.remove("hidden");
    updateTraceUi();
  }
}

function traceResultToEmbossRects(result) {
  return {
    rects: result.rects?.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) || [],
    mask: result.shapeGroups?.length ? [] : (result.mask?.length ? Array.from(result.mask) : []),
    polygons: result.polygons?.map((poly) => poly.map(([x, y]) => [x, y])) || [],
    shapeGroups: result.shapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) || [],
    strokePaths: result.strokePaths?.map((p) => p.map(([x, y]) => [x, y])) || [],
    strokeWidth: result.strokeWidth,
    mode: result.mode || state.traceMode || "silhouette",
    outlineFallback: !!result.outlineFallback,
    width: result.width,
    height: result.height,
  };
}

function hasTraceGeometry(result) {
  return !!(result?.shapeGroups?.length || result?.strokePaths?.length || result?.mask?.length);
}

function storeTraceOnBox(result, { clearLabel = true, clearSvg = true } = {}) {
  if (!hasTraceGeometry(result)) return false;
  if (result.tooComplex) return false;
  state.embossTraceEnabled = true;
  state.embossTraceRects = traceResultToEmbossRects(result);
  if (clearLabel) {
    state.embossText = "";
    document.getElementById("emboss-text").value = "";
  }
  if (clearSvg) {
    state.embossSvgEnabled = false;
    state.embossSvgText = "";
    document.getElementById("emboss-svg-enabled").checked = false;
  }
  return true;
}

async function importSvgAsTrace(svgText, { fileName = "" } = {}) {
  const canvas = await rasterizeSvgToCanvas(svgText);
  traceSourceCanvas = canvas;
  const mode = "silhouette";
  state.traceMode = mode;
  document.getElementById("trace-mode").value = mode;
  traceLastResult = await traceCanvasAsync(canvas, {
    threshold: Math.min(235, Math.max(160, state.traceThreshold ?? 200)),
    invert: state.traceInvert,
    mode,
    strengthen: true,
    smoothPasses: 5,
  });
  traceLastSvg = traceLastResult.svg || "";
  const preview = document.getElementById("trace-preview");
  if (preview) drawTracePreview(preview, traceSourceCanvas, traceLastResult);

  if (!shapeSupportsDecor(decorUiShape())) {
    throw new Error("Pick a box, rounded, or pencil shape first.");
  }
  if (traceLastResult.tooComplex) {
    throw new Error(`SVG too detailed to emboss (max ${MAX_TRACE_POLYGONS} paths).`);
  }

  state.embossText = "";
  document.getElementById("emboss-text").value = "";
  state.embossSvgText = svgText;
  state.embossSvgEnabled = true;
  document.getElementById("emboss-svg-enabled").checked = true;
  storeTraceOnBox(traceLastResult, { clearLabel: false, clearSvg: false });

  const meta = document.getElementById("trace-meta");
  if (meta && fileName) {
    meta.textContent = `SVG ${fileName} · silhouette · applied to box`;
  }
  updateDecorUi();
  updateTraceUi();
  rebuild();
  pushAppHistory();
}

function applyTraceToBox() {
  if (!hasTraceGeometry(traceLastResult)) return;
  if (traceLastResult.tooComplex) {
    document.getElementById("trace-meta").textContent =
      `Too detailed to emboss — raise threshold or use Silhouette mode (max ${MAX_TRACE_POLYGONS} shapes).`;
    return;
  }
  if (!shapeSupportsDecor(decorUiShape())) {
    document.getElementById("trace-meta").textContent = "Pick a box, rounded, or pencil shape first.";
    return;
  }
  if (!storeTraceOnBox(traceLastResult)) return;
  updateDecorUi();
  updateTraceUi();
  pushAppHistory();
  rebuild();
}

function updateDecorUi() {
  const supported = shapeSupportsDecor(decorUiShape());
  document.querySelectorAll('.tab[data-tab="accent"], .tab[data-tab="label"], .tab[data-tab="import"], .tab[data-tab="stack"], .tab[data-tab="link"]').forEach((tab) => {
    tab.disabled = !supported;
    tab.classList.toggle("tab--disabled", !supported);
  });

  const accentOn = state.accentEnabled && supported;
  document.getElementById("accent-enabled").checked = accentOn;
  document.getElementById("btn-export-accent").classList.toggle("hidden", !accentOn);
  document.getElementById("field-accent-face").classList.toggle("hidden", !accentOn);
  document.getElementById("field-accent-height").classList.toggle("hidden", !accentOn);
  document.getElementById("field-accent-color").classList.toggle("hidden", !accentOn);
  document.getElementById("accent-face").value = state.accentFace;

  const honeyOn = state.honeycombEnabled && supported;
  document.getElementById("honeycomb-enabled").checked = honeyOn;
  document.getElementById("field-honeycomb-face").classList.toggle("hidden", !honeyOn);
  document.getElementById("honeycomb-face").value = state.honeycombFace || "back";
  document.getElementById("stackable-enabled").checked = state.stackableEnabled && supported;

  const svgOn = state.embossSvgEnabled && supported && !state.embossTraceEnabled;
  document.getElementById("emboss-svg-enabled").checked = svgOn;
  document.getElementById("field-svg-file").classList.toggle("hidden", !svgOn);
  document.getElementById("field-emboss-text").classList.toggle("hidden", svgOn);
  document.getElementById("field-emboss-font").classList.toggle("hidden", svgOn);
  document.getElementById("emboss-face").value = state.embossFace || "front";
  document.getElementById("emboss-deboss").checked = !!state.embossDeboss;
  updateEmbossDebossUi();
  document.getElementById("field-emboss-height").classList.toggle("hidden", svgOn);
  document.getElementById("emboss-font").value = state.embossFont || "inter";
  updateEmbossTextPreviewStyle();
}

function updateEmbossDebossUi() {
  const on = !!state.embossDeboss;
  const hint = document.getElementById("emboss-deboss-hint");
  if (hint) hint.classList.toggle("hidden", !on);
  const btn = document.getElementById("btn-export-deboss");
  if (btn) btn.classList.toggle("hidden", !on || !debossCutterCache);
}

function updateEmbossTextPreviewStyle() {
  const input = document.getElementById("emboss-text");
  const f = embossFontSpec(state.embossFont || "inter");
  input.style.fontFamily = f.family;
  input.style.fontWeight = String(f.weight);
}

function updateJoinerUi() {
  const supported = shapeSupportsJoiner(joinerUiShape());
  const tab = document.querySelector('.tab[data-tab="link"]');
  if (tab) {
    tab.disabled = !supported;
    tab.classList.toggle("tab--disabled", !supported);
  }
  if (!supported) {
    if (state.joinerEnabled) {
      state.joinerEnabled = false;
      document.getElementById("joiner-enabled").checked = false;
    }
    return;
  }

  const on = state.joinerEnabled;
  document.getElementById("joiner-enabled").checked = on;
  document.getElementById("field-joiner-hand").classList.toggle("hidden", !on);
  document.getElementById("joiner-hint").classList.toggle("hidden", !on);
  document.getElementById("field-joiner-width").classList.toggle("hidden", !on);
  document.getElementById("field-joiner-neck").classList.toggle("hidden", !on);
  document.getElementById("field-joiner-protrusion").classList.toggle("hidden", !on);
  document.getElementById("field-joiner-autoscale").classList.toggle("hidden", !on);
  document.getElementById("joiner-autoscale").checked = state.joinerAutoScale;
  document.querySelectorAll("#field-joiner-hand .chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.hand === state.joinerHand);
  });
  const hint = document.getElementById("joiner-hint");
  const scaleNote = state.joinerAutoScale && meshCache?.meta?.joinerScale
    ? ` Auto-scaled ×${meshCache.meta.joinerScale}.`
    : "";
  hint.textContent = state.joinerHand === "left"
    ? `Male tab on the long side — clip a Right box on from the outside.${scaleNote}`
    : `Female socket on the long side — receives a Left box from the outside.${scaleNote}`;
}

const DIMENSION_EDITS = [
  { btnId: "out-width", fieldId: null, labelId: "label-width", sliderId: "inner-width" },
  { btnId: "out-depth", fieldId: "field-depth", labelId: "label-depth", sliderId: "inner-depth" },
  { btnId: "out-height", fieldId: null, labelId: "label-height", sliderId: "inner-height" },
];

function isFieldVisible(el) {
  if (!el) return true;
  return !el.classList.contains("hidden") && el.offsetParent !== null;
}

function updateDimensionTabOrder() {
  let tab = 1;
  for (const { btnId, fieldId } of DIMENSION_EDITS) {
    const btn = document.getElementById(btnId);
    if (!btn || btn.hidden) continue;
    const field = fieldId ? document.getElementById(fieldId) : btn.closest(".field");
    btn.tabIndex = isFieldVisible(field) ? tab++ : -1;
  }
}

function updateDimensionAriaLabels() {
  for (const { btnId, labelId, sliderId } of DIMENSION_EDITS) {
    const btn = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    const slider = document.getElementById(sliderId);
    if (!btn || !label || !slider) continue;
    const unit = slider.step && String(slider.step).includes(".") ? "mm" : "mm";
    btn.setAttribute("aria-label", `Edit ${label.textContent.toLowerCase()} in ${unit}`);
  }
}

function parseFieldValue(raw, kind) {
  return kind === "float" ? parseFloat(raw) : Number(raw);
}

function formatSliderValue(val, step) {
  const stepText = String(step);
  const decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  return decimals ? val.toFixed(decimals) : String(val);
}

function clampToSlider(slider, raw, parseKind) {
  const min = parseFieldValue(slider.min, parseKind);
  const max = parseFieldValue(slider.max, parseKind);
  const step = parseFieldValue(slider.step, parseKind) || 1;
  let val = parseFieldValue(raw, parseKind);
  if (!Number.isFinite(val)) val = parseFieldValue(slider.value, parseKind);
  val = Math.min(max, Math.max(min, val));
  val = Math.round(val / step) * step;
  return Math.min(max, Math.max(min, val));
}

function applySliderValue(slider, key, val, parseKind) {
  const display = formatSliderValue(val, slider.step);
  slider.value = display;
  state[key] = parseFieldValue(display, parseKind);
  const out = document.querySelector(`.value-edit[data-slider="${slider.id}"]`);
  if (out) out.textContent = display;
  rebuild();
  pushAppHistory();
}

function bindRange(sliderId, key, parseKind = "int") {
  const slider = document.getElementById(sliderId);
  const syncFromSlider = () => {
    const val = parseFieldValue(slider.value, parseKind);
    state[key] = val;
    const out = document.querySelector(`.value-edit[data-slider="${sliderId}"]`);
    if (out) out.textContent = slider.value;
    rebuild();
  };
  slider.addEventListener("input", syncFromSlider);
  slider.addEventListener("change", () => pushAppHistory());
}

function beginValueEdit(btn) {
  const slider = document.getElementById(btn.dataset.slider);
  if (!slider || btn.classList.contains("is-editing")) return;

  const parseKind = btn.dataset.parse || "int";
  const field = btn.closest(".field");
  const input = document.createElement("input");
  input.type = "number";
  input.className = "value-input";
  input.value = slider.value;
  input.min = slider.min;
  input.max = slider.max;
  input.step = slider.step;
  input.setAttribute("aria-label", btn.getAttribute("aria-label") || "Edit value");

  btn.classList.add("is-editing");
  btn.hidden = true;
  field.appendChild(input);
  input.focus();
  input.select();

  const finish = (commit) => {
    if (commit) {
      const val = clampToSlider(slider, input.value, parseKind);
      applySliderValue(slider, btn.dataset.key, val, parseKind);
    }
    input.remove();
    btn.hidden = false;
    btn.classList.remove("is-editing");
    btn.focus();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      finish(true);
      const visible = DIMENSION_EDITS
        .map(({ btnId, fieldId }) => {
          const b = document.getElementById(btnId);
          const field = fieldId ? document.getElementById(fieldId) : b?.closest(".field");
          return isFieldVisible(field) && b && !b.hidden ? b : null;
        })
        .filter(Boolean);
      const currentBtn = btn;
      const idx = visible.indexOf(currentBtn);
      if (idx >= 0 && idx < visible.length - 1) visible[idx + 1].focus();
      else if (visible.length) visible[0].focus();
    }
  });
  input.addEventListener("blur", () => finish(true));
}

document.getElementById("controls").addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.shiftKey) return;
  const active = document.activeElement;
  if (!active?.classList?.contains("value-edit")) return;
  const visible = DIMENSION_EDITS
    .map(({ btnId, fieldId }) => {
      const btn = document.getElementById(btnId);
      const field = fieldId ? document.getElementById(fieldId) : btn?.closest(".field");
      return isFieldVisible(field) && btn && !btn.hidden ? btn : null;
    })
    .filter(Boolean);
  const idx = visible.indexOf(active);
  if (idx === -1 || idx >= visible.length - 1) return;
  e.preventDefault();
  visible[idx + 1].focus();
});

document.getElementById("controls").addEventListener("click", (e) => {
  const btn = e.target.closest(".value-edit");
  if (btn) beginValueEdit(btn);
});

bindRange("inner-width", "innerWidth");
bindRange("inner-depth", "innerDepth");
bindRange("inner-height", "innerHeight");
bindRange("wall", "wall", "float");
bindRange("floor", "floor", "float");
bindRange("corner-radius", "cornerRadius", "float");
bindRange("vertex-fillet", "vertexFillet", "float");
bindRange("sides", "sides");
bindRange("lid-skirt", "lidSkirt");
bindRange("lid-thickness", "lidThickness", "float");
bindRange("lid-clearance", "lidClearance", "float");
bindRange("joiner-width", "joinerWidth", "float");
bindRange("joiner-neck", "joinerNeck", "float");
bindRange("joiner-protrusion", "joinerProtrusion", "float");
bindRange("accent-height", "accentHeight", "float");
bindRange("emboss-depth", "embossDepth", "float");
bindRange("emboss-height", "embossHeight", "float");
bindRange("trace-threshold", "traceThreshold", "int");
bindRange("trace-size", "embossTraceSize", "float");

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.disabled) return;
    setTab(tab.dataset.tab);
  });
});

document.getElementById("btn-lid-preview-fit").addEventListener("click", () => playLidFitPreview());

document.getElementById("lid-type").addEventListener("change", (e) => {
  state.lidType = e.target.value;
  updateLidUi();
  rebuild();
  if (meshCache) fitCamera(meshCache.meta);
  pushAppHistory();
});

document.getElementById("lid-enabled").addEventListener("change", (e) => {
  state.lidEnabled = e.target.checked && shapeSupportsLid(state.shape);
  updateLidUi();
  rebuild();
  if (meshCache) fitCamera(meshCache.meta);
  pushAppHistory();
});

document.getElementById("joiner-enabled").addEventListener("change", (e) => {
  state.joinerEnabled = e.target.checked;
  rebuild();
  if (meshCache) fitCamera(meshCache.meta);
});

document.getElementById("joiner-autoscale").addEventListener("change", (e) => {
  state.joinerAutoScale = e.target.checked;
  rebuild();
});

document.getElementById("accent-enabled").addEventListener("change", (e) => {
  state.accentEnabled = e.target.checked;
  rebuild();
});

document.getElementById("accent-face").addEventListener("change", (e) => {
  state.accentFace = e.target.value;
  rebuild();
});

document.getElementById("accent-color").addEventListener("input", (e) => {
  state.accentColor = e.target.value;
  if (accentMesh) accentMaterial.color.set(state.accentColor);
});

document.getElementById("honeycomb-enabled").addEventListener("change", (e) => {
  state.honeycombEnabled = e.target.checked;
  rebuild();
});

document.getElementById("stackable-enabled").addEventListener("change", (e) => {
  state.stackableEnabled = e.target.checked;
  rebuild();
});

document.getElementById("emboss-text").addEventListener("input", (e) => {
  state.embossText = e.target.value;
  if (e.target.value.trim()) {
    clearEmbossTrace();
    state.embossSvgEnabled = false;
    document.getElementById("emboss-svg-enabled").checked = false;
    updateDecorUi();
    updateTraceUi();
  }
  rebuild();
});
document.getElementById("emboss-text").addEventListener("change", () => pushAppHistory());

document.getElementById("emboss-font").addEventListener("change", async (e) => {
  state.embossFont = e.target.value;
  await ensureEmbossFontLoaded(state.embossFont);
  updateEmbossTextPreviewStyle();
  rebuild();
});

document.getElementById("emboss-svg-enabled").addEventListener("change", (e) => {
  state.embossSvgEnabled = e.target.checked;
  if (e.target.checked) {
    clearEmbossTrace();
    state.embossText = "";
    document.getElementById("emboss-text").value = "";
  } else {
    clearEmbossTrace();
  }
  updateDecorUi();
  updateTraceUi();
  rebuild();
  pushAppHistory();
});

document.getElementById("emboss-face").addEventListener("change", (e) => {
  state.embossFace = e.target.value;
  rebuild();
});

document.getElementById("emboss-deboss").addEventListener("change", (e) => {
  state.embossDeboss = e.target.checked;
  updateEmbossDebossUi();
  rebuild();
});

document.getElementById("honeycomb-face").addEventListener("change", (e) => {
  state.honeycombFace = e.target.value;
  rebuild();
});

const traceDrop = document.getElementById("trace-drop");
const traceFileInput = document.getElementById("trace-file");

traceDrop.setAttribute("tabindex", "0");

traceDrop.addEventListener("click", () => traceFileInput.click());

traceDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  traceDrop.classList.add("trace-drop--over");
});

traceDrop.addEventListener("dragleave", () => {
  traceDrop.classList.remove("trace-drop--over");
});

traceDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  traceDrop.classList.remove("trace-drop--over");
  const file = e.dataTransfer?.files?.[0];
  if (file) handleTraceFile(file);
});

traceFileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) handleTraceFile(file);
  e.target.value = "";
});

document.addEventListener("paste", pasteImageFromClipboard);

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    undoApp();
  } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
    e.preventDefault();
    redoApp();
  }
});

document.getElementById("btn-undo").addEventListener("click", undoApp);
document.getElementById("btn-redo").addEventListener("click", redoApp);
document.getElementById("btn-clear-box").addEventListener("click", clearDecorFromBox);
document.getElementById("btn-reset-view").addEventListener("click", () => {
  if (meshCache) fitCamera(meshCache.meta);
});

document.getElementById("controls").addEventListener("change", (e) => {
  if (sessionBooting || appHistoryLock) return;
  const t = e.target;
  if (t.matches('input[type="checkbox"], select')) pushAppHistory();
});

document.getElementById("trace-mode").addEventListener("change", (e) => {
  state.traceMode = e.target.value;
  if (traceSourceCanvas) runTraceAsync();
});

document.getElementById("trace-invert").addEventListener("change", (e) => {
  state.traceInvert = e.target.checked;
  if (traceSourceCanvas) runTraceAsync();
});

document.getElementById("trace-threshold").addEventListener("input", () => {
  if (traceSourceCanvas) scheduleTrace();
});

document.getElementById("btn-trace").addEventListener("click", () => runTraceAsync());

document.getElementById("btn-trace-apply").addEventListener("click", applyTraceToBox);

document.getElementById("btn-trace-svg").addEventListener("click", () => {
  if (!traceLastSvg) return;
  const blob = new Blob([traceLastSvg], { type: "image/svg+xml" });
  downloadBlob(blob, "traced-art.svg");
});

document.getElementById("svg-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await importSvgAsTrace(String(reader.result || ""), { fileName: file.name });
    } catch (err) {
      console.error("SVG import failed:", err);
      const meta = document.getElementById("trace-meta");
      if (meta) meta.textContent = err.message || "Could not import SVG";
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.querySelectorAll("#field-joiner-hand .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.joinerHand = chip.dataset.hand;
    document.querySelectorAll("#field-joiner-hand .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    updateJoinerUi();
    rebuild();
    pushAppHistory();
  });
});

document.querySelectorAll(".shape-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".shape-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const next = btn.dataset.shape;
    if (PRESET_CONFIG[next]) {
      state.shape = next;
      applyPreset(next);
    } else {
      state.shape = next;
      applySliderProfile("default");
    }
    updateVaseUiVisibility();
    updateLidUi();
    rebuild();
    pushAppHistory();
    if (meshCache) fitCamera(meshCache.meta);
  });
});

function updateVaseUiVisibility() {
  const isVase = state.shape === "vase";
  if (isVase && state.lidEnabled) {
    state.lidEnabled = false;
  }
  document.getElementById("section-vase").classList.toggle("hidden", !isVase);
  document.getElementById("section-classic-size").classList.toggle("hidden", isVase);
  document.getElementById("section-walls").classList.toggle("hidden", isVase);
  document.getElementById("section-edges").classList.toggle("hidden", isVase);
  document.querySelectorAll('.tab[data-tab="accent"], .tab[data-tab="label"], .tab[data-tab="import"], .tab[data-tab="stack"], .tab[data-tab="link"], .tab[data-tab="lid"]').forEach((tab) => {
    tab.classList.toggle("tab--disabled", isVase);
    tab.disabled = isVase;
  });
  document.getElementById("field-vase-drainage-size").classList.toggle("hidden", !state.vaseDrainage);
  const saucerBtn = document.getElementById("btn-export-saucer");
  if (saucerBtn) saucerBtn.classList.toggle("hidden", !(isVase && state.vaseSaucerEnabled));
}

const vaseStyleSelect = document.getElementById("vase-style");
for (const s of VASE_STYLES) {
  const opt = document.createElement("option");
  opt.value = s.id;
  opt.textContent = s.label;
  vaseStyleSelect.appendChild(opt);
}
vaseStyleSelect.value = state.vaseStyle || "cylinder";

vaseStyleSelect.addEventListener("change", (e) => {
  state.vaseStyle = e.target.value;
  const style = VASE_STYLES.find((s) => s.id === e.target.value);
  if (style && typeof style.drainageDefault === "boolean") {
    state.vaseDrainage = style.drainageDefault;
    document.getElementById("vase-drainage").checked = state.vaseDrainage;
    updateVaseUiVisibility();
  }
  rebuild();
});

bindRange("vase-diameter", "vaseDiameter", "float");
bindRange("vase-height", "vaseHeight", "float");
bindRange("vase-wall", "vaseWall", "float");
bindRange("vase-floor", "vaseFloor", "float");
bindRange("vase-drainage-size", "vaseDrainageSize", "float");

document.getElementById("vase-drainage").addEventListener("change", (e) => {
  state.vaseDrainage = e.target.checked;
  updateVaseUiVisibility();
  rebuild();
});

document.getElementById("vase-saucer").addEventListener("change", (e) => {
  state.vaseSaucerEnabled = e.target.checked;
  updateVaseUiVisibility();
  rebuild();
});

document.getElementById("btn-export-saucer").addEventListener("click", () => {
  if (state.shape !== "vase" || !state.vaseSaucerEnabled || !meshCache?.saucerMesh) return;
  const blob = meshToStl(meshCache.saucerMesh, "makerdeck-saucer");
  downloadBlob(blob, filenameFor(meshCache.meta, "saucer"));
});

document.getElementById("btn-export").addEventListener("click", () => {
  if (!meshCache) rebuild();
  const blob = meshToStl(meshCache, "makerdeck");
  downloadBlob(blob, filenameFor(meshCache.meta, "body"));
});

document.getElementById("btn-export-lid").addEventListener("click", () => {
  if (!state.lidEnabled) return;
  if (!lidCache) rebuild();
  const printMesh = orientLidForPrint(lidCache);
  const blob = meshToStl(printMesh, "makerdeck-lid");
  downloadBlob(blob, filenameFor(lidCache.meta, "lid"));
});

document.getElementById("btn-export-accent").addEventListener("click", () => {
  if (!state.accentEnabled || !accentCache) return;
  const blob = meshToStl(accentCache, "makerdeck-accent");
  downloadBlob(blob, filenameFor(meshCache.meta, "accent"));
});

document.getElementById("btn-export-deboss").addEventListener("click", () => {
  if (!state.embossDeboss || !debossCutterCache) return;
  const blob = meshToStl(debossCutterCache, "makerdeck-deboss");
  downloadBlob(blob, filenameFor(meshCache.meta, "deboss-cutter"));
});

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);

function animate() {
  requestAnimationFrame(animate);
  updateLidAnimation(performance.now());
  if (document.hidden && !lidAnim) return;
  controls.update();
  renderer.render(scene, camera);
}

resize();
syncSliderUi("lid-skirt", "lidSkirt", { min: 4, max: 25, value: state.lidSkirt });
syncSliderUi("lid-thickness", "lidThickness", { min: 2, max: 6, value: state.lidThickness, parseKind: "float" });
syncSliderUi("lid-clearance", "lidClearance", { min: 0.15, max: 0.8, value: state.lidClearance, parseKind: "float" });
syncSliderUi("joiner-width", "joinerWidth", { min: 5, max: 22, value: state.joinerWidth, parseKind: "float" });
syncSliderUi("joiner-neck", "joinerNeck", { min: 3, max: 16, value: state.joinerNeck, parseKind: "float" });
syncSliderUi("joiner-protrusion", "joinerProtrusion", { min: 2, max: 10, value: state.joinerProtrusion, parseKind: "float" });
syncSliderUi("accent-height", "accentHeight", { min: 2, max: 10, value: state.accentHeight, parseKind: "float" });
syncSliderUi("emboss-depth", "embossDepth", { min: 0.3, max: 2, value: state.embossDepth, parseKind: "float" });
syncSliderUi("emboss-height", "embossHeight", { min: 3, max: 18, value: state.embossHeight, parseKind: "float" });
syncSliderUi("trace-threshold", "traceThreshold", { min: 20, max: 235, value: state.traceThreshold });
syncSliderUi("trace-size", "embossTraceSize", { min: 6, max: 40, value: state.embossTraceSize, parseKind: "float" });

const embossFontSelect = document.getElementById("emboss-font");
for (const font of EMBOSS_FONTS) {
  const opt = document.createElement("option");
  opt.value = font.id;
  opt.textContent = font.label;
  embossFontSelect.appendChild(opt);
}

function scheduleDeferredRestoreTrace() {
  if (!traceSourceCanvas || traceLastResult || !state.embossTraceEnabled) return;
  const run = () => {
    if (!traceSourceCanvas || traceLastResult || !state.embossTraceEnabled || lidAnim) return;
    runTraceAsync();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 8000 });
  } else {
    setTimeout(run, 2000);
  }
}

async function bootMakerDeck() {
  const restored = await restoreSession();
  if (restored) {
    syncUiFromState();
    setTab(restored.activeTab || "design");
    const meta = document.getElementById("trace-meta");
    if (meta && restored.savedAt) {
      const when = new Date(restored.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      meta.textContent = meta.textContent
        ? `${meta.textContent} · restored from ${when}`
        : `Session restored from ${when}`;
    }
  } else {
    embossFontSelect.value = state.embossFont || "inter";
    updateEmbossTextPreviewStyle();
    setTab("design");
  }

  appHistory = [];
  appHistoryIndex = -1;
  pushAppHistory();
  updateTraceUi();

  await ensureEmbossFontLoaded(state.embossFont);
  sessionBooting = false;
  rebuild();
  if (meshCache) fitCamera(meshCache.meta);

  if (restored?.needsRestoreTrace && traceSourceCanvas) {
    scheduleDeferredRestoreTrace();
  }
}

bootMakerDeck().catch((err) => {
  sessionBooting = false;
  console.error("MakerDeck boot failed:", err);
  const banner = document.createElement("p");
  banner.className = "boot-error";
  banner.textContent = `MakerDeck failed to start: ${err?.message || err}. Hard refresh (Ctrl+Shift+R).`;
  document.querySelector(".controls")?.prepend(banner);
});
animate();
