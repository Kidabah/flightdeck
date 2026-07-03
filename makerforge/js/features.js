/**
 * Accent bands, emboss, honeycomb stamp, stackable hex grid, mesh merge.
 */

import { extrudeShapeGroup, groupPolygonsWithHoles, maskToPolygons, prepareShapeGroups, simplifyPolygon } from "./contour.js";

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

/** Embossed sans-serif label on front face — real letter shapes from canvas raster. */
export function buildEmbossText(meta, params) {
  const text = String(params.embossText || "").trim();
  if (!text) return null;
  const b = rectFeatureBounds(meta);
  const depth = clamp(params.embossDepth ?? 0.7, 0.3, 2);
  const labelH = clamp(params.embossHeight ?? 7, 3, 18);
  const raster = rasterTextRects(text, params.embossFont || "inter");
  if (!raster?.rects.length) return null;

  const scale = labelH / raster.height;
  const xOff = -(raster.width * scale) / 2;
  const zOff = b.totalH * 0.72 - labelH;
  const y0 = b.od2 + 0.08;
  const y1 = y0 + depth;
  const positions = [];
  const indices = [];

  for (const r of raster.rects) {
    const ax = xOff + r.x * scale;
    const bx = xOff + (r.x + r.w) * scale;
    const z1 = zOff + (raster.height - r.y) * scale;
    const z0 = z1 - r.h * scale;
    // Mirror X so label reads correctly on exported STL (viewed from +Y outside).
    appendBox(positions, indices, -bx, y0, z0, -ax, y1, z1);
  }

  return { positions, indices };
}

/** Solid silhouette / traced bitmap emboss on front face (+Y). */
export function buildEmbossBitmap(meta, params, bitmap) {
  if (!bitmap?.width || !bitmap.height) return null;
  const b = rectFeatureBounds(meta);
  const depth = clamp(params.embossDepth ?? 0.7, 0.3, 2);
  const artH = clamp(params.embossTraceSize ?? 16, 6, 40);
  const maxW = Math.min(b.outerW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const xOff = -(bitmap.width * scale) / 2;
  const zOff = b.totalH * 0.72 - bitmap.height * scale;
  const y0 = b.od2 + 0.08;
  const y1 = y0 + depth;
  const positions = [];
  const indices = [];
  const maskW = Math.round(bitmap.width);
  const maskH = Math.round(bitmap.height);
  if (maskW <= 0 || maskH <= 0) return null;

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

  const mapPoint = (px, py) => [
    -(xOff + px * scale),
    y1,
    zOff + (maskH - py) * scale,
  ];

  const simplifyTol = Math.max(0.65, maskW / 200);
  const shapeGroups = bitmap.shapeGroups?.length
    ? prepareShapeGroups(bitmap.shapeGroups, simplifyTol)
    : prepareShapeGroups(
        groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
        simplifyTol,
      );

  for (const group of shapeGroups) {
    extrudeShapeGroup(positions, indices, group, y0, y1, mapPoint);
  }

  return positions.length ? { positions, indices } : null;
}

export function parseSvgPaths(svgText) {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const paths = [...doc.querySelectorAll("path")];
  const polylines = [];
  for (const path of paths) {
    const d = path.getAttribute("d");
    if (!d) continue;
    const pts = [];
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    let i = 0;
    let cmd = "";
    let cx = 0;
    let cy = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (/^[a-zA-Z]$/.test(t)) {
        cmd = t;
        i++;
        continue;
      }
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      if (cmd === "M" || cmd === "L") {
        cx = x;
        cy = y;
        pts.push([cx, cy]);
      } else if (cmd === "m" || cmd === "l") {
        cx += x;
        cy += y;
        pts.push([cx, cy]);
      } else if (cmd === "H") {
        cx = x;
        pts.push([cx, cy]);
      } else if (cmd === "h") {
        cx += x;
        pts.push([cx, cy]);
      } else if (cmd === "V") {
        cy = x;
        pts.push([cx, cy]);
      } else if (cmd === "v") {
        cy += x;
        pts.push([cx, cy]);
      } else if (cmd === "Z" || cmd === "z") {
        if (pts.length) pts.push([pts[0][0], pts[0][1]]);
      }
    }
    if (pts.length > 2) polylines.push(pts);
  }
  return polylines;
}

export function buildEmbossSvg(meta, params, svgText) {
  const polylines = parseSvgPaths(svgText);
  if (!polylines.length) return null;
  const b = rectFeatureBounds(meta);
  const depth = clamp(params.embossDepth ?? 0.7, 0.3, 2);
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
  const sw = maxX - minX || 1;
  const sh = maxY - minY || 1;
  const targetW = Math.min(b.outerW * 0.55, 50);
  const targetH = Math.min(b.totalH * 0.22, 16);
  const s = Math.min(targetW / sw, targetH / sh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const positions = [];
  const indices = [];
  const y0 = b.od2 + 0.08;
  const y1 = y0 + depth;
  const zMid = b.totalH * 0.72;

  for (const line of polylines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, yv0] = line[i];
      const [x1, yv1] = line[i + 1];
      const ax = (x0 - cx) * s;
      const az = zMid + (cy - yv0) * s;
      const bx = (x1 - cx) * s;
      const bz = zMid + (cy - yv1) * s;
      const thick = 0.45;
      appendBox(positions, indices, -bx - thick, y0, az - thick, -ax + thick, y1, bz + thick);
    }
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
  return shape === "rect" || shape === "rounded" || shape === "pencil";
}

export function buildLabelEmboss(meta, params, svgText = "") {
  if (params.embossTraceEnabled && (params.embossTraceRects?.mask?.length || params.embossTraceRects?.rects?.length)) {
    return buildEmbossBitmap(meta, params, params.embossTraceRects);
  }
  if (params.embossText?.trim() && !params.embossSvgEnabled) {
    return buildEmbossText(meta, params);
  }
  if (params.embossSvgEnabled && svgText?.trim()) {
    return buildEmbossSvg(meta, params, svgText);
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
