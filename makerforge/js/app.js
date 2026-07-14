import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildContainer, buildLid, orientLidForPrint, toBufferGeometry, DEFAULTS, shapeSupportsJoiner, shapeSupportsDecor, shapeSupportsAccent, shapeSupportsAccentFrontFace, shapeSupportsProfileTexture, shapeSupportsProfileArt, shapeSupportsArt, shapeSupportsInsert, shapeSupportsLid, LID_TYPES, normalizeLidType, VASE_STYLES, PENCIL_PRESET, PENCIL_BOX_PRESET, TEARDROP_PRESET, STAR_PRESET, HEART_PRESET, CANISTER_SQUARE_PRESET, CANISTER_SQUARE_SET_PRESET, CANISTER_JAR_PRESET, CANISTER_STACK_PRESET } from "./geometry.js?v=308";
import { EMBOSS_FONTS, ensureEmbossFontLoaded, embossFontSpec, textEmbossSizeLimits, arcRadiusLimits, buildWatertightExportMesh, buildWatertightFixedDividerExport, buildTextLabelExportMesh, buildLabelGraphicEmboss, buildMultiColourGraphicEmboss, mergeMeshes, lidCavityIntrusion, effectiveInsertTopClearance, applyExportWatermark, svgEmbossProducesMesh, parsedSvgHasFill, prepareSvgForImport, svgPrefersRasterSilhouette } from "./features.js?v=326";
import { loadImageFromFile, loadImageFromDataUrl, traceCanvasAsync, traceFlattenedSvgCanvasAsync, drawTracePreview, rasterizeSvgToCanvas, flattenCanvasToInkSilhouette, MAX_TRACE_RECTS, MAX_TRACE_POLYGONS } from "./trace.js?v=305";
import { meshToStl, downloadBlob, filenameFor, sanitizeMeshForStl, prepareMeshFor3mf, baseModelName, countOpenEdges } from "./stl.js?v=201";
import { buildColoredProject3mf, createZipArchiveBlob, filename3mfFor } from "./3mf.js?v=210";
import { mountColorPicker, setColorPickerValue, suggestAccentColor } from "./color-picker.js?v=73";
import { appliedHasArt } from "./art-editor.js";
import {
  MAX_ACCENT_BANDS,
  newAccentBand,
  ensureStateAccentBands,
  syncFlatAccentFromBands,
} from "./accent-bands.js?v=163";
import {
  libraryApiAvailable,
  capturePreviewThumbnail,
  saveExportToLibrary,
  listLibraryDesigns,
  fetchDesignParams,
  deleteLibraryDesign,
} from "./library.js?v=201";

const SESSION_KEY = "makerdeck-session-v1";
/** Golden baseline — see makerforge/GOLDEN_BASELINE.md. Do not regress trace preview or b278 emboss. */
const MAKERDECK_BUILD = "b328";
const MAKERDECK_GOLDEN_BUILD = "b284";
const SVG_FAST_RASTER_PX = 896;
const DISPLAY_UNITS = ["mm", "cm", "in"];
const MM_PER_IN = 25.4;
let saveSessionTimer = null;
let sessionBooting = true;

const LENGTH_STATE_KEYS = new Set([
  "innerWidth", "innerDepth", "innerHeight",
  "wall", "floor", "cornerRadius", "vertexFillet",
  "lidSkirt", "lidThickness", "lidLipDepth", "lidClearance", "lidGasketWidth", "lidGasketDepth",
  "joinerWidth", "joinerNeck", "joinerProtrusion",
  "insertThickness", "insertClearance", "insertSlotDepth", "insertTopClearance",
  "vaseDiameter", "vaseHeight", "vaseWall", "vaseFloor", "vaseDrainageSize", "vaseFluteDepth",
  "vaseTextureDepth", "vaseTextureScale",
  "embossDepth", "embossHeight", "embossArcRadius", "embossTraceSize",
  "textOffsetX", "textOffsetY", "decorOffsetX", "decorOffsetY",
]);

const LENGTH_ACCENT_KEYS = new Set(["height", "waveAmp"]);

function normalizeDisplayUnit(unit) {
  return DISPLAY_UNITS.includes(unit) ? unit : "mm";
}

function displayUnitLabel(unit = state.displayUnit) {
  const u = normalizeDisplayUnit(unit);
  return u === "in" ? "in" : u;
}

function displayUnitFactor(unit = state.displayUnit) {
  const u = normalizeDisplayUnit(unit);
  if (u === "cm") return 10;
  if (u === "in") return MM_PER_IN;
  return 1;
}

function isLengthKey(key) {
  return !!(key && (LENGTH_STATE_KEYS.has(key) || LENGTH_ACCENT_KEYS.has(key)));
}

function mmToDisplay(mm, unit = state.displayUnit) {
  return mm / displayUnitFactor(unit);
}

function displayToMm(display, unit = state.displayUnit) {
  return display * displayUnitFactor(unit);
}

function ensureSliderMmStep(slider) {
  if (!slider?.dataset.mmStep) slider.dataset.mmStep = String(slider.step || 1);
  return parseFloat(slider.dataset.mmStep) || 1;
}

function displayDecimalsForStep(dispStep) {
  const stepText = String(dispStep);
  let decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  const u = normalizeDisplayUnit(state.displayUnit);
  if (u === "in" && decimals < 2) decimals = 2;
  if (u === "cm" && decimals < 1) decimals = Math.max(decimals, 1);
  return decimals;
}

function formatDisplayValue(val, dispStep) {
  const decimals = displayDecimalsForStep(dispStep);
  const n = Number(val);
  if (!Number.isFinite(n)) return "0";
  if (decimals) return n.toFixed(decimals);
  return String(Math.round(n));
}

function fmtDimReadout(mm) {
  const factor = displayUnitFactor();
  const disp = mm / factor;
  const step = factor === 1 ? 1 : (factor === 10 ? 0.1 : 0.01);
  return formatDisplayValue(disp, step);
}

function unitLenSpan() {
  return `<span class="unit unit-len">${displayUnitLabel()}</span>`;
}

function applyLengthSliderRange(slider, mmMin, mmMax, mmValue) {
  const mmStep = ensureSliderMmStep(slider);
  slider.dataset.mmMin = String(mmMin);
  slider.dataset.mmMax = String(mmMax);
  const dStep = mmStep / displayUnitFactor();
  slider.min = formatDisplayValue(mmMin / displayUnitFactor(), dStep);
  slider.max = formatDisplayValue(mmMax / displayUnitFactor(), dStep);
  slider.step = String(dStep);
  const display = formatDisplayValue(mmValue / displayUnitFactor(), dStep);
  slider.value = display;
  return display;
}

const PRESET_SHAPES = new Set(["pencil", "pencilBox", "teardrop", "star", "heart", "canisterSquare", "canisterSquareSet", "canisterJar", "canisterStack"]);

const CANISTER_CONTENT_LABELS = {
  coffee: "COFFEE",
  tea: "TEA",
  sugar: "SUGAR",
  milo: "MILO",
  biscuits: "BISCUITS",
  custom: "",
};

/** Stack-set colours + single-letter wrap labels. */
const CANISTER_CONTENT_META = {
  coffee: { label: "COFFEE", letter: "C", color: "#6d7f64", lidColor: "#c4a574", textColor: "#f8fafc", artColor: "#4a3728" },
  tea: { label: "TEA", letter: "T", color: "#e8e6df", lidColor: "#c4a574", textColor: "#3d4a3a" },
  sugar: { label: "SUGAR", letter: "S", color: "#6d8498", lidColor: "#c4a574", textColor: "#f8fafc" },
  milo: { label: "MILO", letter: "M", color: "#6b4a38", lidColor: "#c4a574", textColor: "#f8fafc", artColor: "#3d5c2e" },
  biscuits: { label: "BISCUITS", letter: "B", color: "#c4a882", lidColor: "#c4a574", textColor: "#3d3428" },
};

/** Word-style arc presets — one click sets sweep/start/side; curve slider bends radius. */
const ARC_TEXT_PRESETS = {
  "arch-up": { startDeg: -90, sweep: 240, curve: 60, spacing: 1, side: "up" },
  "arch-down": { startDeg: 180, sweep: 200, curve: 60, spacing: 1, side: "down" },
  banner: { startDeg: -90, sweep: 155, curve: 88, spacing: 1, side: "up" },
};

function nudgeArcCentreForPreset(id) {
  if (state.embossFace === "wrap" && hasGraphicArt(buildParams())) {
    state.textOffsetX = 0;
    state.textOffsetY = 0;
    return;
  }
  const graphicMm = state.embossTraceSize ?? state.embossHeight ?? 16;
  const textMm = state.embossHeight ?? 7;
  if (id === "arch-down") {
    state.textOffsetY = graphicMm * 0.55 + textMm * 0.4;
  } else if (id === "banner") {
    state.textOffsetY = -(graphicMm * 0.65 + textMm * 0.15);
  } else {
    state.textOffsetY = -(graphicMm * 0.85 + textMm * 0.25);
  }
}

/** OEM coffee-tin chart (outer Ø × height mm) → inner cavity after 2.4 mm wall + 2.8 mm floor. */
const CANISTER_SIZE_TABLE = {
  sm: {
    label: "125g",
    hint: "250 ml tin · ~83×95 mm outer",
    square: { innerWidth: 78, innerDepth: 78, innerHeight: 92 },
    jar: { innerWidth: 78, innerDepth: 78, innerHeight: 92 },
  },
  md: {
    label: "250g",
    hint: "500 ml tin · ~99×130 mm outer",
    square: { innerWidth: 94, innerDepth: 94, innerHeight: 127 },
    jar: { innerWidth: 94, innerDepth: 94, innerHeight: 127 },
  },
  lg: {
    label: "500g",
    hint: "1 L tin · ~120×180 mm outer",
    square: { innerWidth: 115, innerDepth: 115, innerHeight: 177 },
    jar: { innerWidth: 115, innerDepth: 115, innerHeight: 177 },
  },
  xl: {
    label: "1.5kg",
    hint: "Biscuit tin · ~155×240 mm outer · 1–1.5 kg",
    square: { innerWidth: 150, innerDepth: 115, innerHeight: 165 },
    jar: { innerWidth: 145, innerDepth: 145, innerHeight: 232 },
  },
};

function isCanisterShape(shape = state.shape) {
  return shape === "canisterSquare" || shape === "canisterSquareSet" || shape === "canisterJar" || shape === "canisterStack";
}

function isStackSetShape(shape = state.shape) {
  return shape === "canisterStack";
}

function isSquareSetShape(shape = state.shape) {
  return shape === "canisterSquareSet";
}

function isKitchenTrioShape(shape = state.shape) {
  return isStackSetShape(shape) || isSquareSetShape(shape);
}

function canisterEmbossText(content, shape = state.shape) {
  const meta = CANISTER_CONTENT_META[content];
  if (!meta) return "";
  if (shape === "canisterStack") return meta.letter;
  return meta.label || CANISTER_CONTENT_LABELS[content] || "";
}

function textHasInk(text) {
  return String(text || "")
    .split(/\r?\n/)
    .some((l) => l.trim());
}

const PRESET_CONFIG = {
  pencil: { preset: PENCIL_PRESET, profile: "pencil" },
  pencilBox: { preset: PENCIL_BOX_PRESET, profile: "pencil" },
  teardrop: { preset: TEARDROP_PRESET, profile: "teardrop" },
  star: { preset: STAR_PRESET, profile: "jewel" },
  heart: { preset: HEART_PRESET, profile: "jewel" },
  canisterSquare: { preset: CANISTER_SQUARE_PRESET, profile: "canister" },
  canisterSquareSet: { preset: CANISTER_SQUARE_SET_PRESET, profile: "canister" },
  canisterJar: { preset: CANISTER_JAR_PRESET, profile: "canister" },
  canisterStack: { preset: CANISTER_STACK_PRESET, profile: "canister" },
};

const state = { ...DEFAULTS, shape: "rect", displayUnit: "mm" };
let meshCache = null;
let lidCache = null;
let accentPreviewParts = [];
let insertCache = null;
let debossCutterCache = null;
let traceSourceCanvas = null;
let traceLastResult = null;
let traceLastSvg = "";
const EMBOSS_FACE_LABELS = {
  front: "front",
  back: "back",
  left: "left side",
  right: "right side",
  top: "top",
  lid: "lid top",
  wrap: "wrap",
};
const BED_LIFT = 0.35;
const LID_PREVIEW_GAP = 0.35;
const LID_ANIM_LIFT = 14;

/** Preview shading tuned to match matte PLA filament (same hex as 3MF export). */
const FILAMENT_PREVIEW = {
  metalness: 0.02,
  roughness: 0.78,
  emissiveIntensity: 0,
};

function applyFilamentMaterial(mat) {
  mat.metalness = FILAMENT_PREVIEW.metalness;
  mat.roughness = FILAMENT_PREVIEW.roughness;
  mat.emissive.setHex(0x000000);
  mat.emissiveIntensity = FILAMENT_PREVIEW.emissiveIntensity;
}

const viewport = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x070b12, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
// Shadows disabled: only the model itself could receive them, and the default
// directional shadow camera caused self-shadow acne patches on box floors.
renderer.shadowMap.enabled = false;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070b12, 0.0022);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
camera.position.set(120, 95, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, BED_LIFT + 20, 0);

const hemi = new THREE.HemisphereLight(0xdce8f5, 0x243044, 1.05);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 0.88);
key.position.set(80, 120, 60);
key.castShadow = true;
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 0.52);
fill.position.set(-60, 40, -40);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 0.28);
rim.position.set(0, 20, -100);
scene.add(rim);

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
  metalness: FILAMENT_PREVIEW.metalness,
  roughness: FILAMENT_PREVIEW.roughness,
  flatShading: false,
  side: THREE.FrontSide,
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
let insertMesh = null;
let insertEdgeLines = null;
let labelMesh = null;
let labelEdgeLines = null;
let artMesh = null;
let artEdgeLines = null;
let artColourPreviewParts = [];
let currentTabId = "design";

const lidMaterial = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  metalness: FILAMENT_PREVIEW.metalness,
  roughness: FILAMENT_PREVIEW.roughness,
  flatShading: false,
  side: THREE.FrontSide,
  polygonOffset: true,
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 3,
});

let previewXRayOn = false;
let lidFitOkTimer = null;

const LID_FIT_OK_PHRASES = ["Good as gold!", "She'll be right!", "No worries, mate!"];

function buildAccentMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: color || "#f97316",
    metalness: FILAMENT_PREVIEW.metalness,
    roughness: FILAMENT_PREVIEW.roughness,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

const insertMaterial = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  metalness: FILAMENT_PREVIEW.metalness,
  roughness: FILAMENT_PREVIEW.roughness,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const labelMaterial = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  metalness: FILAMENT_PREVIEW.metalness,
  roughness: FILAMENT_PREVIEW.roughness,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const artMaterial = new THREE.MeshStandardMaterial({
  color: 0x4a3728,
  metalness: FILAMENT_PREVIEW.metalness,
  roughness: FILAMENT_PREVIEW.roughness,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
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

function saneNum(value, fallback) {
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildParams() {
  const d = DEFAULTS;
  return {
    shape: state.shape === "rounded" ? "rect" : state.shape,
    innerWidth: saneNum(state.innerWidth, d.innerWidth),
    innerDepth: saneNum(state.innerDepth, d.innerDepth),
    innerHeight: saneNum(state.innerHeight, d.innerHeight),
    wall: saneNum(state.wall, d.wall),
    floor: saneNum(state.floor, d.floor),
    cornerRadius: state.shape === "rounded" || state.shape === "pencilBox" || state.shape === "canisterSquare" || state.shape === "canisterSquareSet"
      ? saneNum(state.cornerRadius, d.cornerRadius)
      : 0,
    vertexFillet: state.vertexFillet,
    sides: state.sides,
    starPoints: state.starPoints,
    starInset: state.starInset,
    lidEnabled: !!state.lidEnabled,
    lidSkirt: state.lidSkirt,
    lidThickness: state.lidThickness,
    lidClearance: state.lidClearance,
    lidLipDepth: state.lidLipDepth,
    lidGasketEnabled: !!state.lidGasketEnabled,
    lidGasketWidth: state.lidGasketWidth,
    lidGasketDepth: state.lidGasketDepth,
    lidGasketExportRing: state.lidGasketExportRing !== false,
    lidType: normalizeLidType(state.lidType, state.shape),
    lidWall: state.wall,
    joinerEnabled: state.insertMount === "fixed" ? false : state.joinerEnabled,
    joinerHand: state.joinerHand,
    joinerWidth: state.joinerWidth,
    joinerNeck: state.joinerNeck,
    joinerProtrusion: state.joinerProtrusion,
    joinerClearance: state.joinerClearance,
    joinerAutoScale: state.joinerAutoScale,
    accentEnabled: state.accentEnabled,
    accentBands: state.accentEnabled ? state.accentBands.map((band) => ({ ...band })) : [],
    accentFace: state.accentFace,
    accentPos: state.accentPos,
    accentHeight: state.accentHeight,
    accentEdge: state.accentEdge,
    accentWaveAmp: state.accentWaveAmp,
    accentWaveCount: state.accentWaveCount,
    accentInset: state.accentInset,
    embossText: state.embossText,
    embossTextAlign: state.embossTextAlign || "left",
    embossTextLayout: state.embossTextLayout || "flat",
    embossArcRadius: state.embossArcRadius ?? 0,
    embossArcSweep: state.embossArcSweep ?? 220,
    embossArcStartDeg: state.embossArcStartDeg ?? -90,
    embossArcTilt: state.embossArcTilt ?? 0,
    embossArcSpacing: state.embossArcSpacing ?? 1,
    embossArcCurve: state.embossArcCurve ?? 60,
    embossArcPreset: state.embossArcPreset || "arch-up",
    embossArcSide: state.embossArcSide === "down" ? "down" : "up",
    textOffsetX: state.textOffsetX ?? 0,
    textOffsetY: state.textOffsetY ?? 0,
    textRotation: state.textRotation ?? 0,
    embossFont: state.embossFont,
    embossDepth: state.embossDepth,
    embossHeight: state.embossHeight,
    embossFace: state.embossFace,
    embossDeboss: state.embossDeboss,
    watermarkEnabled: state.watermarkEnabled !== false,
    embossSvgEnabled: state.embossSvgEnabled,
    embossSvgText: state.embossSvgText,
    embossTraceEnabled: state.embossTraceEnabled,
    embossTraceRects: state.embossTraceRects,
    embossTraceSize: state.embossTraceSize,
    decorOffsetX: state.decorOffsetX,
    decorOffsetY: state.decorOffsetY,
    decorRotation: state.decorRotation ?? 0,
    honeycombEnabled: state.honeycombEnabled,
    honeycombFace: state.honeycombFace,
    honeycombSize: state.honeycombSize,
    honeycombDepth: state.honeycombDepth,
    stackableEnabled: state.stackableEnabled,
    stackStyle: state.stackStyle || "hex",
    stackHexSize: state.stackHexSize,
    stackFootHeight: state.stackFootHeight,
    stackClearance: state.stackClearance,
    stackNestRimWidth: state.stackNestRimWidth,
    stackNestRimHeight: state.stackNestRimHeight,
    stackNestDepth: state.stackNestDepth,
    insertEnabled: state.insertEnabled,
    insertAxis: state.insertAxis,
    insertCount: state.insertCount,
    insertThickness: state.insertThickness,
    insertClearance: state.insertClearance,
    insertTopClearance: state.insertTopClearance,
    insertTopClearanceAuto: state.insertTopClearanceAuto !== false,
    insertMount: state.insertMount || "snap",
    insertSlotDepth: state.insertSlotDepth,
    insertSlotRamp: state.insertSlotRamp,
    insertBodyGap: 0.12,
    fuseInsertToBody: state.insertMount === "fixed" && !!state.insertEnabled,
    bookcaseOpenFront: !!state.bookcaseOpenFront,
    vaseStyle: state.vaseStyle,
    vaseDiameter: state.vaseDiameter,
    vaseHeight: state.vaseHeight,
    vaseWall: state.vaseWall,
    vaseFloor: state.vaseFloor,
    vaseDrainage: state.vaseDrainage,
    vaseDrainageSize: state.vaseDrainageSize,
    vaseSaucerEnabled: state.vaseSaucerEnabled,
    vaseFlutes: state.vaseFlutes,
    vaseFluteDepth: state.vaseFluteDepth,
    vaseTwist: state.vaseTwist,
    vaseRim: state.vaseRim,
    vaseTextureEnabled: state.vaseTextureEnabled,
    vaseTextureStyle: state.vaseTextureStyle,
    vaseTextureDepth: state.vaseTextureDepth,
    vaseTextureScale: state.vaseTextureScale,
    vaseTextureBandLo: state.vaseTextureBandLo,
    vaseTextureBandHi: state.vaseTextureBandHi,
  };
}

function disposeLabelPreview() {
  if (labelMesh) {
    labelMesh.parent?.remove(labelMesh);
    labelMesh.geometry.dispose();
    labelMesh = null;
  }
  if (labelEdgeLines) {
    labelEdgeLines.parent?.remove(labelEdgeLines);
    labelEdgeLines.geometry.dispose();
    labelEdgeLines = null;
  }
}

function disposeArtPreview() {
  if (artMesh) {
    artMesh.parent?.remove(artMesh);
    artMesh.geometry.dispose();
    artMesh = null;
  }
  if (artEdgeLines) {
    artEdgeLines.parent?.remove(artEdgeLines);
    artEdgeLines.geometry.dispose();
    artEdgeLines = null;
  }
  for (const part of artColourPreviewParts) {
    part.mesh.parent?.remove(part.mesh);
    part.mesh.geometry.dispose();
    part.material.dispose();
    if (part.edgeLines) {
      part.edgeLines.parent?.remove(part.edgeLines);
      part.edgeLines.geometry.dispose();
    }
  }
  artColourPreviewParts = [];
}

function mountArtPreviewIfNeeded() {
  if (state.embossDeboss) return;
  const params = buildParams();
  const cache = state.embossFace === "lid" ? lidCache : meshCache;
  disposeArtPreview();
  if (cache?.graphicColourParts?.length) {
    const parent = artUsesLidFace(params) && lidMesh ? lidMesh : previewRoot;
    for (const part of cache.graphicColourParts) {
      const mat = buildAccentMaterial(part.color);
      applyFilamentMaterial(mat);
      const artGeom = toBufferGeometry(THREE, part.mesh);
      const mesh = new THREE.Mesh(artGeom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 7;
      parent.add(mesh);
      let edgeLines = null;
      try {
        const edges = new THREE.EdgesGeometry(artGeom, 20);
        edgeLines = new THREE.LineSegments(edges, edgeMaterial);
        edgeLines.renderOrder = 8;
        edgeLines.visible = previewXRayOn;
        parent.add(edgeLines);
      } catch {
        edgeLines = null;
      }
      artColourPreviewParts.push({ mesh, material: mat, edgeLines });
    }
    return;
  }
  if (!cache?.graphicMesh) return;
  artMaterial.color.set(state.embossArtColor || "#4a3728");
  applyFilamentMaterial(artMaterial);
  const artGeom = toBufferGeometry(THREE, cache.graphicMesh);
  attachArtPreviewMesh(artGeom, artMaterial, params);
}

function attachArtPreviewMesh(artGeom, mat, params) {
  artMesh = new THREE.Mesh(artGeom, mat);
  artMesh.castShadow = true;
  artMesh.receiveShadow = true;
  artMesh.renderOrder = 7;
  const parent = artUsesLidFace(params) && lidMesh ? lidMesh : previewRoot;
  parent.add(artMesh);
  try {
    const edges = new THREE.EdgesGeometry(artGeom, 20);
    artEdgeLines = new THREE.LineSegments(edges, edgeMaterial);
    artEdgeLines.renderOrder = 8;
    artEdgeLines.visible = previewXRayOn;
    parent.add(artEdgeLines);
  } catch {
    artEdgeLines = null;
  }
}

function attachLabelPreviewMesh(labelGeom, mat, params) {
  labelMesh = new THREE.Mesh(labelGeom, mat);
  labelMesh.castShadow = true;
  labelMesh.receiveShadow = true;
  labelMesh.renderOrder = 8;
  const parent = artUsesLidFace(params) && lidMesh ? lidMesh : previewRoot;
  parent.add(labelMesh);
  try {
    const labelEdges = new THREE.EdgesGeometry(labelGeom, 20);
    labelEdgeLines = new THREE.LineSegments(labelEdges, edgeMaterial);
    labelEdgeLines.renderOrder = 9;
    labelEdgeLines.visible = previewXRayOn;
    parent.add(labelEdgeLines);
  } catch {
    labelEdgeLines = null;
  }
}

function mountDebossPreviewIfNeeded() {
  // Deboss geometry is already cut into the body/lid shell — same single filament as export.
}

function mountEmbossLabelPreviewIfNeeded() {
  if (state.embossDeboss) return;
  const params = buildParams();
  labelMaterial.color.set(state.embossTextColor || "#f8fafc");
  applyFilamentMaterial(labelMaterial);
  if (state.embossFace === "lid" && lidCache?.labelMesh && lidMesh) {
    const labelGeom = toBufferGeometry(THREE, lidCache.labelMesh);
    attachLabelPreviewMesh(labelGeom, labelMaterial, params);
  } else if (state.embossFace !== "lid" && meshCache?.labelMesh) {
    const labelGeom = toBufferGeometry(THREE, meshCache.labelMesh);
    attachLabelPreviewMesh(labelGeom, labelMaterial, params);
  }
}

function syncTextAlignUi() {
  const align = state.embossTextAlign || "left";
  document.querySelectorAll(".align-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.textAlign === align);
  });
}

function syncArcPresetUi() {
  const id = state.embossArcPreset || "arch-up";
  document.querySelectorAll(".arc-preset-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.arcPreset === id);
  });
}

function applyArcPreset(id, { nudgeGraphic = false, preserveOffsets = false } = {}) {
  const preset = ARC_TEXT_PRESETS[id];
  if (!preset) return;
  state.embossArcPreset = id;
  state.embossArcStartDeg = preset.startDeg;
  state.embossArcSweep = preset.sweep;
  state.embossArcCurve = preset.curve;
  state.embossArcSpacing = preset.spacing;
  state.embossArcSide = preset.side || "up";
  state.embossArcTilt = 0;
  state.textRotation = 0;
  state.embossArcRadius = 0;
  if (nudgeGraphic && !preserveOffsets) {
    nudgeArcCentreForPreset(id);
    setArtSlider("text-offset-y", Math.round((state.textOffsetY ?? 0) * 10) / 10, "float");
  }
  syncArcPresetUi();
  setArtSlider("emboss-arc-curve", state.embossArcCurve ?? 60);
  setArtSlider("emboss-arc-sweep", state.embossArcSweep ?? 220);
  setArtSlider("emboss-arc-start", state.embossArcStartDeg ?? -90, "float");
  setArtSlider("emboss-arc-tilt", 0, "float");
  setArtSlider("emboss-arc-spacing", state.embossArcSpacing ?? 1, "float");
  setArtSlider("emboss-arc-radius", 0);
  syncArcRadiusUi();
}

function syncTextLayoutUi() {
  const layout = state.embossTextLayout || "flat";
  const textOn = textHasInk(state.embossText);
  document.querySelectorAll(".layout-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.textLayout === layout);
  });
  const arcOn = textOn && layout === "arc";
  const adv = !!state.embossArcAdvanced;
  document.getElementById("field-text-align")?.classList.toggle("hidden", arcOn);
  document.getElementById("field-arc-style")?.classList.toggle("hidden", !arcOn);
  document.getElementById("field-arc-curve")?.classList.toggle("hidden", !arcOn);
  document.getElementById("field-arc-advanced-toggle")?.classList.toggle("hidden", !arcOn);
  document.getElementById("field-arc-advanced")?.classList.toggle("hidden", !arcOn || !adv);
  document.getElementById("field-arc-radius")?.classList.toggle("hidden", !arcOn || !adv);
  document.getElementById("field-arc-sweep")?.classList.toggle("hidden", !arcOn || !adv);
  document.getElementById("field-arc-start")?.classList.toggle("hidden", !arcOn || !adv);
  document.getElementById("field-arc-tilt")?.classList.toggle("hidden", !arcOn || !adv);
  document.getElementById("field-arc-spacing")?.classList.toggle("hidden", !arcOn || !adv);
  document.getElementById("field-text-rotation")?.classList.toggle("hidden", arcOn);
  const advBtn = document.getElementById("btn-arc-advanced");
  if (advBtn) advBtn.textContent = adv ? "Hide fine tune" : "Fine tune arc…";
  const textOx = document.querySelector("#field-text-offset-x .field-label");
  const textOy = document.querySelector("#field-text-offset-y .field-label");
  if (textOx) {
    textOx.innerHTML = arcOn
      ? `Move left / right ${unitLenSpan()}`
      : `Text left / right ${unitLenSpan()}`;
  }
  if (textOy) {
    textOy.innerHTML = arcOn
      ? `Move up / down ${unitLenSpan()}`
      : `Text up / down ${unitLenSpan()}`;
  }
  syncArcPresetUi();
}

function effectiveLidColor() {
  return state.lidColor || state.boxColor || "#38bdf8";
}

function setupColorPickers() {
  mountColorPicker(document.getElementById("box-color-picker"), {
    value: state.boxColor,
    onChange: (hex) => {
      state.boxColor = hex;
      applyBoxPreviewColor();
      if (!state.lidColor) {
        setColorPickerValue(document.getElementById("lid-color-picker"), hex);
      }
      scheduleSaveSession();
    },
  });
  mountColorPicker(document.getElementById("lid-color-picker"), {
    value: effectiveLidColor(),
    onChange: (hex) => {
      state.lidColor = hex;
      applyBoxPreviewColor();
      scheduleSaveSession();
    },
  });
  document.getElementById("btn-lid-match-body")?.addEventListener("click", () => {
    state.lidColor = "";
    setColorPickerValue(document.getElementById("lid-color-picker"), state.boxColor || "#38bdf8");
    applyBoxPreviewColor();
    scheduleSaveSession();
  });
  mountColorPicker(document.getElementById("text-color-picker"), {
    value: state.embossTextColor,
    onChange: (hex) => {
      state.embossTextColor = hex;
      if (labelMesh) {
        labelMaterial.color.set(hex);
        applyFilamentMaterial(labelMaterial);
      }
      scheduleSaveSession();
    },
  });
  mountColorPicker(document.getElementById("art-color-picker"), {
    value: state.embossArtColor,
    onChange: (hex) => {
      state.embossArtColor = hex;
      if (artMesh) {
        artMaterial.color.set(hex);
        applyFilamentMaterial(artMaterial);
      }
      scheduleSaveSession();
    },
  });
}

function syncColorPickersFromState() {
  setColorPickerValue(document.getElementById("box-color-picker"), state.boxColor || "#38bdf8");
  setColorPickerValue(document.getElementById("lid-color-picker"), effectiveLidColor());
  setColorPickerValue(document.getElementById("text-color-picker"), state.embossTextColor || "#f8fafc");
  setColorPickerValue(document.getElementById("art-color-picker"), state.embossArtColor || "#4a3728");
}

function hasGraphicArt(params = buildParams()) {
  const hasSvg = params.embossSvgEnabled && !!params.embossSvgText?.trim();
  const traceData = params.embossTraceRects;
  const hasTrace =
    params.embossTraceEnabled &&
    ((traceData?.multiColour && traceData.colorLayers?.length)
      || traceData?.shapeGroups?.length
      || traceData?.strokePaths?.length
      || traceData?.mask?.length
      || traceData?.rects?.length
      || traceData?.silhouetteMask?.length);
  return !!(hasSvg || hasTrace);
}

function hasSeparateArtExport(params = buildParams()) {
  return hasGraphicArt(params) && !params.embossDeboss;
}

function hasSeparateTextExport(params = buildParams()) {
  return textHasInk(params.embossText) && !params.embossDeboss;
}

const WATERMARK_SERIAL_KEY = "makerdeck-export-serial";

function acquireWatermarkStamp() {
  const raw = parseInt(localStorage.getItem(WATERMARK_SERIAL_KEY) || "0", 10);
  const serial = (Number.isFinite(raw) ? raw : 0) + 1;
  localStorage.setItem(WATERMARK_SERIAL_KEY, String(serial));
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { serial, dateStr };
}

function finalizeBodyExportMesh(mesh, meta, params, stamp) {
  if (!stamp || params.watermarkEnabled === false || params.__exportSeparateColors) return mesh;
  return applyExportWatermark(mesh, meta, params, stamp);
}

function partOpenEdgeCount(part) {
  if (!part?.mesh?.positions?.length || !part?.mesh?.indices?.length) return 0;
  return part.mesh.openEdgeCount ?? countOpenEdges(part.mesh.positions, part.mesh.indices);
}

function mergeInsertIntoBodyExport() {
  return state.insertMount === "fixed" && state.insertEnabled;
}

function syncExportStateFromUi() {
  const insertOn = document.getElementById("insert-enabled");
  const insertMount = document.getElementById("insert-mount");
  const insertAxis = document.getElementById("insert-axis");
  const joinerOn = document.getElementById("joiner-enabled");
  if (insertOn) state.insertEnabled = insertOn.checked;
  if (insertMount) state.insertMount = insertMount.value || state.insertMount || "snap";
  if (insertAxis) state.insertAxis = insertAxis.value || state.insertAxis || "length";
  if (joinerOn) state.joinerEnabled = joinerOn.checked;
}

/** Build export geometry from current UI state — never reuse a stale preview cache. */
function buildFreshExportCache() {
  const params = buildParams();
  const cache = buildContainer(params);
  if (cache.meta.shape === "rect" && state.shape === "rounded") {
    cache.meta.shape = "rounded";
  }
  if (state.shape === "hex" && state.sides !== 6) {
    cache.meta.shape = "polygon";
  }
  if (PRESET_SHAPES.has(state.shape)) {
    cache.meta.shape = state.shape;
  }
  return cache;
}

function exportShellTriCount(exportCache) {
  return Math.floor(((exportCache?.shellMesh || exportCache)?.indices?.length || 0) / 3);
}

/** Sharp rect shells are ~28 tris; rounded profiles are 200+. Detect joiner/stale leaks only. */
function weldedDividerExportLooksBroken(exportCache, params, triCount) {
  const shellTris = exportShellTriCount(exportCache);
  const corner = params.cornerRadius || 0;
  const fillet = params.vertexFillet || 0;
  const roundedProfile = corner > 0.5 || fillet > 0.5;

  if (params.joinerEnabled) return true;

  // Rounded boxes should never export a ~28-tri shell (that's the joiner-link path).
  if (roundedProfile && shellTris < 100) return true;
  if (roundedProfile && triCount < 180) return true;

  // Sharp rect + welded divider ≈ 76 tris (split rim / walls) — valid.
  if (!roundedProfile) return shellTris < 20 || triCount < 50;

  return false;
}

function previewBodySource(cache) {
  if (!cache || state.embossDeboss) return cache;
  if (cache.graphicMesh || cache.labelMesh) return cache.shellMesh || cache;
  return cache;
}

function previewLidSource(cache) {
  if (!cache || state.embossDeboss) return cache;
  if (cache.graphicMesh || cache.labelMesh) return cache.shellLid || cache;
  return cache;
}

function resolveBodyExportMesh(exportCache, params, separateText, stamp = null) {
  const cleanBox = exportCache.boxShell || exportCache.shellMesh || exportCache;
  const shell = exportCache.shellMesh || exportCache;
  if (state.insertEnabled && state.insertMount === "fixed") {
    const welded = buildWatertightFixedDividerExport(exportCache, exportCache.meta, {
      ...params,
      fuseInsertToBody: true,
    });
    if (welded?.indices?.length) {
      return finalizeBodyExportMesh(welded, exportCache.meta, params, stamp);
    }
    throw new Error("Fixed divider export failed — use Width or Depth axis (not Height shelves).");
  }
  if (separateText || hasSeparateArtExport(params)) {
    // Stack feet / honeycomb merged into shellMesh are non-manifold in slicers — export plain box.
    return finalizeBodyExportMesh(cleanBox, exportCache.meta, { ...params, __exportSeparateColors: true }, stamp);
  }
  const mesh = buildWatertightExportMesh(exportCache, exportCache.meta, params);
  return finalizeBodyExportMesh(mesh, exportCache.meta, params, stamp);
}

function collectColoredExportParts(exportCache, stamp = null) {
  if (!exportCache) return [];
  const params = buildParams();
  const parts = [];
  let extruder = 1;
  const separateText = hasSeparateTextExport(params) && params.embossFace !== "lid";
  const separateArt = hasSeparateArtExport(params) && params.embossFace !== "lid";
  const separateColor = separateText || separateArt;
  const mergeInsertIntoBody = mergeInsertIntoBodyExport();
  const bodyMesh = resolveBodyExportMesh(exportCache, params, separateText, stamp);

  if (separateColor && (params.embossFace || "front") !== "lid") {
    // Separate Body / Art / Text — each part gets its own filament slot.
    // Do NOT punch wall holes: removed tris open through-holes and slicers fill the cavity solid.
    const exportParams = {
      ...params,
      __labelExportStandoff: true,
      __multiColourAmsExport: true,
      // Flush on the outer skin — no 0.2 mm air gap (reads as white seam in slicer).
      __labelExportEmbedded: true,
    };
    const boxShell = exportCache.boxShell || exportCache.shellMesh || exportCache;
    const bodyClean = prepareMeshFor3mf({
      positions: boxShell.positions.slice(),
      indices: boxShell.indices.slice(),
    });
    if (bodyClean?.indices?.length) {
      parts.push({
        name: "Body",
        mesh: bodyClean,
        color: state.boxColor || "#38bdf8",
        extruder: extruder++,
      });
    }
    if (separateArt) {
      const traceData = params.embossTraceRects;
      if (traceData?.multiColour && traceData.colorLayers?.length) {
        const colourParts = buildMultiColourGraphicEmboss(exportCache.meta, exportParams, traceData);
        for (const cp of colourParts || []) {
          const artClean = cp.mesh ? sanitizeMeshForStl(cp.mesh, { strict: false }) : null;
          if (artClean?.indices?.length) {
            parts.push({
              name: cp.name,
              mesh: artClean,
              color: cp.color,
              extruder: extruder++,
            });
          }
        }
      } else {
        const artMesh = buildLabelGraphicEmboss(exportCache.meta, exportParams, params.embossSvgText || "", "emboss");
        const artClean = artMesh ? sanitizeMeshForStl(artMesh, { strict: false }) : null;
        if (artClean?.indices?.length) {
          parts.push({
            name: "Art",
            mesh: artClean,
            color: state.embossArtColor || "#4a3728",
            extruder: extruder++,
          });
        }
      }
    }
    if (separateText) {
      const textMesh = buildTextLabelExportMesh(exportCache.meta, exportParams);
      const textClean = textMesh ? sanitizeMeshForStl(textMesh, { strict: false }) : null;
      if (textClean?.indices?.length) {
        parts.push({
          name: "Text",
          mesh: textClean,
          color: state.embossTextColor || "#f8fafc",
          extruder: extruder++,
        });
      }
    }
  } else if (bodyMesh?.indices?.length) {
    const bodyClean = sanitizeMeshForStl(bodyMesh);
    if (bodyClean?.indices?.length) {
      parts.push({
        name: "Body",
        mesh: bodyClean,
        color: state.boxColor || "#38bdf8",
        extruder: extruder++,
      });
    }
  }

  if (state.accentEnabled && exportCache.accentMeshes?.length) {
    exportCache.accentMeshes.forEach((part, i) => {
      const accentClean = sanitizeMeshForStl(part.solidMesh || part.mesh);
      if (!accentClean?.indices?.length) return;
      parts.push({
        name: exportCache.accentMeshes.length > 1 ? `Accent ${i + 1}` : "Accent",
        mesh: accentClean,
        color: part.color || state.accentBands[i]?.color || "#f97316",
        extruder: extruder++,
      });
    });
  }

  if (state.insertEnabled && exportCache.insertMesh && !mergeInsertIntoBody) {
    const insertClean = sanitizeMeshForStl(exportCache.insertMesh);
    if (insertClean?.indices?.length) {
      parts.push({
        name: "Insert",
        mesh: insertClean,
        color: state.boxColor || "#38bdf8",
        extruder: extruder++,
      });
    }
  }

  return parts;
}

function exportIncludesLidPlate() {
  return !!state.lidEnabled && !!lidCache && shapeSupportsLid(state.shape);
}

const CONTAINER_LID_README = "Import both files in Bambu Studio. Slice container first, then lid.";

async function buildBody3mfExport(exportCache, parts) {
  const projectName = baseModelName(exportCache.meta);
  const lidOn = exportIncludesLidPlate();

  if (!lidOn) {
    return { blob: buildColoredProject3mf(parts, projectName), zipExport: false, lidPartCount: 0 };
  }

  const containerBlob = buildColoredProject3mf(parts, projectName);
  const containerFile = filename3mfFor(exportCache.meta, "container");

  const zipEntries = [];
  const containerData = await containerBlob.arrayBuffer().then((buf) => new Uint8Array(buf));
  zipEntries.push({ name: containerFile, data: containerData });

  let lidPartCount = 0;
  let lidFile = null;

  const lidParts = collectColoredLidExportParts();
  lidPartCount = lidParts.length;
  if (lidParts.length) {
    const lidBlob = buildColoredProject3mf(lidParts, `${projectName} lid`);
    lidFile = filename3mfFor(exportCache.meta, "lid");
    const lidData = await lidBlob.arrayBuffer().then((buf) => new Uint8Array(buf));
    zipEntries.push({ name: lidFile, data: lidData });
  }

  zipEntries.push({ name: "README.txt", data: CONTAINER_LID_README });
  const zipBlob = createZipArchiveBlob(zipEntries);
  return {
    blob: zipBlob,
    zipExport: true,
    lidPartCount,
    containerBlob,
    containerFile,
    lidFile,
  };
}

function collectColoredLidExportParts() {
  if (!lidCache) return [];
  const params = buildParams();
  const parts = [];
  let extruder = 1;
  const separateText = hasSeparateTextExport(params) && params.embossFace === "lid";
  const separateArt = hasSeparateArtExport(params) && params.embossFace === "lid";
  const shell = lidCache.shellLid || lidCache;
  const lidBody = separateArt || separateText ? shell : lidCache;
  const lidClean = sanitizeMeshForStl(orientLidForPrint(lidBody));
  if (lidClean) {
    parts.push({
      name: "Lid",
      mesh: lidClean,
      color: state.lidColor || state.boxColor || "#38bdf8",
      extruder: extruder++,
    });
  }
  if (separateArt) {
    const artMesh = buildLabelGraphicEmboss(lidCache.meta, params, params.embossSvgText || "", "emboss");
    if (artMesh) {
      const artClean = sanitizeMeshForStl(orientLidForPrint({ ...artMesh, lidHeight: lidCache.lidHeight }));
      if (artClean) {
        parts.push({
          name: "Lid art",
          mesh: artClean,
          color: state.embossArtColor || "#4a3728",
          extruder: extruder++,
        });
      }
    }
  }
  if (separateText && lidCache.labelMesh) {
    const textMesh = buildTextLabelExportMesh(lidCache.meta, params);
    if (textMesh) {
      const textClean = sanitizeMeshForStl(orientLidForPrint({ ...textMesh, lidHeight: lidCache.lidHeight }));
      if (textClean) {
        parts.push({
          name: "Lid text",
          mesh: textClean,
          color: state.embossTextColor || "#f8fafc",
          extruder: extruder++,
        });
      }
    }
  }
  if (params.lidGasketEnabled && params.lidGasketExportRing !== false && lidCache.gasketRingMesh?.indices?.length) {
    const gasketClean = sanitizeMeshForStl(orientLidForPrint(lidCache.gasketRingMesh));
    if (gasketClean?.indices?.length) {
      parts.push({
        name: "Gasket",
        mesh: gasketClean,
        color: "#94a3b8",
        extruder: extruder++,
      });
    }
  }
  return parts;
}

function disposeAccentPreview() {
  for (const part of accentPreviewParts) {
    previewRoot.remove(part.mesh);
    part.mesh.geometry.dispose();
    if (part.edgeLines) {
      previewRoot.remove(part.edgeLines);
      part.edgeLines.geometry.dispose();
    }
    part.material.dispose();
  }
  accentPreviewParts = [];
}

function disposeInsertPreview() {
  if (insertMesh) {
    previewRoot.remove(insertMesh);
    insertMesh.geometry.dispose();
    insertMesh = null;
  }
  if (insertEdgeLines) {
    previewRoot.remove(insertEdgeLines);
    insertEdgeLines.geometry.dispose();
    insertEdgeLines = null;
  }
  insertCache = null;
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

  if (g.lidType === "slip" || g.lidType === "screw") {
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
    if (g.lipOuter) {
      addLidGuideLoop(g.lipOuter, 0, guideSkirtInnerMaterial, false);
    }
  }

  syncLidGuideLoops(lidRestY(), 0);
}

function syncLidGuideLoops(lidY, lidX = 0) {
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
  const t = lidCache?.fitGuides?.lidType || normalizeLidType(state.lidType, state.shape);
  if (t === "flat") {
    return "Orange = box rim. White plate loops rest directly on the rim — no skirt.";
  }
  if (t === "plug") {
    return "Orange = box rim. Green loops = inset plug skirt inside the opening. White = top plate on the rim.";
  }
  if (t === "screw") {
    return "Orange = box rim. Green loops = threaded cap over the neck — twist clockwise to close.";
  }
  return "Orange = box rim. Green loops = skirt wrapping outside the walls (larger than the rim).";
}

function disposeLidPreview() {
  if (lidMesh) {
    while (lidMesh.children.length) {
      const child = lidMesh.children[0];
      lidMesh.remove(child);
      child.geometry?.dispose();
    }
    previewRoot.remove(lidMesh);
    lidMesh.geometry.dispose();
    lidMesh = null;
  }
  disposeLidGuides();
  lidCache = null;
  stopLidAnimation(false);
}

function resetLidPreviewPose() {
  if (!lidCache || !lidMesh) return;
  lidMesh.rotation.set(0, 0, 0);
  setLidPreviewTransform(lidRestY(), 0);
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

function artUsesLidFace(params = null) {
  const p = params || buildParams();
  return (p.embossFace || "front") === "lid";
}

function setLidPreviewTransform(y, x = 0) {
  if (lidMesh) {
    lidMesh.position.y = y;
    lidMesh.position.x = x;
  }
  syncLidGuideLoops(y, x);
}

function setLidPreviewY(y) {
  setLidPreviewTransform(y, 0);
}

function applyInsertPreviewColor() {
  insertMaterial.color.set(state.boxColor || "#38bdf8");
  applyFilamentMaterial(insertMaterial);
}

function applyBoxPreviewColor() {
  if (previewXRayOn) {
    material.color.setHex(0x475569);
  } else {
    const bodyHex = state.boxColor || "#38bdf8";
    material.color.set(bodyHex);
    applyFilamentMaterial(material);
    lidMaterial.color.set(state.lidColor || bodyHex);
    applyFilamentMaterial(lidMaterial);
  }
  applyInsertPreviewColor();
}

function applyAccentPreviewColors() {
  accentPreviewParts.forEach((part, i) => {
    const hex = state.accentBands[i]?.color || "#f97316";
    part.material.color.set(hex);
    applyFilamentMaterial(part.material);
  });
}

function setAccentPreviewXRay(on) {
  for (const part of accentPreviewParts) {
    part.material.transparent = on;
    part.material.opacity = on ? 0.35 : 1;
    part.material.depthWrite = !on;
    if (part.edgeLines) part.edgeLines.visible = on;
  }
}

function setPreviewXRayMode(on) {
  if (previewXRayOn === on) return;
  previewXRayOn = on;

  material.transparent = on;
  material.opacity = on ? 0.14 : 1;
  // Coplanar cap tris + grid bleed through transparent walls if depthWrite stays on.
  material.depthWrite = !on;
  material.metalness = on ? 0.05 : FILAMENT_PREVIEW.metalness;
  material.roughness = on ? 0.5 : FILAMENT_PREVIEW.roughness;
  applyBoxPreviewColor();
  material.polygonOffset = !on;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 2;

  lidMaterial.transparent = on;
  lidMaterial.opacity = on ? 0.42 : 1;
  lidMaterial.depthWrite = !on;
  lidMaterial.emissive.setHex(on ? 0x0ea5e9 : 0x000000);
  lidMaterial.emissiveIntensity = on ? 0.28 : 0;
  if (on) {
    lidMaterial.color.setHex(0x7dd3fc);
  } else {
    lidMaterial.color.set(state.lidColor || state.boxColor || "#38bdf8");
    applyFilamentMaterial(lidMaterial);
  }
  lidMaterial.polygonOffset = !on;
  lidMaterial.polygonOffsetFactor = 2;
  lidMaterial.polygonOffsetUnits = 3;
  lidMaterial.flatShading = on;

  grid.visible = !on;
  grid.position.y = on ? -500 : 0;
  for (const mat of Array.isArray(grid.material) ? grid.material : [grid.material]) {
    mat.opacity = on ? 0 : 0.55;
  }

  edgeMaterial.opacity = on ? 0.22 : 0.55;

  labelMaterial.transparent = on;
  labelMaterial.opacity = on ? 0.35 : 1;
  labelMaterial.depthWrite = !on;

  artMaterial.transparent = on;
  artMaterial.opacity = on ? 0.35 : 1;
  artMaterial.depthWrite = !on;

  setAccentPreviewXRay(on);

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
    edgeLines.visible = on;
  }
  if (insertEdgeLines) insertEdgeLines.visible = on;
  if (labelEdgeLines) labelEdgeLines.visible = on;
  if (artEdgeLines) artEdgeLines.visible = on;
  syncLidGuideLoops(lidMesh?.position.y ?? lidRestY(), 0);
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
  if (resetToRest && lidMesh && lidCache) resetLidPreviewPose();
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
    mode: "vertical",
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
  setLidPreviewTransform(y0 + (y1 - y0) * easeInOutCubic(t), 0);
  if (t >= 1) {
    if (a.phaseIndex === 0) showLidFitOk();
    a.phaseIndex += 1;
    a.phaseStart = now;
    if (a.phaseIndex >= a.phases.length) stopLidAnimation(true);
  }
}

function fitCamera(meta) {
  if (!meta?.outer) return;
  const w = Number(meta.outer.w);
  const d = Number(meta.outer.d);
  const h = Number(meta.outer.h);
  if (!Number.isFinite(w) || !Number.isFinite(d) || !Number.isFinite(h)) return;

  let topY = Number(meshCache?.totalH) || h;
  if (state.lidEnabled && lidCache) {
    const openY = Number(lidOpenY());
    const lidH = Number(lidCache.lidHeight);
    if (Number.isFinite(openY) && Number.isFinite(lidH)) {
      topY = Math.max(topY, openY + lidH);
    }
  }

  const pencilLike = meta.shape === "pencil" || meta.shape === "pencilBox";
  const span = Math.max(w, d, topY);
  const dist = (pencilLike ? span * 1.35 : span * 1.8) + 40;
  if (!Number.isFinite(dist) || dist <= 0) return;

  controls.target.set(0, BED_LIFT + topY * 0.5, 0);
  camera.position.set(
    dist * (pencilLike ? 0.95 : 0.85),
    BED_LIFT + dist * (pencilLike ? 0.55 : 0.65),
    dist * (pencilLike ? 0.75 : 0.9),
  );
  controls.update();
}

function rebuild() {
  if (rebuildBusy) {
    rebuildAgain = true;
    return;
  }
  rebuildBusy = true;
  try {
    try {
      rebuildMesh();
      scheduleSaveSession();
    } catch (err) {
      console.error("MakerDeck rebuild failed:", err);
      if (state.embossTraceEnabled) {
        clearEmbossTrace();
        updateTraceUi();
      }
      try {
        rebuildMesh();
        scheduleSaveSession();
      } catch (retryErr) {
        console.error("MakerDeck rebuild retry failed:", retryErr);
        resetToDefaultBox();
      }
    }
  } finally {
    rebuildBusy = false;
    if (rebuildAgain) {
      rebuildAgain = false;
      rebuild();
    }
  }
}

function resetToDefaults() {
  cancelPendingArtRebuild();
  stopLidAnimation(true);
  if (previewXRayOn) setPreviewXRayMode(false);
  clearEmbossTrace();
  traceSourceCanvas = null;
  traceLastResult = null;
  traceLastSvg = "";

  Object.assign(state, { ...DEFAULTS, shape: "rect" });
  state.embossText = "";
  state.embossSvgEnabled = false;
  state.embossSvgText = "";
  state.embossSvgFileName = "";
  const svgFile = document.getElementById("svg-file");
  if (svgFile) svgFile.value = "";
  state.embossTraceEnabled = false;
  state.embossTraceRects = null;
  state.embossFace = "front";

  document.getElementById("emboss-text").value = "";
  applySliderProfile("default");
  syncUiFromState();
  setTab("design");

  appHistory = [snapshotApp()];
  appHistoryIndex = 0;
  updateHistoryUi();

  rebuild();
  if (meshCache) fitCamera(meshCache.meta);
  scheduleSaveSession();

  const resetBtn = document.getElementById("btn-reset-defaults");
  if (resetBtn) {
    resetBtn.classList.add("is-ok");
    resetBtn.textContent = "Reset ✓";
    setTimeout(() => {
      resetBtn.classList.remove("is-ok");
      resetBtn.textContent = "Reset defaults";
    }, 1400);
  }
}

function resetToDefaultBox() {
  try {
    resetToDefaults();
  } catch (err) {
    console.error("MakerDeck emergency reset failed:", err);
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

function cloneColourLayers(layers) {
  if (!layers?.length) return [];
  return layers.map((layer) => ({
    rgb: layer.rgb ? [...layer.rgb] : [],
    hex: layer.hex,
    label: layer.label,
    mask: layer.mask instanceof Uint8Array ? layer.mask.slice() : Uint8Array.from(layer.mask || []),
    rects: layer.rects?.map((r) => ({ ...r })) || [],
    maskFillPct: layer.maskFillPct,
    shapeGroups: layer.shapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) || [],
  }));
}

function serializeEmbossTraceRects(rects) {
  const out = cloneEmbossTraceRects(rects);
  const w = out.width || 0;
  const h = out.height || 0;
  const expected = w * h;
  if (out.multiColour && out.colorLayers?.length && expected > 0) {
    for (const layer of out.colorLayers) {
      if (layer.mask?.length === expected && expected <= 1_500_000) {
        const bytes = layer.mask instanceof Uint8Array ? layer.mask : new Uint8Array(layer.mask);
        layer.maskB64 = uint8ToB64(bytes);
      }
      delete layer.mask;
    }
    delete out.mask;
    delete out.silhouetteMask;
  } else if (out.mask?.length) {
    const w = out.width || 0;
    const h = out.height || 0;
    const expected = w * h;
    // Full-res trace masks (e.g. 2400×1939) exceed localStorage — re-trace on restore instead.
    if (expected > 0 && out.mask.length === expected && expected <= 1_500_000) {
      const bytes = out.mask instanceof Uint8Array ? out.mask : new Uint8Array(out.mask);
      out.maskB64 = uint8ToB64(bytes);
    }
    delete out.mask;
    if (expected > 1_500_000) out.maskStale = true;
  }
  return out;
}

function deserializeEmbossTraceRects(stored) {
  if (!stored) return null;
  const out = { ...stored };
  if (stored.colorLayers?.length) {
    out.colorLayers = stored.colorLayers.map((layer) => {
      const copy = { ...layer };
      if (layer.maskB64) {
        copy.mask = Array.from(b64ToUint8(layer.maskB64));
        delete copy.maskB64;
      }
      return copy;
    });
  }
  if (stored.maskB64) {
    out.mask = Array.from(b64ToUint8(stored.maskB64));
    delete out.maskB64;
  }
  const expected = (out.width || 0) * (out.height || 0);
  if (out.mask?.length && expected > 0 && out.mask.length !== expected) {
    delete out.mask;
    out.maskStale = true;
  }
  return cloneEmbossTraceRects(out);
}

function stateForSession() {
  const snap = {};
  for (const key of Object.keys(DEFAULTS)) snap[key] = state[key];
  snap.shape = state.shape;
  snap.displayUnit = normalizeDisplayUnit(state.displayUnit);
  if (state.embossTraceRects) {
    snap.embossTraceRects = serializeEmbossTraceRects(state.embossTraceRects);
  }
  return snap;
}

/** Undo snapshots — omit trace polygon blobs (589 islands JSON.stringify was freezing the tab). */
function stateForHistory() {
  const snap = {};
  for (const key of Object.keys(DEFAULTS)) snap[key] = state[key];
  snap.shape = state.shape;
  snap.displayUnit = normalizeDisplayUnit(state.displayUnit);
  snap.embossTraceEnabled = state.embossTraceEnabled;
  if (state.embossTraceRects) {
    snap.embossTraceRects = {
      width: state.embossTraceRects.width,
      height: state.embossTraceRects.height,
      mode: state.embossTraceRects.mode,
      shapeGroupsUnited: !!state.embossTraceRects.shapeGroupsUnited,
      traceGeometryRef: true,
    };
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

async function applySessionPayload(payload) {
  if (!payload?.state) return false;

  for (const key of Object.keys(DEFAULTS)) {
    if (payload.state[key] !== undefined) state[key] = payload.state[key];
  }
  if (payload.state.shape) state.shape = payload.state.shape;
  if (state.shape === "stubbyHolder") state.shape = "circle";
  if (payload.state.displayUnit) state.displayUnit = normalizeDisplayUnit(payload.state.displayUnit);
  if (state.shape === "fatQuarters") state.shape = "rounded";
  if (state.insertMount === "fixed") state.joinerEnabled = false;
  if (payload.state.embossTraceRects) {
    state.embossTraceRects = deserializeEmbossTraceRects(payload.state.embossTraceRects);
  }
  state.lidType = normalizeLidType(state.lidType, state.shape);
  ensureStateAccentBands(state);

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
      await importSvgFile(payload.state.embossSvgText, {
        fileName: payload.state.embossSvgFileName || "restored.svg",
      });
    } catch (err) {
      console.warn("Could not re-import saved SVG:", err);
    }
  }
  return true;
}

async function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    await applySessionPayload(payload);
    return payload;
  } catch (err) {
    console.warn("MakerDeck could not restore session:", err);
    return null;
  }
}

function formatLibraryError(err) {
  const raw = err?.message || err?.error || String(err || "");
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.detail) return String(parsed.detail);
  } catch {
    /* plain text */
  }
  return raw;
}

async function compressDataUrl(dataUrl, maxDim = 480, quality = 0.72) {
  if (!dataUrl?.startsWith("data:")) return "";
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        resolve("");
        return;
      }
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve("");
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

async function archiveBodyExport(blob, filename, { format, stamp, saveToLibrary = false }) {
  if (!saveToLibrary || !libraryApiAvailable()) return null;
  try {
    renderer.render(scene, camera);
    const thumbnail = await compressDataUrl(capturePreviewThumbnail(renderer), 480, 0.72);
    const traceRaw = traceSourceCanvas ? traceSourceCanvas.toDataURL("image/jpeg", 0.82) : null;
    const traceImage = traceRaw ? await compressDataUrl(traceRaw, 640, 0.7) : null;
    const payload = {
      blob,
      filename,
      format,
      part: "body",
      stamp,
      thumbnail,
      traceImage,
      state: stateForSession(),
    };
    try {
      const result = await saveExportToLibrary(payload);
      return result?.design || null;
    } catch (err) {
      if (traceImage) {
        const result = await saveExportToLibrary({ ...payload, traceImage: null });
        return result?.design || null;
      }
      throw err;
    }
  } catch (err) {
    console.warn("MakerDeck design library save failed:", err);
    return { error: formatLibraryError(err) };
  }
}

function notifyLibrarySaved(design) {
  if (currentTabId === "library") void refreshLibraryUi();
  if (!design) return;
  const status = document.getElementById("library-status");
  if (status && currentTabId === "library") {
    status.textContent = `Saved “${design.name || "design"}”.`;
  }
}

function formatLibraryWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

async function refreshLibraryUi() {
  const grid = document.getElementById("library-grid");
  const status = document.getElementById("library-status");
  if (!grid) return;
  if (!libraryApiAvailable()) {
    grid.innerHTML = "";
    if (status) status.textContent = "Design library needs MakerDeck inside Flightdeck (not a local file).";
    return;
  }
  if (status) status.textContent = "Loading…";
  try {
    const designs = await listLibraryDesigns(48);
    grid.innerHTML = "";
    if (!designs.length) {
      if (status) status.textContent = "No saved designs yet — download a body STL or 3MF to add one.";
      return;
    }
    for (const design of designs) {
      const card = document.createElement("article");
      card.className = "library-card";
      const thumb = document.createElement("div");
      thumb.className = "library-thumb";
      if (design.thumbnail) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = `/api/makerdeck/designs/${encodeURIComponent(design.id)}/thumbnail`;
        img.alt = "";
        thumb.appendChild(img);
      } else if (design.has_thumbnail) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = `/api/makerdeck/designs/${encodeURIComponent(design.id)}/thumbnail`;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        thumb.textContent = (design.format || "?").toUpperCase();
      }
      const body = document.createElement("div");
      body.className = "library-card-body";
      const title = document.createElement("h3");
      title.className = "library-card-title";
      title.textContent = design.name || "Untitled";
      const meta = document.createElement("p");
      meta.className = "library-card-meta";
      const serial = design.watermark_serial ? ` · #${String(design.watermark_serial).padStart(4, "0")}` : "";
      meta.textContent = `${(design.format || "").toUpperCase()}${serial} · ${formatLibraryWhen(design.exported_at)}`;
      const actions = document.createElement("div");
      actions.className = "library-card-actions";
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "btn btn-primary btn-sm";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", () => void loadLibraryDesign(design.id));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-secondary btn-sm";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => void removeLibraryDesign(design.id));
      actions.append(loadBtn, delBtn);
      body.append(title, meta, actions);
      card.append(thumb, body);
      grid.appendChild(card);
    }
    if (status) status.textContent = `${designs.length} saved design${designs.length === 1 ? "" : "s"}`;
  } catch (err) {
    if (status) status.textContent = err?.message || "Could not load design library.";
    grid.innerHTML = "";
  }
}

async function loadLibraryDesign(designId) {
  const status = document.getElementById("library-status");
  if (status) status.textContent = "Loading design…";
  try {
    const payload = await fetchDesignParams(designId);
    sessionBooting = true;
    await applySessionPayload({
      state: payload.state,
      traceImage: payload.traceImage || null,
    });
    sessionBooting = false;
    syncUiFromState();
    updateDecorUi();
    syncArtEditorUi();
    updateTraceUi();
    rebuild();
    if (meshCache) fitCamera(meshCache.meta);
    pushAppHistory();
    scheduleDeferredRestoreTrace();
    if (status) status.textContent = `Loaded “${payload.name || "design"}”.`;
    setTab("design");
  } catch (err) {
    sessionBooting = false;
    if (status) status.textContent = err?.message || "Could not load design.";
  }
}

async function removeLibraryDesign(designId) {
  if (!confirm("Delete this design from the library?")) return;
  try {
    await deleteLibraryDesign(designId);
    await refreshLibraryUi();
  } catch (err) {
    const status = document.getElementById("library-status");
    if (status) status.textContent = err?.message || "Delete failed.";
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
  syncSliderUi("lid-lip", "lidLipDepth", { min: 0, max: 8, value: state.lidLipDepth ?? 0, parseKind: "float" });
  syncSliderUi("lid-clearance", "lidClearance", { min: 0.15, max: 0.8, value: state.lidClearance, parseKind: "float" });
  syncSliderUi("joiner-width", "joinerWidth", { min: 5, max: 22, value: state.joinerWidth, parseKind: "float" });
  syncSliderUi("joiner-neck", "joinerNeck", { min: 3, max: 16, value: state.joinerNeck, parseKind: "float" });
  syncSliderUi("joiner-protrusion", "joinerProtrusion", { min: 2, max: 10, value: state.joinerProtrusion, parseKind: "float" });
  syncSliderUi("insert-thickness", "insertThickness", { min: 1.2, max: 4, value: state.insertThickness, parseKind: "float" });
  syncSliderUi("insert-clearance", "insertClearance", { min: 0.15, max: 1, value: state.insertClearance, parseKind: "float" });
  syncSliderUi("insert-slot-depth", "insertSlotDepth", { min: 1, max: 4, value: state.insertSlotDepth ?? 2, parseKind: "float" });
  syncSliderUi("insert-count", "insertCount", { min: 1, max: 4, value: state.insertCount ?? 1, parseKind: "int" });
  syncInsertCountHint();
  syncInsertTopClearanceUi();
  syncSliderUi("emboss-depth", "embossDepth", { min: 0.3, max: 2, value: state.embossDepth, parseKind: "float" });
  syncSliderUi("emboss-height", "embossHeight", { min: 3, max: 48, value: state.embossHeight, parseKind: "float" });
  syncSliderUi("emboss-arc-radius", "embossArcRadius", { min: 0, max: 150, value: state.embossArcRadius ?? 0, parseKind: "float" });
  syncSliderUi("emboss-arc-curve", "embossArcCurve", { min: 0, max: 100, value: state.embossArcCurve ?? 60, parseKind: "int" });
  syncSliderUi("emboss-arc-sweep", "embossArcSweep", { min: 40, max: 360, value: state.embossArcSweep ?? 220, parseKind: "float" });
  syncSliderUi("emboss-arc-start", "embossArcStartDeg", { min: -180, max: 180, value: state.embossArcStartDeg ?? -90, parseKind: "float" });
  syncSliderUi("emboss-arc-tilt", "embossArcTilt", { min: -180, max: 180, value: state.embossArcTilt ?? 0, parseKind: "float" });
  syncSliderUi("emboss-arc-spacing", "embossArcSpacing", { min: 0.7, max: 1.8, value: state.embossArcSpacing ?? 1, parseKind: "float" });
  syncArcRadiusUi();
  syncSliderUi("trace-threshold", "traceThreshold", { min: 20, max: 254, value: state.traceThreshold });
  syncSliderUi("trace-size", "embossTraceSize", { min: 6, max: 56, value: state.embossTraceSize, parseKind: "float" });
  syncSliderUi("art-rotation", "decorRotation", { min: -180, max: 180, value: state.decorRotation ?? 0, parseKind: "float" });
  syncSliderUi("art-offset-x", "decorOffsetX", { min: -80, max: 80, value: state.decorOffsetX ?? 0, parseKind: "float" });
  syncSliderUi("art-offset-y", "decorOffsetY", { min: -80, max: 80, value: state.decorOffsetY ?? 0, parseKind: "float" });
  syncSliderUi("text-offset-x", "textOffsetX", { min: -80, max: 80, value: state.textOffsetX ?? 0, parseKind: "float" });
  syncSliderUi("text-offset-y", "textOffsetY", { min: -80, max: 80, value: state.textOffsetY ?? 0, parseKind: "float" });
  syncSliderUi("text-rotation", "textRotation", { min: -180, max: 180, value: state.textRotation ?? 0, parseKind: "float" });
  syncSliderUi("vase-diameter", "vaseDiameter", { min: 30, max: 220, value: state.vaseDiameter, parseKind: "float" });
  syncSliderUi("vase-height", "vaseHeight", { min: 20, max: 280, value: state.vaseHeight, parseKind: "float" });
  syncSliderUi("vase-wall", "vaseWall", { min: 1.0, max: 3, value: state.vaseWall, parseKind: "float" });
  syncSliderUi("vase-floor", "vaseFloor", { min: 1.4, max: 6, value: state.vaseFloor, parseKind: "float" });
  syncSliderUi("vase-drainage-size", "vaseDrainageSize", { min: 4, max: 30, value: state.vaseDrainageSize, parseKind: "float" });
  syncSliderUi("vase-flutes", "vaseFlutes", { min: 0, max: 24, value: state.vaseFlutes ?? 0 });
  syncSliderUi("vase-flute-depth", "vaseFluteDepth", { min: 0.5, max: 6, value: state.vaseFluteDepth ?? 2, parseKind: "float" });
  syncSliderUi("vase-twist", "vaseTwist", { min: -180, max: 180, value: state.vaseTwist ?? 0, parseKind: "float" });
  syncSliderUi("vase-texture-depth", "vaseTextureDepth", { min: 0.3, max: 3, value: state.vaseTextureDepth ?? 1.2, parseKind: "float" });
  syncSliderUi("vase-texture-scale", "vaseTextureScale", { min: 6, max: 40, value: state.vaseTextureScale ?? 14, parseKind: "float" });
  syncSliderUi("profile-texture-depth", "vaseTextureDepth", { min: 0.3, max: 3, value: state.vaseTextureDepth ?? 1.2, parseKind: "float" });
  syncSliderUi("profile-texture-scale", "vaseTextureScale", { min: 6, max: 40, value: state.vaseTextureScale ?? 14, parseKind: "float" });
  const profileTextureSel = document.getElementById("profile-texture-style");
  if (profileTextureSel) profileTextureSel.value = state.vaseTextureStyle || "ripple";
  const profileTextureOn = document.getElementById("profile-texture-enabled");
  if (profileTextureOn) profileTextureOn.checked = !!state.vaseTextureEnabled;
  const vaseStyleSel = document.getElementById("vase-style");
  if (vaseStyleSel) vaseStyleSel.value = state.vaseStyle || "cylinder";
  const vaseRimSel = document.getElementById("vase-rim");
  if (vaseRimSel) vaseRimSel.value = state.vaseRim || "square";
  const vaseTextureSel = document.getElementById("vase-texture-style");
  if (vaseTextureSel) vaseTextureSel.value = state.vaseTextureStyle || "ripple";
  const vaseTextureOn = document.getElementById("vase-texture-enabled");
  if (vaseTextureOn) vaseTextureOn.checked = !!state.vaseTextureEnabled;
  document.getElementById("vase-drainage").checked = !!state.vaseDrainage;
  document.getElementById("vase-saucer").checked = !!state.vaseSaucerEnabled;

  document.getElementById("emboss-text").value = state.embossText || "";
  syncColorPickersFromState();
  syncTextAlignUi();
  syncTextLayoutUi();
  const embossFontSelect = document.getElementById("emboss-font");
  if (embossFontSelect) embossFontSelect.value = state.embossFont || "bebas";
  updateEmbossTextPreviewStyle();
  updateLabels();
  syncLidTypeSelect();
  updateLidUi();
  updateJoinerUi();
  updateDecorUi();
  updateTraceUi();
}

function rebuildMesh() {
  const params = buildParams();

  const nextCache = buildContainer(params);
  if (nextCache.meta.shape === "rect" && state.shape === "rounded") {
    nextCache.meta.shape = "rounded";
  }
  if (state.shape === "hex" && state.sides !== 6) {
    nextCache.meta.shape = "polygon";
  }
  if (PRESET_SHAPES.has(state.shape)) {
    nextCache.meta.shape = state.shape;
  }

  const bodySource = previewBodySource(nextCache);
  if (!bodySource?.positions?.length || !bodySource?.indices?.length) {
    throw new Error(`Empty ${state.shape || "box"} geometry`);
  }
  const bodyGeom = toBufferGeometry(THREE, bodySource);

  let nextLidCache = null;
  let nextLidMesh = null;
  let nextLidGeom = null;
  if (state.lidEnabled && shapeSupportsLid(state.shape)) {
    nextLidCache = buildLid(params);
    if (!nextLidCache?.positions?.length || !nextLidCache?.indices?.length) {
      throw new Error("Empty lid geometry");
    }
    nextLidGeom = toBufferGeometry(THREE, previewLidSource(nextLidCache));
    nextLidMesh = new THREE.Mesh(nextLidGeom, lidMaterial);
    nextLidMesh.castShadow = true;
    nextLidMesh.receiveShadow = true;
    nextLidMesh.renderOrder = 4;
    lidMaterial.polygonOffsetFactor = 2;
    lidMaterial.polygonOffsetUnits = 3;
  }

  if (bodyMesh) {
    previewRoot.remove(bodyMesh);
    bodyMesh.geometry.dispose();
  }
  if (edgeLines) {
    previewRoot.remove(edgeLines);
    edgeLines.geometry.dispose();
  }
  disposeAccentPreview();
  disposeInsertPreview();
  disposeLabelPreview();
  disposeArtPreview();
  disposeLidPreview();

  meshCache = nextCache;
  lidCache = nextLidCache;

  applyBoxPreviewColor();
  bodyMesh = new THREE.Mesh(bodyGeom, material);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.renderOrder = 2;
  previewRoot.add(bodyMesh);

  try {
    const edges = new THREE.EdgesGeometry(bodyGeom, 28);
    edgeLines = new THREE.LineSegments(edges, edgeMaterial);
    edgeLines.renderOrder = 3;
    edgeLines.visible = previewXRayOn;
    previewRoot.add(edgeLines);
  } catch {
    edgeLines = null;
  }

  if (meshCache.accentMeshes?.length) {
    meshCache.accentMeshes.forEach((part) => {
      const mat = buildAccentMaterial(part.color);
      const accentGeom = toBufferGeometry(THREE, part.mesh);
      const mesh = new THREE.Mesh(accentGeom, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = part.onTop ? 8 : 6;
      previewRoot.add(mesh);
      let edgeLines = null;
      try {
        const accentEdges = new THREE.EdgesGeometry(accentGeom, 18);
        edgeLines = new THREE.LineSegments(accentEdges, edgeMaterial);
        edgeLines.renderOrder = part.onTop ? 9 : 7;
        edgeLines.visible = previewXRayOn;
        previewRoot.add(edgeLines);
      } catch {
        edgeLines = null;
      }
      accentPreviewParts.push({ mesh, edgeLines, material: mat });
    });
    applyAccentPreviewColors();
    setAccentPreviewXRay(previewXRayOn);
  }

  if (meshCache.insertMesh) {
    insertCache = meshCache.insertMesh;
    applyInsertPreviewColor();
    const insertGeom = toBufferGeometry(THREE, insertCache);
    insertMesh = new THREE.Mesh(insertGeom, insertMaterial);
    insertMesh.castShadow = false;
    insertMesh.receiveShadow = false;
    insertMesh.renderOrder = 5;
    previewRoot.add(insertMesh);
  }

  if (nextLidMesh) {
    lidMesh = nextLidMesh;
    previewRoot.add(lidMesh);
    resetLidPreviewPose();
    buildLidGuideLoops();
  }

  mountArtPreviewIfNeeded();
  mountEmbossLabelPreviewIfNeeded();

  if (!bodyMesh?.parent) {
    throw new Error("Preview body not attached after rebuild");
  }

  debossCutterCache = state.embossFace === "lid"
    ? (lidCache?.debossCutterMesh || null)
    : (meshCache.debossCutterMesh || null);
  updateEmbossDebossUi();

  updateStats(meshCache.meta);
  updateLabels();
  updateLidUi();
  updateJoinerUi();
  updateDecorUi();
  updateVaseUiVisibility();
}

function updateStats(meta) {
  const { outer, cavityMl, materialMl, estGrams } = meta;
  const u = displayUnitLabel();
  const fmt = (n) => fmtDimReadout(n);
  if (meta.shape === "vase") {
    document.getElementById("stat-outer").textContent = `${meta.styleLabel || "Vase"} · ⌀${fmt(outer.w)} × ${fmt(outer.h)} ${u}`;
  } else if (meta.shape === "circle") {
    document.getElementById("stat-outer").textContent = `⌀${fmt(outer.w)} × ${fmt(outer.h)} ${u}`;
  } else if (meta.shape === "oval") {
    document.getElementById("stat-outer").textContent = `Oval ${fmt(outer.w)} × ${fmt(outer.d)} × ${fmt(outer.h)} ${u}`;
  } else if (PRESET_SHAPES.has(meta.shape)) {
    if (meta.shape === "star") {
      document.getElementById("stat-outer").textContent = `${meta.starPoints}-pt ${fmt(outer.w)} × ${fmt(outer.h)} ${u}`;
    } else {
      document.getElementById("stat-outer").textContent = `${fmt(outer.w)} × ${fmt(outer.d)} × ${fmt(outer.h)} ${u}`;
    }
  } else if (meta.shape === "hex" || meta.shape === "polygon") {
    const sideLabel = meta.sides === 6 ? "hex" : `${meta.sides}-gon`;
    document.getElementById("stat-outer").textContent = `${sideLabel} ${fmt(outer.w)} flat × ${fmt(outer.h)} ${u}`;
  } else {
    document.getElementById("stat-outer").textContent = `${fmt(outer.w)} × ${fmt(outer.d)} × ${fmt(outer.h)} ${u}`;
  }
  document.getElementById("stat-cavity").textContent = `${cavityMl} ml`;
  document.getElementById("stat-material").textContent = `${materialMl} ml`;
  document.getElementById("stat-grams").textContent = `~${estGrams} g`;
}

function syncSliderUi(sliderId, key, { min, max, value, parseKind = "int" }) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;
  const out = document.querySelector(`.value-edit[data-slider="${sliderId}"]`);
  let display;
  if (isLengthKey(key)) {
    display = applyLengthSliderRange(slider, min, max, value);
    if (key) state[key] = parseKind === "float" ? parseFloat(value) : Number(value);
  } else {
    slider.min = String(min);
    slider.max = String(max);
    display = formatSliderValue(value, slider.step);
    slider.value = display;
    if (key) state[key] = parseKind === "float" ? parseFloat(value) : Number(value);
  }
  if (out) out.textContent = display;
}

function setArtSlider(sliderId, value, parseKind = "float") {
  const slider = document.getElementById(sliderId);
  const out = document.querySelector(`.value-edit[data-slider="${sliderId}"]`);
  if (!slider) return;
  const key = out?.dataset?.key;
  let display;
  if (isLengthKey(key)) {
    const mmMin = parseFloat(slider.dataset.mmMin ?? slider.min);
    const mmMax = parseFloat(slider.dataset.mmMax ?? slider.max);
    display = applyLengthSliderRange(slider, mmMin, mmMax, value);
  } else {
    display = formatSliderValue(value, slider.step);
    slider.value = display;
  }
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
  canister: {
    width: { min: 70, max: 160 },
    depth: { min: 70, max: 160 },
    height: { min: 80, max: 250 },
  },
};

function applyCanisterContent(content, { rebuildNow = true } = {}) {
  const key = CANISTER_CONTENT_LABELS[content] !== undefined ? content : "custom";
  state.canisterContent = key;
  if (key !== "custom") {
    state.embossText = canisterEmbossText(key);
    const meta = CANISTER_CONTENT_META[key];
    if ((isStackSetShape() || isSquareSetShape()) && meta) {
      state.boxColor = meta.color;
      state.lidColor = meta.lidColor;
      state.embossTextColor = meta.textColor;
      if (meta.artColor) state.embossArtColor = meta.artColor;
      setColorPickerValue(document.getElementById("box-color-picker"), state.boxColor);
      setColorPickerValue(document.getElementById("lid-color-picker"), effectiveLidColor());
      setColorPickerValue(document.getElementById("text-color-picker"), state.embossTextColor);
      setColorPickerValue(document.getElementById("art-color-picker"), state.embossArtColor || "#4a3728");
    }
  }
  const sel = document.getElementById("canister-content");
  if (sel) sel.value = key;
  if (key === "biscuits" && isCanisterShape() && !isStackSetShape()) {
    applyCanisterSize("xl", { rebuildNow: false });
  }
  syncCanisterControlsFromState();
  if (rebuildNow) {
    rebuild();
    pushAppHistory();
  }
}

function applyCanisterSize(size, { rebuildNow = true } = {}) {
  const key = CANISTER_SIZE_TABLE[size] ? size : "md";
  state.canisterSize = key;
  const kind = state.shape === "canisterJar" || state.shape === "canisterStack" ? "jar" : "square";
  const dims = CANISTER_SIZE_TABLE[key][kind];
  state.innerWidth = dims.innerWidth;
  state.innerDepth = dims.innerDepth;
  state.innerHeight = dims.innerHeight;
  document.querySelectorAll("[data-canister-size]").forEach((btn) => {
    const entry = CANISTER_SIZE_TABLE[btn.dataset.canisterSize];
    const active = btn.dataset.canisterSize === key;
    btn.classList.toggle("active", active);
    if (entry?.label) btn.textContent = entry.label;
    if (entry?.hint) btn.title = entry.hint;
  });
  syncShapeControlsFromState();
  if (rebuildNow) {
    rebuild();
    pushAppHistory();
  }
}

function syncCanisterControlsFromState() {
  const on = isCanisterShape();
  const kitchenTrio = isKitchenTrioShape();
  document.getElementById("section-canister")?.classList.toggle("hidden", !on);
  document.getElementById("canister-size-row")?.classList.toggle("hidden", kitchenTrio);
  document.getElementById("canister-stack-row")?.classList.toggle("hidden", !kitchenTrio);
  document.querySelector(".canister-food-hint")?.classList.toggle("hidden", kitchenTrio);
  document.getElementById("canister-stack-hint")?.classList.toggle("hidden", !isStackSetShape());
  document.getElementById("canister-square-set-hint")?.classList.toggle("hidden", !isSquareSetShape());
  if (!on) return;
  const sel = document.getElementById("canister-content");
  if (sel) sel.value = state.canisterContent || "custom";
  document.querySelectorAll("[data-canister-size]").forEach((btn) => {
    const entry = CANISTER_SIZE_TABLE[btn.dataset.canisterSize];
    const active = btn.dataset.canisterSize === (state.canisterSize || "md");
    btn.classList.toggle("active", active);
    if (entry?.label) btn.textContent = entry.label;
    if (entry?.hint) btn.title = entry.hint;
  });
  document.querySelectorAll("[data-stack-member]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.stackMember === (state.canisterContent || "coffee"));
  });
}

function applyPreset(shape) {
  const cfg = PRESET_CONFIG[shape];
  if (!cfg) return;
  cancelPendingArtRebuild();
  stopLidAnimation(true);
  if (previewXRayOn) setPreviewXRayMode(false);
  state.shape = shape;
  Object.assign(state, cfg.preset);
  applySliderProfile(cfg.profile);
  if (shape === "pencilBox" || shape === "canisterSquare" || shape === "canisterSquareSet") {
    syncSliderUi("corner-radius", "cornerRadius", { min: 1, max: 24, value: state.cornerRadius ?? (shape === "pencilBox" ? 4 : 10), parseKind: "float" });
    syncSliderUi("lid-skirt", "lidSkirt", { min: 4, max: 25, value: state.lidSkirt ?? 12 });
    syncSliderUi("lid-thickness", "lidThickness", { min: 2, max: 6, value: state.lidThickness ?? 2.4, parseKind: "float" });
    syncSliderUi("lid-clearance", "lidClearance", { min: 0.15, max: 0.8, value: state.lidClearance ?? (shape === "pencilBox" ? 0.25 : 0.3), parseKind: "float" });
    if (shape === "pencilBox") {
      syncSliderUi("insert-thickness", "insertThickness", { min: 1.2, max: 4, value: state.insertThickness ?? 2.4, parseKind: "float" });
      syncSliderUi("insert-clearance", "insertClearance", { min: 0.15, max: 1, value: state.insertClearance ?? 0.35, parseKind: "float" });
    }
    if (shape === "canisterSquare" || shape === "canisterSquareSet") {
      syncSliderUi("lid-lip", "lidLipDepth", { min: 0, max: 8, value: state.lidLipDepth ?? 2.5, parseKind: "float" });
    }
  }
  if (shape === "canisterJar" || shape === "canisterStack") {
    syncSliderUi("lid-skirt", "lidSkirt", { min: 4, max: 25, value: state.lidSkirt ?? 10 });
    syncSliderUi("lid-thickness", "lidThickness", { min: 2, max: 6, value: state.lidThickness ?? 2.4, parseKind: "float" });
    syncSliderUi("lid-clearance", "lidClearance", { min: 0.15, max: 0.8, value: state.lidClearance ?? 0.3, parseKind: "float" });
    syncSliderUi("lid-lip", "lidLipDepth", { min: 0, max: 8, value: state.lidLipDepth ?? (shape === "canisterStack" ? 0 : 2.5), parseKind: "float" });
  }
  if (isCanisterShape(shape)) {
    document.getElementById("stackable-enabled").checked = !!state.stackableEnabled;
    syncCanisterControlsFromState();
    if (isKitchenTrioShape(shape)) {
      applyCanisterSize("md", { rebuildNow: false });
      applyCanisterContent(state.canisterContent || "coffee", { rebuildNow: false });
    }
  }
  if (state.embossFace === "lid" && !state.lidEnabled) {
    state.embossFace = "front";
  }
  document.getElementById("lid-enabled").checked = !!state.lidEnabled;
  document.getElementById("lid-type").value = state.lidType || "slip";
  document.getElementById("insert-enabled").checked = !!state.insertEnabled;
}

/** Leaving a preset (pencil box, teardrop, etc.) — drop lid + case dimensions back to a normal box. */
function resetFromPresetToBasic(shape) {
  const d = DEFAULTS;
  state.shape = shape;
  state.innerWidth = d.innerWidth;
  state.innerDepth = d.innerDepth;
  state.innerHeight = d.innerHeight;
  state.cornerRadius = shape === "rounded" ? d.cornerRadius : 0;
  state.vertexFillet = d.vertexFillet;
  state.sides = d.sides;
  state.lidEnabled = false;
  state.lidType = d.lidType;
  state.lidSkirt = d.lidSkirt;
  state.lidThickness = d.lidThickness;
  state.lidClearance = d.lidClearance;
  state.lidLipDepth = d.lidLipDepth;
  state.lidGasketEnabled = d.lidGasketEnabled;
  state.lidGasketWidth = d.lidGasketWidth;
  state.lidGasketDepth = d.lidGasketDepth;
  state.lidGasketExportRing = d.lidGasketExportRing !== false;
  state.stackableEnabled = d.stackableEnabled;
  state.stackStyle = d.stackStyle;
  state.lidColor = d.lidColor;
  if (state.embossFace === "lid") state.embossFace = "front";
  applySliderProfile("default");
  if (shape === "rounded") {
    syncSliderUi("corner-radius", "cornerRadius", { min: 1, max: 24, value: state.cornerRadius, parseKind: "float" });
  }
}

function applyVaseShape() {
  state.shape = "vase";
  state.lidEnabled = false;
  state.innerWidth = DEFAULTS.vaseDiameter ?? state.vaseDiameter;
  applySliderProfile("default");
  syncSliderUi("vase-diameter", "vaseDiameter", { min: 30, max: 220, value: state.vaseDiameter, parseKind: "float" });
  syncSliderUi("vase-height", "vaseHeight", { min: 20, max: 280, value: state.vaseHeight, parseKind: "float" });
}

function syncShapeControlsFromState() {
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
  syncSliderUi("lid-lip", "lidLipDepth", { min: 0, max: 8, value: state.lidLipDepth ?? 0, parseKind: "float" });
  syncSliderUi("lid-clearance", "lidClearance", { min: 0.15, max: 0.8, value: state.lidClearance, parseKind: "float" });
  document.getElementById("lid-enabled").checked = !!state.lidEnabled;
  document.getElementById("lid-type").value = state.lidType || "slip";
  updateLabels();
}

function selectShape(next) {
  cancelPendingArtRebuild();
  stopLidAnimation(true);
  if (previewXRayOn) setPreviewXRayMode(false);

  const prev = state.shape;
  const leavingPreset = PRESET_SHAPES.has(prev) || prev === "vase";

  if (next === "vase") {
    applyVaseShape();
  } else if (PRESET_CONFIG[next]) {
    state.shape = next;
    applyPreset(next);
  } else if (leavingPreset) {
    resetFromPresetToBasic(next);
  } else {
    state.shape = next;
    applySliderProfile("default");
    if (next === "oval" && prev === "circle") {
      state.innerDepth = Math.max(20, Math.round(state.innerWidth * 0.625));
    }
    if (next === "rounded") {
      syncSliderUi("corner-radius", "cornerRadius", { min: 1, max: 24, value: state.cornerRadius ?? DEFAULTS.cornerRadius, parseKind: "float" });
    }
  }

  if (shapeSupportsProfileArt(next)) {
    // Keep front as default — wrap is opt-in (coffee-bag flat face is the safe baseline).
  } else if (state.embossFace === "wrap") {
    state.embossFace = "front";
  }

  syncLidTypeSelect();
  syncShapeControlsFromState();
  syncCanisterControlsFromState();
  updateVaseUiVisibility();
  updateLidUi();
  updateDecorUi();
  updateJoinerUi();
  rebuild();
  pushAppHistory();
  if (meshCache) fitCamera(meshCache.meta);
}

function syncLidTypeSelect() {
  const sel = document.getElementById("lid-type");
  if (!sel) return;
  const types = LID_TYPES.filter((t) => !t.circleOnly || state.shape === "circle" || state.shape === "canisterJar" || state.shape === "canisterStack");
  sel.innerHTML = types.map(
    (t) => `<option value="${t.id}">${t.optionLabel || t.label}</option>`,
  ).join("");
  state.lidType = normalizeLidType(state.lidType, state.shape);
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
  const circle = shape === "circle" || shape === "canisterJar" || shape === "canisterStack";
  const oval = shape === "oval";
  const rounded = shape === "rounded";
  const preset = PRESET_SHAPES.has(shape);
  const poly = hex;
  const star = shape === "star";
  const heart = shape === "heart";
  const pencilLike = shape === "pencil" || shape === "pencilBox";
  const pencilBox = shape === "pencilBox";
  const canisterSquare = shape === "canisterSquare" || shape === "canisterSquareSet";

  document.getElementById("label-width").textContent = pencilLike
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
    pencilBox: "Case size",
    teardrop: "Drop size",
    star: "Star size",
    heart: "Heart size",
    canisterSquare: "Canister size",
    canisterSquareSet: "Square set size",
    canisterJar: "Jar size",
    canisterStack: "Stack jar size",
  };
  document.getElementById("label-inner-size").innerHTML = sizeHeading[shape]
    ? `${sizeHeading[shape]} ${unitLenSpan()}`
    : circle
      ? `Size ${unitLenSpan()}`
      : hex
        ? `Flat size ${unitLenSpan()}`
        : `Inner size ${unitLenSpan()}`;

  document.getElementById("field-depth").classList.toggle("hidden", hex || circle || star);
  document.getElementById("field-corner").classList.toggle("hidden", !rounded && !pencilBox && !canisterSquare);
  document.getElementById("field-sides").classList.toggle("hidden", !poly || pencilBox);
  document.getElementById("field-vertex-fillet").classList.toggle("hidden", circle || oval || rounded || (preset && !star && !heart && !pencilBox && !canisterSquare));
  document.getElementById("section-edges").classList.toggle("hidden", preset && !star && !heart && !pencilBox && !canisterSquare);

  const filletLabel = document.getElementById("label-vertex-fillet");
  filletLabel.textContent = poly ? "Vertex fillet" : "Edge fillet";

  updateDimensionTabOrder();
  updateDimensionAriaLabels();
}

function updateLidUi() {
  const supported = shapeSupportsLid(state.shape);
  const on = state.lidEnabled && supported;
  const lidType = normalizeLidType(state.lidType, state.shape);
  const type = LID_TYPES.find((t) => t.id === lidType) || LID_TYPES[0];
  const isFlat = lidType === "flat";
  const lipOn = isFlat && (state.lidLipDepth ?? 0) > 0.4;
  const gasketOn = isFlat && !!state.lidGasketEnabled;
  const gasketExportOn = gasketOn && state.lidGasketExportRing !== false;
  document.getElementById("lid-enabled").checked = !!state.lidEnabled && supported;
  document.getElementById("lid-type").value = type.id;
  document.getElementById("btn-lid-preview-fit").classList.toggle("hidden", !on);
  document.getElementById("lid-xray-hint")?.classList.toggle("hidden", !on);
  document.getElementById("field-lid-type").classList.toggle("hidden", !on);
  document.getElementById("field-lid-skirt").classList.toggle("hidden", !on || isFlat);
  document.getElementById("field-lid-thickness").classList.toggle("hidden", !on);
  document.getElementById("field-lid-clearance").classList.toggle("hidden", !on || (isFlat && !lipOn));
  document.getElementById("field-lid-lip")?.classList.toggle("hidden", !on || !isFlat);
  document.getElementById("field-lid-gasket")?.classList.toggle("hidden", !on || !isFlat);
  document.getElementById("field-lid-gasket-width")?.classList.toggle("hidden", !on || !isFlat || !gasketOn);
  document.getElementById("field-lid-gasket-depth")?.classList.toggle("hidden", !on || !isFlat || !gasketOn);
  document.getElementById("field-lid-gasket-export")?.classList.toggle("hidden", !on || !isFlat || !gasketOn);
  document.getElementById("lid-gasket-hint")?.classList.toggle("hidden", !on || !isFlat || !gasketOn);
  document.getElementById("lid-gasket-export-hint")?.classList.toggle("hidden", !on || !isFlat || !gasketOn);
  const gasketToggle = document.getElementById("lid-gasket-enabled");
  if (gasketToggle) gasketToggle.checked = gasketOn;
  const gasketExportToggle = document.getElementById("lid-gasket-export-ring");
  if (gasketExportToggle) gasketExportToggle.checked = gasketExportOn;
  if (isFlat) {
    syncSliderUi("lid-gasket-width", "lidGasketWidth", { min: 1.2, max: 4, value: state.lidGasketWidth ?? 2, parseKind: "float" });
    syncSliderUi("lid-gasket-depth", "lidGasketDepth", { min: 0.6, max: 2.5, value: state.lidGasketDepth ?? 1.2, parseKind: "float" });
  }
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
  document.getElementById("lid-tray-hint")?.classList.toggle(
    "hidden",
    !(on && isFlat && state.stackableEnabled && isCanisterShape() && (state.stackStyle || "hex") === "hex"),
  );
  document.getElementById("lid-nest-hint")?.classList.toggle(
    "hidden",
    !(on && isFlat && state.stackableEnabled && isStackSetShape()),
  );
  syncEmbossFaceUi();
  syncExportFormatOptions();
  syncInsertTopClearanceUi();
}

function joinerUiShape() {
  if (state.shape === "rounded") return "rounded";
  if (PRESET_SHAPES.has(state.shape)) return state.shape;
  return state.shape;
}

function decorUiShape() {
  if (shapeSupportsProfileArt(state.shape)) return state.shape;
  if (state.shape === "rounded") return "rounded";
  if (state.shape === "pencil") return "pencil";
  if (state.shape === "pencilBox") return "pencilBox";
  if (state.shape === "canisterSquare" || state.shape === "canisterSquareSet") return "canisterSquare";
  return state.shape === "rect" ? "rect" : null;
}

function artUiShape() {
  const d = decorUiShape();
  return d || (shapeSupportsArt(state.shape) ? state.shape : null);
}

function insertUiShape() {
  if (state.shape === "rounded") return "rounded";
  if (state.shape === "pencilBox") return "pencilBox";
  if (state.shape === "canisterSquare" || state.shape === "canisterSquareSet") return "canisterSquare";
  return state.shape === "rect" ? "rect" : null;
}

function normalizeRestoredTab(tabId) {
  if (tabId === "label" || tabId === "import") return "art";
  if (tabId === "hinge") return "lid";
  return tabId || "design";
}

function setTab(tabId) {
  tabId = normalizeRestoredTab(tabId);
  currentTabId = tabId;
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
  syncArtEditorUi();
  if (tabId === "library") void refreshLibraryUi();
}

function clearEmbossTrace() {
  state.embossTraceEnabled = false;
  state.embossTraceRects = null;
}

function cloneEmbossTraceRects(rects) {
  if (!rects) return null;
  const maskCopy = rects.mask?.length
    ? (rects.mask instanceof Uint8Array ? rects.mask.slice() : Uint8Array.from(rects.mask))
    : [];
  const silCopy = rects.silhouetteMask?.length
    ? (rects.silhouetteMask instanceof Uint8Array ? rects.silhouetteMask.slice() : Uint8Array.from(rects.silhouetteMask))
    : maskCopy;
  return {
    rects: rects.rects?.map((r) => ({ ...r })) || [],
    mask: maskCopy,
    silhouetteMask: silCopy,
    polygons: rects.polygons?.map((poly) => poly.map(([x, y]) => [x, y])) || [],
    shapeGroups: rects.shapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) || [],
    strokePaths: rects.strokePaths?.map((p) => p.map(([x, y]) => [x, y])) || [],
    strokeWidth: rects.strokeWidth,
    mode: rects.mode || "silhouette",
    autoTrace: !!rects.autoTrace,
    autoPickedMode: rects.autoPickedMode,
    colorLogo: !!rects.colorLogo,
    outlineRaster: !!rects.outlineRaster,
    outlineFallback: !!rects.outlineFallback,
    shapeGroupsUnited: !!rects.shapeGroupsUnited,
    rasterSimplified: !!rects.rasterSimplified,
    maskFillPct: rects.maskFillPct,
    rectCount: rects.rectCount,
    previewShapeGroups: null,
    multiColour: !!rects.multiColour,
    colorLayerCount: rects.colorLayerCount,
    colorLayers: cloneColourLayers(rects.colorLayers),
    width: rects.width,
    height: rects.height,
  };
}

function snapshotApp() {
  return {
    state: stateForHistory(),
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
  if (s.embossTraceRects?.traceGeometryRef) {
    if (!s.embossTraceEnabled) state.embossTraceRects = null;
  } else if (s.embossTraceRects) {
    state.embossTraceRects = deserializeEmbossTraceRects(s.embossTraceRects);
  } else if (!s.embossTraceEnabled) {
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
  state.embossSvgFileName = "";
  const svgFile = document.getElementById("svg-file");
  if (svgFile) svgFile.value = "";
  state.decorRotation = 0;
  state.decorOffsetX = 0;
  state.decorOffsetY = 0;
  state.textOffsetX = 0;
  state.textOffsetY = 0;
  state.textRotation = 0;
  state.embossArcTilt = 0;
  state.embossArcStartDeg = -90;
  state.embossArcPreset = "arch-up";
  state.embossArcCurve = 60;
  state.embossArcAdvanced = false;
  document.getElementById("emboss-text").value = "";
  document.getElementById("emboss-svg-enabled").checked = false;
  pushAppHistory();
  updateDecorUi();
  syncArtEditorUi();
  updateTraceUi();
  updateHistoryUi();
  rebuild();
  scheduleSaveSession();
}

let artSubPane = "graphic";

function setArtSubPane(pane) {
  artSubPane = pane === "text" ? "text" : "graphic";
  document.querySelectorAll(".art-subnav-btn").forEach((btn) => {
    const on = btn.dataset.artPane === artSubPane;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const graphicPane = document.getElementById("art-pane-graphic");
  const textPane = document.getElementById("art-pane-text");
  if (graphicPane) {
    graphicPane.hidden = artSubPane !== "graphic";
    graphicPane.classList.toggle("hidden", artSubPane !== "graphic");
  }
  if (textPane) {
    textPane.hidden = artSubPane !== "text";
    textPane.classList.toggle("hidden", artSubPane !== "text");
  }
}

function syncArtSubPane() {
  setArtSubPane(artSubPane);
}

function isArtTabActive() {
  const tab = document.querySelector('.tab[data-tab="art"]');
  return tab?.classList.contains("active") && !tab.disabled;
}

let artRebuildTimer = null;
let rebuildBusy = false;
let rebuildAgain = false;

function artRebuildDelayMs() {
  const layerCount = state.embossTraceRects?.colorLayers?.length || 0;
  if (state.embossTraceRects?.multiColour && layerCount > 1) return 320;
  if (state.embossTraceEnabled && state.embossTraceRects) return 200;
  return 120;
}

function scheduleArtRebuild(immediate = false) {
  clearTimeout(artRebuildTimer);
  const run = () => {
    artRebuildTimer = null;
    rebuild();
  };
  if (immediate) {
    run();
    return;
  }
  artRebuildTimer = setTimeout(run, artRebuildDelayMs());
}

function cancelPendingArtRebuild() {
  clearTimeout(artRebuildTimer);
  artRebuildTimer = null;
}

function syncArcRadiusUi() {
  const out = document.getElementById("out-emboss-arc-radius");
  const r = state.embossArcRadius ?? 0;
  if (out) {
    if (r > 0) {
      const slider = document.getElementById("emboss-arc-radius");
      const mmStep = slider ? ensureSliderMmStep(slider) : 1;
      const dStep = mmStep / displayUnitFactor();
      out.textContent = formatDisplayValue(mmToDisplay(r), dStep);
    } else {
      out.textContent = "Auto";
    }
  }
}

function syncArtArcRadiusSlider() {
  if (!meshCache) return;
  const params = buildParams();
  const face = params.embossFace || "front";
  const limits = arcRadiusLimits(meshCache.meta, face, params);
  const r = state.embossArcRadius ?? 0;
  const clamped = r > 0 ? Math.min(limits.max, Math.max(15, r)) : 0;
  if (r > 0 && state.embossArcRadius !== clamped) {
    state.embossArcRadius = clamped;
  }
  syncSliderUi("emboss-arc-radius", "embossArcRadius", {
    min: 0,
    max: limits.max,
    value: clamped,
    parseKind: "float",
  });
  syncArcRadiusUi();
}

function syncArtSizeSlider() {
  if (!meshCache) return;
  const params = buildParams();
  const face = params.embossFace || "front";
  const limits = textEmbossSizeLimits(meshCache.meta, face, params);
  const height = state.embossHeight ?? 7;
  const clamped = Math.min(limits.max, Math.max(limits.min, height));
  if (state.embossHeight !== clamped) {
    state.embossHeight = clamped;
  }
  syncSliderUi("emboss-height", "embossHeight", {
    min: limits.min,
    max: limits.max,
    value: clamped,
    parseKind: "float",
  });
}

function svgImportModeLabel(svgText, importMode = "vector") {
  if (importMode === "trace" || (state.embossTraceEnabled && state.embossSvgText?.trim())) {
    return "traced silhouette";
  }
  return parsedSvgHasFill(svgText) ? "filled vector" : "stroke vector";
}

function syncSvgImportUi() {
  const meta = document.getElementById("svg-import-meta");
  const importMeta = document.getElementById("art-import-meta");
  const loaded = state.embossSvgEnabled && !!state.embossSvgText?.trim();
  if (!loaded) {
    if (meta) {
      meta.textContent = "";
      meta.classList.add("hidden");
    }
    if (importMeta && !traceSourceCanvas) {
      importMeta.textContent = "";
      importMeta.classList.add("hidden");
    }
    return;
  }
  const mode = svgImportModeLabel(state.embossSvgText);
  const name = state.embossSvgFileName?.trim();
  const cache = state.embossFace === "lid" ? lidCache : meshCache;
  const hasMesh = !!(cache?.graphicColourParts?.length || cache?.graphicMesh?.positions?.length);
  let msg = name ? `${name} · ${mode}` : `SVG · ${mode}`;
  if (!hasMesh) msg += " · no mesh yet";
  else msg += " · on box";
  if (meta) {
    meta.textContent = msg;
    meta.classList.remove("hidden");
  }
  if (importMeta) {
    importMeta.textContent = msg;
    importMeta.classList.remove("hidden");
  }
}

function syncArtEditorUi() {
  const textOn = textHasInk(state.embossText);
  const traceOn = !!state.embossTraceEnabled;
  const svgOn = state.embossSvgEnabled && !!state.embossSvgText?.trim();
  const artOn = hasGraphicArt(buildParams());
  const hasContent = appliedHasArt(state) || textOn;

  document.getElementById("emboss-text").value = state.embossText || "";
  document.getElementById("emboss-face").value = state.embossFace || "front";
  document.getElementById("emboss-font").value = state.embossFont || "bebas";
  document.getElementById("emboss-deboss").checked = !!state.embossDeboss;
  syncEmbossFaceUi();
  setArtSlider("emboss-height", state.embossHeight ?? 7);
  setArtSlider("emboss-depth", state.embossDepth ?? 0.7);
  setArtSlider("art-rotation", Math.round((state.decorRotation ?? 0) * 10) / 10, "float");
  setArtSlider("art-offset-x", state.decorOffsetX ?? 0, "float");
  setArtSlider("art-offset-y", state.decorOffsetY ?? 0, "float");
  setArtSlider("text-offset-x", state.textOffsetX ?? 0, "float");
  setArtSlider("text-offset-y", state.textOffsetY ?? 0, "float");
  setArtSlider("text-rotation", Math.round((state.textRotation ?? 0) * 10) / 10, "float");
  setArtSlider("trace-size", state.embossTraceSize ?? 16);
  setArtSlider("emboss-arc-curve", state.embossArcCurve ?? 60);
  setArtSlider("emboss-arc-radius", state.embossArcRadius ?? 0);
  setArtSlider("emboss-arc-sweep", state.embossArcSweep ?? 220);
  setArtSlider("emboss-arc-start", state.embossArcStartDeg ?? -90, "float");
  setArtSlider("emboss-arc-tilt", Math.round((state.embossArcTilt ?? 0) * 10) / 10, "float");
  setArtSlider("emboss-arc-spacing", state.embossArcSpacing ?? 1, "float");
  syncArcRadiusUi();
  syncArtArcRadiusSlider();
  syncTextLayoutUi();
  updateEmbossTextPreviewStyle();
  updateEmbossDebossUi();

  document.getElementById("field-emboss-height")?.classList.remove("hidden");
  document.getElementById("field-trace-size").classList.toggle("hidden", !(traceOn || svgOn));
  document.getElementById("field-art-rotation").classList.toggle("hidden", !artOn);
  document.getElementById("field-art-offset-x").classList.toggle("hidden", !artOn);
  document.getElementById("field-art-offset-y").classList.toggle("hidden", !artOn);
  document.getElementById("field-text-transform-div")?.classList.toggle("hidden", !textOn);
  document.getElementById("field-text-offset-x")?.classList.toggle("hidden", !textOn);
  document.getElementById("field-text-offset-y")?.classList.toggle("hidden", !textOn);
  const arcOn = (state.embossTextLayout || "flat") === "arc";
  document.getElementById("field-text-rotation")?.classList.toggle("hidden", !textOn || arcOn);
  const wrapArt = shapeSupportsProfileArt(state.shape);
  const offsetXLabel = document.querySelector("#field-art-offset-x .field-label");
  const offsetYLabel = document.querySelector("#field-art-offset-y .field-label");
  if (offsetXLabel) {
    offsetXLabel.innerHTML = wrapArt
      ? `Graphic around wall ${unitLenSpan()}`
      : `Graphic left / right ${unitLenSpan()}`;
  }
  if (offsetYLabel) {
    offsetYLabel.innerHTML = wrapArt
      ? `Graphic height ${unitLenSpan()}`
      : `Graphic up / down ${unitLenSpan()}`;
  }
  syncArtSizeSlider();
  syncArtArcRadiusSlider();
  syncSvgImportUi();
  syncArtSubPane();
}

function pasteImageFromClipboard(e) {
  if (!isArtTabActive()) return;
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
    traceLastResult?.colorLayers?.length ||
    traceLastResult?.shapeGroups?.length ||
    traceLastResult?.strokePaths?.length ||
    traceLastResult?.polygons?.length ||
    traceLastResult?.rects?.length
  );
  document.getElementById("btn-trace").disabled = !hasImage;
  document.getElementById("btn-trace-apply").disabled = !hasTrace;
  document.getElementById("btn-trace-svg").disabled = !hasTrace;
  document.getElementById("btn-trace-clear").disabled = !(hasImage || hasTrace || state.embossTraceEnabled);
  document.getElementById("btn-trace-svg").classList.toggle("hidden", !hasTrace);
  document.getElementById("trace-preview-wrap").classList.toggle("hidden", !hasImage);
  document.getElementById("trace-mode").value = state.traceMode || "multi-colour";
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
  const count = traceLastResult.islandCount ?? traceLastResult.polygonCount ?? 0;
  const effectiveMode = traceLastResult.mode || state.traceMode;
  const isOutline = effectiveMode === "outline";
  let msg = traceLastResult.multiColour
    ? `${traceLastResult.colorLayerCount ?? traceLastResult.colorLayers?.length ?? 0} colours · multi-colour logo`
    : isOutline
      ? `${count} path${count === 1 ? "" : "s"} · line art`
      : `${count} island${count === 1 ? "" : "s"} · single colour`;
  if (traceLastResult.multiColour && traceLastResult.colourPaletteMerged && traceLastResult.rawColourBucketCount) {
    msg += ` · merged from ${traceLastResult.rawColourBucketCount} inks (AMS max 6)`;
  }
  if (traceLastResult.multiColour && traceLastResult.colorLayers?.length) {
    msg += ` · ${traceLastResult.colorLayers.map((l) => l.label).join(", ")}`;
  }
  if (traceLastResult.outlineRaster) {
    msg = `${traceLastResult.rectCount ?? 0} ink run${traceLastResult.rectCount === 1 ? "" : "s"} · line art mask`;
  }
  if (traceLastResult.outlineFallback) {
    msg = traceLastResult.outlineRaster
      ? `${traceLastResult.rectCount ?? 0} ink run${traceLastResult.rectCount === 1 ? "" : "s"} · line art mask (auto — complex double-edge art)`
      : `${count} island${count === 1 ? "" : "s"} · silhouette (auto — this art is double-edge, not single stroke)`;
  }
  if (traceLastResult.colorLayers >= 2) {
    msg = `${count} island${count === 1 ? "" : "s"} · ${traceLastResult.colorLayers} colour layers`;
    if (count > 80) msg += " · tip: Silhouette mode prints cleaner";
  }
  if (traceLastResult.outlineFallback && count > 80) {
    msg += " · tip: use Silhouette for line art like this";
  }
  if (traceLastResult.colorLogo) {
    msg = `${count} island${count === 1 ? "" : "s"} · colour logo`;
  }
  if (traceLastResult.autoTrace) {
    const picked = traceLastResult.autoPickedMode === "outline"
      ? "line art"
      : traceLastResult.autoPickedMode === "color-logo"
        ? "colour logo"
        : "solid logo";
    msg += ` · auto picked ${picked}`;
  }
  if (traceLastResult.tracePx) msg += ` · ${traceLastResult.tracePx}px`;
  if (traceLastResult.simplified) msg += " · auto-simplified for print";
  if (traceLastResult.rasterSimplified) msg += " · smoothed complex mask";
  if (traceLastResult.tooComplex) {
    msg = `Too detailed — raise threshold or use Silhouette (max ${MAX_TRACE_POLYGONS} islands)`;
    document.getElementById("btn-trace-apply").disabled = true;
  }
  if (state.embossTraceEnabled && !traceLastResult.tooComplex) {
    const face = state.embossFace;
    const faceLabel = EMBOSS_FACE_LABELS[face] || "front";
    msg += ` · ${faceLabel} face`;
  }
  if (traceLastResult.maskFillPct != null) {
    msg += ` · mask ${traceLastResult.maskFillPct}% fill`;
  }
  meta.textContent = msg;
  updateHistoryUi();
}

let traceJob = 0;
let traceDebounceTimer = null;
let traceSvgImport = false;

/** Drop/paste PNG/JPG — clear SVG + prior trace so nothing hidden carries over. */
function resetTraceImportForRaster() {
  traceSvgImport = false;
  traceJob++;
  traceLastResult = null;
  traceLastSvg = "";
  clearEmbossTrace();
  state.embossSvgEnabled = false;
  state.embossSvgText = "";
  state.embossSvgFileName = "";
  const svgCb = document.getElementById("emboss-svg-enabled");
  if (svgCb) svgCb.checked = false;
  const svgFile = document.getElementById("svg-file");
  if (svgFile) svgFile.value = "";
  const svgMeta = document.getElementById("svg-import-meta");
  if (svgMeta) {
    svgMeta.textContent = "";
    svgMeta.classList.add("hidden");
  }
}

async function runTraceAsync() {
  if (!traceSourceCanvas) return;
  const job = ++traceJob;
  const meta = document.getElementById("trace-meta");
  const btn = document.getElementById("btn-trace");
  if (meta) meta.textContent = "Tracing…";
  if (btn) btn.disabled = true;
  await new Promise((r) => setTimeout(r, 0));
  try {
    let mode = state.traceMode;
    if (traceSvgImport && mode === "auto") mode = "silhouette";
    const result = traceSvgImport
      ? await traceFlattenedSvgCanvasAsync(traceSourceCanvas)
      : await traceCanvasAsync(traceSourceCanvas, {
        threshold: state.traceThreshold,
        invert: state.traceInvert,
        mode,
        colorSeparation: false,
        strengthen: mode === "silhouette",
        preferWrapLineArt: (state.embossFace || "front") === "wrap",
      });
    if (job !== traceJob) return;
    traceLastResult = result;
    traceLastSvg = result.svg || "";
    const preview = document.getElementById("trace-preview");
    drawTracePreview(preview, traceSourceCanvas, traceLastResult);
    updateTraceUi();
    if (
      traceLastResult &&
      !traceLastResult.tooComplex &&
      state.embossTraceEnabled &&
      shapeSupportsArt(artUiShape() || state.shape) &&
      storeTraceOnBox(traceLastResult)
    ) {
      await rebuildDeferred();
      updateDecorUi();
      syncArtEditorUi();
    }
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

function clearTraceImageAndEmboss() {
  const hadTrace = !!(traceSourceCanvas || traceLastResult || traceLastSvg || state.embossTraceEnabled);
  traceJob++;
  traceSourceCanvas = null;
  traceLastResult = null;
  traceLastSvg = "";
  traceSvgImport = false;
  clearEmbossTrace();
  state.embossSvgEnabled = false;
  state.embossSvgText = "";
  state.embossSvgFileName = "";
  const svgCb = document.getElementById("emboss-svg-enabled");
  if (svgCb) svgCb.checked = false;
  const svgMeta = document.getElementById("svg-import-meta");
  if (svgMeta) {
    svgMeta.textContent = "";
    svgMeta.classList.add("hidden");
  }
  const traceFile = document.getElementById("trace-file");
  if (traceFile) traceFile.value = "";
  const preview = document.getElementById("trace-preview");
  const ctx = preview?.getContext("2d");
  if (preview && ctx) ctx.clearRect(0, 0, preview.width, preview.height);
  const meta = document.getElementById("trace-meta");
  if (meta) meta.textContent = "";
  document.getElementById("trace-preview-wrap")?.classList.add("hidden");
  updateTraceUi();
  updateDecorUi();
  syncArtEditorUi();
  updateHistoryUi();
  if (hadTrace) {
    rebuild();
    pushAppHistory();
    scheduleSaveSession();
  }
}

async function handleTraceFile(file) {
  const name = file.name?.toLowerCase() || "";
  const isSvg = file.type === "image/svg+xml" || name.endsWith(".svg");
  setArtSubPane("graphic");
  if (isSvg) {
    try {
      const text = await file.text();
      state.embossSvgEnabled = true;
      document.getElementById("emboss-svg-enabled").checked = true;
      await importSvgFile(text, { fileName: file.name });
    } catch (err) {
      const meta = document.getElementById("svg-import-meta");
      if (meta) {
        meta.textContent = err.message || "Could not import SVG";
        meta.classList.remove("hidden");
      }
    }
    return;
  }
  try {
    resetTraceImportForRaster();
    const loaded = await loadImageFromFile(file);
    traceSourceCanvas = loaded.canvas;
    await runTraceAsync();
    if (
      traceLastResult &&
      !traceLastResult.tooComplex &&
      shapeSupportsArt(artUiShape() || state.shape) &&
      storeTraceOnBox(traceLastResult)
    ) {
      requestAnimationFrame(() => {
        rebuild();
        updateDecorUi();
        syncArtEditorUi();
      });
    }
  } catch (err) {
    document.getElementById("trace-meta").textContent = err.message || "Could not load image";
    document.getElementById("trace-preview-wrap").classList.remove("hidden");
    updateTraceUi();
  }
}

function traceResultToEmbossRects(result) {
  if (result.multiColour && result.colorLayers?.length) {
    return {
      rects: [],
      mask: [],
      silhouetteMask: [],
      polygons: [],
      shapeGroups: [],
      strokePaths: [],
      mode: "multi-colour",
      multiColour: true,
      colorLayers: cloneColourLayers(result.colorLayers),
      colorLayerCount: result.colorLayerCount ?? result.colorLayers.length,
      rawColourBucketCount: result.rawColourBucketCount,
      colourPaletteMerged: !!result.colourPaletteMerged,
      autoTrace: false,
      width: result.width,
      height: result.height,
      cropOx: result.cropOx,
      cropOy: result.cropOy,
    };
  }
  const silMask = result.silhouetteMask?.length
    ? (result.silhouetteMask instanceof Uint8Array ? result.silhouetteMask.slice() : Uint8Array.from(result.silhouetteMask))
    : (result.mask?.length
      ? (result.mask instanceof Uint8Array ? result.mask.slice() : Uint8Array.from(result.mask))
      : null);
  return {
    rects: result.rects?.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) || [],
    mask: silMask || [],
    silhouetteMask: silMask || [],
    polygons: result.polygons?.map((poly) => poly.map(([x, y]) => [x, y])) || [],
    shapeGroups: result.shapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) || [],
    strokePaths: result.strokePaths?.map((p) => p.map(([x, y]) => [x, y])) || [],
    strokeWidth: result.strokeWidth,
    mode: result.mode || state.traceMode || "silhouette",
    autoTrace: !!result.autoTrace,
    autoPickedMode: result.autoPickedMode,
    colorLogo: !!result.colorLogo,
    outlineRaster: !!result.outlineRaster,
    outlineFallback: !!result.outlineFallback,
    rasterSimplified: !!result.rasterSimplified,
    maskFillPct: result.maskFillPct,
    rectCount: result.rectCount,
    shapeGroupsUnited: !!result.shapeGroupsUnited,
    previewShapeGroups: result.previewShapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) || (result.shapeGroupsUnited ? result.shapeGroups?.map((g) => ({
      outer: g.outer.map(([x, y]) => [x, y]),
      holes: g.holes.map((h) => h.map(([x, y]) => [x, y])),
    })) : null),
    width: result.width,
    height: result.height,
    multiColour: !!result.multiColour,
    colorLayerCount: result.colorLayerCount,
  };
}

function hasTraceGeometry(result) {
  return !!(
    result?.colorLayers?.length
    || result?.shapeGroups?.length
    || result?.strokePaths?.length
    || result?.mask?.length
    || result?.silhouetteMask?.length
    || result?.rects?.length
  );
}

function storeTraceOnBox(result, { clearLabel = false, clearSvg = false } = {}) {
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
    state.embossSvgFileName = "";
    document.getElementById("emboss-svg-enabled").checked = false;
    const svgFile = document.getElementById("svg-file");
    if (svgFile) svgFile.value = "";
  }
  return true;
}

function setSvgImportStatus(msg) {
  const meta = document.getElementById("svg-import-meta");
  if (!meta) return;
  meta.textContent = msg;
  meta.classList.remove("hidden");
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function rebuildDeferred() {
  await yieldToBrowser();
  await new Promise((resolve) => setTimeout(resolve, 0));
  rebuild();
  await yieldToBrowser();
}

async function applySvgTraceResult(svgText, traceResult, { fileName = "" } = {}) {
  if (!traceResult || traceResult.tooComplex) {
    throw new Error(`SVG too detailed to emboss (max ${MAX_TRACE_POLYGONS} paths).`);
  }
  if (!storeTraceOnBox(traceResult, { clearLabel: false, clearSvg: false })) {
    throw new Error("Could not apply SVG to box.");
  }
  state.embossSvgText = svgText;
  state.embossSvgFileName = fileName || state.embossSvgFileName || "";
  state.embossSvgEnabled = true;
  state.embossTraceEnabled = true;
  document.getElementById("emboss-svg-enabled").checked = true;
  updateDecorUi();
  syncArtEditorUi();
  syncSvgImportUi();
  updateTraceUi();
  await rebuildDeferred();
  pushAppHistory();
}

/** Complex SVGs — vector path with solid silhouette (skip broken fast-logo trace). */
async function importSvgFastLogo(svgText, { fileName = "" } = {}) {
  await importSvgAsTrace(svgText, { fileName, importMode: "silhouette" });
}

async function importSvgDirectEmboss(svgText, { fileName = "", importMode = "vector" } = {}) {
  if (!shapeSupportsArt(artUiShape() || state.shape)) {
    throw new Error("Pick a box, rounded, pencil, or profile pot shape first.");
  }
  traceSvgImport = false;
  setSvgImportStatus(fileName ? `Processing ${fileName}…` : "Processing SVG…");
  await yieldToBrowser();

  state.embossTraceEnabled = false;
  state.embossTraceRects = null;
  traceSourceCanvas = null;
  traceLastResult = null;
  traceLastSvg = "";
  const previewWrap = document.getElementById("trace-preview-wrap");
  if (previewWrap) previewWrap.classList.add("hidden");

  state.embossSvgText = svgText;
  state.embossSvgFileName = fileName || state.embossSvgFileName || "";
  state.embossSvgEnabled = true;
  document.getElementById("emboss-svg-enabled").checked = true;

  updateDecorUi();
  await rebuildDeferred();
  syncArtEditorUi();
  syncSvgImportUi();
  updateTraceUi();
  pushAppHistory();
}

async function importSvgFile(svgText, { fileName = "" } = {}) {
  if (!shapeSupportsArt(artUiShape() || state.shape)) {
    throw new Error("Pick a box, rounded, pencil, or profile pot shape first.");
  }
  if (!meshCache?.meta) rebuild();

  const prepped = prepareSvgForImport(svgText);
  await yieldToBrowser();

  if (svgPrefersRasterSilhouette(prepped)) {
    await importSvgAsTrace(prepped, { fileName, importMode: "silhouette" });
    return;
  }

  const hasFill = parsedSvgHasFill(prepped);
  if (hasFill) {
    await importSvgDirectEmboss(prepped, { fileName, importMode: "vector" });
    syncSvgImportUi();
    const cache = state.embossFace === "lid" ? lidCache : meshCache;
    if (!cache?.graphicMesh?.positions?.length) {
      await importSvgAsTrace(prepped, { fileName, importMode: "silhouette" });
    }
    return;
  }

  const params = buildParams();
  const vectorOk = meshCache?.meta && svgEmbossProducesMesh(meshCache.meta, params, prepped);
  if (vectorOk) {
    await importSvgDirectEmboss(prepped, { fileName, importMode: "vector" });
    return;
  }
  try {
    await importSvgAsTrace(prepped, { fileName, importMode: "silhouette" });
    const meta = document.getElementById("trace-meta");
    if (meta && fileName) {
      meta.textContent = `SVG ${fileName} — traced silhouette (vector paths were empty).`;
    }
  } catch (err) {
    throw new Error(err?.message || "Could not import SVG — try a simpler file or PNG trace.");
  }
}

async function importSvgAsTrace(svgText, { fileName = "", importMode = "silhouette" } = {}) {
  traceSvgImport = true;
  setSvgImportStatus(fileName ? `Tracing ${fileName}…` : "Tracing SVG…");
  await yieldToBrowser();

  const canvas = await rasterizeSvgToCanvas(svgText, SVG_FAST_RASTER_PX);
  flattenCanvasToInkSilhouette(canvas);
  traceSourceCanvas = canvas;
  if (importMode === "outline") {
    state.traceMode = "outline";
    document.getElementById("trace-mode").value = "outline";
  }
  await yieldToBrowser();

  traceLastResult = await traceFlattenedSvgCanvasAsync(canvas);
  traceLastSvg = traceLastResult.svg || "";
  const modeSel = document.getElementById("trace-mode");
  if (modeSel) modeSel.value = state.traceMode || "multi-colour";
  const preview = document.getElementById("trace-preview");
  if (preview) drawTracePreview(preview, traceSourceCanvas, traceLastResult);
  const previewWrap = document.getElementById("trace-preview-wrap");
  if (previewWrap) previewWrap.classList.add("hidden");

  if (!shapeSupportsArt(artUiShape() || state.shape)) {
    throw new Error("Pick a box, rounded, pencil, or profile pot shape first.");
  }

  await applySvgTraceResult(svgText, traceLastResult, { fileName });
}

function applyTraceToBox() {
  if (!hasTraceGeometry(traceLastResult)) return;
  if (traceLastResult.tooComplex) {
    document.getElementById("trace-meta").textContent =
      `Too detailed to emboss — raise threshold or use Silhouette mode (max ${MAX_TRACE_POLYGONS} shapes).`;
    return;
  }
  if (!shapeSupportsArt(artUiShape() || state.shape)) {
    document.getElementById("trace-meta").textContent = "Pick a box, rounded, pencil, or profile pot shape first.";
    return;
  }
  if (!storeTraceOnBox(traceLastResult)) return;
  rebuild();
  pushAppHistory();
  updateDecorUi();
  syncArtEditorUi();
  updateTraceUi();
}

function syncInsertCountHint() {
  const el = document.getElementById("insert-count-hint");
  if (!el) return;
  const n = Math.max(1, Math.min(4, Math.round(state.insertCount ?? 1)));
  const tiers = n + 1;
  if (state.insertAxis === "height") {
    el.textContent = `${n} shelf${n === 1 ? "" : "ves"} → ${tiers} tiers`;
    return;
  }
  el.textContent = `${n} divider${n === 1 ? "" : "s"} → ${tiers} compartments`;
}

function syncInsertTopClearanceUi() {
  const params = buildParams();
  const autoOn = state.insertTopClearanceAuto !== false;
  const effective = effectiveInsertTopClearance(params);
  const intrusion = lidCavityIntrusion(params);
  const insertOn = state.insertEnabled && shapeSupportsInsert(insertUiShape());

  document.getElementById("field-insert-top-auto")?.classList.toggle("hidden", !insertOn);
  document.getElementById("field-insert-top-clearance")?.classList.toggle("hidden", !insertOn);

  const autoCb = document.getElementById("insert-top-auto");
  if (autoCb) autoCb.checked = autoOn;

  const slider = document.getElementById("insert-top-clearance");
  const out = document.getElementById("out-insert-top-clearance");
  if (slider) {
    const mmMin = 0.2;
    const mmMax = 8;
    const display = applyLengthSliderRange(slider, mmMin, mmMax, effective);
    slider.disabled = autoOn;
    if (out) {
      out.textContent = display;
      out.disabled = autoOn;
    }
  }

  const hint = document.getElementById("insert-top-clearance-hint");
  if (hint && insertOn) {
    const u = displayUnitLabel();
    if (autoOn && intrusion > 0) {
      const src = normalizeLidType(state.lidType) === "plug" ? "inset skirt" : "lip";
      hint.textContent = `Auto: ${fmtDimReadout(effective)} ${u} (${src} ${fmtDimReadout(intrusion)} ${u} + gap). Uncheck Match lid to override.`;
    } else if (autoOn) {
      hint.textContent = "Slip-over lid — no internal intrusion. Uncheck Match lid to set a custom top gap.";
    } else {
      hint.textContent = "Manual top clearance — shortens dividers below the lid zone.";
    }
  }

  const autoHint = document.getElementById("insert-top-auto-hint");
  if (autoHint && insertOn && !state.lidEnabled) {
    autoHint.textContent = "Enable an inset plug or flat-cap lid to auto-shorten dividers.";
  } else if (autoHint) {
    autoHint.textContent = "Shortens dividers when an inset plug skirt or flat-cap lip hangs inside the cavity.";
  }
}

function describeBodyExportParts() {
  const params = buildParams();
  const parts = ["Body"];
  if (hasSeparateArtExport(params) && params.embossFace !== "lid") {
    const layers = state.embossTraceRects?.colorLayers;
    if (state.embossTraceRects?.multiColour && layers?.length > 1) {
      for (const layer of layers) parts.push(`Art ${layer.label || "colour"}`);
    } else {
      parts.push("Art");
    }
  }
  if (hasSeparateTextExport(params) && params.embossFace !== "lid") parts.push("Text");
  if (state.accentEnabled && accentSupportedForShape()) {
    const bandCount = state.accentBands?.filter((band) => band?.onTop !== false).length || 1;
    parts.push(bandCount > 1 ? `Accent ×${bandCount}` : "Accent");
  }
  if (state.insertEnabled && !mergeInsertIntoBodyExport()) parts.push("Insert");
  return parts;
}

function describeExportPlan(format = "3mf") {
  if (format === "3mf") {
    const bodyParts = describeBodyExportParts();
    const zipExport = exportIncludesLidPlate();
    const lidParts = zipExport ? describeExportPlan("lid-3mf").bodyParts : [];
    return {
      format,
      bodyParts,
      zipExport,
      plate1Label: bodyParts.join(" + "),
      plate2Label: lidParts.length ? lidParts.join(" + ") : "Lid",
      summary: zipExport
        ? "ZIP · container + lid"
        : bodyParts.join(" + "),
    };
  }
  if (format === "lid-3mf" || format === "lid-stl") {
    const lidParts = ["Lid"];
    const params = buildParams();
    if (hasSeparateArtExport(params) && params.embossFace === "lid") lidParts.push("Art");
    if (hasSeparateTextExport(params) && params.embossFace === "lid") lidParts.push("Text");
    if (params.lidGasketEnabled && params.lidGasketExportRing !== false) lidParts.push("Gasket");
    return {
      format,
      bodyParts: lidParts,
      zipExport: false,
      plate1Label: lidParts.join(" + "),
      summary: lidParts.join(" + "),
    };
  }
  return {
    format,
    bodyParts: [],
    zipExport: false,
    plate1Label: exportFormatLabel(format),
    summary: exportFormatLabel(format),
  };
}

function syncExportPlanUi() {
  const plan = document.getElementById("export-plan");
  const sel = document.getElementById("export-format");
  if (!plan || !sel) return;
  const format = sel.value || "3mf";
  const info = describeExportPlan(format);
  const opt3mf = sel.querySelector('option[value="3mf"]');
  if (opt3mf) {
    opt3mf.textContent = exportIncludesLidPlate() ? "3MF · ZIP (container + lid)" : "3MF project";
  }
  if (format !== "3mf" && format !== "lid-3mf") {
    plan.hidden = true;
    plan.textContent = "";
    return;
  }
  plan.hidden = false;
  if (info.zipExport) {
    plan.innerHTML = `<span class="export-plan-parts">ZIP · container + lid</span>`;
  } else {
    plan.innerHTML = `<span class="export-plan-parts">${info.summary}</span>`;
  }
}

function syncExportFormatOptions() {
  const sel = document.getElementById("export-format");
  if (!sel) return;
  const lidOn = state.lidEnabled && shapeSupportsLid(state.shape);
  const accentOn = state.accentEnabled && accentSupportedForShape();
  const insertOn = state.insertEnabled && shapeSupportsInsert(insertUiShape());
  const debossOn = !!state.embossDeboss && !!debossCutterCache;
  const saucerOn = state.shape === "vase" && state.vaseSaucerEnabled && !!meshCache?.saucerMesh;
  const show = { lid: lidOn, accent: accentOn, insert: insertOn, deboss: debossOn, saucer: saucerOn };
  sel.querySelectorAll("option[data-export-opt]").forEach((opt) => {
    const ok = show[opt.dataset.exportOpt];
    opt.hidden = !ok;
    opt.disabled = !ok;
  });
  if (sel.selectedOptions[0]?.disabled) sel.value = "3mf";
  syncExportPlanUi();
}

function meshBounds(mesh) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY };
}

function exportFormatExt(format) {
  if (format === "3mf" && exportIncludesLidPlate()) return ".zip";
  return format === "3mf" || format === "lid-3mf" ? ".3mf" : ".stl";
}

function exportFormatLabel(format) {
  const labels = {
    "3mf": exportIncludesLidPlate() ? "3MF · ZIP (container + lid)" : "3MF project — body",
    stl: "STL — body",
    "lid-3mf": "3MF — lid",
    "lid-stl": "STL — lid",
    accent: "STL — accent bands",
    insert: "STL — insert / divider",
    deboss: "STL — deboss cutter",
    saucer: "STL — vase saucer",
  };
  return labels[format] || format;
}

function bodyFormatSupportsLibrary(format) {
  return format === "3mf" || format === "stl";
}

function suggestExportFilename(format) {
  if (!meshCache) rebuild();
  switch (format) {
    case "3mf":
      return exportIncludesLidPlate()
        ? `${baseModelName(meshCache.meta)}.zip`
        : filename3mfFor(meshCache.meta, "body");
    case "stl":
      return filenameFor(meshCache.meta, "body");
    case "lid-3mf":
      return filename3mfFor(lidCache?.meta || meshCache.meta, "lid");
    case "lid-stl":
      return filenameFor(lidCache?.meta || meshCache.meta, "lid");
    case "accent":
      return filenameFor(meshCache.meta, "accent");
    case "insert":
      return filenameFor(meshCache.meta, "insert");
    case "deboss":
      return filenameFor(meshCache.meta, "deboss-cutter");
    case "saucer":
      return filenameFor(meshCache.meta, "saucer");
    default:
      return `makerdeck-export${exportFormatExt(format)}`;
  }
}

function sanitizeExportFilename(raw, ext) {
  let name = String(raw || "").trim().replace(/[/\\?%*:|"<>]/g, "-");
  if (!name) name = "makerdeck-export";
  const lowerExt = ext.toLowerCase();
  if (!name.toLowerCase().endsWith(lowerExt)) {
    name = name.replace(/\.[^.]+$/, "") + lowerExt;
  }
  return name;
}

let exportDialogFormat = "3mf";
let exportDialogResolve = null;

function closeExportDialog(result) {
  const dialog = document.getElementById("export-dialog");
  if (dialog?.open) dialog.close();
  const resolve = exportDialogResolve;
  exportDialogResolve = null;
  resolve?.(result);
}

function setExportStatus(message, { detail = "" } = {}) {
  const status = document.getElementById("export-status");
  if (!status) return;
  status.textContent = message;
  status.title = detail || message;
}

function openExportDialog(format) {
  const dialog = document.getElementById("export-dialog");
  const input = document.getElementById("export-dialog-filename");
  const kind = document.getElementById("export-dialog-kind");
  const plates = document.getElementById("export-dialog-plates");
  const partsLine = document.getElementById("export-dialog-parts");
  const libWrap = document.getElementById("export-dialog-library-wrap");
  const libCheck = document.getElementById("export-dialog-library");
  const hint = document.getElementById("export-dialog-hint");
  if (!dialog || !input) return Promise.resolve(null);

  exportDialogFormat = format;
  const plan = describeExportPlan(format);
  input.value = suggestExportFilename(format);
  if (kind) kind.textContent = exportFormatLabel(format);
  if (plates) {
    if (plan.zipExport) {
      plates.hidden = false;
      plates.innerHTML = [
        `<span class="export-plate-chip"><strong>container.3mf</strong> ${plan.plate1Label}</span>`,
        `<span class="export-plate-chip"><strong>lid.3mf</strong> ${plan.plate2Label}</span>`,
      ].join("");
    } else if (format === "3mf" || format === "lid-3mf") {
      plates.hidden = false;
      plates.innerHTML = `<span class="export-plate-chip"><strong>Plate 1</strong> ${plan.plate1Label}</span>`;
    } else {
      plates.hidden = true;
      plates.innerHTML = "";
    }
  }
  if (partsLine) {
    partsLine.textContent = plan.bodyParts.length
      ? `Parts: ${plan.bodyParts.join(", ")}`
      : "";
  }

  const canSave = bodyFormatSupportsLibrary(format) && libraryApiAvailable();
  if (libWrap) libWrap.hidden = !canSave;
  if (libCheck && canSave) {
    libCheck.checked = localStorage.getItem("makerdeck-export-save-library") !== "0";
  }
  if (hint) {
    if (canSave && plan.zipExport) {
      hint.textContent = "ZIP contains container.3mf and lid.3mf — open both in Bambu Studio. Library saves the container 3MF and your sliders.";
    } else if (canSave) {
      hint.textContent = "Library saves your sliders and art so you can reload this design later.";
    } else {
      hint.textContent = "Only body STL and 3MF can be saved to the design library.";
    }
  }

  return new Promise((resolve) => {
    exportDialogResolve = resolve;
    dialog.showModal();
    input.focus();
    input.select();
  });
}

function initExportDialog() {
  const dialog = document.getElementById("export-dialog");
  const form = document.getElementById("export-dialog-form");
  const cancel = document.getElementById("export-dialog-cancel");
  if (!dialog || !form) return;

  cancel?.addEventListener("click", () => closeExportDialog(null));
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeExportDialog(null);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("export-dialog-filename");
    const libCheck = document.getElementById("export-dialog-library");
    const ext = exportFormatExt(exportDialogFormat);
    const filename = sanitizeExportFilename(input?.value, ext);
    const saveToLibrary = !!libCheck?.checked && bodyFormatSupportsLibrary(exportDialogFormat);
    localStorage.setItem("makerdeck-export-save-library", saveToLibrary ? "1" : "0");
    closeExportDialog({ filename, saveToLibrary });
  });
}

function pickExportFilename(format, options = {}) {
  if (options.filename) return options.filename;
  return suggestExportFilename(format);
}

function runExport(format, options = {}) {
  if (!meshCache) rebuild();
  try {
    switch (format) {
      case "3mf": {
        syncExportStateFromUi();
        if (state.insertEnabled && state.insertMount === "fixed" && state.joinerEnabled) {
          alert("Link joiner and welded dividers don't mix — turn off Joiner on the Link tab, then download again.");
          return;
        }
        const status = document.getElementById("export-status");
        if (status) setExportStatus("Preparing 3MF export…");
        void (async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          try {
            const exportCache = buildFreshExportCache();
            rebuild();
            const params = buildParams();
            const stamp = params.watermarkEnabled !== false ? acquireWatermarkStamp() : null;
            if (status) status.textContent = "Building export meshes…";
            await new Promise((resolve) => setTimeout(resolve, 0));
            const parts = collectColoredExportParts(exportCache, stamp);
            const triCount = parts.reduce((sum, part) => sum + Math.floor((part.mesh?.indices?.length || 0) / 3), 0);
            const expectDivider = state.insertEnabled && state.insertMount === "fixed";
            const shellTris = exportShellTriCount(exportCache);
            if (expectDivider && weldedDividerExportLooksBroken(exportCache, params, triCount)) {
              const rounded = (params.cornerRadius || 0) > 0.5 || (params.vertexFillet || 0) > 0.5;
              const expectHint = rounded ? "~300+ triangles" : "~40 triangles (sharp corners)";
              const diag = `shell=${shellTris}, joiner=${state.joinerEnabled ? "on" : "off"}, axis=${state.insertAxis}, mount=${state.insertMount}, rounded=${rounded ? "yes" : "no"}`;
              if (status) {
                status.textContent = `Export blocked — only ${triCount} triangles (expected ${expectHint}). ${diag}`;
              }
              alert(`Export blocked: only ${triCount} triangles.\n\nExpected ${expectHint} for this box.\n\nCheck:\n• Insert → Mount = Fixed (welded)\n• Link tab → Joiner OFF\n• Divider axis = Width or Depth\n\nDiagnostic: ${diag}`);
              return;
            }
            if (status) setExportStatus("Packing 3MF…");
            await new Promise((resolve) => setTimeout(resolve, 0));
            const packed = await buildBody3mfExport(exportCache, parts);
            const blob = packed.blob;
            const fname = pickExportFilename(format, options);
            downloadBlob(blob, fname);
            const partNames = packed.zipExport
              ? `${parts.map((p) => p.name).join(" + ")} + Lid`
              : parts.map((p) => p.name).join(" + ");
            const zipNote = packed.zipExport ? ` · ${packed.containerFile} + ${packed.lidFile}` : "";
            const wmNote = stamp ? ` · watermark #${String(stamp.serial).padStart(4, "0")}` : "";
            const bodyPart = parts.find((p) => p.name === "Body");
            const paints = bodyPart?.triangleExtruders;
            let openNote = "";
            let hasOpenEdges = false;
            if (paints?.length) {
              const artTris = paints.filter((e) => e === 2).length;
              const textTris = paints.filter((e) => e === 3).length;
              const bodyOpen = partOpenEdgeCount(bodyPart);
              hasOpenEdges = bodyOpen > 0;
              openNote = ` · art ${artTris} tris, text ${textTris} tris, open ${bodyOpen}`;
            } else {
              const bodyOpen = partOpenEdgeCount(parts.find((p) => p.name === "Body"));
              const artOpen = partOpenEdgeCount(parts.find((p) => p.name === "Art"));
              const textOpen = partOpenEdgeCount(parts.find((p) => p.name === "Text"));
              const accentOpen = parts
                .filter((p) => p.name === "Accent" || /^Accent \d+$/.test(p.name))
                .reduce((sum, p) => sum + partOpenEdgeCount(p), 0);
              const totalOpen = bodyOpen + artOpen + textOpen + accentOpen;
              hasOpenEdges = totalOpen > 0;
              if (totalOpen > 0) {
                openNote = ` · open edges: body ${bodyOpen}, art ${artOpen}, text ${textOpen}, accent ${accentOpen}`;
              }
            }
            if (hasOpenEdges) {
              openNote += " — avoid Bambu Repair (remeshes parts); re-export after update";
            }
            const exportHeadline = packed.zipExport
              ? "ZIP downloaded — open container.3mf and lid.3mf in Bambu"
              : `${parts.length > 1 ? `${parts.length}-part` : "Plain"} 3MF exported — ${partNames}`;
            const exportDetail = `${triCount} triangles${zipNote}${openNote}${wmNote}`;
            setExportStatus(exportHeadline, { detail: exportDetail });
            void archiveBodyExport(
              packed.zipExport ? packed.containerBlob : blob,
              packed.zipExport ? packed.containerFile : fname,
              { format: "3mf", stamp, saveToLibrary: options.saveToLibrary },
            ).then((result) => {
              let headline = exportHeadline;
              let detail = exportDetail;
              if (result?.error) {
                headline += " · library failed";
                detail += ` · ${result.error}`;
              } else if (result?.id) {
                headline += " · saved to library";
              }
              setExportStatus(headline, { detail });
              notifyLibrarySaved(result?.id ? result : null);
            });
          } catch (err) {
            console.error("3MF export failed:", err);
            setExportStatus(err?.message || "3MF export failed");
            alert(err?.message || "3MF export failed.");
          }
        })();
        break;
      }
      case "stl": {
        syncExportStateFromUi();
        const exportCache = buildFreshExportCache();
        rebuild();
        const params = buildParams();
        const stamp = params.watermarkEnabled !== false ? acquireWatermarkStamp() : null;
        const separateText = hasSeparateTextExport(params);
        const separateColor = separateText || hasSeparateArtExport(params);
        let exportMesh = separateColor
          ? resolveBodyExportMesh(exportCache, params, separateText, stamp)
          : finalizeBodyExportMesh(
            buildWatertightExportMesh(exportCache, exportCache.meta, params),
            exportCache.meta,
            params,
            stamp,
          );
        if (state.insertEnabled && state.insertMount === "fixed") {
          exportMesh = buildWatertightFixedDividerExport(exportCache, exportCache.meta, { ...params, fuseInsertToBody: true }) || exportMesh;
        }
        const stlBlob = meshToStl(exportMesh, "makerdeck");
        const stlName = pickExportFilename(format, options);
        downloadBlob(stlBlob, stlName);
        const status = document.getElementById("export-status");
        void archiveBodyExport(stlBlob, stlName, { format: "stl", stamp, saveToLibrary: options.saveToLibrary }).then((result) => {
          if (result?.error) {
            if (status) {
              status.textContent = `STL downloaded${stamp ? ` · watermark #${String(stamp.serial).padStart(4, "0")}` : ""} · library failed: ${result.error}`;
            }
          } else if (status && result?.id) {
            status.textContent = `STL downloaded · saved to design library${stamp ? ` · watermark #${String(stamp.serial).padStart(4, "0")}` : ""}`;
          } else if (status) {
            status.textContent = `STL downloaded${stamp ? ` · watermark #${String(stamp.serial).padStart(4, "0")}` : ""}`;
          }
          notifyLibrarySaved(result?.id ? result : null);
        });
        break;
      }
      case "lid-3mf": {
        if (!state.lidEnabled || !lidCache) return;
        rebuild();
        const lidParts = collectColoredLidExportParts();
        if (!lidParts.length) return;
        downloadBlob(
          buildColoredProject3mf(lidParts, `${baseModelName(lidCache.meta || meshCache.meta)} lid`),
          pickExportFilename(format, options),
        );
        break;
      }
      case "lid-stl": {
        if (!state.lidEnabled || !lidCache) return;
        rebuild();
        if (appliedHasArt(state) && state.embossFace !== "lid") {
          const status = document.getElementById("art-draft-status");
          if (status) {
            status.textContent = "Art is on the box body — switch Face to Lid top, Apply, then download lid again.";
            status.classList.add("is-dirty");
          }
        }
        try {
          downloadBlob(meshToStl(orientLidForPrint(lidCache), "makerdeck-lid"), pickExportFilename(format, options));
        } catch (err) {
          const status = document.getElementById("art-draft-status");
          if (status) {
            status.textContent = err?.message || "Lid export failed — check art fits on lid face.";
            status.classList.add("is-dirty");
          }
        }
        break;
      }
      case "accent": {
        const accentParts = meshCache.accentMeshes || [];
        if (!state.accentEnabled || !accentParts.length) return;
        const exportMeshes = accentParts
          .map((part) => sanitizeMeshForStl(part.solidMesh || part.mesh))
          .filter((mesh) => mesh?.indices?.length);
        if (!exportMeshes.length) return;
        const merged = exportMeshes.length === 1 ? exportMeshes[0] : mergeMeshes(...exportMeshes);
        downloadBlob(meshToStl(merged, "makerdeck-accent"), pickExportFilename(format, options));
        break;
      }
      case "insert": {
        if (!state.insertEnabled || !insertCache) return;
        downloadBlob(meshToStl(insertCache, "makerdeck-insert"), pickExportFilename(format, options));
        break;
      }
      case "deboss": {
        if (!state.embossDeboss || !debossCutterCache) return;
        let exportMesh = debossCutterCache;
        if (state.embossFace === "lid" && lidCache) {
          exportMesh = orientLidForPrint({ ...debossCutterCache, lidHeight: lidCache.lidHeight });
        }
        downloadBlob(meshToStl(exportMesh, "makerdeck-deboss"), pickExportFilename(format, options));
        break;
      }
      case "saucer": {
        if (state.shape !== "vase" || !state.vaseSaucerEnabled || !meshCache?.saucerMesh) return;
        downloadBlob(meshToStl(meshCache.saucerMesh, "makerdeck-saucer"), pickExportFilename(format, options));
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("Export failed:", err);
    alert(err?.message || "Export failed.");
  }
}

function accentShapeKey() {
  if (state.shape === "rounded") return "rounded";
  if (state.shape === "hex") return "hex";
  if (state.shape === "polygon") return "polygon";
  if (PRESET_SHAPES.has(state.shape)) return state.shape;
  return state.shape;
}

function accentUiMode() {
  const key = accentShapeKey();
  if (key === "vase") return "vase";
  if (shapeSupportsAccentFrontFace(key)) return "box";
  if (shapeSupportsAccent(key)) return "profile";
  return "none";
}

function accentSupportedForShape() {
  return shapeSupportsAccent(accentShapeKey());
}

function accentBandsUiSignature() {
  return `${state.accentBands.length}:${accentUiMode()}:${state.accentBands.map((b) => `${b.id}:${b.onTop ? 1 : 0}`).join(",")}`;
}

function bindAccentBandSlider(slider, bandIndex, key, parseKind = "float") {
  const sync = () => {
    let val = parseFieldValue(slider.value, parseKind);
    if (isLengthKey(key)) val = displayToMm(val);
    if (!state.accentBands[bandIndex]) return;
    state.accentBands[bandIndex][key] = val;
    if (key === "pos" && accentUiMode() === "profile") {
      state.accentBands[bandIndex].face = val <= 0.5 ? "floor" : "rim";
    }
    syncFlatAccentFromBands(state);
    const out = slider.parentElement?.querySelector(".value-edit");
    if (out) out.textContent = slider.value;
    scheduleSaveSession();
    rebuild();
  };
  slider.addEventListener("input", sync);
  slider.addEventListener("change", () => pushAppHistory());
}

function createAccentBandValueEdit(sliderId, bandIndex, key, parseKind, display) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "value-edit";
  btn.id = `${sliderId}-out`;
  btn.dataset.slider = sliderId;
  btn.dataset.accentBand = String(bandIndex);
  btn.dataset.accentKey = key;
  btn.dataset.parse = parseKind;
  btn.textContent = String(display);
  return btn;
}

function applyAccentBandSliderValue(slider, bandIndex, key, val, parseKind) {
  const mmVal = isLengthKey(key) ? displayToMm(val) : val;
  const stored = parseKind === "float" ? parseFloat(mmVal) : Number(mmVal);
  const band = state.accentBands[bandIndex];
  if (!band) return;
  band[key] = stored;
  let display;
  if (isLengthKey(key)) {
    const mmMin = parseFloat(slider.dataset.mmMin ?? slider.min);
    const mmMax = parseFloat(slider.dataset.mmMax ?? slider.max);
    display = applyLengthSliderRange(slider, mmMin, mmMax, stored);
  } else {
    display = formatSliderValue(val, slider.step);
    slider.value = display;
  }
  if (key === "pos" && accentUiMode() === "profile") {
    band.face = band.pos <= 0.5 ? "floor" : "rim";
  }
  syncFlatAccentFromBands(state);
  const out = slider.parentElement?.querySelector(".value-edit");
  if (out) out.textContent = display;
  rebuild();
  pushAppHistory();
}

function syncAccentBandControlsFromState() {
  const mode = accentUiMode();
  state.accentBands.forEach((band, i) => {
    const setSlider = (suffix, val, key) => {
      const slider = document.getElementById(`accent-band-${i}-${suffix}`);
      const out = document.getElementById(`accent-band-${i}-${suffix}-out`);
      if (!slider) return;
      let display;
      if (isLengthKey(key)) {
        const mmMin = parseFloat(slider.dataset.mmMin ?? slider.min);
        const mmMax = parseFloat(slider.dataset.mmMax ?? slider.max);
        display = applyLengthSliderRange(slider, mmMin, mmMax, val);
      } else {
        display = formatSliderValue(val, slider.step);
        slider.value = display;
      }
      if (out) out.textContent = display;
    };
    setSlider("pos", band.pos ?? 50, "pos");
    setSlider("height", band.height ?? 4, "height");
    setSlider("rotation", band.rotation ?? 0, "rotation");
    setSlider("wave-amp", band.waveAmp ?? 3, "waveAmp");
    setSlider("wave-count", band.waveCount ?? 6, "waveCount");
    const edge = document.getElementById(`accent-band-${i}-edge`);
    if (edge) edge.value = band.edge || "straight";
    const face = document.getElementById(`accent-band-${i}-face`);
    if (face) face.value = band.face || "rim";
    const onTop = document.getElementById(`accent-band-${i}-on-top`);
    if (onTop) onTop.checked = !!band.onTop;
    setColorPickerValue(document.getElementById(`accent-band-${i}-color`), band.color || "#f97316");
    const wavyOn = mode === "vase" && band.edge === "wave";
    document.getElementById(`accent-band-${i}-wave-amp-field`)?.classList.toggle("hidden", !wavyOn);
    document.getElementById(`accent-band-${i}-wave-count-field`)?.classList.toggle("hidden", !wavyOn);
    document.getElementById(`accent-band-${i}-rotation-field`)?.classList.toggle("hidden", !wavyOn);
  });
}

function addAccentBand() {
  if (state.accentBands.length >= MAX_ACCENT_BANDS) return;
  const mode = accentUiMode();
  const first = state.accentBands[0];
  const usedColors = new Set(state.accentBands.map((b) => b.color));
  let color = suggestAccentColor(state.boxColor);
  if (usedColors.has(color)) color = suggestAccentColor("#64748b");
  const defaults = { height: first?.height ?? 4, waveAmp: first?.waveAmp ?? 3, waveCount: first?.waveCount ?? 6 };
  const makeOnTop = state.accentBands.length >= 1;
  if (makeOnTop) state.accentBands.forEach((b) => { b.onTop = false; });
  if (mode === "vase") {
    state.accentBands.push(newAccentBand({
      ...defaults,
      pos: Math.max(5, Math.min(95, (first?.pos ?? 50) - 28)),
      edge: "straight",
      color,
      onTop: makeOnTop,
    }));
  } else if (mode === "profile") {
    state.accentBands.push(newAccentBand({
      ...defaults,
      pos: Math.max(5, Math.min(95, (first?.pos ?? 85) - 30)),
      face: "rim",
      color,
      onTop: makeOnTop,
    }));
  } else {
    state.accentBands.push(newAccentBand({
      ...defaults,
      pos: first?.pos ?? 100,
      edge: first?.edge ?? "straight",
      face: first?.face === "floor" ? "rim" : "floor",
      color,
      onTop: makeOnTop,
    }));
  }
  syncFlatAccentFromBands(state);
  scheduleSaveSession();
  renderAccentBandsUi(true);
  rebuild();
  pushAppHistory();
}

function removeAccentBand(index) {
  if (state.accentBands.length <= 1) return;
  state.accentBands.splice(index, 1);
  syncFlatAccentFromBands(state);
  scheduleSaveSession();
  renderAccentBandsUi(true);
  rebuild();
  pushAppHistory();
}

function renderAccentBandsUi(force = false) {
  const wrap = document.getElementById("accent-bands-wrap");
  const container = document.getElementById("accent-bands");
  const addBtn = document.getElementById("btn-accent-add-band");
  const accentOn = state.accentEnabled && accentSupportedForShape();
  wrap?.classList.toggle("hidden", !accentOn);
  if (!accentOn || !container) return;

  ensureStateAccentBands(state);
  const sig = accentBandsUiSignature();
  if (!force && container.dataset.sig === sig) {
    syncAccentBandControlsFromState();
    if (addBtn) {
      addBtn.disabled = state.accentBands.length >= MAX_ACCENT_BANDS;
      addBtn.classList.toggle("hidden", state.accentBands.length >= MAX_ACCENT_BANDS);
    }
    return;
  }
  container.dataset.sig = sig;
  container.innerHTML = "";

  const mode = accentUiMode();
  state.accentBands.forEach((band, i) => {
    if (mode === "profile" && band.face === "front") band.face = "rim";
    if (mode === "vase" && band.face === "front") band.face = "rim";

    const card = document.createElement("div");
    card.className = "accent-band-card";
    card.dataset.bandIndex = String(i);

    const header = document.createElement("div");
    header.className = "accent-band-card-header";
    const title = document.createElement("h3");
    title.className = "accent-band-card-title";
    title.textContent = `Band ${i + 1}`;
    header.appendChild(title);
    if (state.accentBands.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-ghost btn-sm btn-accent-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeAccentBand(i));
      header.appendChild(removeBtn);
    }
    card.appendChild(header);

    if (mode === "box") {
      const faceField = document.createElement("label");
      faceField.className = "field";
      faceField.innerHTML = `<span class="field-label">Face</span>`;
      const faceSel = document.createElement("select");
      faceSel.id = `accent-band-${i}-face`;
      faceSel.innerHTML = `<option value="rim">Rim band (all sides)</option>
           <option value="front">Front panel only</option>
           <option value="floor">Floor stripe (outer base ring)</option>`;
      faceSel.value = band.face || "rim";
      faceSel.addEventListener("change", (e) => {
        const target = state.accentBands[i];
        if (!target) return;
        target.face = e.target.value;
        if (target.face === "floor") target.pos = 0;
        else if (target.face === "rim" && (target.pos == null || target.pos <= 0.5)) target.pos = 100;
        syncFlatAccentFromBands(state);
        scheduleSaveSession();
        rebuild();
      });
      faceField.appendChild(faceSel);
      card.appendChild(faceField);
    }

    if (mode === "vase" || mode === "profile") {
      if (mode === "profile" && band.pos == null) {
        band.pos = band.face === "floor" ? 0 : 85;
      }
      const posField = document.createElement("label");
      posField.className = "field";
      posField.innerHTML = `<span class="field-label">Position <span class="unit">%</span></span>`;
      const posSlider = document.createElement("input");
      posSlider.type = "range";
      posSlider.id = `accent-band-${i}-pos`;
      posSlider.min = "0";
      posSlider.max = "100";
      posSlider.step = "1";
      posSlider.value = String(band.pos ?? 50);
      posSlider.tabIndex = -1;
      const posOut = createAccentBandValueEdit(posSlider.id, i, "pos", "float", band.pos ?? 50);
      posField.append(posSlider, posOut);
      card.appendChild(posField);
      bindAccentBandSlider(posSlider, i, "pos", "float");

      if (mode === "vase") {
      const edgeField = document.createElement("label");
      edgeField.className = "field";
      edgeField.innerHTML = `<span class="field-label">Band edge</span>`;
      const edgeSel = document.createElement("select");
      edgeSel.id = `accent-band-${i}-edge`;
      edgeSel.innerHTML = `
        <option value="straight">Straight ring</option>
        <option value="wave">Wavy (up-n-down)</option>`;
      edgeSel.value = band.edge || "straight";
      edgeSel.addEventListener("change", (e) => {
        const target = state.accentBands[i];
        if (!target) return;
        target.edge = e.target.value;
        syncFlatAccentFromBands(state);
        document.getElementById(`accent-band-${i}-wave-amp-field`)?.classList.toggle("hidden", e.target.value !== "wave");
        document.getElementById(`accent-band-${i}-wave-count-field`)?.classList.toggle("hidden", e.target.value !== "wave");
        document.getElementById(`accent-band-${i}-rotation-field`)?.classList.toggle("hidden", e.target.value !== "wave");
        scheduleSaveSession();
        rebuild();
      });
      edgeField.appendChild(edgeSel);
      card.appendChild(edgeField);

      const rotField = document.createElement("label");
      rotField.className = "field";
      rotField.id = `accent-band-${i}-rotation-field`;
      rotField.classList.toggle("hidden", band.edge !== "wave");
      rotField.innerHTML = `<span class="field-label">Rotate pattern <span class="unit">°</span></span>`;
      const rotSlider = document.createElement("input");
      rotSlider.type = "range";
      rotSlider.id = `accent-band-${i}-rotation`;
      rotSlider.min = "0";
      rotSlider.max = "360";
      rotSlider.step = "1";
      rotSlider.value = String(band.rotation ?? 0);
      rotSlider.tabIndex = -1;
      const rotOut = createAccentBandValueEdit(rotSlider.id, i, "rotation", "float", band.rotation ?? 0);
      rotField.append(rotSlider, rotOut);
      card.appendChild(rotField);
      bindAccentBandSlider(rotSlider, i, "rotation", "float");

      const wavyOn = band.edge === "wave";
      const waveAmpField = document.createElement("label");
      waveAmpField.className = "field";
      waveAmpField.id = `accent-band-${i}-wave-amp-field`;
      waveAmpField.classList.toggle("hidden", !wavyOn);
      waveAmpField.innerHTML = `<span class="field-label">Wave height ${unitLenSpan()}</span>`;
      const waveAmpSlider = document.createElement("input");
      waveAmpSlider.type = "range";
      waveAmpSlider.id = `accent-band-${i}-wave-amp`;
      waveAmpSlider.min = "0.5";
      waveAmpSlider.max = "10";
      waveAmpSlider.step = "0.5";
      waveAmpSlider.value = String(band.waveAmp ?? 3);
      waveAmpSlider.tabIndex = -1;
      const waveAmpOut = createAccentBandValueEdit(waveAmpSlider.id, i, "waveAmp", "float", band.waveAmp ?? 3);
      waveAmpField.append(waveAmpSlider, waveAmpOut);
      card.appendChild(waveAmpField);
      bindAccentBandSlider(waveAmpSlider, i, "waveAmp", "float");

      const waveCountField = document.createElement("label");
      waveCountField.className = "field";
      waveCountField.id = `accent-band-${i}-wave-count-field`;
      waveCountField.classList.toggle("hidden", !wavyOn);
      waveCountField.innerHTML = `<span class="field-label">Waves around</span>`;
      const waveCountSlider = document.createElement("input");
      waveCountSlider.type = "range";
      waveCountSlider.id = `accent-band-${i}-wave-count`;
      waveCountSlider.min = "2";
      waveCountSlider.max = "16";
      waveCountSlider.step = "1";
      waveCountSlider.value = String(band.waveCount ?? 6);
      waveCountSlider.tabIndex = -1;
      const waveCountOut = createAccentBandValueEdit(waveCountSlider.id, i, "waveCount", "int", band.waveCount ?? 6);
      waveCountField.append(waveCountSlider, waveCountOut);
      card.appendChild(waveCountField);
      bindAccentBandSlider(waveCountSlider, i, "waveCount", "int");
      }
    }

    const heightField = document.createElement("label");
    heightField.className = "field";
    heightField.innerHTML = `<span class="field-label">Band height ${unitLenSpan()}</span>`;
    const heightSlider = document.createElement("input");
    heightSlider.type = "range";
    heightSlider.id = `accent-band-${i}-height`;
    heightSlider.min = "2";
    heightSlider.max = "80";
    heightSlider.step = "0.5";
    heightSlider.value = String(band.height ?? 4);
    heightSlider.tabIndex = -1;
    const heightOut = createAccentBandValueEdit(heightSlider.id, i, "height", "float", band.height ?? 4);
    heightField.append(heightSlider, heightOut);
    card.appendChild(heightField);
    bindAccentBandSlider(heightSlider, i, "height", "float");

    if (state.accentBands.length > 1) {
      const topField = document.createElement("label");
      topField.className = "field field-toggle";
      topField.innerHTML = `<span class="field-label">On top</span>`;
      const topCb = document.createElement("input");
      topCb.type = "checkbox";
      topCb.id = `accent-band-${i}-on-top`;
      topCb.checked = !!band.onTop;
      topCb.addEventListener("change", () => {
        if (topCb.checked) {
          state.accentBands.forEach((b, j) => { b.onTop = j === i; });
        } else {
          const other = i === 0 ? 1 : 0;
          state.accentBands[i].onTop = false;
          if (state.accentBands[other]) state.accentBands[other].onTop = true;
        }
        syncFlatAccentFromBands(state);
        syncAccentBandControlsFromState();
        scheduleSaveSession();
        rebuild();
        pushAppHistory();
      });
      topField.appendChild(topCb);
      card.appendChild(topField);
    }

    const colorField = document.createElement("div");
    colorField.className = "field field-color";
    colorField.innerHTML = `<span class="field-label">Band colour</span>`;
    const pickerHost = document.createElement("div");
    pickerHost.id = `accent-band-${i}-color`;
    colorField.appendChild(pickerHost);
    const suggestBtn = document.createElement("button");
    suggestBtn.type = "button";
    suggestBtn.className = "btn btn-ghost accent-band-suggest";
    suggestBtn.textContent = "Suggest contrast";
    suggestBtn.addEventListener("click", () => {
      const target = state.accentBands[i];
      if (!target) return;
      const suggested = suggestAccentColor(state.boxColor);
      target.color = suggested;
      syncFlatAccentFromBands(state);
      setColorPickerValue(pickerHost, suggested);
      applyAccentPreviewColors();
      scheduleSaveSession();
    });
    colorField.appendChild(suggestBtn);
    card.appendChild(colorField);

    mountColorPicker(pickerHost, {
      value: band.color || "#f97316",
      onChange: (hex) => {
        const target = state.accentBands[i];
        if (!target) return;
        target.color = hex;
        syncFlatAccentFromBands(state);
        applyAccentPreviewColors();
        scheduleSaveSession();
      },
    });

    container.appendChild(card);
  });

  if (addBtn) {
    addBtn.disabled = state.accentBands.length >= MAX_ACCENT_BANDS;
    addBtn.classList.toggle("hidden", state.accentBands.length >= MAX_ACCENT_BANDS);
  }
}

function updateDecorUi() {
  const supported = shapeSupportsArt(artUiShape() || state.shape);
  const accentSupported = accentSupportedForShape();
  const insertSupported = shapeSupportsInsert(insertUiShape());
  document.querySelectorAll('.tab[data-tab="accent"], .tab[data-tab="art"], .tab[data-tab="stack"], .tab[data-tab="link"], .tab[data-tab="insert"]').forEach((tab) => {
    const insertTab = tab.dataset.tab === "insert";
    const tabOk = insertTab ? insertSupported : tab.dataset.tab === "accent" ? accentSupported : supported;
    tab.disabled = !tabOk;
    tab.classList.toggle("tab--disabled", !tabOk);
  });

  const accentOn = state.accentEnabled && accentSupported;
  document.getElementById("accent-enabled").checked = accentOn;
  renderAccentBandsUi();

  const insertOn = state.insertEnabled && insertSupported;
  document.getElementById("insert-enabled").checked = insertOn;
  document.getElementById("field-insert-count").classList.toggle("hidden", !insertOn);
  document.getElementById("field-insert-axis").classList.toggle("hidden", !insertOn);
  document.getElementById("field-insert-thickness").classList.toggle("hidden", !insertOn);
  const fixedMount = state.insertMount === "fixed";
  // Welded dividers have no clearance to tune.
  document.getElementById("field-insert-clearance").classList.toggle("hidden", !insertOn || fixedMount);
  document.getElementById("field-insert-mount").classList.toggle("hidden", !insertOn);
  const slotMount = state.insertMount === "slot" && state.insertAxis === "height";
  document.getElementById("field-insert-slot-depth").classList.toggle("hidden", !insertOn || !slotMount);
  document.getElementById("insert-mount-hint")?.classList.toggle(
    "hidden",
    !insertOn || state.insertAxis === "height" || fixedMount,
  );
  document.getElementById("insert-fixed-hint")?.classList.toggle("hidden", !insertOn || !fixedMount);
  document.getElementById("insert-axis").value = state.insertAxis || "length";
  document.getElementById("insert-mount").value = ["slot", "fixed"].includes(state.insertMount) ? state.insertMount : "snap";
  syncInsertCountHint();
  syncInsertTopClearanceUi();

  const honeyOn = state.honeycombEnabled && supported;
  document.getElementById("honeycomb-enabled").checked = honeyOn;
  document.getElementById("field-honeycomb-face").classList.toggle("hidden", !honeyOn);
  document.getElementById("honeycomb-face").value = state.honeycombFace || "back";
  document.getElementById("stackable-enabled").checked = state.stackableEnabled && supported && (state.stackStyle || "hex") !== "nest";
  document.getElementById("field-stackable-hex")?.classList.toggle("hidden", (state.stackStyle || "hex") === "nest");

  const svgLoaded = state.embossSvgEnabled && supported;
  const traceOnBox = !!state.embossTraceEnabled;
  const artOn = hasGraphicArt(buildParams());
  const textOn = textHasInk(state.embossText);
  const svgCb = document.getElementById("emboss-svg-enabled");
  if (svgCb) svgCb.checked = svgLoaded;
  const wm = document.getElementById("watermark-enabled");
  if (wm) wm.checked = state.watermarkEnabled !== false;
  document.getElementById("field-text-color").classList.remove("hidden");
  const multiColourArt = !!(state.embossTraceRects?.multiColour && state.embossTraceRects?.colorLayers?.length > 1);
  document.getElementById("field-art-color").classList.toggle("hidden", !artOn || !!state.embossDeboss || multiColourArt);
  const artColorHint = document.getElementById("art-color-hint");
  if (artColorHint) {
    artColorHint.textContent = multiColourArt
      ? "Multi-colour trace — each colour exports as its own AMS slot."
      : "Single-colour art — pick a contrast filament.";
  }
  document.getElementById("field-text-align").classList.toggle("hidden", !textOn || (state.embossTextLayout || "flat") === "arc");
  document.getElementById("field-text-layout").classList.remove("hidden");
  document.getElementById("field-emboss-font").classList.remove("hidden");
  syncEmbossFaceUi();
  document.getElementById("emboss-deboss").checked = !!state.embossDeboss;
  updateEmbossDebossUi();
  document.getElementById("field-emboss-height")?.classList.remove("hidden");
  document.getElementById("field-trace-size").classList.toggle("hidden", !(svgLoaded || traceOnBox));
  document.getElementById("emboss-font").value = state.embossFont || "bebas";
  syncArtEditorUi();
  syncArtSubPane();
  syncExportFormatOptions();
}

function syncEmbossFaceUi() {
  const select = document.getElementById("emboss-face");
  if (!select) return;
  const profileArt = shapeSupportsProfileArt(state.shape);
  const lidOn = state.lidEnabled && shapeSupportsLid(state.shape);
  const wrapOpt = select.querySelector('option[value="wrap"]');
  for (const opt of select.options) {
    if (opt.value === "wrap") {
      opt.hidden = !profileArt;
      opt.disabled = !profileArt;
    } else if (profileArt) {
      opt.hidden = true;
      opt.disabled = true;
    } else {
      opt.hidden = false;
      opt.disabled = opt.value === "lid" && !lidOn;
    }
  }
  if (profileArt && state.embossFace !== "wrap") {
    state.embossFace = "wrap";
  }
  if (wrapOpt && profileArt) wrapOpt.hidden = false;
  const lidOpt = select.querySelector('option[value="lid"]');
  if (lidOpt) lidOpt.disabled = !lidOn;
  if (state.embossFace === "lid" && !lidOn) {
    state.embossFace = profileArt ? "wrap" : "top";
  }
  const face = state.embossFace ?? (profileArt ? "wrap" : "front");
  select.value = face;

  const hint = document.getElementById("emboss-face-hint");
  if (hint) {
    if (profileArt && face === "wrap") {
      hint.textContent = "Art wraps around the outer wall — great for logos and patterns on pots.";
      hint.classList.remove("hidden");
    } else if (lidOn && face === "top") {
      hint.textContent = "Top puts text on the box body only — Download lid won't include it. Pick Lid top for art on the lid STL.";
      hint.classList.remove("hidden");
    } else if (lidOn && face === "lid") {
      const svgOn = state.embossSvgEnabled && !!state.embossSvgText?.trim();
      const textOn = textHasInk(state.embossText);
      if (svgOn && textOn) {
        hint.textContent = "SVG on the lid STL; text exports as a separate colour part.";
      } else if (svgOn) {
        hint.textContent = "SVG emboss on the lid STL (Download lid).";
      } else {
        hint.textContent = "Text will emboss on the lid STL (Download lid).";
      }
      hint.classList.remove("hidden");
    } else {
      hint.textContent = "";
      hint.classList.add("hidden");
    }
  }
}

function updateEmbossDebossUi() {
  const on = !!state.embossDeboss;
  const hint = document.getElementById("emboss-deboss-hint");
  if (hint) hint.classList.toggle("hidden", !on);
  syncExportFormatOptions();
}

function updateEmbossTextPreviewStyle() {
  const input = document.getElementById("emboss-text");
  const f = embossFontSpec(state.embossFont || "bebas");
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
  const unit = displayUnitLabel();
  for (const { btnId, labelId, sliderId } of DIMENSION_EDITS) {
    const btn = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    const slider = document.getElementById(sliderId);
    if (!btn || !label || !slider) continue;
    btn.setAttribute("aria-label", `Edit ${label.textContent.toLowerCase()} in ${unit}`);
  }
  document.querySelectorAll(".value-edit[data-key]").forEach((btn) => {
    if (!isLengthKey(btn.dataset.key)) return;
    const field = btn.closest(".field");
    const labelEl = field?.querySelector(".field-label");
    const labelText = labelEl?.textContent?.replace(/\s*(mm|cm|in)\s*$/i, "").trim() || btn.dataset.key;
    btn.setAttribute("aria-label", `Edit ${labelText.toLowerCase()} in ${unit}`);
  });
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
  const mmVal = isLengthKey(key) ? displayToMm(val) : val;
  const stored = parseKind === "float" ? parseFloat(mmVal) : Number(mmVal);
  state[key] = stored;
  let display;
  if (isLengthKey(key)) {
    const mmMin = parseFloat(slider.dataset.mmMin ?? slider.min);
    const mmMax = parseFloat(slider.dataset.mmMax ?? slider.max);
    display = applyLengthSliderRange(slider, mmMin, mmMax, stored);
  } else {
    display = formatSliderValue(val, slider.step);
    slider.value = display;
  }
  const out = document.querySelector(`.value-edit[data-slider="${slider.id}"]`);
  if (out) out.textContent = display;
  if (key === "embossArcRadius") syncArcRadiusUi();
  rebuild();
  pushAppHistory();
}

function bindRange(sliderId, key, parseKind = "int") {
  const slider = document.getElementById(sliderId);
  const syncFromSlider = () => {
    let val = parseFieldValue(slider.value, parseKind);
    if (isLengthKey(key)) val = displayToMm(val);
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
      if (btn.dataset.accentBand != null && btn.dataset.accentKey) {
        applyAccentBandSliderValue(slider, Number(btn.dataset.accentBand), btn.dataset.accentKey, val, parseKind);
      } else {
        applySliderValue(slider, btn.dataset.key, val, parseKind);
      }
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
bindRange("lid-lip", "lidLipDepth", "float");
bindRange("lid-gasket-width", "lidGasketWidth", "float");
bindRange("lid-gasket-depth", "lidGasketDepth", "float");
bindRange("joiner-width", "joinerWidth", "float");
bindRange("joiner-neck", "joinerNeck", "float");
bindRange("joiner-protrusion", "joinerProtrusion", "float");
bindRange("insert-thickness", "insertThickness", "float");
bindRange("insert-clearance", "insertClearance", "float");
bindRange("insert-slot-depth", "insertSlotDepth", "float");
bindRange("insert-count", "insertCount", "int");

document.getElementById("insert-top-auto")?.addEventListener("change", (e) => {
  state.insertTopClearanceAuto = e.target.checked;
  syncInsertTopClearanceUi();
  rebuild();
  pushAppHistory();
});

const insertTopSlider = document.getElementById("insert-top-clearance");
if (insertTopSlider) {
  insertTopSlider.addEventListener("input", () => {
    state.insertTopClearanceAuto = false;
    const autoCb = document.getElementById("insert-top-auto");
    if (autoCb) autoCb.checked = false;
    state.insertTopClearance = displayToMm(parseFieldValue(insertTopSlider.value, "float"));
    const out = document.getElementById("out-insert-top-clearance");
    if (out) out.textContent = insertTopSlider.value;
    syncInsertTopClearanceUi();
    rebuild();
  });
  insertTopSlider.addEventListener("change", () => pushAppHistory());
}

bindRange("trace-threshold", "traceThreshold", "int");

function bindArtStateSlider(sliderId, stateKey, parseKind = "float") {
  const slider = document.getElementById(sliderId);
  if (!slider) return;
  const arcAdvancedKeys = new Set([
    "embossArcRadius",
    "embossArcSweep",
    "embossArcStartDeg",
    "embossArcTilt",
    "embossArcSpacing",
  ]);
  slider.addEventListener("input", () => {
    let val = parseFieldValue(slider.value, parseKind);
    if (isLengthKey(stateKey)) val = displayToMm(val);
    state[stateKey] = val;
    const out = document.querySelector(`.value-edit[data-slider="${sliderId}"]`);
    if (out) out.textContent = slider.value;
    if (arcAdvancedKeys.has(stateKey)) state.embossArcPreset = "custom";
    if (stateKey === "embossHeight") syncArtSizeSlider();
    if (stateKey === "embossArcRadius") syncArcRadiusUi();
    if (stateKey === "embossTraceSize" && (state.embossTextLayout || "flat") === "arc") syncArtArcRadiusSlider();
    if (arcAdvancedKeys.has(stateKey)) syncArcPresetUi();
    scheduleArtRebuild();
  });
  slider.addEventListener("change", () => pushAppHistory());
}

bindArtStateSlider("emboss-height", "embossHeight");
bindArtStateSlider("emboss-depth", "embossDepth");
bindArtStateSlider("emboss-arc-curve", "embossArcCurve", "int");
bindArtStateSlider("emboss-arc-radius", "embossArcRadius", "float");
bindArtStateSlider("emboss-arc-sweep", "embossArcSweep", "float");
bindArtStateSlider("emboss-arc-start", "embossArcStartDeg", "float");
bindArtStateSlider("emboss-arc-tilt", "embossArcTilt", "float");
bindArtStateSlider("emboss-arc-spacing", "embossArcSpacing", "float");
bindArtStateSlider("text-offset-x", "textOffsetX", "float");
bindArtStateSlider("text-offset-y", "textOffsetY", "float");
bindArtStateSlider("text-rotation", "textRotation", "float");
bindArtStateSlider("art-rotation", "decorRotation", "float");
bindArtStateSlider("art-offset-x", "decorOffsetX", "float");
bindArtStateSlider("art-offset-y", "decorOffsetY", "float");
bindArtStateSlider("trace-size", "embossTraceSize");

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.disabled) return;
    setTab(tab.dataset.tab);
  });
});

document.getElementById("btn-lid-preview-fit").addEventListener("click", () => playLidFitPreview());

document.getElementById("lid-type").addEventListener("change", (e) => {
  state.lidType = e.target.value;
  if (!state.lidEnabled && shapeSupportsLid(state.shape)) {
    state.lidEnabled = true;
  }
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

document.getElementById("lid-gasket-enabled")?.addEventListener("change", (e) => {
  state.lidGasketEnabled = e.target.checked;
  updateLidUi();
  rebuild();
  pushAppHistory();
});

document.getElementById("lid-gasket-export-ring")?.addEventListener("change", (e) => {
  state.lidGasketExportRing = e.target.checked;
  updateLidUi();
  rebuild();
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
  ensureStateAccentBands(state);
  renderAccentBandsUi(true);
  updateDecorUi();
  rebuild();
});

document.getElementById("btn-accent-add-band")?.addEventListener("click", () => addAccentBand());

document.getElementById("insert-enabled").addEventListener("change", (e) => {
  state.insertEnabled = e.target.checked;
  rebuild();
});

document.getElementById("insert-axis").addEventListener("change", (e) => {
  state.insertAxis = e.target.value;
  if (state.insertMount === "slot" && state.insertAxis !== "height") {
    state.insertMount = "snap";
    document.getElementById("insert-mount").value = "snap";
  }
  // Welded shelves would print mid-air — fixed mount is vertical-only.
  if (state.insertMount === "fixed" && state.insertAxis === "height") {
    state.insertMount = "snap";
    document.getElementById("insert-mount").value = "snap";
  }
  rebuild();
});

document.getElementById("insert-mount").addEventListener("change", (e) => {
  state.insertMount = e.target.value;
  if (state.insertMount === "fixed" && state.joinerEnabled) {
    state.joinerEnabled = false;
    document.getElementById("joiner-enabled").checked = false;
    updateJoinerUi();
  }
  if (state.insertMount === "slot" && state.insertAxis !== "height") {
    state.insertAxis = "height";
    document.getElementById("insert-axis").value = "height";
  }
  if (state.insertMount === "fixed" && state.insertAxis === "height") {
    state.insertAxis = "length";
    document.getElementById("insert-axis").value = "length";
  }
  rebuild();
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
  if (textHasInk(state.embossText) && hasGraphicArt(buildParams()) && (state.embossTextLayout || "flat") === "flat") {
    state.embossTextLayout = "arc";
    const wrapArc = state.embossFace === "wrap";
    applyArcPreset(wrapArc ? "banner" : "arch-up", { nudgeGraphic: false, preserveOffsets: true });
    syncTextLayoutUi();
  }
  updateDecorUi();
  syncArtEditorUi();
  scheduleArtRebuild();
  scheduleSaveSession();
});

document.querySelectorAll(".align-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.embossTextAlign = btn.dataset.textAlign || "left";
    syncTextAlignUi();
    scheduleArtRebuild();
    pushAppHistory();
  });
});

document.querySelectorAll(".layout-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = btn.dataset.textLayout || "flat";
    state.embossTextLayout = next;
    if (next === "arc") {
      const wrapGraphic = state.embossFace === "wrap" && hasGraphicArt(buildParams());
      applyArcPreset(wrapGraphic ? "banner" : "arch-up", {
        nudgeGraphic: false,
        preserveOffsets: true,
      });
      state.textRotation = 0;
    }
    syncTextLayoutUi();
    updateDecorUi();
    scheduleArtRebuild();
    pushAppHistory();
  });
});

document.querySelectorAll(".arc-preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.arcPreset;
    if (!id) return;
    const wrapGraphic = state.embossFace === "wrap" && hasGraphicArt(buildParams());
    applyArcPreset(id, { nudgeGraphic: wrapGraphic, preserveOffsets: !wrapGraphic });
    if (wrapGraphic) {
      setArtSlider("text-offset-x", state.textOffsetX ?? 0, "float");
      setArtSlider("text-offset-y", state.textOffsetY ?? 0, "float");
    }
    syncTextLayoutUi();
    scheduleArtRebuild();
    pushAppHistory();
  });
});

document.getElementById("btn-arc-advanced")?.addEventListener("click", () => {
  state.embossArcAdvanced = !state.embossArcAdvanced;
  syncTextLayoutUi();
});

document.getElementById("emboss-font").addEventListener("change", async (e) => {
  state.embossFont = e.target.value;
  await ensureEmbossFontLoaded(e.target.value);
  updateEmbossTextPreviewStyle();
  scheduleArtRebuild();
  pushAppHistory();
});

document.getElementById("emboss-svg-enabled")?.addEventListener("change", (e) => {
  state.embossSvgEnabled = e.target.checked;
  if (e.target.checked) {
    clearEmbossTrace();
  } else {
    state.embossSvgText = "";
    state.embossSvgFileName = "";
    const svgFile = document.getElementById("svg-file");
    if (svgFile) svgFile.value = "";
  }
  updateDecorUi();
  syncArtEditorUi();
  scheduleArtRebuild(true);
  pushAppHistory();
});

document.getElementById("emboss-face").addEventListener("change", (e) => {
  state.embossFace = e.target.value;
  syncEmbossFaceUi();
  syncArtEditorUi();
  if (traceSourceCanvas) runTraceAsync();
  scheduleArtRebuild(true);
  pushAppHistory();
});

document.getElementById("emboss-deboss").addEventListener("change", (e) => {
  state.embossDeboss = e.target.checked;
  syncArtEditorUi();
  scheduleArtRebuild(true);
  pushAppHistory();
});

document.getElementById("btn-art-clear").addEventListener("click", () => {
  clearDecorFromBox();
});

document.getElementById("honeycomb-face").addEventListener("change", (e) => {
  state.honeycombFace = e.target.value;
  rebuild();
});

const traceDrop = document.getElementById("trace-drop");
const traceFileInput = document.getElementById("trace-file");

document.querySelectorAll(".art-subnav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setArtSubPane(btn.dataset.artPane || "graphic");
    scheduleSaveSession();
  });
});

function fileFromDropEvent(e) {
  const dt = e.dataTransfer;
  if (!dt) return null;
  if (dt.files?.length) return dt.files[0];
  const items = [...(dt.items || [])];
  const fileItem = items.find((item) => item.kind === "file");
  return fileItem?.getAsFile() || null;
}

function wireArtDropZone(el, onFile, { openInput = null } = {}) {
  if (!el) return;
  let dragDepth = 0;
  const overCls = "trace-drop--over";
  const setOver = (on) => el.classList.toggle(overCls, on);

  el.addEventListener("click", (e) => {
    if (e.target.closest('input[type="file"]')) return;
    openInput?.click();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openInput?.click();
    }
  });
  el.addEventListener("dragenter", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth += 1;
    setOver(true);
  });
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setOver(true);
  });
  el.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setOver(false);
  });
  el.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    setOver(false);
    const file = fileFromDropEvent(e);
    if (file) await onFile(file);
  });
}

wireArtDropZone(traceDrop, handleTraceFile, { openInput: traceFileInput });

if (traceDrop) traceDrop.setAttribute("tabindex", "0");

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
  if (!meshCache) rebuild();
  if (meshCache) fitCamera(meshCache.meta);
});

document.getElementById("btn-reset-defaults").addEventListener("click", () => {
  resetToDefaults();
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

document.getElementById("btn-trace-clear").addEventListener("click", clearTraceImageAndEmboss);

document.getElementById("btn-trace-svg").addEventListener("click", () => {
  if (!traceLastSvg) return;
  const blob = new Blob([traceLastSvg], { type: "image/svg+xml" });
  downloadBlob(blob, "traced-art.svg");
});

document.getElementById("btn-load-badge-sample")?.addEventListener("click", async () => {
  try {
    const res = await fetch("samples/mechanic-badge.svg");
    if (!res.ok) throw new Error("Could not load mechanic badge sample");
    await importSvgFile(await res.text(), { fileName: "mechanic-badge.svg" });
    if (state.lidEnabled && shapeSupportsLid(state.shape)) {
      state.embossFace = "lid";
      document.getElementById("emboss-face").value = "lid";
      syncEmbossFaceUi();
      rebuild();
    }
  } catch (err) {
    console.error("Badge sample failed:", err);
    const meta = document.getElementById("trace-meta");
    if (meta) meta.textContent = err.message || "Could not load badge sample";
  }
});

document.getElementById("watermark-enabled")?.addEventListener("change", (e) => {
  state.watermarkEnabled = e.target.checked;
  scheduleSaveSession();
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
    selectShape(btn.dataset.shape);
  });
});

document.getElementById("canister-content")?.addEventListener("change", (e) => {
  applyCanisterContent(e.target.value);
});

document.querySelectorAll("[data-canister-size]").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyCanisterSize(btn.dataset.canisterSize);
  });
});

document.querySelectorAll("[data-stack-member]").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyCanisterContent(btn.dataset.stackMember);
  });
});

// Hide canister controls until a kitchen preset is active.
syncCanisterControlsFromState();

function updateProfileTextureUiVisibility() {
  const supported = shapeSupportsProfileTexture(state.shape);
  const textureOn = !!state.vaseTextureEnabled;
  document.getElementById("section-profile-texture")?.classList.toggle("hidden", !supported);
  document.getElementById("field-profile-texture-style")?.classList.toggle("hidden", !supported || !textureOn);
  document.getElementById("field-profile-texture-depth")?.classList.toggle("hidden", !supported || !textureOn);
  document.getElementById("field-profile-texture-scale")?.classList.toggle("hidden", !supported || !textureOn);
}

function updateVaseUiVisibility() {
  const isVase = state.shape === "vase";
  if (isVase && state.lidEnabled) {
    state.lidEnabled = false;
  }
  document.getElementById("section-vase").classList.toggle("hidden", !isVase);
  document.getElementById("section-classic-size").classList.toggle("hidden", isVase);
  document.getElementById("section-walls").classList.toggle("hidden", isVase);
  document.getElementById("section-edges").classList.toggle("hidden", isVase);
  document.querySelectorAll('.tab[data-tab="art"], .tab[data-tab="stack"], .tab[data-tab="link"], .tab[data-tab="lid"], .tab[data-tab="insert"]').forEach((tab) => {
    tab.classList.toggle("tab--disabled", isVase);
    tab.disabled = isVase;
  });
  document.getElementById("field-vase-drainage-size").classList.toggle("hidden", !state.vaseDrainage);
  document.getElementById("field-vase-flute-depth").classList.toggle("hidden", !(state.vaseFlutes > 0));
  document.getElementById("field-vase-twist").classList.toggle("hidden", !(state.vaseFlutes > 0));
  const textureOn = !!state.vaseTextureEnabled;
  document.getElementById("field-vase-texture-style")?.classList.toggle("hidden", !textureOn);
  document.getElementById("field-vase-texture-depth")?.classList.toggle("hidden", !textureOn);
  document.getElementById("field-vase-texture-scale")?.classList.toggle("hidden", !textureOn);
  updateProfileTextureUiVisibility();
  syncExportFormatOptions();
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
bindRange("vase-flutes", "vaseFlutes");
bindRange("vase-flute-depth", "vaseFluteDepth", "float");
bindRange("vase-twist", "vaseTwist", "float");
document.getElementById("vase-flutes").addEventListener("input", () => {
  const flutesOn = state.vaseFlutes > 0;
  document.getElementById("field-vase-flute-depth").classList.toggle("hidden", !flutesOn);
  document.getElementById("field-vase-twist").classList.toggle("hidden", !flutesOn);
});

document.getElementById("vase-texture-enabled")?.addEventListener("change", (e) => {
  state.vaseTextureEnabled = e.target.checked;
  const profileOn = document.getElementById("profile-texture-enabled");
  if (profileOn) profileOn.checked = state.vaseTextureEnabled;
  updateVaseUiVisibility();
  scheduleSaveSession();
  rebuild();
});

document.getElementById("profile-texture-enabled")?.addEventListener("change", (e) => {
  state.vaseTextureEnabled = e.target.checked;
  const vaseOn = document.getElementById("vase-texture-enabled");
  if (vaseOn) vaseOn.checked = state.vaseTextureEnabled;
  updateVaseUiVisibility();
  scheduleSaveSession();
  rebuild();
});

document.getElementById("vase-texture-style")?.addEventListener("change", (e) => {
  state.vaseTextureStyle = e.target.value;
  const profileSel = document.getElementById("profile-texture-style");
  if (profileSel) profileSel.value = state.vaseTextureStyle;
  scheduleSaveSession();
  rebuild();
});

document.getElementById("profile-texture-style")?.addEventListener("change", (e) => {
  state.vaseTextureStyle = e.target.value;
  const vaseSel = document.getElementById("vase-texture-style");
  if (vaseSel) vaseSel.value = state.vaseTextureStyle;
  scheduleSaveSession();
  rebuild();
});

bindRange("vase-texture-depth", "vaseTextureDepth", "float");
bindRange("vase-texture-scale", "vaseTextureScale", "float");
bindRange("profile-texture-depth", "vaseTextureDepth", "float");
bindRange("profile-texture-scale", "vaseTextureScale", "float");

document.getElementById("vase-rim").addEventListener("change", (e) => {
  state.vaseRim = e.target.value;
  rebuild();
});

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

function updateLengthUnitLabels() {
  document.querySelectorAll(".unit-len").forEach((el) => {
    el.textContent = displayUnitLabel();
  });
}

function refreshDisplayUnitUi() {
  updateLengthUnitLabels();
  syncShapeControlsFromState();
  syncCanisterControlsFromState();
  updateVaseUiVisibility();
  updateLidUi();
  updateJoinerUi();
  updateDecorUi();
  syncArtEditorUi();
  syncInsertTopClearanceUi();
  syncAccentBandControlsFromState();
  if (meshCache?.meta) updateStats(meshCache.meta);
  updateDimensionAriaLabels();
}

function setDisplayUnit(unit) {
  state.displayUnit = normalizeDisplayUnit(unit);
  const sel = document.getElementById("display-unit");
  if (sel && sel.value !== state.displayUnit) sel.value = state.displayUnit;
  refreshDisplayUnitUi();
  scheduleSaveSession();
}

document.getElementById("display-unit")?.addEventListener("change", (e) => {
  setDisplayUnit(e.target.value);
});

document.getElementById("export-format")?.addEventListener("change", () => syncExportPlanUi());

document.getElementById("btn-export-go")?.addEventListener("click", async () => {
  const sel = document.getElementById("export-format");
  const format = sel?.value || "3mf";
  const choice = await openExportDialog(format);
  if (!choice) return;
  runExport(format, choice);
});

initExportDialog();

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
syncSliderUi("lid-lip", "lidLipDepth", { min: 0, max: 8, value: state.lidLipDepth ?? 0, parseKind: "float" });
syncSliderUi("lid-gasket-width", "lidGasketWidth", { min: 1.2, max: 4, value: state.lidGasketWidth ?? 2, parseKind: "float" });
syncSliderUi("lid-gasket-depth", "lidGasketDepth", { min: 0.6, max: 2.5, value: state.lidGasketDepth ?? 1.2, parseKind: "float" });
syncSliderUi("lid-clearance", "lidClearance", { min: 0.15, max: 0.8, value: state.lidClearance, parseKind: "float" });
syncSliderUi("joiner-width", "joinerWidth", { min: 5, max: 22, value: state.joinerWidth, parseKind: "float" });
syncSliderUi("joiner-neck", "joinerNeck", { min: 3, max: 16, value: state.joinerNeck, parseKind: "float" });
syncSliderUi("joiner-protrusion", "joinerProtrusion", { min: 2, max: 10, value: state.joinerProtrusion, parseKind: "float" });
syncSliderUi("insert-thickness", "insertThickness", { min: 1.2, max: 4, value: state.insertThickness, parseKind: "float" });
syncSliderUi("insert-clearance", "insertClearance", { min: 0.15, max: 1, value: state.insertClearance, parseKind: "float" });
syncSliderUi("emboss-depth", "embossDepth", { min: 0.3, max: 2, value: state.embossDepth, parseKind: "float" });
syncSliderUi("emboss-height", "embossHeight", { min: 3, max: 48, value: state.embossHeight, parseKind: "float" });
syncSliderUi("emboss-arc-radius", "embossArcRadius", { min: 0, max: 200, value: state.embossArcRadius ?? 0, parseKind: "float" });
syncSliderUi("emboss-arc-curve", "embossArcCurve", { min: 0, max: 100, value: state.embossArcCurve ?? 60, parseKind: "int" });
syncSliderUi("emboss-arc-sweep", "embossArcSweep", { min: 40, max: 360, value: state.embossArcSweep ?? 220, parseKind: "float" });
syncSliderUi("emboss-arc-start", "embossArcStartDeg", { min: -180, max: 180, value: state.embossArcStartDeg ?? -90, parseKind: "float" });
syncSliderUi("emboss-arc-tilt", "embossArcTilt", { min: -180, max: 180, value: state.embossArcTilt ?? 0, parseKind: "float" });
syncSliderUi("emboss-arc-spacing", "embossArcSpacing", { min: 0.7, max: 1.8, value: state.embossArcSpacing ?? 1, parseKind: "float" });
syncArcRadiusUi();
syncSliderUi("trace-threshold", "traceThreshold", { min: 20, max: 254, value: state.traceThreshold });
syncSliderUi("trace-size", "embossTraceSize", { min: 6, max: 56, value: state.embossTraceSize, parseKind: "float" });
syncSliderUi("art-rotation", "decorRotation", { min: -180, max: 180, value: state.decorRotation ?? 0, parseKind: "float" });
syncSliderUi("art-offset-x", "decorOffsetX", { min: -80, max: 80, value: state.decorOffsetX ?? 0, parseKind: "float" });
syncSliderUi("art-offset-y", "decorOffsetY", { min: -80, max: 80, value: state.decorOffsetY ?? 0, parseKind: "float" });
syncSliderUi("text-offset-x", "textOffsetX", { min: -80, max: 80, value: state.textOffsetX ?? 0, parseKind: "float" });
syncSliderUi("text-offset-y", "textOffsetY", { min: -80, max: 80, value: state.textOffsetY ?? 0, parseKind: "float" });
syncSliderUi("text-rotation", "textRotation", { min: -180, max: 180, value: state.textRotation ?? 0, parseKind: "float" });

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
  setupColorPickers();
  syncLidTypeSelect();
  ensureStateAccentBands(state);
  const restored = await restoreSession();
  const unitSel = document.getElementById("display-unit");
  if (unitSel) unitSel.value = normalizeDisplayUnit(state.displayUnit);
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
    embossFontSelect.value = state.embossFont || "bebas";
    updateEmbossTextPreviewStyle();
    setTab("design");
  }

  appHistory = [];
  appHistoryIndex = -1;
  pushAppHistory();
  updateTraceUi();

  await ensureEmbossFontLoaded(state.embossFont);
  refreshDisplayUnitUi();
  const buildTag = document.getElementById("makerdeck-build");
  if (buildTag) buildTag.textContent = MAKERDECK_BUILD;
  sessionBooting = false;
  try {
    rebuild();
    if (meshCache) fitCamera(meshCache.meta);
  } catch (err) {
    console.error("MakerDeck boot rebuild failed:", err);
    resetToDefaultBox();
  }

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
