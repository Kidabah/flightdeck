/**
 * Accent bands, emboss, honeycomb stamp, stackable hex grid, mesh merge.
 */

import { extrudeShapeGroup, extrudeShapeGroupBetween, groupPolygonsWithHoles, maskToPolygons, prepareShapeGroups, prepareStrokePaths, simplifyPolygon } from "./contour.js";

export const EMBOSS_FONTS = [
  { id: "inter", label: "Inter — clean sans", family: 'Inter, system-ui, "Segoe UI", sans-serif', weight: 700 },
  { id: "arial", label: "Arial — classic", family: "Arial, Helvetica, sans-serif", weight: 700 },
  { id: "impact", label: "Impact — heavy", family: 'Impact, "Arial Black", sans-serif', weight: 400 },
  { id: "georgia", label: "Georgia — serif", family: "Georgia, 'Times New Roman', serif", weight: 700 },
  { id: "courier", label: "Courier — mono", family: '"Courier New", Courier, monospace', weight: 700 },
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
    if (!part?.positions?.length) continue;
    const offset = positions.length / 3;
    const partPos = part.positions;
    for (let i = 0; i < partPos.length; i++) positions.push(partPos[i]);
    for (const idx of part.indices) indices.push(idx + offset);
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

export function buildAccentMesh(meta, params) {
  const bandH = clamp(params.accentHeight ?? 4, 2, 12);
  const face = params.accentFace || "rim";
  const b = rectFeatureBounds(meta);
  const z1 = b.totalH;
  const z0 = z1 - bandH;
  const positions = [];
  const indices = [];

  if (face === "rim") {
    wallBand(positions, indices, "y", b.od2, -b.ow2, b.ow2, z0, z1);
    wallBand(positions, indices, "y", -b.od2, -b.ow2, b.ow2, z0, z1);
    wallBand(positions, indices, "x", b.ow2, -b.od2, b.od2, z0, z1);
    wallBand(positions, indices, "x", -b.ow2, -b.od2, b.od2, z0, z1);
  } else if (face === "front") {
    const inset = clamp(params.accentInset ?? 4, 2, Math.min(b.outerW, b.outerD) / 3);
    wallBand(positions, indices, "y", b.od2, -b.ow2 + inset, b.ow2 - inset, z0, z1);
  } else if (face === "floor") {
    const zf0 = 0;
    const zf1 = bandH;
    pushQuad(positions, indices,
      vec3(-b.ow2, -b.od2, zf0), vec3(b.ow2, -b.od2, zf0),
      vec3(b.ow2, b.od2, zf0), vec3(-b.ow2, b.od2, zf0));
    pushQuad(positions, indices,
      vec3(-b.ow2, -b.od2, zf1), vec3(-b.ow2, b.od2, zf1),
      vec3(b.ow2, b.od2, zf1), vec3(b.ow2, -b.od2, zf1));
    wallBand(positions, indices, "y", b.od2, -b.ow2, b.ow2, zf0, zf1);
    wallBand(positions, indices, "y", -b.od2, -b.ow2, b.ow2, zf0, zf1);
    wallBand(positions, indices, "x", b.ow2, -b.od2, b.od2, zf0, zf1);
    wallBand(positions, indices, "x", -b.ow2, -b.od2, b.od2, zf0, zf1);
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

function extrudeWallsAlongZ(outPos, outIdx, pts, z0, z1) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(outPos, outIdx,
      vec3(pts[i][0], pts[i][1], z0), vec3(pts[j][0], pts[j][1], z0),
      vec3(pts[j][0], pts[j][1], z1), vec3(pts[i][0], pts[i][1], z1));
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

/** Rasterise label text to merged rects (browser canvas). */
function rasterTextRects(text, fontId, fontSizePx = 96) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = embossFontStack(fontId, fontSizePx);
  ctx.font = font;
  const pad = Math.ceil(fontSizePx * 0.18);
  const width = Math.ceil(ctx.measureText(text).width + pad * 2);
  const height = Math.ceil(fontSizePx * 1.12);
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, pad, fontSizePx * 0.9);
  const data = ctx.getImageData(0, 0, width, height).data;
  const runs = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && data[(y * width + x) * 4 + 3] > 64;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push({ x: start, y, w: x - start, h: 1 });
        start = -1;
      }
    }
  }
  runs.sort((a, b) => a.x - b.x || a.y - b.y);
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.x === r.x && prev.w === r.w && prev.y + prev.h === r.y) {
      prev.h += 1;
    } else {
      merged.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
  }
  return { rects: merged, width, height };
}

/** Embossed sans-serif label on chosen face — real letter shapes from canvas raster. */
export function buildEmbossText(meta, params) {
  const text = String(params.embossText || "").trim();
  if (!text) return null;
  const labelH = clamp(params.embossHeight ?? 7, 3, 18);
  const raster = rasterTextRects(text, params.embossFont || "inter");
  if (!raster?.rects.length) return null;

  const frame = getEmbossFaceFrame(meta, params.embossFace || "front");
  const { d0, d1 } = labelOffsets(params);
  const scale = labelH / raster.height;
  const artW = raster.width * scale;
  const xOff = -artW / 2;
  const zOff = frame.centerZ - labelH;
  const positions = [];
  const indices = [];

  for (const r of raster.rects) {
    const ax = xOff + r.x * scale;
    const bx = xOff + (r.x + r.w) * scale;
    const z1 = zOff + (raster.height - r.y) * scale;
    const z0 = z1 - r.h * scale;
    boxOnFace(positions, indices, frame, ax, bx, z0, z1, d0, d1);
  }

  return { positions, indices };
}

/** Solid silhouette / traced bitmap emboss on chosen face. */
export function buildEmbossBitmap(meta, params, bitmap) {
  if (!bitmap?.width || !bitmap.height) return null;
  const artH = clamp(params.embossTraceSize ?? 16, 6, 40);
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front");
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artWidth = bitmap.width * scale;
  const xOff = -artWidth / 2;
  const zOff = frame.centerZ - artH;
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const maskW = Math.round(bitmap.width);
  const maskH = Math.round(bitmap.height);
  if (maskW <= 0 || maskH <= 0) return null;

  const isOutline = bitmap.mode === "outline";

  if (isOutline && bitmap.strokePaths?.length) {
    const smoothPasses = artH <= 12 ? 5 : artH <= 20 ? 4 : 3;
    const simplifyTol = Math.max(0.22, maskW / 520);
    const paths = prepareStrokePaths(bitmap.strokePaths, simplifyTol, smoothPasses);
    const strokePx = bitmap.strokeWidth ?? Math.max(1.35, maskW / 88);
    const lineWidth = clamp(scale * strokePx, 0.45, 1.5);
    const mapPt = (px, py) => [xOff + px * scale, zOff + (maskH - py) * scale];
    extrudeStrokePathList(positions, indices, frame, paths, mapPt, lineWidth, d0, d1);
    if (positions.length) return { positions, indices };
    // Fall through to silhouette rebuild if stroke data was empty/corrupt.
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

  // High-res traces already carry smoothed shapeGroups — only rebuild from mask when missing.
  const hiRes = maskW >= 1800;
  const smoothPasses = bitmap.shapeGroups?.length
    ? 0
    : hiRes ? 5 : artH <= 12 ? 4 : artH <= 20 ? 3 : 2;
  const simplifyTol = hiRes ? Math.max(0.1, maskW / 1400) : Math.max(0.28, maskW / 480);
  const shapeGroups = bitmap.shapeGroups?.length
    ? bitmap.shapeGroups
    : prepareShapeGroups(
        groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
        simplifyTol,
        smoothPasses,
      );

  for (const group of shapeGroups) {
    const remapped = {
      outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
      holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
    };
    extrudeGroupOnFace(positions, indices, frame, remapped, d0, d1);
  }

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

function sampleSvgPathElement(pathEl, maxPoints = 900) {
  const len = pathEl.getTotalLength();
  if (!Number.isFinite(len) || len < 0.02) return [];
  const count = Math.min(maxPoints, Math.max(24, Math.ceil(len / 0.28)));
  const step = len / count;
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const pt = pathEl.getPointAtLength(Math.min(i * step, len));
    pts.push([pt.x, pt.y]);
  }
  return dedupePolylinePoints(pts);
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

/** Sample SVG geometry into polylines (handles curves via native path length). */
export function parseSvgPaths(svgText) {
  if (typeof DOMParser === "undefined" || typeof document === "undefined") return [];
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() === "parsererror") return [];

  const viewBox = parseSvgViewBox(svg);
  const scratch = document.createElementNS(SVG_NS, "svg");
  scratch.setAttribute("xmlns", SVG_NS);
  scratch.setAttribute("viewBox", svg.getAttribute("viewBox") || `${viewBox[0]} ${viewBox[1]} ${viewBox[2]} ${viewBox[3]}`);
  scratch.setAttribute("width", String(viewBox[2]));
  scratch.setAttribute("height", String(viewBox[3]));
  scratch.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden";
  document.body.appendChild(scratch);

  const polylines = [];
  let strokeWidth = readSvgStrokeWidth(null, svg);

  try {
    for (const pathEl of doc.querySelectorAll("path")) {
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(pathEl, svg));
      const d = pathEl.getAttribute("d");
      if (!d) continue;
      for (const sub of splitPathSubpaths(d)) {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", sub);
        scratch.appendChild(p);
        const sampled = sampleSvgPathElement(p);
        scratch.removeChild(p);
        if (sampled.length >= 2) polylines.push(sampled);
      }
    }
    for (const el of doc.querySelectorAll("polyline, polygon, line, rect, circle, ellipse")) {
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(el, svg));
      const pts = polylineFromElement(el);
      if (pts.length >= 2) polylines.push(pts);
    }
  } finally {
    scratch.remove();
  }

  return { polylines, viewBox, strokeWidth };
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

export function buildEmbossSvg(meta, params, svgText) {
  const parsed = parseSvgPaths(svgText);
  const polylines = parsed.polylines || (Array.isArray(parsed) ? parsed : []);
  if (!polylines.length) return null;

  const frame = getEmbossFaceFrame(meta, params.embossFace || "front");
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
  const artH = clamp(params.embossTraceSize ?? params.embossHeight ?? 16, 6, 40);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / sh, maxW / sw);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const cx = (minX + maxX) / 2;
  const zOff = frame.centerZ - artH;
  const svgStroke = parsed.strokeWidth ?? 1.5;
  const lineWidth = clamp(scale * svgStroke, 0.45, 1.5);
  const smoothPasses = artH <= 12 ? 4 : artH <= 20 ? 3 : 2;
  const simplifyTol = Math.max(0.18, Math.max(sw, sh) / 520);
  const closedPaths = polylines.map((line) => {
    if (line.length >= 3) {
      const [x0, y0] = line[0];
      const [x1, y1] = line[line.length - 1];
      if (Math.hypot(x0 - x1, y0 - y1) < Math.max(0.35, Math.max(sw, sh) * 0.004)) {
        return [...line, line[0]];
      }
    }
    return line;
  });
  const strokePaths = prepareStrokePaths(closedPaths, simplifyTol, smoothPasses);
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const mapPt = (x, y) => [(x - cx) * scale, zOff + (maxY - y) * scale];

  extrudeStrokePathList(positions, indices, frame, strokePaths, mapPt, lineWidth, d0, d1);
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
  return shape === "rect" || shape === "rounded" || shape === "pencil";
}

/** Face frame for placing emboss on any of the four side walls.
 * Returns an object with faceW / faceH (usable dimensions in mm) and a
 * mapPoint(px, py, offset) helper that projects a 2D art-space point (px, py)
 * onto the target face at a distance `offset` from the outer surface
 * (positive = outward, negative = inward for deboss).
 */
export function getEmbossFaceFrame(meta, face) {
  const b = rectFeatureBounds(meta);
  const useFace = ["front", "back", "left", "right"].includes(face) ? face : "front";
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

function ringPointsLocal(ring) {
  return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
}

/** Extrude a shape group (outer ring + holes) onto a face at offsets [d0, d1]. */
function extrudeGroupOnFace(outPos, outIdx, frame, group, d0, d1) {
  const mapTop = (px, py) => frame.mapPoint(px, py, d1);
  const mapBot = (px, py) => frame.mapPoint(px, py, d0);
  const flatCoord = frame.face === "left" || frame.face === "right"
    ? (w) => [w[1], w[2]]
    : (w) => [w[0], w[2]];
  extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, flatCoord);
}

function labelOffsets(params) {
  const depth = clamp(params.embossDepth ?? 0.7, 0.3, 2);
  if (params.__embossMode === "deboss-cutter") {
    // Slicer-facing cutter STL: pokes 0.4mm past the surface and sinks (depth + 0.05)mm inward
    // so the boolean subtract is clean at the outer skin.
    return { d0: -depth - 0.05, d1: 0.4, depth, deboss: true };
  }
  // Preview + regular emboss: extrude outward with a tiny bias to avoid z-fighting on shell.
  return { d0: 0.08, d1: 0.08 + depth, depth, deboss: false };
}

export function buildLabelEmboss(meta, params, svgText = "", mode = "emboss") {
  const p = { ...params, __embossMode: mode };
  const hasTrace =
    p.embossTraceEnabled &&
    (p.embossTraceRects?.mask?.length || p.embossTraceRects?.rects?.length);
  const hasText = !!p.embossText?.trim();

  // Label text wins over stale trace/SVG geometry on the box.
  if (hasText && !p.embossSvgEnabled) {
    return buildEmbossText(meta, p);
  }
  if (hasTrace) {
    return buildEmbossBitmap(meta, p, p.embossTraceRects);
  }
  if (p.embossSvgEnabled && svgText?.trim()) {
    return buildEmbossSvg(meta, p, svgText);
  }
  return null;
}

export function applyBodyDecorations(bodyMesh, meta, params) {
  const parts = [bodyMesh];
  if (params.honeycombEnabled) {
    const honey = buildHoneycombStamp(meta, params);
    if (honey) parts.push(honey);
  }
  if (params.stackableEnabled) {
    const stack = buildStackableHex(meta, params);
    if (stack) parts.push(stack);
  }
  return mergeMeshes(...parts);
}
