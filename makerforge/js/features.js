/**
 * Accent bands, emboss, honeycomb stamp, stackable hex grid, mesh merge.
 */

import { dilateMask, extrudeShapeGroup, extrudeShapeGroupBetween, filterDegenerateShapeGroups, groupPolygonsWithHoles, maskToPolygons, prepareShapeGroups, prepareStrokePaths, previewMergeTraceShapeGroups, rasterizeShapeGroupsToMask, rasterizeStrokePathsToMask, simplifyPolygon, triangulateMappedCap, unionDenseEmbossShapeGroups, unionShapeGroupsToPrepared } from "./contour.js?v=223";
import { decorPlacementOffsets, decorArtRect, rotateFacePoint, rotateShapeGroup } from "./decor.js";
import {
  profileOutlineNormals,
  profileOutlineArcMetrics,
  resolveVaseTexture,
  vaseTextureDisplacement,
} from "./vase-textures.js";

export const EMBOSS_FONTS = [
  { id: "segoe-ui", label: "Segoe UI — Windows", family: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif', weight: 700 },
  { id: "bahnschrift", label: "Bahnschrift — Windows", family: 'Bahnschrift, "Segoe UI", sans-serif', weight: 600 },
  { id: "calibri", label: "Calibri — Office", family: 'Calibri, "Segoe UI", Candara, sans-serif', weight: 700 },
  { id: "candara", label: "Candara — Office", family: 'Candara, Calibri, sans-serif', weight: 700 },
  { id: "corbel", label: "Corbel — Office", family: 'Corbel, Calibri, sans-serif', weight: 700 },
  { id: "constantia", label: "Constantia — Office serif", family: "Constantia, Georgia, serif", weight: 700 },
  { id: "cambria", label: "Cambria — Office serif", family: "Cambria, Georgia, serif", weight: 700 },
  { id: "arial", label: "Arial — Windows sans", family: "Arial, Helvetica, sans-serif", weight: 700 },
  { id: "arial-black", label: "Arial Black — heavy", family: '"Arial Black", Arial, sans-serif', weight: 900 },
  { id: "tahoma", label: "Tahoma — Windows UI", family: 'Tahoma, "Segoe UI", sans-serif', weight: 700 },
  { id: "trebuchet", label: "Trebuchet MS — friendly", family: '"Trebuchet MS", Tahoma, sans-serif', weight: 700 },
  { id: "verdana", label: "Verdana — readable", family: "Verdana, Geneva, sans-serif", weight: 700 },
  { id: "segoe-print", label: "Segoe Print — casual", family: '"Segoe Print", "Segoe UI", cursive', weight: 400 },
  { id: "segoe-script", label: "Segoe Script — script", family: '"Segoe Script", "Segoe UI", cursive', weight: 400 },
  { id: "gabriola", label: "Gabriola — decorative", family: 'Gabriola, "Segoe UI", serif', weight: 400 },
  { id: "franklin", label: "Franklin Gothic — poster", family: '"Franklin Gothic Medium", Arial, sans-serif', weight: 500 },
  { id: "century-gothic", label: "Century Gothic — geometric", family: '"Century Gothic", Arial, sans-serif', weight: 700 },
  { id: "lucida-sans", label: "Lucida Sans — humanist", family: '"Lucida Sans Unicode", "Segoe UI", sans-serif', weight: 700 },
  { id: "palatino", label: "Palatino Linotype — book", family: '"Palatino Linotype", Georgia, serif', weight: 700 },
  { id: "book-antiqua", label: "Book Antiqua — classic", family: '"Book Antiqua", Palatino, serif', weight: 700 },
  { id: "garamond", label: "Garamond — elegant", family: 'Garamond, "Times New Roman", serif', weight: 700 },
  { id: "times", label: "Times New Roman — Office", family: '"Times New Roman", Times, serif', weight: 700 },
  { id: "georgia", label: "Georgia — serif", family: "Georgia, 'Times New Roman', serif", weight: 700 },
  { id: "sitka", label: "Sitka — reading", family: 'Sitka, Georgia, serif', weight: 700 },
  { id: "impact", label: "Impact — poster", family: 'Impact, "Arial Black", sans-serif', weight: 400 },
  { id: "haettenschweiler", label: "Haettenschweiler — narrow", family: "Haettenschweiler, Impact, sans-serif", weight: 400 },
  { id: "ms-sans", label: "Microsoft Sans Serif", family: '"Microsoft Sans Serif", Tahoma, sans-serif', weight: 400 },
  { id: "consolas", label: "Consolas — mono", family: 'Consolas, "Courier New", monospace', weight: 700 },
  { id: "courier", label: "Courier New — mono", family: '"Courier New", Courier, monospace', weight: 700 },
  { id: "lucida-console", label: "Lucida Console — mono", family: '"Lucida Console", Consolas, monospace', weight: 400 },
  { id: "inter", label: "Inter — clean sans", family: 'Inter, "Segoe UI", system-ui, sans-serif', weight: 700 },
  { id: "bebas", label: "Bebas Neue — label", family: '"Bebas Neue", Impact, sans-serif', weight: 400, google: "Bebas Neue" },
  { id: "anton", label: "Anton — display", family: 'Anton, Impact, sans-serif', weight: 400, google: "Anton" },
  { id: "oswald", label: "Oswald — condensed", family: 'Oswald, "Arial Narrow", sans-serif', weight: 700, google: "Oswald" },
  { id: "roboto", label: "Roboto — modern", family: "Roboto, Arial, sans-serif", weight: 700, google: "Roboto" },
  { id: "roboto-mono", label: "Roboto Mono — tech", family: '"Roboto Mono", "Courier New", monospace', weight: 700, google: "Roboto Mono" },
];

export function embossFontSpec(id) {
  return EMBOSS_FONTS.find((f) => f.id === id) || EMBOSS_FONTS[0];
}

export function embossFontStack(id, fontSizePx) {
  const f = embossFontSpec(id);
  return `${f.weight} ${fontSizePx}px ${f.family}`;
}

export async function ensureEmbossFontLoaded(id) {
  if (typeof document === "undefined" || !document.fonts) return;
  const f = embossFontSpec(id);
  if (!f.google) return;
  try {
    await document.fonts.load(embossFontStack(id, 96));
  } catch {
    /* fall back to system fonts */
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function vec3(x, y, z) {
  return [x, y, z];
}

function pushTri(outPos, outIdx, a, b, c) {
  const base = outPos.length / 3;
  outPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  outIdx.push(base, base + 1, base + 2);
}

function pushQuad(outPos, outIdx, a, b, c, d) {
  pushTri(outPos, outIdx, a, b, c);
  pushTri(outPos, outIdx, a, c, d);
}

export function mergeMeshes(...parts) {
  const positions = [];
  const indices = [];
  for (const part of parts) {
    if (!part?.positions?.length || !part?.indices?.length) continue;
    const offset = positions.length / 3;
    const partPos = part.positions;
    for (let i = 0; i < partPos.length; i++) positions.push(partPos[i]);
    for (const idx of part.indices) indices.push(idx + offset);
  }
  return { positions, indices };
}

/** Merge meshes with vertex snapping — welded dividers must share shell corner verts. */
export function mergeMeshesSnap(...parts) {
  const eps = 0.015;
  const positions = [];
  const indices = [];
  const table = new Map();

  function vertexIndex(x, y, z) {
    const k = `${Math.round(x / eps)}|${Math.round(y / eps)}|${Math.round(z / eps)}`;
    let idx = table.get(k);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(x, y, z);
      table.set(k, idx);
    }
    return idx;
  }

  for (const part of parts) {
    if (!part?.positions?.length || !part?.indices?.length) continue;
    const remap = new Array(part.positions.length / 3);
    for (let v = 0; v < part.positions.length; v += 3) {
      remap[v / 3] = vertexIndex(part.positions[v], part.positions[v + 1], part.positions[v + 2]);
    }
    for (let t = 0; t < part.indices.length; t++) {
      indices.push(remap[part.indices[t]]);
    }
  }
  return { positions, indices };
}

export function rectFeatureBounds(meta) {
  const { inner, outer } = meta;
  return {
    ow2: outer.w / 2,
    od2: outer.d / 2,
    iw2: inner.w / 2,
    id2: inner.d / 2,
    outerW: outer.w,
    outerD: outer.d,
    innerW: inner.w,
    innerD: inner.d,
    totalH: outer.h,
    cavityH: inner.h,
    floor: outer.h - inner.h,
  };
}

function wallBand(outPos, outIdx, axis, wallCoord, t0, t1, z0, z1) {
  const a0 = axis === "y" ? vec3(t0, wallCoord, z0) : vec3(wallCoord, t0, z0);
  const a1 = axis === "y" ? vec3(t1, wallCoord, z0) : vec3(wallCoord, t1, z0);
  const a2 = axis === "y" ? vec3(t1, wallCoord, z1) : vec3(wallCoord, t1, z1);
  const a3 = axis === "y" ? vec3(t0, wallCoord, z1) : vec3(wallCoord, t0, z1);
  pushQuad(outPos, outIdx, a0, a1, a2, a3);
}

function shapeGroupsBounds2d(groups) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const group of groups) {
    for (const ring of [group.outer, ...group.holes]) {
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function scaleShapeGroupsToLocal(groups, minX, minY, stepMm) {
  const inv = 1 / stepMm;
  return groups.map((group) => ({
    outer: group.outer.map(([x, y]) => [(x - minX) * inv, (y - minY) * inv]),
    holes: group.holes.map((hole) => hole.map(([x, y]) => [(x - minX) * inv, (y - minY) * inv])),
  }));
}

/** Accent-style face decal — horizontal slabs hugging the wall (flat faces + wrap). */
function buildFaceDecalSlabMesh(frame, shapeGroups, opts = {}) {
  if (!shapeGroups?.length || !frame?.mapPoint) return null;
  if (!["front", "back", "left", "right", "wrap"].includes(frame.face)) return null;

  const stepMm = opts.stepMm ?? DECAL_LAYER_MM;
  const d0 = opts.d0 ?? ACCENT_SKIN_MM;
  const d1 = opts.d1 ?? (ACCENT_SKIN_MM + ACCENT_BAND_THICKNESS_MM);
  const bounds = shapeGroupsBounds2d(shapeGroups);
  if (!bounds) return null;

  const pad = stepMm;
  const grid = resolveSlabGrid(bounds, stepMm, pad);
  const effStep = grid.stepMm;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const maxX = bounds.maxX + pad;
  const maxY = bounds.maxY + pad;
  const cols = grid.cols;
  const rows = grid.rows;

  const local = scaleShapeGroupsToLocal(shapeGroups, minX, minY, effStep);
  let mask = rasterizeShapeGroupsToMask(local, cols, rows);
  const dilatePasses = opts.dilatePasses ?? 1;
  if (dilatePasses > 0) mask = dilateMask(mask, cols, rows, dilatePasses);

  const positions = [];
  const indices = [];
  const w = (i, j, k) => [positions[i], positions[j], positions[k]];

  for (let row = 0; row < rows; row++) {
    const py0 = minY + row * effStep;
    const py1 = py0 + effStep;
    let col = 0;
    while (col < cols) {
      while (col < cols && !mask[row * cols + col]) col++;
      const start = col;
      while (col < cols && mask[row * cols + col]) col++;
      if (col <= start) continue;
      const px0 = minX + start * effStep;
      const px1 = minX + col * effStep;

      const c00 = frame.mapPoint(px0, py0, d0);
      const c10 = frame.mapPoint(px1, py0, d0);
      const c11 = frame.mapPoint(px1, py1, d0);
      const c01 = frame.mapPoint(px0, py1, d0);
      const o00 = frame.mapPoint(px0, py0, d1);
      const o10 = frame.mapPoint(px1, py0, d1);
      const o11 = frame.mapPoint(px1, py1, d1);
      const o01 = frame.mapPoint(px0, py1, d1);

      pushQuad(positions, indices, vec3(...o00), vec3(...o10), vec3(...o11), vec3(...o01));
      pushQuad(positions, indices, vec3(...c00), vec3(...c01), vec3(...c11), vec3(...c10));
      pushQuad(positions, indices, vec3(...c00), vec3(...c10), vec3(...o10), vec3(...o00));
      pushQuad(positions, indices, vec3(...c01), vec3(...o01), vec3(...o11), vec3(...c11));
      pushQuad(positions, indices, vec3(...c00), vec3(...o00), vec3(...o01), vec3(...c01));
      pushQuad(positions, indices, vec3(...c10), vec3(...c11), vec3(...o11), vec3(...o10));
    }
  }

  return indices.length ? { positions, indices } : null;
}

function profileIsValid(profile) {
  return Array.isArray(profile) && profile.length >= 3;
}

/** Nudge accent sleeve outside the body shell — stops preview z-fight (negligible on print). */
const ACCENT_SKIN_MM = 0.12;
/** Radial depth of profile accent bands — visible in preview and slicer-safe for multi-material. */
const ACCENT_BAND_THICKNESS_MM = 0.45;
/** Layer-height slabs for face decals (same slice strategy as accent bands). */
const DECAL_LAYER_MM = 0.2;
/** Wrap preview art — raster slabs (no earcut on curved wall). */
const WRAP_DECAL_STEP_MM = 0.4;
const WRAP_DECAL_TARGET_COLS = 560;
const WRAP_DECAL_STEP_MIN_MM = 0.08;
const WRAP_DECAL_STEP_MAX_MM = 0.26;

function wrapDecalStepMm(shapeGroups) {
  const bounds = shapeGroupsBounds2d(shapeGroups);
  if (!bounds) return WRAP_DECAL_STEP_MM;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  return clamp(span / WRAP_DECAL_TARGET_COLS, WRAP_DECAL_STEP_MIN_MM, WRAP_DECAL_STEP_MAX_MM);
}

function resolveSlabGrid(bounds, stepMm, pad, maxCells = 2048) {
  const w = Math.max(bounds.maxX - bounds.minX + pad * 2, stepMm);
  const h = Math.max(bounds.maxY - bounds.minY + pad * 2, stepMm);
  let step = stepMm;
  let cols = Math.max(1, Math.ceil(w / step));
  let rows = Math.max(1, Math.ceil(h / step));
  while (Math.max(cols, rows) > maxCells && step < 1.2) {
    step *= 1.2;
    cols = Math.max(1, Math.ceil(w / step));
    rows = Math.max(1, Math.ceil(h / step));
  }
  return { stepMm: step, cols, rows };
}
/** Extra radial push when a band is marked "on top" over another. */
const ACCENT_LAYER_BUMP_MM = 0.22;

function ensureProfileCCW(points) {
  if (polygonSignedArea2(points) < 0) return points.slice().reverse();
  return points;
}

function offsetProfileInward(points, offset) {
  if (!offset || offset <= 0) return points;
  return offsetProfileEdgeJoin(points, -offset);
}

function offsetProfileOutward(points, offset) {
  if (!offset || offset <= 0) return points;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * offset, y + (dy / len) * offset];
  });
}

function polygonSignedArea2(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return area / 2;
}

/** Offset a closed profile along exterior vertex normals — correct on concave outlines (star, heart). */
function offsetProfileByNormals(points, offset) {
  if (!offset || offset <= 0 || points.length < 3) return points;
  return offsetProfileEdgeJoin(points, offset);
}

function lineLineIntersect(a0, a1, b0, b1) {
  const dax = a1[0] - a0[0];
  const day = a1[1] - a0[1];
  const dbx = b1[0] - b0[0];
  const dby = b1[1] - b0[1];
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b0[0] - a0[0]) * dby - (b0[1] - a0[1]) * dbx) / denom;
  return [a0[0] + dax * t, a0[1] + day * t];
}

/**
 * Robust outward offset — intersects parallel offset edges (fixes heart cleft /
 * star notches where vertex-normal miters fold through the wall).
 */
function offsetProfileEdgeJoin(points, offset) {
  const ccw = polygonSignedArea2(points) > 0;
  const sign = ccw ? 1 : -1;
  const n = points.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = points[j][0] - points[i][0];
    const dy = points[j][1] - points[i][1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = sign * (dy / len);
    const ny = sign * (-dx / len);
    edges.push({
      p0: [points[i][0] + nx * offset, points[i][1] + ny * offset],
      p1: [points[j][0] + nx * offset, points[j][1] + ny * offset],
      nx,
      ny,
    });
  }
  const out = [];
  const maxSpike = offset * 2.8;
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const curr = edges[i];
    const currPt = points[i];
    let pt = lineLineIntersect(prev.p0, prev.p1, curr.p0, curr.p1);
    if (!pt) {
      pt = [currPt[0] + curr.nx * offset, currPt[1] + curr.ny * offset];
    } else if (Math.hypot(pt[0] - currPt[0], pt[1] - currPt[1]) > maxSpike) {
      pt = [(prev.p1[0] + curr.p0[0]) / 2, (prev.p1[1] + curr.p0[1]) / 2];
    }
    out.push(pt);
  }
  return out;
}

function isProfileConcaveVertex(points, i) {
  const n = points.length;
  const ccw = polygonSignedArea2(points) > 0;
  const prev = points[(i - 1 + n) % n];
  const curr = points[i];
  const next = points[(i + 1) % n];
  const e0x = curr[0] - prev[0];
  const e0y = curr[1] - prev[1];
  const e1x = next[0] - curr[0];
  const e1y = next[1] - curr[1];
  const cross = e0x * e1y - e0y * e1x;
  const len = Math.hypot(e0x, e0y) * Math.hypot(e1x, e1y);
  if (len < 1e-9) return false;
  const sinHalf = cross / len;
  return ccw ? sinHalf < -0.12 : sinHalf > 0.12;
}

function pointInProfile(pt, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const hit = (yi > pt[1]) !== (yj > pt[1])
      && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

const PROFILE_ACCENT_EDGE_MIN = 0.25;

/** 0 where offset folds inside the wall or at reflex corners — smooth taper between. */
function profileAccentPinchWeights(profile, outerRaw) {
  const n = profile.length;
  let w = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    if (pointInProfile(outerRaw[i], profile) || isProfileConcaveVertex(profile, i)) w[i] = 0;
  }
  for (let pass = 0; pass < 8; pass++) {
    const next = w.slice();
    for (let i = 0; i < n; i++) {
      if (w[i] <= 0) continue;
      const wl = w[(i - 1 + n) % n];
      const wr = w[(i + 1) % n];
      const neighbor = Math.min(wl, wr);
      if (neighbor < w[i]) next[i] = Math.max(neighbor, w[i] - 0.09);
    }
    w = next;
  }
  return w;
}

function pinchProfileAccentOuter(profile, outer, weights) {
  for (let i = 0; i < profile.length; i++) {
    const t = weights[i];
    outer[i][0] = profile[i][0] + (outer[i][0] - profile[i][0]) * t;
    outer[i][1] = profile[i][1] + (outer[i][1] - profile[i][1]) * t;
  }
}

function profileAccentWallWidth(inner, outer, i) {
  return Math.hypot(outer[i][0] - inner[i][0], outer[i][1] - inner[i][1]);
}

function profileAccentEdgeOk(profile, inner, outer, weights, i, j) {
  if (Math.min(weights[i], weights[j]) < PROFILE_ACCENT_EDGE_MIN) return false;
  if (pointInProfile(outer[i], profile) || pointInProfile(outer[j], profile)) return false;
  if (profileAccentWallWidth(inner, outer, i) < 0.05 && profileAccentWallWidth(inner, outer, j) < 0.05) return false;
  return true;
}

function extrudeProfileAnnulusWalls(outPos, outIdx, profile, inner, outer, weights, z0, z1) {
  const ccw = polygonSignedArea2(inner) > 0;
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!profileAccentEdgeOk(profile, inner, outer, weights, i, j)) continue;
    const o0 = vec3(outer[i][0], outer[i][1], z0);
    const o1 = vec3(outer[j][0], outer[j][1], z0);
    const o2 = vec3(outer[j][0], outer[j][1], z1);
    const o3 = vec3(outer[i][0], outer[i][1], z1);
    const i0 = vec3(inner[i][0], inner[i][1], z0);
    const i1 = vec3(inner[j][0], inner[j][1], z0);
    const i2 = vec3(inner[j][0], inner[j][1], z1);
    const i3 = vec3(inner[i][0], inner[i][1], z1);
    if (ccw) {
      pushQuad(outPos, outIdx, o0, o1, o2, o3);
      pushQuad(outPos, outIdx, i1, i0, i3, i2);
    } else {
      pushQuad(outPos, outIdx, o0, o3, o2, o1);
      pushQuad(outPos, outIdx, i1, i2, i3, i0);
    }
  }
}

function capProfileAccentRing(outPos, outIdx, profile, outer, inner, weights, z, normalUp) {
  const ccw = polygonSignedArea2(inner) > 0;
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!profileAccentEdgeOk(profile, inner, outer, weights, i, j)) continue;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(inner[i][0], inner[i][1], z);
    const i1 = vec3(inner[j][0], inner[j][1], z);
    if (ccw) {
      if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
      else pushQuad(outPos, outIdx, o0, i0, i1, o1);
    } else if (normalUp) {
      pushQuad(outPos, outIdx, o0, i0, i1, o1);
    } else {
      pushQuad(outPos, outIdx, o0, o1, i1, i0);
    }
  }
}

function profileAccentOffset(points) {
  return offsetProfileByNormals(ensureProfileCCW(points), ACCENT_SKIN_MM);
}

/**
 * Continuous accent sleeve — outer ring offset then pinched where the offset
 * folds inside the profile (heart cleft) so the band fades instead of bleeding.
 */
function buildProfileAccentSleeve(outerProfile, z0, z1, onTop = false) {
  const profile = ensureProfileCCW(outerProfile);
  const positions = [];
  const indices = [];
  const offset = ACCENT_SKIN_MM + ACCENT_BAND_THICKNESS_MM + (onTop ? ACCENT_LAYER_BUMP_MM : 0);
  const inner = profile.map((p) => [p[0], p[1]]);
  const outer = offsetProfileEdgeJoin(profile, offset);
  const weights = profileAccentPinchWeights(profile, outer);
  pinchProfileAccentOuter(profile, outer, weights);
  extrudeProfileAnnulusWalls(positions, indices, profile, inner, outer, weights, z0, z1);
  capProfileAccentRing(positions, indices, profile, outer, inner, weights, z0, false);
  capProfileAccentRing(positions, indices, profile, outer, inner, weights, z1, true);
  return { positions, indices };
}

function profileBandZRange(face, bandH, totalH, accentPos) {
  if (face === "front") {
    const pos = accentPos != null ? clamp(accentPos, 0, 100) / 100 : 0.85;
    const z0 = (totalH - bandH) * pos;
    return { z0, z1: z0 + bandH };
  }
  const pos = face === "floor"
    ? 0
    : accentPos != null
      ? clamp(accentPos, 0, 100) / 100
      : 1;
  const z0 = (totalH - bandH) * pos;
  return { z0, z1: z0 + bandH };
}

function frontProfileEdgeFilter(points, inset) {
  const frontY = Math.min(...points.map((p) => p[1]));
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const x0 = minX + inset;
  const x1 = maxX - inset;
  const yTol = 0.35;
  return (a, b) => {
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    return midY <= frontY + yTol && midX >= x0 && midX <= x1;
  };
}

export function buildAccentMesh(meta, params, outerProfile = null) {
  const face = params.accentFace || "rim";
  const b = rectFeatureBounds(meta);
  const bandH = Math.min(clamp(params.accentHeight ?? 4, 2, 80), b.totalH);
  const positions = [];
  const indices = [];
  const skin = ACCENT_SKIN_MM + (params.accentOnTop ? ACCENT_LAYER_BUMP_MM : 0);
  const accentProfile = profileIsValid(outerProfile)
    ? profileAccentOffset(outerProfile)
    : null;

  if (profileIsValid(outerProfile)) {
    const { z0, z1 } = profileBandZRange(face, bandH, b.totalH, params.accentPos);
    if (face === "front") {
      const inset = clamp(params.accentInset ?? 4, 2, Math.min(b.outerW, b.outerD) / 3);
      extrudeWallsAlongZ(positions, indices, accentProfile, z0, z1, frontProfileEdgeFilter(accentProfile, inset));
    } else {
      return buildProfileAccentSleeve(outerProfile, z0, z1, !!params.accentOnTop);
    }
  } else if (face === "rim") {
    const z1 = b.totalH;
    const z0 = z1 - bandH;
    wallBand(positions, indices, "y", b.od2 + skin, -b.ow2 - skin, b.ow2 + skin, z0, z1);
    wallBand(positions, indices, "y", -b.od2 - skin, -b.ow2 - skin, b.ow2 + skin, z0, z1);
    wallBand(positions, indices, "x", b.ow2 + skin, -b.od2 - skin, b.od2 + skin, z0, z1);
    wallBand(positions, indices, "x", -b.ow2 - skin, -b.od2 - skin, b.od2 + skin, z0, z1);
  } else if (face === "front") {
    const { z0, z1 } = profileBandZRange(face, bandH, b.totalH, params.accentPos);
    const inset = clamp(params.accentInset ?? 4, 2, Math.min(b.outerW, b.outerD) / 3);
    wallBand(positions, indices, "y", -b.od2 - skin, -b.ow2 + inset, b.ow2 - inset, z0, z1);
  } else if (face === "floor") {
    wallBand(positions, indices, "y", b.od2 + skin, -b.ow2 - skin, b.ow2 + skin, 0, bandH);
    wallBand(positions, indices, "y", -b.od2 - skin, -b.ow2 - skin, b.ow2 + skin, 0, bandH);
    wallBand(positions, indices, "x", b.ow2 + skin, -b.od2 - skin, b.od2 + skin, 0, bandH);
    wallBand(positions, indices, "x", -b.ow2 - skin, -b.od2 - skin, b.od2 + skin, 0, bandH);
  }

  return { positions, indices };
}

function hexVerts(cx, cz, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 6) + (i * Math.PI) / 3;
    pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return pts;
}

/** Extrude a closed polygon as walls only — no fan caps to origin. */
function extrudeWallsAlongY(outPos, outIdx, pts, y0, y1) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(outPos, outIdx,
      vec3(pts[i][0], y0, pts[i][1]), vec3(pts[j][0], y0, pts[j][1]),
      vec3(pts[j][0], y1, pts[j][1]), vec3(pts[i][0], y1, pts[i][1]));
  }
}

function extrudeWallsAlongZ(outPos, outIdx, pts, z0, z1, edgeFilter = null) {
  const ccw = polygonSignedArea2(pts) > 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i];
    const b = pts[j];
    if (edgeFilter && !edgeFilter(a, b, i, j, pts)) continue;
    const p0 = vec3(a[0], a[1], z0);
    const p1 = vec3(b[0], b[1], z0);
    const p2 = vec3(b[0], b[1], z1);
    const p3 = vec3(a[0], a[1], z1);
    if (ccw) pushQuad(outPos, outIdx, p0, p1, p2, p3);
    else pushQuad(outPos, outIdx, p0, p3, p2, p1);
  }
}

function capRingXZ(outPos, outIdx, outer, inner, z, normalUp) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(inner[i][0], inner[i][1], z);
    const i1 = vec3(inner[j][0], inner[j][1], z);
    if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

function forEachHexGrid(w, h, cellR, fn) {
  const pitchX = cellR * Math.sqrt(3);
  const pitchY = cellR * 1.5;
  const rows = Math.max(1, Math.floor(h / pitchY));
  const cols = Math.max(1, Math.floor(w / pitchX));
  const x0 = -((cols - 1) * pitchX) / 2;
  const z0 = -((rows - 1) * pitchY) / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = x0 + col * pitchX + (row % 2 ? pitchX / 2 : 0);
      const cz = z0 + row * pitchY;
      fn(cx, cz);
    }
  }
}

/** Honeycomb ridge stamp on chosen face (default back wall). */
export function buildHoneycombStamp(meta, params) {
  const b = rectFeatureBounds(meta);
  const cellR = clamp(params.honeycombSize ?? 2.5, 1.2, 5);
  const depth = clamp(params.honeycombDepth ?? 0.6, 0.3, 1.5);
  const face = params.honeycombFace || "back";
  const margin = 8;
  const faceW = b.outerW - margin * 2;
  const faceH = b.totalH - margin * 2;
  const zMid = b.totalH * 0.5;
  const positions = [];
  const indices = [];

  forEachHexGrid(faceW, faceH, cellR, (cx, cz) => {
    const z = zMid + cz;
    const pts = hexVerts(cx, z, cellR * 0.85);
    if (face === "front") {
      extrudeWallsAlongY(positions, indices, pts, b.od2, b.od2 + depth);
    } else {
      extrudeWallsAlongY(positions, indices, pts, -b.od2 - depth, -b.od2);
    }
  });

  return { positions, indices };
}

/** Stackable: hex feet on bottom + matching pockets in top rim. */
export function buildStackableHex(meta, params) {
  const b = rectFeatureBounds(meta);
  const cellR = clamp(params.stackHexSize ?? 3, 2, 5);
  const footH = clamp(params.stackFootHeight ?? 1.6, 0.8, 3);
  const clearance = params.stackClearance ?? 0.35;
  const margin = Math.max(10, cellR * 3);
  const gridW = b.innerW - margin * 2;
  const gridD = b.innerD - margin * 2;
  if (gridW < cellR * 4 || gridD < cellR * 4) return null;

  const positions = [];
  const indices = [];
  const footR = cellR - clearance * 0.4;
  const pocketOuterR = cellR + clearance;
  const pocketInnerR = Math.max(footR - 0.2, cellR * 0.55);

  forEachHexGrid(gridW, gridD, cellR, (cx, cy) => {
    const pts = hexVerts(cx, cy, footR);
    extrudeWallsAlongZ(positions, indices, pts, -footH, 0);
    const bot = pts.map(([x, y]) => [x, y]);
    capRingXZ(positions, indices, bot, hexVerts(cx, cy, footR * 0.35), 0, false);
  });

  const zTop = b.totalH;
  const pocketD = footH + clearance;
  forEachHexGrid(gridW, gridD, cellR, (cx, cy) => {
    const outer = hexVerts(cx, cy, pocketOuterR);
    const inner = hexVerts(cx, cy, pocketInnerR);
    capRingXZ(positions, indices, outer, inner, zTop, true);
    extrudeWallsAlongZ(positions, indices, outer, zTop - pocketD, zTop);
    extrudeWallsAlongZ(positions, indices, inner, zTop - pocketD, zTop);
    capRingXZ(positions, indices, outer, inner, zTop - pocketD, false);
  });

  return { positions, indices };
}

function profileMaxRadius(profile) {
  let maxR = 0;
  for (const [x, y] of profile) maxR = Math.max(maxR, Math.hypot(x, y));
  return maxR;
}

function scaleProfileXY(profile, factor) {
  if (!factor || Math.abs(factor - 1) < 1e-6) return profile;
  return profile.map(([x, y]) => [x * factor, y * factor]);
}

function flatLidGasketProfiles(boxOuter, params) {
  if (!params?.lidGasketEnabled || !profileIsValid(boxOuter)) return null;
  const gasketWidth = clamp(params.lidGasketWidth ?? 2, 1.2, 4);
  const gasketDepth = clamp(params.lidGasketDepth ?? 1.2, 0.6, 2.5);
  const wall = params.wall ?? params.lidWall ?? 2.4;
  const gasketInset = clamp(params.lidGasketInset ?? wall * 0.85, 1.5, 14);
  const outerR = profileMaxRadius(boxOuter);
  const inset = Math.min(gasketInset, Math.max(1.5, outerR - gasketWidth - 1.5));
  const outerGroove = offsetProfileInward(boxOuter, Math.max(0.5, inset - gasketWidth / 2));
  const innerGroove = offsetProfileInward(boxOuter, inset + gasketWidth / 2);
  if (!profileIsValid(innerGroove) || profileMaxRadius(innerGroove) < 2) return null;
  return { outerGroove, innerGroove, gasketDepth, gasketWidth };
}

/** Underside annular groove on flat lids — seats a printed TPU ring or cord. */
export function appendFlatLidGasketGroove(outPos, outIdx, boxOuter, params) {
  const groove = flatLidGasketProfiles(boxOuter, params);
  if (!groove) return;
  const { outerGroove, innerGroove, gasketDepth } = groove;
  const z0 = 0;
  const z1 = gasketDepth;
  capRingXZ(outPos, outIdx, outerGroove, innerGroove, z0, false);
  extrudeWallsAlongZ(outPos, outIdx, outerGroove, z0, z1);
  extrudeWallsAlongZ(outPos, outIdx, innerGroove, z0, z1);
  capRingXZ(outPos, outIdx, outerGroove, innerGroove, z1, true);
}

/** Printable TPU washer — mates with {@link appendFlatLidGasketGroove}. */
export function buildFlatLidGasketRing(boxOuter, params) {
  const groove = flatLidGasketProfiles(boxOuter, params);
  if (!groove) return null;
  const { outerGroove, innerGroove, gasketDepth } = groove;
  const fit = 0.12;
  const outerRing = offsetProfileInward(outerGroove, fit);
  const innerRing = offsetProfileOutward(innerGroove, fit);
  if (!profileIsValid(outerRing) || !profileIsValid(innerRing)) return null;
  const ringHeight = gasketDepth * 0.88;
  const positions = [];
  const indices = [];
  capRingXZ(positions, indices, outerRing, innerRing, 0, false);
  extrudeWallsAlongZ(positions, indices, outerRing, 0, ringHeight);
  extrudeWallsAlongZ(positions, indices, innerRing, 0, ringHeight);
  capRingXZ(positions, indices, outerRing, innerRing, ringHeight, true);
  return { positions, indices, ringHeight };
}

/**
 * Nest-stack flat lid — outer seating groove + raised lip (kitchen tower jars).
 * The next jar's bottom wall registers in the outer band; centre stays flat.
 */
export function appendNestStackLidRim(outPos, outIdx, boxOuter, params, lidThickness) {
  const outerR = profileMaxRadius(boxOuter);
  if (outerR < 8) return;

  const rimWidth = clamp(params.stackNestRimWidth ?? 5, 3, 12);
  const rimHeight = clamp(params.stackNestRimHeight ?? 2.8, 1.5, 6);
  const nestDepth = clamp(params.stackNestDepth ?? 4, 2, 10);
  const rimInnerScale = Math.max((outerR - rimWidth) / outerR, 0.55);
  const rimInner = scaleProfileXY(boxOuter, rimInnerScale);

  const zTop = lidThickness;
  const zGroove = zTop - nestDepth;
  const zLip = zTop + rimHeight;

  capRingXZ(outPos, outIdx, boxOuter, rimInner, zTop, true);
  extrudeWallsAlongZ(outPos, outIdx, boxOuter, zGroove, zTop);
  extrudeWallsAlongZ(outPos, outIdx, rimInner, zGroove, zTop);
  capRingXZ(outPos, outIdx, boxOuter, rimInner, zGroove, false);

  capRingXZ(outPos, outIdx, boxOuter, rimInner, zLip, true);
  extrudeWallsAlongZ(outPos, outIdx, boxOuter, zTop, zLip);
  extrudeWallsAlongZ(outPos, outIdx, rimInner, zTop, zLip);
}

/** Recessed hex pockets on the top face of a flat lid — mates with stackable feet on another box. */
export function appendStackableLidPockets(outPos, outIdx, meta, params, lidThickness) {
  const b = rectFeatureBounds(meta);
  const cellR = clamp(params.stackHexSize ?? 3, 2, 5);
  const footH = clamp(params.stackFootHeight ?? 1.6, 0.8, 3);
  const clearance = params.stackClearance ?? 0.35;
  const margin = Math.max(10, cellR * 3);
  const gridW = b.innerW - margin * 2;
  const gridD = b.innerD - margin * 2;
  if (gridW < cellR * 4 || gridD < cellR * 4) return;

  const footR = cellR - clearance * 0.4;
  const pocketOuterR = cellR + clearance;
  const pocketInnerR = Math.max(footR - 0.2, cellR * 0.55);
  const zTop = lidThickness;
  const pocketD = footH + clearance;

  forEachHexGrid(gridW, gridD, cellR, (cx, cy) => {
    const outer = hexVerts(cx, cy, pocketOuterR);
    const inner = hexVerts(cx, cy, pocketInnerR);
    capRingXZ(outPos, outIdx, outer, inner, zTop, true);
    extrudeWallsAlongZ(outPos, outIdx, outer, zTop - pocketD, zTop);
    extrudeWallsAlongZ(outPos, outIdx, inner, zTop - pocketD, zTop);
    capRingXZ(outPos, outIdx, outer, inner, zTop - pocketD, false);
  });
}

export function shapeSupportsInsert(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencilBox" || shape === "canisterSquare";
}

const INSERT_TOP_CLEAR_BUFFER = 0.5;

function insertLidType(lidType) {
  if (lidType === "flat") return "flat";
  if (lidType === "plug") return "plug";
  return "slip";
}

/** Depth inside the cavity consumed by inset plug skirt or flat-cap lip (mm). */
export function lidCavityIntrusion(params) {
  if (!params?.lidEnabled) return 0;
  const lidType = insertLidType(params.lidType);
  if (lidType === "plug") return clamp(params.lidSkirt ?? 10, 4, 30);
  if (lidType === "flat") return clamp(params.lidLipDepth ?? 0, 0, 12);
  return 0;
}

/** Top clearance for dividers — auto-matches lid intrusion unless user overrides. */
export function effectiveInsertTopClearance(params) {
  const manual = clamp(params?.insertTopClearance ?? 0.6, 0, 40);
  if (params?.insertTopClearanceAuto === false) return manual;
  const intrusion = lidCavityIntrusion(params);
  if (intrusion <= 0) return manual;
  return Math.max(manual, intrusion + INSERT_TOP_CLEAR_BUFFER);
}

/** Panel boxes for vertical dividers (length / depth axis). */
function dividerPanelBoxes(meta, params) {
  const b = rectFeatureBounds(meta);
  const axis = params.insertAxis === "depth" ? "depth" : params.insertAxis === "height" ? "height" : "length";
  const count = clamp(Math.round(params.insertCount ?? 1), 1, 4);
  const thickness = clamp(params.insertThickness ?? 2.4, 1.2, 5);
  const clearance = clamp(params.insertClearance ?? 0.35, 0.1, 1.2);
  const topClear = effectiveInsertTopClearance(params);
  const fuseToBody = !!params.fuseInsertToBody;
  const bodyGap = fuseToBody ? 0 : (params.insertBodyGap ?? 0.12);
  const mount = params.insertMount === "slot" && axis === "height" ? "slot" : "snap";
  const wallClear = fuseToBody ? 0 : clearance + bodyGap;

  const spanW = b.innerW - wallClear * 2;
  const spanD = b.innerD - wallClear * 2;
  if (spanW < 8 || spanD < 8) return null;

  const halfT = thickness / 2;
  const boxes = [];

  if (axis === "height") {
    const spanH = b.cavityH - wallClear * 2 - topClear;
    if (spanH < 4) return null;
    const zBase = b.floor + wallClear;
    const slotDepth = clamp(params.insertSlotDepth ?? 2, 1, 4);
    const shelfW = mount === "slot" ? Math.max(8, b.innerW - slotDepth * 2 - bodyGap * 2) : spanW;
    const shelfD = spanD;
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const z = zBase + t * spanH;
      boxes.push({
        x0: -shelfW / 2, x1: shelfW / 2,
        y0: -shelfD / 2, y1: shelfD / 2,
        z0: z - halfT, z1: z + halfT,
      });
    }
    return boxes;
  }

  const weld = 0;
  const z0 = fuseToBody ? b.floor : b.floor + bodyGap;
  const z1 = fuseToBody
    ? b.floor + b.cavityH
    : b.floor + b.cavityH - topClear - bodyGap;
  if (z1 - z0 < 4) return null;

  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    if (axis === "length") {
      const x = -spanW / 2 + t * spanW;
      boxes.push({
        x0: x - halfT, x1: x + halfT,
        y0: -spanD / 2 - weld, y1: spanD / 2 + weld,
        z0, z1,
      });
    } else {
      const y = -spanD / 2 + t * spanD;
      boxes.push({
        x0: -spanW / 2 - weld, x1: spanW / 2 + weld,
        y0: y - halfT, y1: y + halfT,
        z0, z1,
      });
    }
  }
  return boxes;
}

function triFullyInsideBox(positions, ia, ib, ic, box) {
  for (const v of [ia, ib, ic]) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1 || z < box.z0 || z > box.z1) return false;
  }
  return true;
}

function wallSegments(span0, span1, gaps) {
  const segs = [];
  let t = span0;
  const sorted = (gaps || []).slice().sort((a, b) => a[0] - b[0]);
  for (const [g0, g1] of sorted) {
    if (g0 > t + 0.02) segs.push([t, g0]);
    t = Math.max(t, g1);
  }
  if (span1 > t + 0.02) segs.push([t, span1]);
  return segs;
}

function fixedDividerFloorStripBoxes(meta, params) {
  const b = rectFeatureBounds(meta);
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length || !params?.fuseInsertToBody) return [];
  const pad = 0.08;
  return panels.map((panel) => ({
    x0: panel.x0 - pad, x1: panel.x1 + pad,
    y0: panel.y0 - pad, y1: panel.y1 + pad,
    z0: b.floor - pad, z1: b.floor + pad,
  }));
}

/** Shared vertex pool — every corner appears once in the export mesh. */
class WeldPool {
  constructor(eps = 0.01) {
    this.eps = eps;
    this.positions = [];
    this.indices = [];
    this.table = new Map();
  }

  v(x, y, z) {
    const k = `${Math.round(x / this.eps)}|${Math.round(y / this.eps)}|${Math.round(z / this.eps)}`;
    let i = this.table.get(k);
    if (i === undefined) {
      i = this.positions.length / 3;
      this.positions.push(x, y, z);
      this.table.set(k, i);
    }
    return i;
  }

  tri(a, b, c) {
    this.indices.push(this.v(a[0], a[1], a[2]), this.v(b[0], b[1], b[2]), this.v(c[0], c[1], c[2]));
  }

  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  mesh() {
    return { positions: this.positions, indices: this.indices };
  }
}

function isSharpRectProfile(meta, params) {
  return (meta.shape === "rect" || meta.shape === "rounded")
    && (params.cornerRadius || 0) <= 0.5
    && (params.vertexFillet || 0) <= 0.5;
}

function uniqSortedCuts(vals) {
  return [...new Set(vals.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

/**
 * Divider faces for rounded fallback — bay faces + top only (no end caps / bottom).
 * End caps caused n=3 T-junctions with gapped inner walls.
 */
function buildDividerPanelFaces(meta, params) {
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length) return null;
  const axis = params.insertAxis === "depth" ? "depth" : "length";
  const pool = new WeldPool();
  for (const panel of panels) {
    const { x0, x1, y0, y1, z0, z1 } = panel;
    if (axis === "depth") {
      pool.quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]);
      pool.quad([x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0]);
      pool.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    } else {
      pool.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
      pool.quad([x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0]);
      pool.quad([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]);
    }
  }
  return pool.mesh();
}

/**
 * Sharp rect + welded divider(s) — true 2-manifold open-top shell.
 * Split rim / outer walls at divider stations so every edge has exactly 2 faces.
 * Divider = bay faces + top only (no end caps / bottom — those caused n=3 edges).
 */
function buildSharpWeldedBoxExport(meta, params) {
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length) return null;
  const b = rectFeatureBounds(meta);
  const { ow2, od2, iw2, id2 } = b;
  const z0 = 0;
  const zF = b.floor;
  const zT = b.totalH;
  const axis = params.insertAxis === "depth" ? "depth" : "length";
  const pool = new WeldPool();
  const sorted = panels.slice().sort((a, c) => (axis === "depth" ? a.y0 - c.y0 : a.x0 - c.x0));

  if (axis === "depth") {
    const yGaps = sorted.map((p) => [p.y0, p.y1]);
    const wallSegs = wallSegments(-id2, id2, yGaps);
    const yCuts = uniqSortedCuts([-od2, -id2, ...sorted.flatMap((p) => [p.y0, p.y1]), id2, od2]);

    for (let i = 0; i < yCuts.length - 1; i++) {
      const ya = yCuts[i];
      const yb = yCuts[i + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([-ow2, ya, z0], [ow2, ya, z0], [ow2, yb, z0], [-ow2, yb, z0]);
    }

    pool.quad([-ow2, -od2, z0], [-ow2, -od2, zT], [ow2, -od2, zT], [ow2, -od2, z0]);
    pool.quad([ow2, od2, z0], [ow2, od2, zT], [-ow2, od2, zT], [-ow2, od2, z0]);

    for (let i = 0; i < yCuts.length - 1; i++) {
      const ya = yCuts[i];
      const yb = yCuts[i + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([ow2, ya, z0], [ow2, ya, zT], [ow2, yb, zT], [ow2, yb, z0]);
      pool.quad([-ow2, yb, z0], [-ow2, yb, zT], [-ow2, ya, zT], [-ow2, ya, z0]);
    }

    pool.quad([-ow2, -od2, zT], [ow2, -od2, zT], [iw2, -id2, zT], [-iw2, -id2, zT]);
    pool.quad([ow2, od2, zT], [-ow2, od2, zT], [-iw2, id2, zT], [iw2, id2, zT]);
    pool.tri([ow2, -od2, zT], [ow2, -id2, zT], [iw2, -id2, zT]);
    pool.tri([ow2, od2, zT], [iw2, id2, zT], [ow2, id2, zT]);
    pool.tri([-ow2, -od2, zT], [-iw2, -id2, zT], [-ow2, -id2, zT]);
    pool.tri([-ow2, od2, zT], [-ow2, id2, zT], [-iw2, id2, zT]);

    const rimInner = uniqSortedCuts([-id2, ...sorted.flatMap((p) => [p.y0, p.y1]), id2]);
    for (let i = 0; i < rimInner.length - 1; i++) {
      const ya = rimInner[i];
      const yb = rimInner[i + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([ow2, ya, zT], [ow2, yb, zT], [iw2, yb, zT], [iw2, ya, zT]);
      pool.quad([-ow2, yb, zT], [-ow2, ya, zT], [-iw2, ya, zT], [-iw2, yb, zT]);
    }

    for (const [ya, yb] of wallSegs) {
      pool.quad([-iw2, ya, zF], [-iw2, ya, zT], [-iw2, yb, zT], [-iw2, yb, zF]);
      pool.quad([iw2, yb, zF], [iw2, yb, zT], [iw2, ya, zT], [iw2, ya, zF]);
    }
    pool.quad([iw2, -id2, zF], [iw2, -id2, zT], [-iw2, -id2, zT], [-iw2, -id2, zF]);
    pool.quad([-iw2, id2, zF], [-iw2, id2, zT], [iw2, id2, zT], [iw2, id2, zF]);

    let yCursor = -id2;
    for (const panel of sorted) {
      if (panel.y0 > yCursor + 0.02) {
        pool.quad([-iw2, yCursor, zF], [iw2, yCursor, zF], [iw2, panel.y0, zF], [-iw2, panel.y0, zF]);
      }
      pool.quad([-iw2, panel.y0, zF], [-iw2, panel.y0, zT], [iw2, panel.y0, zT], [iw2, panel.y0, zF]);
      pool.quad([iw2, panel.y1, zF], [iw2, panel.y1, zT], [-iw2, panel.y1, zT], [-iw2, panel.y1, zF]);
      pool.quad([-iw2, panel.y0, zT], [iw2, panel.y0, zT], [iw2, panel.y1, zT], [-iw2, panel.y1, zT]);
      yCursor = panel.y1;
    }
    if (id2 > yCursor + 0.02) {
      pool.quad([-iw2, yCursor, zF], [iw2, yCursor, zF], [iw2, id2, zF], [-iw2, id2, zF]);
    }
  } else {
    const xGaps = sorted.map((p) => [p.x0, p.x1]);
    const wallSegs = wallSegments(-iw2, iw2, xGaps);
    const xCuts = uniqSortedCuts([-ow2, -iw2, ...sorted.flatMap((p) => [p.x0, p.x1]), iw2, ow2]);
    const ySideCuts = uniqSortedCuts([-od2, -id2, id2, od2]);

    for (let i = 0; i < xCuts.length - 1; i++) {
      const xa = xCuts[i];
      const xb = xCuts[i + 1];
      if (xb - xa < 0.02) continue;
      for (let j = 0; j < ySideCuts.length - 1; j++) {
        const ya = ySideCuts[j];
        const yb = ySideCuts[j + 1];
        if (yb - ya < 0.02) continue;
        pool.quad([xa, ya, z0], [xb, ya, z0], [xb, yb, z0], [xa, yb, z0]);
      }
    }

    for (let j = 0; j < ySideCuts.length - 1; j++) {
      const ya = ySideCuts[j];
      const yb = ySideCuts[j + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([-ow2, ya, z0], [-ow2, ya, zT], [-ow2, yb, zT], [-ow2, yb, z0]);
      pool.quad([ow2, yb, z0], [ow2, yb, zT], [ow2, ya, zT], [ow2, ya, z0]);
    }

    for (let i = 0; i < xCuts.length - 1; i++) {
      const xa = xCuts[i];
      const xb = xCuts[i + 1];
      if (xb - xa < 0.02) continue;
      pool.quad([xa, -od2, z0], [xb, -od2, z0], [xb, -od2, zT], [xa, -od2, zT]);
      pool.quad([xb, od2, z0], [xa, od2, z0], [xa, od2, zT], [xb, od2, zT]);
    }

    // Left / right flanges only over cavity span (ears cover corners)
    pool.quad([-ow2, -id2, zT], [-ow2, id2, zT], [-iw2, id2, zT], [-iw2, -id2, zT]);
    pool.quad([ow2, -id2, zT], [iw2, -id2, zT], [iw2, id2, zT], [ow2, id2, zT]);

    pool.tri([-ow2, -od2, zT], [-iw2, -id2, zT], [-ow2, -id2, zT]);
    pool.tri([-ow2, od2, zT], [-ow2, id2, zT], [-iw2, id2, zT]);
    pool.tri([ow2, -od2, zT], [ow2, -id2, zT], [iw2, -id2, zT]);
    pool.tri([ow2, od2, zT], [iw2, id2, zT], [ow2, id2, zT]);

    // Corner flange tris (outer front/back to inner) — complete the rim at ±ow2 ends
    pool.tri([-ow2, -od2, zT], [-iw2, -od2, zT], [-iw2, -id2, zT]);
    pool.tri([ow2, -od2, zT], [iw2, -id2, zT], [iw2, -od2, zT]);
    pool.tri([-ow2, od2, zT], [-iw2, id2, zT], [-iw2, od2, zT]);
    pool.tri([ow2, od2, zT], [iw2, od2, zT], [iw2, id2, zT]);

    const rimInner = uniqSortedCuts([-iw2, ...sorted.flatMap((p) => [p.x0, p.x1]), iw2]);
    for (let i = 0; i < rimInner.length - 1; i++) {
      const xa = rimInner[i];
      const xb = rimInner[i + 1];
      if (xb - xa < 0.02) continue;
      pool.quad([xa, -od2, zT], [xb, -od2, zT], [xb, -id2, zT], [xa, -id2, zT]);
      pool.quad([xb, od2, zT], [xa, od2, zT], [xa, id2, zT], [xb, id2, zT]);
    }

    pool.quad([-iw2, -id2, zF], [-iw2, -id2, zT], [-iw2, id2, zT], [-iw2, id2, zF]);
    pool.quad([iw2, id2, zF], [iw2, id2, zT], [iw2, -id2, zT], [iw2, -id2, zF]);
    for (const [xa, xb] of wallSegs) {
      pool.quad([xa, -id2, zF], [xa, -id2, zT], [xb, -id2, zT], [xb, -id2, zF]);
      pool.quad([xb, id2, zF], [xb, id2, zT], [xa, id2, zT], [xa, id2, zF]);
    }

    let xCursor = -iw2;
    for (const panel of sorted) {
      if (panel.x0 > xCursor + 0.02) {
        pool.quad([xCursor, -id2, zF], [panel.x0, -id2, zF], [panel.x0, id2, zF], [xCursor, id2, zF]);
      }
      pool.quad([panel.x0, -id2, zF], [panel.x0, -id2, zT], [panel.x0, id2, zT], [panel.x0, id2, zF]);
      pool.quad([panel.x1, id2, zF], [panel.x1, id2, zT], [panel.x1, -id2, zT], [panel.x1, -id2, zF]);
      pool.quad([panel.x0, -id2, zT], [panel.x1, -id2, zT], [panel.x1, id2, zT], [panel.x0, id2, zT]);
      xCursor = panel.x1;
    }
    if (iw2 > xCursor + 0.02) {
      pool.quad([xCursor, -id2, zF], [iw2, -id2, zF], [iw2, id2, zF], [xCursor, id2, zF]);
    }
  }

  return pool.mesh();
}

/** Fixed divider export — sharp boxes rebuilt watertight; rounded shells floor-strip + panel faces. */
export function buildWatertightFixedDividerExport(bodyMesh, meta, params) {
  if (!params?.fuseInsertToBody) return null;
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length) return null;

  if (isSharpRectProfile(meta, params)) {
    return buildSharpWeldedBoxExport(meta, params);
  }

  const shell = bodyMesh?.shellMesh || bodyMesh;
  const dividerFaces = buildDividerPanelFaces(meta, params);
  if (!shell?.indices?.length) return dividerFaces;

  const floorZones = fixedDividerFloorStripBoxes(meta, params);
  const positions = shell.positions.slice();
  const cleanIdx = [];
  for (let t = 0; t < shell.indices.length; t += 3) {
    const ia = shell.indices[t];
    const ib = shell.indices[t + 1];
    const ic = shell.indices[t + 2];
    if (floorZones.some((box) => triFullyInsideBox(shell.positions, ia, ib, ic, box))) continue;
    cleanIdx.push(ia, ib, ic);
  }
  return mergeMeshesSnap({ positions, indices: cleanIdx }, dividerFaces);
}

/** Removable flat divider panels — separate print part(s), splits cavity into equal bays. */
export function buildDividerInsert(meta, params) {
  const boxes = dividerPanelBoxes(meta, params);
  if (!boxes?.length) return null;
  const positions = [];
  const indices = [];
  for (const box of boxes) {
    appendBox(positions, indices, box.x0, box.y0, box.z0, box.x1, box.y1, box.z1);
  }
  return { positions, indices };
}

function appendBox(outPos, outIdx, x0, y0, z0, x1, y1, z1) {
  const pts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7],
  ];
  for (const f of faces) pushQuad(outPos, outIdx, pts[f[0]], pts[f[1]], pts[f[2]], pts[f[3]]);
}

/** Rasterise label text to a high-res alpha mask (stencil contours, not pixel blocks). */
function rasterTextMask(text, fontId, fontSizePx = 640, align = "left") {
  if (typeof document === "undefined") return null;
  const lines = String(text || "")
    .split(/\r?\n/)
    .slice(0, 4)
    .map((l) => l.trimEnd());
  if (!lines.some((l) => l.trim())) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = embossFontStack(fontId, fontSizePx);
  ctx.font = font;
  const pad = Math.ceil(fontSizePx * 0.22);
  let maxLineW = 0;
  for (const line of lines) {
    maxLineW = Math.max(maxLineW, ctx.measureText(line).width);
  }
  const lineHeight = fontSizePx * 1.12;
  const width = Math.ceil(maxLineW + pad * 2);
  const height = Math.ceil(pad * 2 + (lines.length - 1) * lineHeight + fontSizePx);
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  const textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
  ctx.textAlign = textAlign;
  for (let i = 0; i < lines.length; i++) {
    const y = pad + fontSizePx * 0.85 + i * lineHeight;
    let x = pad;
    if (textAlign === "center") x = width / 2;
    else if (textAlign === "right") x = width - pad;
    ctx.fillText(lines[i], x, y);
  }
  const data = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] > 64) mask[i] = 1;
  }
  return { mask, width, height };
}

/** Rasterise one line of text along a circular arc (for logo plaques). */
function rasterArcTextMask(text, fontId, fontSizePx = 640, options = {}) {
  if (typeof document === "undefined") return null;
  const line = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l) || "";
  if (!line) return null;

  const chars = [...line];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = embossFontStack(fontId, fontSizePx);
  ctx.font = font;

  const letterSpacing = clamp(options.spacing ?? 1.1, 0.55, 2.2);
  const charWidths = chars.map((c) => ctx.measureText(c).width);
  const totalWidth = charWidths.reduce((a, b) => a + b, 0) * letterSpacing;
  const sweepDeg = clamp(options.sweepDeg ?? 220, 35, 360);
  const sweepRad = (sweepDeg * Math.PI) / 180;
  const side = options.side === "down" ? "down" : "up";
  const sweepDir = side === "down" ? -1 : 1;
  const radiusPx = Math.max(
    fontSizePx * 0.85,
    options.radiusPx ?? (totalWidth / sweepRad) * 1.05,
  );
  const pad = Math.ceil(fontSizePx * 0.4);
  const size = Math.ceil((radiusPx + fontSizePx) * 2 + pad * 2);

  canvas.width = size;
  canvas.height = size;
  const ocx = size / 2;
  const ocy = size / 2;

  const defaultStart = side === "down" ? 180 : -90;
  const startAngle = ((options.startDeg ?? defaultStart) * Math.PI) / 180;
  const rotSign = side === "down" ? -1 : 1;

  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  let totalDist = 0;
  for (let i = 0; i < chars.length; i++) {
    totalDist += charWidths[i] * letterSpacing;
  }
  const letterSpanRad = totalDist / radiusPx;
  const angleOffset = Math.max(0, (sweepRad - letterSpanRad) / 2);

  let dist = 0;
  for (let i = 0; i < chars.length; i++) {
    const w = charWidths[i] * letterSpacing;
    const along = angleOffset + (dist + w / 2) / radiusPx;
    const angle = startAngle + sweepDir * along;
    const x = ocx + Math.cos(angle) * radiusPx;
    const y = ocy + Math.sin(angle) * radiusPx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + rotSign * (Math.PI / 2));
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    dist += w;
  }

  const data = ctx.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] > 64) mask[i] = 1;
  }
  return { mask, width: size, height: size, arcCenterPx: [ocx, ocy], radiusPx };
}

function estimateGraphicArtSizeMm(frame, meta, params) {
  const traceData = params.embossTraceRects;
  const hasTrace =
    params.embossTraceEnabled &&
    traceData?.width &&
    traceData?.height;
  if (hasTrace) {
    const artH = clamp(params.embossTraceSize ?? 16, 6, 56);
    const maxW = Math.min(frame.faceW * 0.62, 56);
    const scale = Math.min(artH / traceData.height, maxW / traceData.width);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return { artW: traceData.width * scale, artH: traceData.height * scale };
  }
  if (params.embossSvgEnabled && params.embossSvgText?.trim()) {
    const parsed = parseSvgPaths(params.embossSvgText);
    const layout = computeSvgArtLayout(parsed, meta, params);
    if (layout) return { artW: layout.artW, artH: layout.artH };
  }
  return null;
}

/** Arc radius slider limits for a face (mm). 0 = auto. */
export function arcRadiusLimits(meta, face, params = null) {
  const frame = getEmbossFaceFrame(meta, face || "front", params);
  const minDim = Math.min(frame.faceW, frame.faceH);
  const maxDim = Math.max(frame.faceW, frame.faceH);
  return {
    min: 0,
    max: Math.max(140, Math.round(maxDim * 1.15)),
    maxAuto: Math.max(60, minDim * 0.88),
  };
}

function autoArcRadiusMm(frame, meta, params, labelH) {
  const limits = arcRadiusLimits(meta, frame.face, params);
  const minDim = Math.min(frame.faceW, frame.faceH);
  let radius = minDim * 0.48;
  const graphic = estimateGraphicArtSizeMm(frame, meta, params);
  if (graphic) {
    const g = Math.max(graphic.artW, graphic.artH);
    radius = Math.max(radius, g * 0.88 + labelH * 0.75);
  }
  return clamp(radius, 18, limits.maxAuto);
}

/** Curve slider 0–100 → radius mm (Word-style “how bent”). */
export function resolveArcRadiusMm(frame, meta, params, labelH) {
  const limits = arcRadiusLimits(meta, frame.face, params);
  if (params.embossArcRadius > 0) {
    return clamp(params.embossArcRadius, 15, limits.max);
  }
  const auto = autoArcRadiusMm(frame, meta, params, labelH);
  const curve = clamp(params.embossArcCurve ?? 60, 0, 100);
  const scale = 0.48 + (curve / 100) * 1.05;
  return clamp(auto * scale, 15, limits.max);
}

/** @deprecated bounds helper — prefer rasterTextMask dimensions. */
function rasterTextRects(text, fontId, fontSizePx = 96) {
  const raster = rasterTextMask(text, fontId, fontSizePx);
  if (!raster) return null;
  return { rects: [{ x: 0, y: 0, w: raster.width, h: raster.height }], width: raster.width, height: raster.height };
}

/** Tight pixel bounds of ink in a text mask. */
function glyphBoundsFromMask(mask, maskW, maskH) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let py = 0; py < maskH; py++) {
    for (let px = 0; px < maskW; px++) {
      if (!mask[py * maskW + px]) continue;
      left = Math.min(left, px);
      right = Math.max(right, px);
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
    }
  }
  if (!Number.isFinite(left)) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/** Size limits for embossed text on a face (mm). */
export function textEmbossSizeLimits(meta, face, params = null) {
  const frame = getEmbossFaceFrame(meta, face || "front", params);
  return {
    min: 3,
    max: Math.min(48, Math.max(20, Math.round(frame.faceH * 0.48 * 2) / 2)),
    maxWidthMm: Math.max(20, frame.faceW * 0.88),
  };
}

/** True when text has at least one non-empty line. */
function textHasInk(text) {
  return String(text || "")
    .split(/\r?\n/)
    .some((l) => l.trim());
}

/** Shared text layout — keeps 3D mesh and selection handles aligned. */
function computeTextArtLayout(meta, params) {
  const text = String(params.embossText || "");
  if (!textHasInk(text)) return null;
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const limits = textEmbossSizeLimits(meta, frame.face, params);
  const labelH = clamp(params.embossHeight ?? 7, limits.min, limits.max);
  const arcMode = (params.embossTextLayout || "flat") === "arc";
  const fontId = params.embossFont || "inter";
  const fontSizePx = isLabelExport(params) ? 1280 : 640;

  let raster;
  if (arcMode) {
    const radiusMm = resolveArcRadiusMm(frame, meta, params, labelH);
    const radiusPx = (radiusMm / labelH) * fontSizePx;
    raster = rasterArcTextMask(text, fontId, fontSizePx, {
      sweepDeg: params.embossArcSweep ?? 220,
      radiusPx,
      startDeg: params.embossArcStartDeg ?? -90,
      spacing: params.embossArcSpacing ?? 1,
      side: params.embossArcSide === "down" ? "down" : "up",
    });
  } else {
    raster = rasterTextMask(text, fontId, fontSizePx, params.embossTextAlign || "left");
  }
  if (!raster?.mask?.length) return null;

  const { mask, width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(mask, maskW, maskH);
  if (!glyph) return null;

  const scale = Math.min(labelH / glyph.height, limits.maxWidthMm / glyph.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artW = glyph.width * scale;
  const artH = glyph.height * scale;

  let left;
  let right;
  let bottom;
  let top;
  let cx;
  let cy;
  let canvasXOff;
  let canvasZOff;
  let rotation;

  if (arcMode && raster.arcCenterPx) {
    const [acxPx, acyPx] = raster.arcCenterPx;
    const faceCy = frame.horizontal ? 0 : frame.centerZ;
    const targetCx = params.textOffsetX ?? 0;
    const targetCy = faceCy + (params.textOffsetY ?? 0);
    canvasXOff = targetCx - acxPx * scale;
    canvasZOff = targetCy - (maskH - acyPx) * scale;
    left = canvasXOff + glyph.left * scale;
    right = canvasXOff + (glyph.right + 1) * scale;
    bottom = canvasZOff + (maskH - glyph.bottom - 1) * scale;
    top = canvasZOff + (maskH - glyph.top) * scale;
    cx = targetCx;
    cy = targetCy;
    rotation = params.embossArcTilt ?? 0;
  } else {
    const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH, "text");
    left = xOff;
    right = xOff + artW;
    bottom = zOff;
    top = zOff + artH;
    cx = xOff + artW / 2;
    cy = zOff + artH / 2;
    canvasXOff = xOff - glyph.left * scale;
    canvasZOff = zOff - (maskH - glyph.bottom) * scale;
    rotation = params.textRotation ?? 0;
  }

  return {
    frame,
    raster,
    scale,
    xOff: canvasXOff,
    zOff: canvasZOff,
    artW,
    artH,
    maskW,
    maskH,
    left,
    right,
    bottom,
    top,
    cx,
    cy,
    rotation,
    glyphHeightMm: artH,
    arcMode,
  };
}

function flatCoordForFrame(frame, w) {
  if (frame.face === "wrap") return [w[0], w[1]];
  if (frame.horizontal) return [w[0], w[1]];
  if (frame.face === "left" || frame.face === "right") return [w[1], w[2]];
  return [w[0], w[2]];
}

function profilePointAtArc(outer, normals, arcLen) {
  const n = outer.length;
  const perim = profileOutlineArcMetrics(outer).perimeter;
  const t = ((arcLen % perim) + perim) % perim;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = outer[i][0];
    const ay = outer[i][1];
    const bx = outer[j][0];
    const by = outer[j][1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (acc + segLen >= t - 1e-9 || i === n - 1) {
      const u = segLen > 1e-9 ? (t - acc) / segLen : 0;
      const x = ax + (bx - ax) * u;
      const y = ay + (by - ay) * u;
      const nx = normals[i][0] + (normals[j][0] - normals[i][0]) * u;
      const ny = normals[i][1] + (normals[j][1] - normals[i][1]) * u;
      const nlen = Math.hypot(nx, ny) || 1;
      return { x, y, nx: nx / nlen, ny: ny / nlen };
    }
    acc += segLen;
  }
  return { x: outer[0][0], y: outer[0][1], nx: normals[0][0], ny: normals[0][1] };
}

/** Arc length to the profile point facing the default camera (-Y). */
function profileArcFrontOffset(outer) {
  let bestY = Infinity;
  let bestArc = 0;
  let acc = 0;
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const y = outer[i][1];
    if (y < bestY) {
      bestY = y;
      bestArc = acc;
    }
    const j = (i + 1) % n;
    acc += Math.hypot(outer[j][0] - outer[i][0], outer[j][1] - outer[i][1]);
  }
  return bestArc;
}

function unwrapWrapX(x, anchor, perim) {
  let dx = x - anchor;
  dx -= perim * Math.round(dx / perim);
  return anchor + dx;
}

/** Keep wall-wrap polygons near their anchor so edges don't chord across the seam. */
function normalizeWrapShapeGroups(shapeGroups, perim, anchorX) {
  if (!shapeGroups?.length || !Number.isFinite(perim) || perim <= 0) return shapeGroups;
  const mapPt = ([x, y]) => [unwrapWrapX(x, anchorX, perim), y];
  return shapeGroups.map((group) => ({
    outer: group.outer.map(mapPt),
    holes: group.holes.map((hole) => hole.map(mapPt)),
  }));
}

function wrapFlatFromArt() {
  return (px, py) => [px, py];
}

function wrapExtrudeCaps(frame, caps) {
  return frame.face === "wrap" ? { caps, flatFromArt: wrapFlatFromArt() } : { caps };
}

/** Wall-wrap frame — art maps around the outer profile (arc length × height).
 * When surface texture is on, offsets ride the same displacement as the body wall
 * so emboss/decals are not shredded by ripple peaks punching through flat art. */
export function getProfileWrapFaceFrame(outerProfile, meta, params = null) {
  const outer = outerProfile.map((p) => [p[0], p[1]]);
  const normals = profileOutlineNormals(outer);
  const metrics = profileOutlineArcMetrics(outer);
  const totalH = meta.outer?.h ?? meta.totalH ?? 40;
  const floor = meta.outer?.h != null && meta.inner?.h != null
    ? meta.outer.h - meta.inner.h
    : (meta.floor ?? 0);
  const arcOrigin = profileArcFrontOffset(outer);
  const textureSpec = resolveVaseTexture(params || {}, {
    height: totalH,
    floor,
    diameter: metrics.effectiveDiameter,
  });
  const textured = textureSpec && textureSpec.style !== "none" && textureSpec.depth > 0;
  const texSpec = textured
    ? { ...textureSpec, height: totalH, floor, diameter: metrics.effectiveDiameter }
    : null;

  return {
    face: "wrap",
    faceW: metrics.perimeter,
    faceH: totalH,
    centerZ: totalH * 0.5,
    horizontal: false,
    arcOrigin,
    textured: !!textured,
    mapPoint: (px, py, offset) => {
      const arcLen = px + arcOrigin;
      const pt = profilePointAtArc(outer, normals, arcLen);
      const z = clamp(py, 0, totalH);
      let surfaceDr = 0;
      if (texSpec) {
        const perim = metrics.perimeter || 1;
        const t = ((arcLen % perim) + perim) % perim;
        const angle = (t / perim) * Math.PI * 2 - Math.PI;
        surfaceDr = vaseTextureDisplacement(angle, z, texSpec);
      }
      const r = surfaceDr + offset;
      return [pt.x + pt.nx * r, pt.y + pt.ny * r, z];
    },
  };
}

function isLabelExport(params) {
  return !!params?.__labelExportStandoff;
}

function labelMaskSimplifyTol(maskW, params) {
  if (isLabelExport(params)) return Math.max(0.02, maskW / 8000);
  return Math.max(0.1, maskW / 1400);
}

function labelSmoothPasses(sizeMm, params, { hiRes = false } = {}) {
  if (isLabelExport(params)) return 1;
  if (hiRes) return 5;
  if (sizeMm <= 8) return 4;
  if (sizeMm <= 14) return 3;
  if (sizeMm <= 20) return 3;
  return 2;
}

function finishExportShapeGroups(groups, params) {
  if (!groups?.length || !isLabelExport(params)) return groups;
  return groups;
}

/** Solid filled regions from outline strokes — avoids dashed quad segments in export. */
function shapeGroupsFromStrokePathsForExport(paths, maskW, maskH, strokePx, artH, params) {
  const smoothPasses = labelSmoothPasses(artH, params);
  const simplifyTol = Math.max(0.03, maskW / 6000);
  const prepared = prepareStrokePaths(paths, simplifyTol, smoothPasses);
  const exportStrokePx = strokePx * 1.85;
  let mask = rasterizeStrokePathsToMask(prepared, maskW, maskH, exportStrokePx);
  mask = dilateMask(mask, maskW, maskH, 3);
  return prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    simplifyTol,
    0,
  );
}

function prepareTextExportMask(mask, maskW, maskH, params) {
  if (!isLabelExport(params)) return mask;
  const out = mask instanceof Uint8Array ? mask.slice() : new Uint8Array(mask);
  // Close anti-alias pinholes that read as horizontal layer gaps in the slicer.
  return dilateMask(out, maskW, maskH, 4);
}

function collectTextEmbossShapeGroups(meta, params) {
  const layout = computeTextArtLayout(meta, params);
  if (!layout) return null;

  const { frame, raster, scale, xOff, zOff, maskW, maskH, cx, cy, rotation } = layout;
  const simplifyTol = labelMaskSimplifyTol(maskW, params);
  const glyphMm = layout.glyphHeightMm ?? 7;
  const smoothPasses = isLabelExport(params) ? 0 : labelSmoothPasses(glyphMm, params);
  const textMask = prepareTextExportMask(raster.mask, maskW, maskH, params);
  let shapeGroups;
  if (isLabelExport(params)) {
    const rawGroups = groupPolygonsWithHoles(maskToPolygons(textMask, maskW, maskH));
    // Arc letters are spaced on a curve — union would merge/warp them.
    if (layout.arcMode) {
      shapeGroups = prepareShapeGroups(rawGroups, simplifyTol, 0);
    } else {
      const united = unionShapeGroupsToPrepared(rawGroups, maskW, maskH, simplifyTol, 0, rawGroups.length > 12 ? 4 : 2);
      shapeGroups = united.length ? united : prepareShapeGroups(rawGroups, simplifyTol, 0);
    }
  } else {
    shapeGroups = prepareShapeGroups(
      groupPolygonsWithHoles(maskToPolygons(textMask, maskW, maskH)),
      simplifyTol,
      smoothPasses,
    );
  }

  const remapped = shapeGroups.map((group) => ({
    outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
    holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
  }));

  let shaped = remapped.map((g) => rotateShapeGroup(g, cx, cy, rotation));
  if (frame.face === "wrap") {
    shaped = normalizeWrapShapeGroups(shaped, frame.faceW, cx);
  }
  shaped = finishExportShapeGroups(shaped, params);

  return {
    frame,
    shapeGroups: shaped,
    depth: clamp(params.embossDepth ?? 0.7, 0.3, 2),
  };
}

function inflateShapeGroups(shapeGroups, padMm = 0.25) {
  if (!padMm || !shapeGroups?.length) return shapeGroups;
  return shapeGroups.map((group) => ({
    outer: inflateRing(group.outer, padMm),
    holes: group.holes.map((hole) => inflateRing(hole, -padMm)),
  }));
}

function inflateRing(ring, pad) {
  if (!ring?.length || !pad) return ring;
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  const out = pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * pad, y + (dy / len) * pad];
  });
  if (out.length) out.push(out[0]);
  return out;
}

/** Pre-unioned at trace time, or fast cached preview merge — never sync full union on slider rebuilds. */
function unionDenseTraceShapeGroups(sourceGroups, maskW, maskH, artH, params, bitmap) {
  if (bitmap?.shapeGroupsUnited) return sourceGroups;
  if (!sourceGroups?.length || sourceGroups.length <= 1) return sourceGroups;
  if (isLabelExport(params)) {
    const simplifyTol = Math.max(0.06, maskW / 4000);
    const { groups } = unionDenseEmbossShapeGroups(sourceGroups, maskW, maskH, { simplifyTol, smoothPasses: 1 });
    return groups;
  }
  if (bitmap?.previewShapeGroups?.length) return bitmap.previewShapeGroups;
  const merged = previewMergeTraceShapeGroups(sourceGroups, maskW, maskH);
  if (bitmap && merged !== sourceGroups) bitmap.previewShapeGroups = merged;
  return merged;
}

function collectBitmapGraphicShapeGroups(meta, params, bitmap) {
  if (!bitmap?.width || !bitmap.height) return null;
  const artH = clamp(params.embossTraceSize ?? 16, 6, 56);
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artWidth = bitmap.width * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artWidth, artH);
  const rotCx = xOff + artWidth / 2;
  const rotCy = zOff + artH / 2;
  const rotation = params.decorRotation ?? 0;
  const maskW = Math.round(bitmap.width);
  const maskH = Math.round(bitmap.height);
  if (maskW <= 0 || maskH <= 0) return null;

  const mapFaceGroup = (group) => {
    const remapped = {
      outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
      holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
    };
    let shaped = rotateShapeGroup(remapped, rotCx, rotCy, rotation);
    if (frame.face === "wrap") shaped = normalizeWrapShapeGroups([shaped], frame.faceW, rotCx)[0];
    return shaped;
  };

  const groups = [];
  if (bitmap.shapeGroups?.length) {
    const sourceGroups = unionDenseTraceShapeGroups(bitmap.shapeGroups, maskW, maskH, artH, params, bitmap);
    for (const group of sourceGroups) groups.push(mapFaceGroup(group));
  } else if (bitmap.mask?.length === maskW * maskH) {
    const mask = bitmap.mask instanceof Uint8Array ? bitmap.mask : new Uint8Array(bitmap.mask);
    const hiRes = maskW >= 1800;
    const smoothPasses = labelSmoothPasses(artH, params, { hiRes });
    const simplifyTol = isLabelExport(params)
      ? Math.max(0.06, maskW / 4000)
      : hiRes ? Math.max(0.1, maskW / 1400) : Math.max(0.28, maskW / 480);
    const shapeGroups = prepareShapeGroups(
      groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
      simplifyTol,
      smoothPasses,
    );
    for (const group of shapeGroups) groups.push(mapFaceGroup(group));
  } else if (bitmap.strokePaths?.length) {
    const strokePx = bitmap.strokeWidth ?? Math.max(1.35, maskW / 88);
    if (isLabelExport(params)) {
      let shapeGroups = shapeGroupsFromStrokePathsForExport(
        bitmap.strokePaths,
        maskW,
        maskH,
        strokePx,
        artH,
        params,
      );
      if (shapeGroups.length > 1) {
        const simplifyTol = Math.max(0.06, maskW / 4000);
        const united = unionShapeGroupsToPrepared(
          shapeGroups,
          maskW,
          maskH,
          simplifyTol,
          1,
          4,
        );
        if (united.length) shapeGroups = united;
      }
      for (const group of shapeGroups) groups.push(mapFaceGroup(group));
    } else {
      const smoothPasses = labelSmoothPasses(artH, params);
      const simplifyTol = Math.max(0.22, maskW / 520);
      const paths = prepareStrokePaths(bitmap.strokePaths, simplifyTol, smoothPasses);
      const halfW = clamp(scale * strokePx * 0.55, 0.35, 2.2);
      const mapPt = (px, py) => rotateFacePoint(rotCx, rotCy, xOff + px * scale, zOff + (maskH - py) * scale, rotation);
      for (const path of paths) {
        if (path.length < 2) continue;
        for (let i = 0; i < path.length - 1; i++) {
          const [x0, y0] = mapPt(path[i][0], path[i][1]);
          const [x1, y1] = mapPt(path[i + 1][0], path[i + 1][1]);
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * halfW;
          const ny = (dx / len) * halfW;
          groups.push({
            outer: [
              [x0 + nx, y0 + ny],
              [x1 + nx, y1 + ny],
              [x1 - nx, y1 - ny],
              [x0 - nx, y0 - ny],
              [x0 + nx, y0 + ny],
            ],
            holes: [],
          });
        }
      }
    }
  }

  return groups.length ? { frame, shapeGroups: finishExportShapeGroups(groups, params) } : null;
}

function collectSvgGraphicShapeGroups(meta, params, svgText) {
  const parsed = parseSvgPaths(svgText);
  const layout = computeSvgArtLayout(parsed, meta, params);
  if (!layout) return null;

  const { frame, sw, sh, artH, scale } = layout;
  const strokePaths = parsed.strokePaths || [];
  const fillRings = parsed.fillRings || [];
  const groups = [];

  if (fillRings.length) {
    const simplifyTol = isLabelExport(params)
      ? Math.max(0.06, Math.max(sw, sh) / 1200)
      : Math.max(0.12, Math.max(sw, sh) / 480);
    const smoothPasses = labelSmoothPasses(artH, params);
    const rawGroups = fillRings.map((ring) => ({ outer: ring, holes: [] }));
    const shapeGroups = prepareShapeGroups(rawGroups, simplifyTol, smoothPasses);
    for (const group of shapeGroups) {
      const remapped = {
        outer: group.outer.map(([x, y]) => mapSvgArtPoint(layout, x, y)),
        holes: group.holes.map((h) => h.map(([x, y]) => mapSvgArtPoint(layout, x, y))),
      };
      let shaped = remapped;
      if (frame.face === "wrap") shaped = normalizeWrapShapeGroups([remapped], frame.faceW, layout.rotCx)[0];
      groups.push(shaped);
    }
  }

  if (strokePaths.length) {
    const svgStroke = parsed.strokeWidth ?? 1.5;
    const maskW = Math.max(1, Math.round(sw));
    const maskH = Math.max(1, Math.round(sh));
    if (isLabelExport(params)) {
      const shapeGroups = shapeGroupsFromStrokePathsForExport(
        strokePaths,
        maskW,
        maskH,
        svgStroke,
        artH,
        params,
      );
      for (const group of shapeGroups) {
        const remapped = {
          outer: group.outer.map(([x, y]) => mapSvgArtPoint(layout, x, y)),
          holes: group.holes.map((h) => h.map(([x, y]) => mapSvgArtPoint(layout, x, y))),
        };
        let shaped = remapped;
        if (frame.face === "wrap") shaped = normalizeWrapShapeGroups([remapped], frame.faceW, layout.rotCx)[0];
        groups.push(shaped);
      }
    } else {
      const halfW = clamp(scale * svgStroke * 0.55, 0.35, 2.2);
      const smoothPasses = labelSmoothPasses(artH, params);
      const simplifyTol = Math.max(0.18, Math.max(sw, sh) / 520);
      const closedPaths = strokePaths.map((line) => {
        if (line.length < 2) return line;
        const a = line[0];
        const b = line[line.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) return line;
        return [...line, a];
      });
      const paths = prepareStrokePaths(closedPaths, simplifyTol, smoothPasses);
      for (const path of paths) {
        if (path.length < 2) continue;
        for (let i = 0; i < path.length - 1; i++) {
          const [x0, y0] = mapSvgArtPoint(layout, path[i][0], path[i][1]);
          const [x1, y1] = mapSvgArtPoint(layout, path[i + 1][0], path[i + 1][1]);
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * halfW;
          const ny = (dx / len) * halfW;
          groups.push({
            outer: [
              [x0 + nx, y0 + ny],
              [x1 + nx, y1 + ny],
              [x1 - nx, y1 - ny],
              [x0 - nx, y0 - ny],
              [x0 + nx, y0 + ny],
            ],
            holes: [],
          });
        }
      }
    }
  }

  return groups.length ? { frame, shapeGroups: finishExportShapeGroups(groups, params) } : null;
}

function collectGraphicEmbossShapeGroups(meta, params, svgText = "") {
  const traceData = params.embossTraceRects;
  const hasTrace =
    params.embossTraceEnabled &&
    (traceData?.shapeGroups?.length ||
      traceData?.strokePaths?.length ||
      traceData?.mask?.length ||
      traceData?.rects?.length);
  const hasSvg = params.embossSvgEnabled && !!svgText?.trim() && !hasTrace;
  if (hasTrace) return collectBitmapGraphicShapeGroups(meta, params, traceData);
  if (hasSvg) return collectSvgGraphicShapeGroups(meta, params, svgText);
  return null;
}

/** Combined text + graphic ink footprint on the label face (for export wall pockets). */
export function collectLabelEmbossShapeGroups(meta, params, svgText = "") {
  const groups = [];
  let frame = null;
  const textCol = collectTextEmbossShapeGroups(meta, params);
  if (textCol) {
    frame = textCol.frame;
    groups.push(...textCol.shapeGroups);
  }
  const graphicCol = collectGraphicEmbossShapeGroups(meta, params, svgText);
  if (graphicCol) {
    frame = frame || graphicCol.frame;
    if (graphicCol.frame?.face !== frame?.face) return textCol || graphicCol;
    groups.push(...graphicCol.shapeGroups);
  }
  if (!groups.length || !frame) return null;
  return { frame, shapeGroups: groups };
}

/** Cut wall pockets under separate-colour art so the slicer keeps the rest of the face. */
export function punchBodyShellForLabelExport(shellMesh, meta, params, svgText = "") {
  if (!shellMesh?.indices?.length) return shellMesh;
  const face = params.embossFace || "front";
  if (face === "lid" || face === "wrap" || params.embossDeboss) return shellMesh;
  const collected = collectLabelEmbossShapeGroups(meta, params, svgText);
  if (!collected?.shapeGroups?.length) return shellMesh;
  const inflated = inflateShapeGroups(collected.shapeGroups, 0.3);
  return removeWallTrisUnderEmboss(
    { positions: shellMesh.positions.slice(), indices: shellMesh.indices.slice() },
    collected.frame,
    meta,
    inflated,
  );
}

function exteriorFacePlane(frame, meta) {
  const b = rectFeatureBounds(meta);
  const eps = 0.06;
  switch (frame.face) {
    case "front":
      return { onPlane: (w) => Math.abs(w[1] + b.od2) <= eps, normal: [0, -1, 0], to2D: (w) => [w[0], w[2]] };
    case "back":
      return { onPlane: (w) => Math.abs(w[1] - b.od2) <= eps, normal: [0, 1, 0], to2D: (w) => [w[0], w[2]] };
    case "right":
      return { onPlane: (w) => Math.abs(w[0] - b.ow2) <= eps, normal: [1, 0, 0], to2D: (w) => [w[1], w[2]] };
    case "left":
      return { onPlane: (w) => Math.abs(w[0] + b.ow2) <= eps, normal: [-1, 0, 0], to2D: (w) => [w[1], w[2]] };
    case "top":
      return { onPlane: (w) => Math.abs(w[2] - b.totalH) <= eps, normal: [0, 0, 1], to2D: (w) => [w[0], w[1]] };
    case "bottom":
      return { onPlane: (w) => Math.abs(w[2]) <= eps, normal: [0, 0, -1], to2D: (w) => [w[0], w[1]] };
    default:
      return null;
  }
}

function meshTriNormal(positions, ia, ib, ic) {
  const ax = positions[ia * 3];
  const ay = positions[ia * 3 + 1];
  const az = positions[ia * 3 + 2];
  const bx = positions[ib * 3];
  const by = positions[ib * 3 + 1];
  const bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3];
  const cy = positions[ic * 3 + 1];
  const cz = positions[ic * 3 + 2];
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function triOnExteriorFace(positions, ia, ib, ic, spec) {
  const a = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
  const b = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
  const c = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
  if (!spec.onPlane(a) || !spec.onPlane(b) || !spec.onPlane(c)) return false;
  const n = meshTriNormal(positions, ia, ib, ic);
  return n[0] * spec.normal[0] + n[1] * spec.normal[1] + n[2] * spec.normal[2] > 0.5;
}

function removeExteriorWallTriangles(mesh, frame, meta) {
  const spec = exteriorFacePlane(frame, meta);
  if (!spec) return mesh;
  const positions = mesh.positions;
  const indices = mesh.indices;
  const cleanIdx = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    if (triOnExteriorFace(positions, ia, ib, ic, spec)) continue;
    cleanIdx.push(ia, ib, ic);
  }
  return { positions: positions.slice(), indices: cleanIdx };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInShapeGroup(px, py, group) {
  if (!pointInRing(px, py, group.outer)) return false;
  for (const hole of group.holes) {
    if (hole.length >= 3 && pointInRing(px, py, hole)) return false;
  }
  return true;
}

function removeWallTrisUnderEmboss(mesh, frame, meta, shapeGroups) {
  const spec = exteriorFacePlane(frame, meta);
  if (!spec || !shapeGroups?.length) return mesh;
  const positions = mesh.positions;
  const cleanIdx = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t];
    const ib = mesh.indices[t + 1];
    const ic = mesh.indices[t + 2];
    if (triOnExteriorFace(positions, ia, ib, ic, spec)) {
      const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
      const cy = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3;
      const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
      const [px, py] = spec.to2D([cx, cy, cz]);
      let underInk = false;
      for (const group of shapeGroups) {
        if (pointInShapeGroup(px, py, group)) {
          underInk = true;
          break;
        }
      }
      if (underInk) continue;
    }
    cleanIdx.push(ia, ib, ic);
  }
  return { positions: positions.slice(), indices: cleanIdx };
}

function appendMesh(positions, indices, mesh) {
  if (!mesh?.positions?.length || !mesh?.indices?.length) return;
  const base = positions.length / 3;
  for (let i = 0; i < mesh.positions.length; i++) positions.push(mesh.positions[i]);
  for (const idx of mesh.indices) indices.push(idx + base);
}

/** Watertight side-face text for STL export — preview still uses fast merge. */
function buildWatertightTextEmbossExport(shellMesh, meta, params) {
  const collected = collectTextEmbossShapeGroups(meta, params);
  if (!collected?.shapeGroups?.length) return null;

  const { frame, shapeGroups, depth } = collected;
  const positions = [];
  const indices = [];
  const stripped = removeExteriorWallTriangles(shellMesh, frame, meta);
  appendMesh(positions, indices, stripped);

  const fw = frame.faceW;
  const fh = frame.faceH;
  const outerRect = [[-fw / 2, 0], [fw / 2, 0], [fw / 2, fh], [-fw / 2, fh]];
  const mapBot = (px, py) => frame.mapPoint(px, py, 0);
  const mapTop = (px, py) => frame.mapPoint(px, py, depth);
  const flatCoord = (w) => flatCoordForFrame(frame, w);

  triangulateMappedCap(positions, indices, mapBot, flatCoord, outerRect, [], true);

  for (const group of shapeGroups) {
    const { caps, flatFromArt } = wrapExtrudeCaps(frame, "both");
    extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flatCoord, caps, flatFromArt);
  }

  return removeWallTrisUnderEmboss({ positions, indices }, frame, meta, shapeGroups);
}

/** Closed letter solids for separate-colour export (no wall interaction). */
export function buildTextLabelExportMesh(meta, params) {
  const p = { ...params, __labelExportKind: "text" };
  const collected = collectTextEmbossShapeGroups(meta, p);
  if (!collected?.shapeGroups?.length) return null;

  if (isLabelExport(p)) {
    const { d0, d1 } = labelOffsets(p);
    const slab = buildFaceDecalSlabMesh(collected.frame, collected.shapeGroups, { d0, d1 });
    if (slab?.indices?.length) return slab;
  }

  const { frame, shapeGroups } = collected;
  const { d0, d1 } = labelOffsets(p);
  const positions = [];
  const indices = [];
  extrudeGroupsOnFace(positions, indices, frame, shapeGroups, d0, d1, p);
  return positions.length ? { positions, indices } : null;
}

/** Closed graphic solids for separate-colour export (trace/SVG — not thin stroke quads). */
export function buildGraphicLabelExportMesh(meta, params, svgText = "") {
  const p = { ...params, __labelExportKind: "art" };
  const collected = collectGraphicEmbossShapeGroups(meta, p, svgText);
  if (!collected?.shapeGroups?.length) return null;

  if (isLabelExport(p)) {
    const { d0, d1 } = labelOffsets(p);
    const slab = buildFaceDecalSlabMesh(collected.frame, collected.shapeGroups, { d0, d1 });
    if (slab?.indices?.length) return slab;
  }

  const { frame, shapeGroups } = collected;
  const { d0, d1 } = labelOffsets(p);
  const positions = [];
  const indices = [];
  extrudeGroupsOnFace(positions, indices, frame, shapeGroups, d0, d1, p);
  return positions.length ? { positions, indices } : null;
}

function appendColoredMeshPart(positions, indices, triangleExtruders, mesh, extruder) {
  if (!mesh?.indices?.length) return;
  const vBase = positions.length / 3;
  for (let i = 0; i < mesh.positions.length; i++) positions.push(mesh.positions[i]);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    indices.push(mesh.indices[t] + vBase, mesh.indices[t + 1] + vBase, mesh.indices[t + 2] + vBase);
    triangleExtruders.push(extruder);
  }
}

/** One AMS object — body wall intact, art/text painted per triangle (no Bambu face cull). */
export function buildMergedAmsExportMesh(shellMesh, meta, params, svgText = "", { includeArt = true, includeText = true } = {}) {
  if (!shellMesh?.indices?.length) return null;
  const exportParams = { ...params, __labelExportMerged: true };
  const positions = [];
  const indices = [];
  const triangleExtruders = [];

  appendColoredMeshPart(positions, indices, triangleExtruders, shellMesh, 1);
  let extruder = 2;
  if (includeArt) {
    const artMesh = buildLabelGraphicEmboss(meta, exportParams, svgText, "emboss");
    appendColoredMeshPart(positions, indices, triangleExtruders, artMesh, extruder);
    extruder += 1;
  }
  if (includeText) {
    const textMesh = buildTextLabelExportMesh(meta, exportParams);
    appendColoredMeshPart(positions, indices, triangleExtruders, textMesh, extruder);
  }

  return indices.length ? { positions, indices, triangleExtruders } : null;
}

export function buildWatertightExportMesh(bodyMesh, meta, params) {
  if (!bodyMesh || params.embossDeboss) return bodyMesh;
  const face = params.embossFace || "front";
  if (face === "lid" || face === "wrap" || params.joinerEnabled) return bodyMesh;

  const shell = bodyMesh.shellMesh || bodyMesh;
  if (params.embossText?.trim() && !params.embossDeboss) {
    return buildWatertightTextEmbossExport(shell, meta, params) || bodyMesh;
  }
  return bodyMesh;
}

const WATERMARK_DEPTH = 0.6;

function textMaskToShapeGroups(text, fontId, labelHMm, xOff, zOff) {
  const raster = rasterTextMask(text, fontId, 640, "left");
  if (!raster?.mask?.length) return [];
  const { mask, width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(mask, maskW, maskH);
  if (!glyph) return [];
  const scale = labelHMm / glyph.height;
  if (!Number.isFinite(scale) || scale <= 0) return [];
  const canvasXOff = xOff - glyph.left * scale;
  const canvasZOff = zOff - (maskH - glyph.bottom) * scale;
  const simplifyTol = Math.max(0.08, maskW / 1600);
  const smoothPasses = labelHMm <= 4 ? 3 : 2;
  const shapeGroups = prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    simplifyTol,
    smoothPasses,
  );
  return shapeGroups.map((group) => ({
    outer: group.outer.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale]),
    holes: group.holes.map((h) => h.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale])),
  }));
}

function monogramShapeGroups(frame) {
  const inset = 6;
  const monoH = 7;
  const xOff = -frame.faceW / 2 + inset;
  const zOff = -frame.faceH / 2 + inset;
  const raster = rasterTextMask("MD", "impact", 320, "left");
  if (!raster?.mask?.length) return [];
  const { mask, width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(mask, maskW, maskH);
  if (!glyph) return [];
  const scale = monoH / glyph.height;
  const canvasXOff = xOff - glyph.left * scale;
  const canvasZOff = zOff - (maskH - glyph.bottom) * scale;
  const shapeGroups = prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    Math.max(0.1, maskW / 1400),
    2,
  );
  return shapeGroups.map((group) => ({
    outer: group.outer.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale]),
    holes: group.holes.map((h) => h.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale])),
  }));
}

function collectWatermarkShapeGroups(meta, stamp) {
  const frame = getEmbossFaceFrame(meta, "bottom", null);
  const inset = 6;
  const monoH = 7;
  const labelH = 3.2;
  const monoGroups = monogramShapeGroups(frame);
  let monoW = monoH * 1.35;
  if (monoGroups.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const group of monoGroups) {
      for (const [px] of group.outer) {
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
      }
    }
    if (Number.isFinite(minX)) monoW = maxX - minX;
  }
  const line = `MakerDeck · ${stamp.dateStr} · #${String(stamp.serial).padStart(4, "0")}`;
  const textX = -frame.faceW / 2 + inset + monoW + 2.5;
  const textZ = -frame.faceH / 2 + inset + (monoH - labelH) * 0.35;
  const textGroups = textMaskToShapeGroups(line, "consolas", labelH, textX, textZ);
  const shapeGroups = [...monoGroups, ...textGroups];
  if (!shapeGroups.length) return null;
  return { frame, shapeGroups, depth: WATERMARK_DEPTH };
}

function buildWatertightBottomDebossExport(shellMesh, meta, shapeGroups, depth = WATERMARK_DEPTH) {
  const frame = getEmbossFaceFrame(meta, "bottom", null);
  const positions = [];
  const indices = [];
  const stripped = removeExteriorWallTriangles(shellMesh, frame, meta);
  appendMesh(positions, indices, stripped);

  const fw = frame.faceW;
  const fh = frame.faceH;
  const outerRect = [[-fw / 2, -fh / 2], [fw / 2, -fh / 2], [fw / 2, fh / 2], [-fw / 2, fh / 2]];
  const mapSurf = (px, py) => frame.mapPoint(px, py, 0);
  const mapDeep = (px, py) => frame.mapPoint(px, py, -depth);
  const flatCoord = (w) => flatCoordForFrame(frame, w);

  triangulateMappedCap(positions, indices, mapSurf, flatCoord, outerRect, [], true);

  for (const group of shapeGroups) {
    extrudeShapeGroupBetween(positions, indices, group, mapSurf, mapDeep, flatCoord, "both");
  }

  return removeWallTrisUnderEmboss({ positions, indices }, frame, meta, shapeGroups);
}

/** Shallow bottom deboss — MD monogram + date/serial on the exterior underside. */
export function applyExportWatermark(mesh, meta, params, stamp) {
  if (!mesh || params.watermarkEnabled === false || !stamp) return mesh;
  if (!shapeSupportsDecor(meta.shape)) return mesh;
  const collected = collectWatermarkShapeGroups(meta, stamp);
  if (!collected?.shapeGroups?.length) return mesh;
  const shell = mesh.shellMesh || mesh;
  return buildWatertightBottomDebossExport(shell, meta, collected.shapeGroups, collected.depth) || mesh;
}

/** Preview-only groove mesh for the underside watermark (no shell surgery). */
export function buildWatermarkPreviewMesh(meta, stamp) {
  if (!stamp || !shapeSupportsDecor(meta.shape)) return null;
  const collected = collectWatermarkShapeGroups(meta, stamp);
  if (!collected?.shapeGroups?.length) return null;
  const { frame, shapeGroups, depth } = collected;
  const positions = [];
  const indices = [];
  const mapSurf = (px, py) => frame.mapPoint(px, py, 0);
  const mapDeep = (px, py) => frame.mapPoint(px, py, -depth);
  const flatCoord = (w) => flatCoordForFrame(frame, w);
  for (const group of shapeGroups) {
    extrudeShapeGroupBetween(positions, indices, group, mapSurf, mapDeep, flatCoord, "both");
  }
  return positions.length ? { positions, indices } : null;
}

/** Embossed label text — smooth stencil silhouettes (one solid per letter). */
export function buildEmbossText(meta, params) {
  const collected = collectTextEmbossShapeGroups(meta, params);
  if (!collected) return null;

  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const flatCoord = (w) => flatCoordForFrame(collected.frame, w);
  const mapTop = (px, py) => collected.frame.mapPoint(px, py, d1);
  const mapBot = (px, py) => collected.frame.mapPoint(px, py, d0);

  for (const group of collected.shapeGroups) {
    const { caps, flatFromArt } = wrapExtrudeCaps(collected.frame, "top");
    extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flatCoord, caps, flatFromArt);
  }
  return positions.length ? { positions, indices } : null;
}

/** Solid silhouette / traced bitmap emboss on chosen face. */
export function buildEmbossBitmap(meta, params, bitmap) {
  if (!bitmap?.width || !bitmap.height) return null;
  const artH = clamp(params.embossTraceSize ?? 16, 6, 56);
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artWidth = bitmap.width * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artWidth, artH);
  const rotCx = xOff + artWidth / 2;
  const rotCy = zOff + artH / 2;
  const rotation = params.decorRotation ?? 0;
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const maskW = Math.round(bitmap.width);
  const maskH = Math.round(bitmap.height);
  if (maskW <= 0 || maskH <= 0) return null;

  const isOutline = bitmap.mode === "outline";
  const denseTrace = (bitmap.shapeGroups?.length ?? 0) > 8;

  // Outline stroke extrusion is per-segment — freezes wrap preview on heraldic traces. Prefer merged solids.
  if (isOutline && bitmap.strokePaths?.length && !denseTrace && bitmap.strokePaths.length <= 12) {
    const smoothPasses = artH <= 12 ? 5 : artH <= 20 ? 4 : 3;
    const simplifyTol = Math.max(0.22, maskW / 520);
    const paths = prepareStrokePaths(bitmap.strokePaths, simplifyTol, smoothPasses);
    const strokePx = bitmap.strokeWidth ?? Math.max(1.35, maskW / 88);
    const lineWidth = clamp(scale * strokePx, 0.45, 1.5);
    const mapPt = (px, py) => rotateFacePoint(rotCx, rotCy, xOff + px * scale, zOff + (maskH - py) * scale, rotation);
    extrudeStrokePathList(positions, indices, frame, paths, mapPt, lineWidth, d0, d1);
    if (positions.length) return { positions, indices };
  }

  if (bitmap.shapeGroups?.length) {
    const sourceGroups = unionDenseTraceShapeGroups(bitmap.shapeGroups, maskW, maskH, artH, params, bitmap);
    const faceGroups = remappedBitmapFaceGroups(bitmap, frame, params, sourceGroups, maskW, maskH, artH);
    extrudeGroupsOnFace(positions, indices, frame, faceGroups, d0, d1, params);
    return positions.length ? { positions, indices } : null;
  }

  let mask = null;
  if (bitmap.mask?.length === maskW * maskH) {
    mask = bitmap.mask instanceof Uint8Array ? bitmap.mask : new Uint8Array(bitmap.mask);
  } else if (bitmap.rects?.length) {
    mask = new Uint8Array(maskW * maskH);
    for (const r of bitmap.rects) {
      const x0 = clamp(Math.floor(r.x), 0, maskW);
      const x1 = clamp(Math.ceil(r.x + r.w), 0, maskW);
      const yStart = clamp(Math.floor(r.y), 0, maskH);
      const yEnd = clamp(Math.ceil(r.y + r.h), 0, maskH);
      for (let py = yStart; py < yEnd; py++) {
        for (let px = x0; px < x1; px++) mask[py * maskW + px] = 1;
      }
    }
  } else {
    return null;
  }

  const hiRes = maskW >= 1800;
  const smoothPasses = hiRes ? 5 : artH <= 12 ? 4 : artH <= 20 ? 3 : 2;
  const simplifyTol = hiRes ? Math.max(0.1, maskW / 1400) : Math.max(0.28, maskW / 480);
  const shapeGroups = prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    simplifyTol,
    smoothPasses,
  );

  const faceGroups = remappedBitmapFaceGroups(bitmap, frame, params, shapeGroups, maskW, maskH, artH);
  extrudeGroupsOnFace(positions, indices, frame, faceGroups, d0, d1, params);

  return positions.length ? { positions, indices } : null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function splitPathSubpaths(d) {
  const trimmed = String(d || "").trim();
  if (!trimmed) return [];
  const parts = trimmed.match(/[Mm][^Mm]*/g);
  return parts?.length ? parts : [trimmed];
}

function dedupePolylinePoints(points, eps = 0.08) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= eps) out.push(p);
  }
  return out;
}

function transformSvgPoint(ctm, x, y) {
  if (!ctm) return [x, y];
  return [
    ctm.a * x + ctm.c * y + ctm.e,
    ctm.b * x + ctm.d * y + ctm.f,
  ];
}

function sampleSvgPathElementWithCtm(pathEl, maxPoints = 900) {
  const ctm = pathEl.getCTM?.() || null;
  const len = pathEl.getTotalLength();
  if (!Number.isFinite(len) || len < 0.02) return [];
  const count = Math.min(maxPoints, Math.max(24, Math.ceil(len / 0.28)));
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const pt = pathEl.getPointAtLength(Math.min((i / count) * len, len));
    pts.push(transformSvgPoint(ctm, pt.x, pt.y));
  }
  return dedupePolylinePoints(pts);
}

function polylineFromElementWithCtm(el) {
  const raw = polylineFromElement(el);
  const ctm = el.getCTM?.() || null;
  if (!ctm) return raw;
  return raw.map(([x, y]) => transformSvgPoint(ctm, x, y));
}

function svgEffectivePresentation(el, attr, root) {
  let node = el;
  while (node && node.nodeType === 1) {
    const val = node.getAttribute?.(attr);
    if (val != null && String(val).trim() !== "") return String(val).trim();
    if (node === root) break;
    node = node.parentNode;
  }
  return null;
}

/** Resolve fill/stroke intent — honours inherited SVG presentation attributes. */
function svgElementPaintMode(el, root) {
  const fill = svgEffectivePresentation(el, "fill", root);
  const stroke = svgEffectivePresentation(el, "stroke", root);
  const hasFill = fill != null ? fill !== "none" : true;
  const hasStroke = stroke != null && stroke !== "none";
  if (hasFill && hasStroke) return "both";
  if (hasFill) return "fill";
  if (hasStroke) return "stroke";
  return "none";
}

function closeSvgRing(points) {
  if (points.length < 3) return points;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  if (Math.hypot(x0 - x1, y0 - y1) < 0.05) return points;
  return [...points, [x0, y0]];
}

function routeSvgSample(points, mode, strokePaths, fillRings) {
  if (!points || points.length < 2) return;
  const closed = pathIsExplicitlyClosed(points);
  if (mode === "fill") {
    if (closed && points.length >= 3) fillRings.push(closeSvgRing(points));
    else strokePaths.push(points);
    return;
  }
  if (mode === "stroke") {
    strokePaths.push(points);
    return;
  }
  if (mode === "both") {
    if (closed && points.length >= 3) fillRings.push(closeSvgRing(points));
    else strokePaths.push(points);
  }
}

function sampleSvgPathElement(pathEl, maxPoints = 900) {
  return sampleSvgPathElementWithCtm(pathEl, maxPoints);
}

function parseSvgViewBox(svg) {
  const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb.every(Number.isFinite)) return vb;
  const w = parseFloat(String(svg.getAttribute("width") || "").replace(/[^\d.]/g, "")) || 100;
  const h = parseFloat(String(svg.getAttribute("height") || "").replace(/[^\d.]/g, "")) || 100;
  return [0, 0, w, h];
}

function readSvgStrokeWidth(pathEl, svg) {
  const raw = pathEl?.getAttribute("stroke-width") ?? svg?.getAttribute("stroke-width") ?? "1.5";
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 1.5;
}

function polylineFromElement(el) {
  if (el.tagName === "polyline" || el.tagName === "polygon") {
    const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) pts.push([nums[i], nums[i + 1]]);
    }
    if (el.tagName === "polygon" && pts.length >= 3) pts.push([pts[0][0], pts[0][1]]);
    return dedupePolylinePoints(pts);
  }
  if (el.tagName === "line") {
    const x1 = parseFloat(el.getAttribute("x1") || "0");
    const y1 = parseFloat(el.getAttribute("y1") || "0");
    const x2 = parseFloat(el.getAttribute("x2") || "0");
    const y2 = parseFloat(el.getAttribute("y2") || "0");
    return [[x1, y1], [x2, y2]];
  }
  if (el.tagName === "rect") {
    const x = parseFloat(el.getAttribute("x") || "0");
    const y = parseFloat(el.getAttribute("y") || "0");
    const w = parseFloat(el.getAttribute("width") || "0");
    const h = parseFloat(el.getAttribute("height") || "0");
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  }
  if (el.tagName === "circle") {
    const cx = parseFloat(el.getAttribute("cx") || "0");
    const cy = parseFloat(el.getAttribute("cy") || "0");
    const r = parseFloat(el.getAttribute("r") || "0");
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }
  if (el.tagName === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") || "0");
    const cy = parseFloat(el.getAttribute("cy") || "0");
    const rx = parseFloat(el.getAttribute("rx") || "0");
    const ry = parseFloat(el.getAttribute("ry") || "0");
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  }
  return [];
}

/** Sample SVG geometry — transform-aware, split into stroke paths and filled rings. */
export function parseSvgPaths(svgText) {
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return { polylines: [], strokePaths: [], fillRings: [], viewBox: [0, 0, 100, 100], strokeWidth: 1.5 };
  }
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() === "parsererror") {
    return { polylines: [], strokePaths: [], fillRings: [], viewBox: [0, 0, 100, 100], strokeWidth: 1.5 };
  }

  const viewBox = parseSvgViewBox(svg);
  const scratch = document.createElementNS(SVG_NS, "svg");
  scratch.setAttribute("xmlns", SVG_NS);
  scratch.setAttribute(
    "viewBox",
    svg.getAttribute("viewBox") || `${viewBox[0]} ${viewBox[1]} ${viewBox[2]} ${viewBox[3]}`,
  );
  scratch.setAttribute("width", String(viewBox[2]));
  scratch.setAttribute("height", String(viewBox[3]));
  scratch.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden";
  for (const child of [...svg.childNodes]) {
    if (child.nodeType !== 1) continue;
    if (child.tagName?.toLowerCase() === "defs") continue;
    scratch.appendChild(document.importNode(child, true));
  }
  document.body.appendChild(scratch);

  const strokePaths = [];
  const fillRings = [];
  let strokeWidth = readSvgStrokeWidth(null, svg);

  try {
    for (const pathEl of scratch.querySelectorAll("path")) {
      if (pathEl.closest("defs")) continue;
      const mode = svgElementPaintMode(pathEl, svg);
      if (mode === "none") continue;
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(pathEl, svg));
      const d = pathEl.getAttribute("d");
      if (!d) continue;
      const parent = pathEl.parentNode || scratch;
      for (const sub of splitPathSubpaths(d)) {
        const temp = document.createElementNS(SVG_NS, "path");
        temp.setAttribute("d", sub);
        parent.insertBefore(temp, pathEl);
        const sampled = sampleSvgPathElementWithCtm(temp);
        temp.remove();
        routeSvgSample(sampled, mode, strokePaths, fillRings);
      }
    }
    for (const el of scratch.querySelectorAll("polyline, polygon, line, rect, circle, ellipse")) {
      if (el.closest("defs")) continue;
      const mode = svgElementPaintMode(el, svg);
      if (mode === "none") continue;
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(el, svg));
      const sampled = polylineFromElementWithCtm(el);
      routeSvgSample(sampled, mode, strokePaths, fillRings);
    }
  } finally {
    scratch.remove();
  }

  const polylines = [...strokePaths, ...fillRings];
  return { polylines, strokePaths, fillRings, viewBox, strokeWidth };
}

export function parsedSvgHasFill(svgText) {
  const parsed = parseSvgPaths(svgText);
  return (parsed.fillRings?.length || 0) > 0;
}

/** True when vector SVG parsing yields emboss geometry for the current shape/face. */
export function svgEmbossProducesMesh(meta, params, svgText) {
  if (!meta || !svgText?.trim()) return false;
  const mesh = buildEmbossSvg(meta, params, svgText);
  return !!(mesh?.positions?.length && mesh?.indices?.length);
}

function pathIsExplicitlyClosed(path) {
  if (!path || path.length < 4) return false;
  const dx = path[0][0] - path[path.length - 1][0];
  const dy = path[0][1] - path[path.length - 1][1];
  return Math.hypot(dx, dy) < 0.05;
}

function extrudeStrokePathList(positions, indices, frame, paths, mapPt, lineWidthMm, d0, d1) {
  const half = lineWidthMm / 2;
  for (const path of paths) {
    if (!path?.length) continue;
    const closed = pathIsExplicitlyClosed(path);
    const pts = closed ? ringPointsLocal(path) : path;
    const segCount = closed ? pts.length : pts.length - 1;
    if (segCount < 1) continue;
    for (let i = 0; i < segCount; i++) {
      const j = closed ? (i + 1) % pts.length : i + 1;
      const [x0, y0] = mapPt(pts[i][0], pts[i][1]);
      const [x1, y1] = mapPt(pts[j][0], pts[j][1]);
      extrudeStrokeSegmentOnFace(positions, indices, frame, x0, y0, x1, y1, half, d0, d1);
    }
  }
}

function computeSvgArtLayout(parsed, meta, params) {
  const strokePaths = parsed.strokePaths || [];
  const fillRings = parsed.fillRings || [];
  const polylines = parsed.polylines || [...strokePaths, ...fillRings];
  if (!polylines.length) return null;

  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of polylines) {
    for (const [x, y] of line) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;

  const sw = maxX - minX || parsed.viewBox?.[2] || 1;
  const sh = maxY - minY || parsed.viewBox?.[3] || 1;
  const artH = clamp(params.embossTraceSize ?? params.embossHeight ?? 16, 6, 56);
  const wrap = frame.face === "wrap";
  const maxW = wrap ? Math.min(frame.faceW * 0.55, 72) : Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / sh, maxW / sw);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const cx = (minX + maxX) / 2;
  const artW = sw * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH);
  const rotCx = xOff + artW / 2;
  const rotCy = zOff + artH / 2;
  return {
    frame,
    scale,
    cx,
    minX,
    minY,
    maxX,
    maxY,
    sw,
    sh,
    artW,
    artH,
    xOff,
    zOff,
    rotCx,
    rotCy,
    rotation: params.decorRotation ?? 0,
  };
}

function mapSvgArtPoint(layout, x, y) {
  const { rotCx, rotCy, cx, maxY, scale, xOff, artW, zOff, rotation } = layout;
  return rotateFacePoint(
    rotCx,
    rotCy,
    (x - cx) * scale + xOff + artW / 2,
    zOff + (maxY - y) * scale,
    rotation,
  );
}

function extrudeSvgFillRings(outPos, outIdx, fillRings, layout, params) {
  if (!fillRings.length) return;
  const { frame, scale, rotCx, artH, sw, sh } = layout;
  const { d0, d1 } = labelOffsets(params);
  const simplifyTol = Math.max(0.12, Math.max(sw, sh) / 480);
  const smoothPasses = artH <= 12 ? 4 : artH <= 20 ? 3 : 2;
  const rawGroups = fillRings.map((ring) => ({ outer: ring, holes: [] }));
  const shapeGroups = prepareShapeGroups(rawGroups, simplifyTol, smoothPasses);
  const faceGroups = shapeGroups.map((group) => ({
    outer: group.outer.map(([x, y]) => mapSvgArtPoint(layout, x, y)),
    holes: group.holes.map((h) => h.map(([x, y]) => mapSvgArtPoint(layout, x, y))),
  }));
  if (faceGroups.length) {
    extrudeGroupsOnFace(outPos, outIdx, frame, faceGroups, d0, d1, params);
  }
}

export function buildEmbossSvg(meta, params, svgText) {
  const parsed = parseSvgPaths(svgText);
  const layout = computeSvgArtLayout(parsed, meta, params);
  if (!layout) return null;

  const strokePaths = parsed.strokePaths || [];
  const fillRings = parsed.fillRings || [];
  const { frame, sw, sh, artH, scale } = layout;
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];

  extrudeSvgFillRings(positions, indices, fillRings, layout, params);

  if (strokePaths.length) {
    const svgStroke = parsed.strokeWidth ?? 1.5;
    const lineWidth = clamp(scale * svgStroke, 0.45, 1.5);
    const smoothPasses = artH <= 12 ? 4 : artH <= 20 ? 3 : 2;
    const simplifyTol = Math.max(0.18, Math.max(sw, sh) / 520);
    const closedPaths = strokePaths.map((line) => {
      if (line.length >= 3) {
        const [x0, y0] = line[0];
        const [x1, y1] = line[line.length - 1];
        if (Math.hypot(x0 - x1, y0 - y1) < Math.max(0.35, Math.max(sw, sh) * 0.004)) {
          return [...line, line[0]];
        }
      }
      return line;
    });
    const prepared = prepareStrokePaths(closedPaths, simplifyTol, smoothPasses);
    const mapPt = (x, y) => mapSvgArtPoint(layout, x, y);
    extrudeStrokePathList(positions, indices, frame, prepared, mapPt, lineWidth, d0, d1);
  }

  return positions.length ? { positions, indices } : null;
}

export function resolveJoinerDims(params, outerW, outerD) {
  const span = Math.max(outerW, outerD);
  const auto = params.joinerAutoScale !== false;
  const scale = auto ? clamp(span / 94, 0.55, 2.2) : 1;
  const width = clamp((params.joinerWidth ?? 9) * scale, 4, 28);
  const neck = clamp(Math.min((params.joinerNeck ?? 6) * scale, width - 1.5), 2.5, width - 1);
  const protrusion = clamp((params.joinerProtrusion ?? 4) * scale, 1.8, 12);
  return {
    hand: params.joinerHand === "right" ? "right" : "left",
    width,
    neck,
    protrusion,
    clearance: params.joinerClearance ?? 0.3,
    wall: params.wall,
    scale: round1(scale),
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function shapeSupportsDecor(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencil" || shape === "pencilBox" || shape === "canisterSquare";
}

/** Parametric wall relief on curved profile containers (pots, tubes). */
export function shapeSupportsProfileTexture(shape) {
  return (
    shape === "teardrop"
    || shape === "heart"
    || shape === "star"
    || shape === "circle"
    || shape === "oval"
    || shape === "rect"
    || shape === "rounded"
    || shape === "pencil"
    || shape === "pencilBox"
    || shape === "canisterSquare"
    || shape === "canisterJar"
    || shape === "canisterStack"
  );
}

/** SVG / trace / text art on profile wall wrap. */
export function shapeSupportsProfileArt(shape) {
  return (
    shape === "teardrop"
    || shape === "heart"
    || shape === "star"
    || shape === "circle"
    || shape === "oval"
    || shape === "canisterJar"
    || shape === "canisterStack"
  );
}

export function shapeSupportsArt(shape) {
  return shapeSupportsDecor(shape) || shapeSupportsProfileArt(shape);
}

/** Accent bands wrap the outer wall profile — all container shapes except open specials. */
export function shapeSupportsAccent(shape) {
  return (
    shape === "vase"
    || shape === "rect"
    || shape === "rounded"
    || shape === "pencil"
    || shape === "pencilBox"
    || shape === "canisterSquare"
    || shape === "canisterJar"
    || shape === "circle"
    || shape === "oval"
    || shape === "hex"
    || shape === "polygon"
    || shape === "teardrop"
    || shape === "star"
    || shape === "heart"
  );
}

/** Front-panel-only accent band — flat box faces only. */
export function shapeSupportsAccentFrontFace(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencil" || shape === "pencilBox" || shape === "canisterSquare";
}

/** Face frame for placing emboss on any of the four side walls.
 * Returns an object with faceW / faceH (usable dimensions in mm) and a
 * mapPoint(px, py, offset) helper that projects a 2D art-space point (px, py)
 * onto the target face at a distance `offset` from the outer surface
 * (positive = outward, negative = inward for deboss).
 */
export function getEmbossFaceFrame(meta, face, params = null) {
  const useFace = ["front", "back", "left", "right", "top", "lid", "bottom", "wrap"].includes(face) ? face : "front";
  if (useFace === "wrap" && meta.outerProfile?.length >= 3) {
    return getProfileWrapFaceFrame(meta.outerProfile, meta, params);
  }

  const b = rectFeatureBounds(meta);

  if (useFace === "bottom") {
    return {
      face: "bottom",
      faceW: b.outerW,
      faceH: b.outerD,
      centerZ: 0,
      horizontal: true,
      // Exterior bottom at z=0; inward deboss = +Z (offset negative).
      mapPoint: (px, py, offset) => [px, py, -offset],
    };
  }

  if (useFace === "top") {
    return {
      face: "top",
      faceW: b.outerW,
      faceH: b.outerD,
      centerZ: b.totalH * 0.5,
      horizontal: true,
      mapPoint: (px, py, offset) => [px, py, b.totalH + offset],
    };
  }

  if (useFace === "lid") {
    const lidType = params?.lidType ?? "slip";
    const skirtDepth = lidType === "screw"
      ? clamp(params?.lidSkirt ?? 10, 6, 30)
      : clamp(params?.lidSkirt ?? 10, 4, 30);
    const lidThickness = clamp(params?.lidThickness ?? 2.4, 1.2, 8);
    const zTop = lidType === "flat" ? lidThickness : skirtDepth + lidThickness;
    return {
      face: "lid",
      faceW: b.outerW,
      faceH: b.outerD,
      centerZ: 0,
      horizontal: true,
      centerX: 0,
      mapPoint: (px, py, offset) => [px, py, zTop + offset],
    };
  }

  // Convention: default preview camera looks at -Y face → that's the user's "front".
  if (useFace === "front" || useFace === "back") {
    const yOut = useFace === "front" ? -b.od2 : b.od2;
    const yDir = useFace === "front" ? -1 : 1;
    // For "front" (world -Y) text is not mirrored — reads normally.
    // For "back" (world +Y) mirror X so text reads correctly when viewed from +Y.
    const mirror = useFace === "back";
    return {
      face: useFace,
      faceW: b.outerW,
      faceH: b.totalH,
      centerZ: b.totalH * 0.72,
      mapPoint: (px, py, offset) => {
        const y = yOut + yDir * offset;
        const x = mirror ? -px : px;
        return [x, y, py];
      },
    };
  }
  // Right = world +X face (visible in default preview orbit); Left = world -X face.
  const xOut = useFace === "right" ? b.ow2 : -b.ow2;
  const xDir = useFace === "right" ? 1 : -1;
  // Left face: viewer looks from -X toward +X → mirror so text reads L-to-R correctly.
  const mirror = useFace === "left";
  return {
    face: useFace,
    faceW: b.outerD,
    faceH: b.totalH,
    centerZ: b.totalH * 0.72,
    mapPoint: (px, py, offset) => {
      const x = xOut + xDir * offset;
      const y = mirror ? -px : px;
      return [x, y, py];
    },
  };
}

/** Extrude a raster-space rectangle onto a face frame between offsets [d0, d1].
 * (px range is [xLeft, xRight], py range is [zBottom, zTop] in art space.)
 */
function boxOnFace(outPos, outIdx, frame, xLeft, xRight, zBottom, zTop, d0, d1) {
  const p000 = frame.mapPoint(xLeft, zBottom, d0);
  const p100 = frame.mapPoint(xRight, zBottom, d0);
  const p110 = frame.mapPoint(xRight, zTop, d0);
  const p010 = frame.mapPoint(xLeft, zTop, d0);
  const p001 = frame.mapPoint(xLeft, zBottom, d1);
  const p101 = frame.mapPoint(xRight, zBottom, d1);
  const p111 = frame.mapPoint(xRight, zTop, d1);
  const p011 = frame.mapPoint(xLeft, zTop, d1);
  const winding = d1 > d0;
  const face = (a, b, c, d) => winding
    ? pushQuad(outPos, outIdx, a, b, c, d)
    : pushQuad(outPos, outIdx, a, d, c, b);
  face(p000, p100, p110, p010);
  face(p001, p011, p111, p101);
  face(p000, p001, p101, p100);
  face(p010, p110, p111, p011);
  face(p000, p010, p011, p001);
  face(p100, p101, p111, p110);
}

/** Extrude a thick line segment on a face (for outline / stroke emboss). */
function extrudeStrokeSegmentOnFace(outPos, outIdx, frame, x0, y0, x1, y1, half, d0, d1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  const winding = d1 > d0;
  const face = (a, b, c, d) => winding
    ? pushQuad(outPos, outIdx, a, b, c, d)
    : pushQuad(outPos, outIdx, a, d, c, b);
  const p000 = frame.mapPoint(x0 - nx, y0 - ny, d0);
  const p100 = frame.mapPoint(x1 - nx, y1 - ny, d0);
  const p110 = frame.mapPoint(x1 + nx, y1 + ny, d0);
  const p010 = frame.mapPoint(x0 + nx, y0 + ny, d0);
  const p001 = frame.mapPoint(x0 - nx, y0 - ny, d1);
  const p101 = frame.mapPoint(x1 - nx, y1 - ny, d1);
  const p111 = frame.mapPoint(x1 + nx, y1 + ny, d1);
  const p011 = frame.mapPoint(x0 + nx, y0 + ny, d1);
  face(p000, p100, p110, p010);
  face(p001, p011, p111, p101);
  face(p000, p001, p101, p100);
  face(p010, p110, p111, p011);
}

/** Extrude remapped art groups — wrap uses raster wall slabs (avoids earcut slash garbage). */
function extrudeGroupsOnFace(outPos, outIdx, frame, faceGroups, d0, d1, params = null) {
  if (frame.face === "wrap" && faceGroups.length) {
    const stepMm = params?.__labelExportStandoff ? DECAL_LAYER_MM : wrapDecalStepMm(faceGroups);
    const slab = buildFaceDecalSlabMesh(frame, faceGroups, { d0, d1, stepMm, dilatePasses: 0 });
    if (slab?.indices?.length) {
      const base = outPos.length / 3;
      for (let i = 0; i < slab.positions.length; i++) outPos.push(slab.positions[i]);
      for (let i = 0; i < slab.indices.length; i++) outIdx.push(slab.indices[i] + base);
      return;
    }
    return;
  }
  for (const group of faceGroups) {
    extrudeGroupOnFace(outPos, outIdx, frame, group, d0, d1, params);
  }
}

function remappedBitmapFaceGroups(bitmap, frame, params, sourceGroups, maskW, maskH, artH) {
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  const artWidth = bitmap.width * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artWidth, artH);
  const rotCx = xOff + artWidth / 2;
  const rotCy = zOff + artH / 2;
  const rotation = params.decorRotation ?? 0;
  const faceGroups = [];
  for (const group of sourceGroups) {
    const remapped = {
      outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
      holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
    };
    faceGroups.push(rotateShapeGroup(remapped, rotCx, rotCy, rotation));
  }
  return faceGroups;
}

function ringPointsLocal(ring) {
  return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
}

/** Extrude a shape group (outer ring + holes) onto a face at offsets [d0, d1]. */
function extrudeGroupOnFace(outPos, outIdx, frame, group, d0, d1, params = null) {
  const mapTop = (px, py) => frame.mapPoint(px, py, d1);
  const mapBot = (px, py) => frame.mapPoint(px, py, d0);
  const flatCoord = (w) => flatCoordForFrame(frame, w);
  const capMode = params ? embossExportCaps(params, d0) : (d0 < 0 ? "both" : "top");
  const { caps, flatFromArt } = wrapExtrudeCaps(frame, capMode);
  extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, flatCoord, caps, flatFromArt);
}

function exportEmbossDepth(params) {
  let depth = clamp(params.embossDepth ?? 0.7, 0.3, 2);
  if (!params?.__labelExportStandoff) return depth;
  // Shallow sticker-like skin — fewer seam loops than thick plaques (esp. arc text).
  const maxMm = params.__labelExportKind === "text" ? 0.36 : 0.48;
  depth = Math.min(depth, maxMm);
  return Math.max(0.32, Math.round(depth / 0.2) * 0.2);
}

function embossExportCaps(params, d0) {
  if (params?.__labelExportStandoff) {
    const depth = exportEmbossDepth(params);
    // Flush on body — bottom mates the wall; top cap + sides only.
    if (params.__labelExportEmbedded && depth <= 0.48) return "top";
    return "both";
  }
  return d0 < 0 ? "both" : "top";
}

function labelOffsets(params) {
  const depth = exportEmbossDepth(params);
  if (params.__embossMode === "deboss-cutter") {
    // Slicer-facing cutter STL: pokes 0.4mm past the surface and sinks (depth + 0.05)mm inward
    // so the boolean subtract is clean at the outer skin.
    return { d0: -depth - 0.05, d1: 0.4, depth, deboss: true };
  }
  // Raised emboss: flush in preview; export embeds into wall pockets (no air gap).
  let standoff = 0;
  if (!params.__labelExportEmbedded) {
    standoff = params.__labelExportStandoff ? 0.2 : 0;
    if (params.__labelExportStandoff && params.vaseTextureEnabled) {
      const texDepth = clamp(params.vaseTextureDepth ?? 1.2, 0.2, 3);
      standoff = Math.max(standoff, 0.35 + texDepth * 0.15);
    }
  }
  // Preview floor — very shallow emboss z-fights the wall and reads as white seams.
  const useDepth = params.__labelExportStandoff ? depth : Math.max(depth, 0.35);
  return { d0: standoff, d1: standoff + useDepth, depth: useDepth, deboss: false };
}

/** Measure active art on a face for preview handles (null if none). */
export function measureDecorArt(meta, params) {
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const traceData = params.embossTraceRects;
  const hasTrace =
    params.embossTraceEnabled &&
    (traceData?.shapeGroups?.length ||
      traceData?.strokePaths?.length ||
      traceData?.mask?.length ||
      traceData?.rects?.length);
  const hasText = textHasInk(params.embossText);
  const hasSvg = params.embossSvgEnabled && !!params.embossSvgText?.trim();

  let textRect = null;
  if (hasText) {
    const layout = computeTextArtLayout(meta, params);
    if (layout) {
      textRect = {
        frame: layout.frame,
        kind: "text",
        rotation: layout.rotation,
        left: layout.left,
        right: layout.right,
        bottom: layout.bottom,
        top: layout.top,
        cx: layout.cx,
        cy: layout.cy,
        artW: layout.right - layout.left,
        artH: layout.top - layout.bottom,
      };
    }
  }

  let svgRect = null;
  if (hasSvg) {
    const parsed = parseSvgPaths(params.embossSvgText);
    const strokePaths = parsed.strokePaths || [];
    const fillRings = parsed.fillRings || [];
    const polylines = parsed.polylines || [...strokePaths, ...fillRings];
    if (polylines.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const line of polylines) {
        for (const [x, y] of line) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (Number.isFinite(minX)) {
        const sw = maxX - minX || parsed.viewBox?.[2] || 1;
        const sh = maxY - minY || parsed.viewBox?.[3] || 1;
        const artH = clamp(params.embossTraceSize ?? params.embossHeight ?? 16, 6, 56);
        const wrap = frame.face === "wrap";
        const maxW = wrap ? Math.min(frame.faceW * 0.55, 72) : Math.min(frame.faceW * 0.62, 56);
        const scale = Math.min(artH / sh, maxW / sw);
        if (Number.isFinite(scale) && scale > 0) {
          const artW = sw * scale;
          const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH);
          svgRect = {
            frame,
            kind: "svg",
            rotation: params.decorRotation ?? 0,
            ...decorArtRect(frame, xOff, zOff, artW, artH),
          };
        }
      }
    }
  }

  if (textRect && svgRect) {
    return {
      frame,
      kind: "combo",
      rotation: textRect.rotation,
      left: Math.min(textRect.left, svgRect.left),
      right: Math.max(textRect.right, svgRect.right),
      bottom: Math.min(textRect.bottom, svgRect.bottom),
      top: Math.max(textRect.top, svgRect.top),
      cx: (textRect.cx + svgRect.cx) / 2,
      cy: (textRect.cy + svgRect.cy) / 2,
      artW: Math.max(textRect.right, svgRect.right) - Math.min(textRect.left, svgRect.left),
      artH: Math.max(textRect.top, svgRect.top) - Math.min(textRect.bottom, svgRect.bottom),
    };
  }
  if (textRect) return textRect;
  if (svgRect) return svgRect;

  if (hasTrace && traceData?.width && traceData?.height) {
    const artH = clamp(params.embossTraceSize ?? 16, 6, 56);
    const maxW = Math.min(frame.faceW * 0.62, 56);
    const scale = Math.min(artH / traceData.height, maxW / traceData.width);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const artW = traceData.width * scale;
    const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH);
    return { frame, kind: "trace", rotation: params.decorRotation ?? 0, ...decorArtRect(frame, xOff, zOff, artW, artH) };
  }

  return null;
}

function labelEmbossParts(meta, params, svgText = "", mode = "emboss") {
  const p = { ...params, __embossMode: mode };
  const traceData = p.embossTraceRects;
  const hasTrace =
    p.embossTraceEnabled &&
    (traceData?.shapeGroups?.length ||
      traceData?.strokePaths?.length ||
      traceData?.mask?.length ||
      traceData?.rects?.length);
  const hasText = textHasInk(p.embossText);
  const hasSvg = p.embossSvgEnabled && !!svgText?.trim() && !hasTrace;

  let text = null;
  let graphic = null;
  if (hasText) text = buildEmbossText(meta, p);
  if (hasSvg) graphic = buildEmbossSvg(meta, p, svgText);
  if (hasTrace) graphic = buildEmbossBitmap(meta, p, traceData);
  return { text, graphic };
}

/** Text and graphic meshes separately (for preview colours and export). */
export function buildLabelEmbossParts(meta, params, svgText = "", mode = "emboss") {
  return labelEmbossParts(meta, params, svgText, mode);
}

/** Graphic-only label (SVG/trace) — for body export when text is a separate colour. */
export function buildLabelGraphicEmboss(meta, params, svgText = "", mode = "emboss") {
  const p = { ...params, embossText: "", __embossMode: mode };
  if (isLabelExport(p)) return buildGraphicLabelExportMesh(meta, p, svgText);
  return labelEmbossParts(meta, p, svgText, mode).graphic;
}

export function buildLabelEmboss(meta, params, svgText = "", mode = "emboss") {
  const { text, graphic } = labelEmbossParts(meta, params, svgText, mode);
  const parts = [text, graphic].filter(Boolean);
  return parts.length ? mergeMeshes(...parts) : null;
}

export function applyBodyDecorations(bodyMesh, meta, params) {
  const parts = [bodyMesh];
  if (params.honeycombEnabled) {
    const honey = buildHoneycombStamp(meta, params);
    if (honey) parts.push(honey);
  }
  if (params.stackableEnabled && (params.stackStyle || "hex") !== "nest") {
    const stack = buildStackableHex(meta, params);
    if (stack) parts.push(stack);
  }
  return mergeMeshes(...parts);
}
