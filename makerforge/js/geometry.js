/**
 * Parametric hollow container mesh builder.
 * Returns { positions, indices } in mm, Z-up, centered on XY, base at z=0.
 */

import {
  applyBodyDecorations,
  buildLabelEmboss,
  buildAccentMesh,
  mergeMeshes,
  resolveJoinerDims,
  shapeSupportsDecor,
} from "./features.js";
import earcut from "https://esm.sh/earcut@2.2.4";
import { buildVase, buildVaseSaucer, vaseMeta, VASE_DEFAULTS, VASE_STYLES } from "./vase.js";
import {
  appendSlideChannelsToBody,
  buildSlideLidMesh,
  computeSlideFitGuides,
  shapeSupportsSlideLid,
} from "./slide-lid.js";

export { shapeSupportsDecor, VASE_STYLES, shapeSupportsSlideLid };

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function pushTri(outPos, outIdx, a, b, c) {
  const base = outPos.length / 3;
  outPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  outIdx.push(base, base + 1, base + 2);
}

function pushTriIdx(outIdx, a, b, c) {
  outIdx.push(a, b, c);
}

function pushQuad(outPos, outIdx, a, b, c, d) {
  pushTri(outPos, outIdx, a, b, c);
  pushTri(outPos, outIdx, a, c, d);
}

function vec3(x, y, z) {
  return [x, y, z];
}

function centerPositions(positions, cx, cy) {
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
  }
}

function norm2(x, y) {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

function flatToCircumradius(flat, sides) {
  return flat / (2 * Math.cos(Math.PI / sides));
}

function circumradiusToFlat(radius, sides) {
  return 2 * radius * Math.cos(Math.PI / sides);
}

/** Regular polygon, CCW, flat on top/bottom. */
function regularPolygonVertices(sides, circumRadius, phase = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = ((Math.PI * 2) / sides) * i + phase + Math.PI / sides;
    pts.push([circumRadius * Math.cos(a), circumRadius * Math.sin(a)]);
  }
  return pts;
}

function circleVertices(radius, segments = 48) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = ((Math.PI * 2) / segments) * i;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

/** Round polygon vertices with circular fillets. */
function filletedOutline(vertices, filletR, arcSegments = 6) {
  const r = filletR;
  if (r < 0.2 || vertices.length < 3) return vertices.map((p) => [p[0], p[1]]);

  const n = vertices.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i + n - 1) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    const inDir = norm2(prev[0] - curr[0], prev[1] - curr[1]);
    const outDir = norm2(next[0] - curr[0], next[1] - curr[1]);
    const dot = clamp(inDir[0] * outDir[0] + inDir[1] * outDir[1], -1, 1);
    const theta = Math.acos(dot);
    if (theta < 0.08 || theta > Math.PI - 0.08) {
      out.push([curr[0], curr[1]]);
      continue;
    }
    const trim = Math.min(r / Math.tan(theta / 2), Math.hypot(prev[0] - curr[0], prev[1] - curr[1]) * 0.42, Math.hypot(next[0] - curr[0], next[1] - curr[1]) * 0.42);
    const p1 = [curr[0] + inDir[0] * trim, curr[1] + inDir[1] * trim];
    const p2 = [curr[0] + outDir[0] * trim, curr[1] + outDir[1] * trim];
    const bis = norm2(inDir[0] + outDir[0], inDir[1] + outDir[1]);
    const distCenter = r / Math.sin(theta / 2);
    const center = [curr[0] + bis[0] * distCenter, curr[1] + bis[1] * distCenter];
    const a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    const a2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
    out.push(p1);
    let sweep = a2 - a1;
    while (sweep <= 0) sweep += Math.PI * 2;
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
    const steps = Math.max(2, arcSegments);
    for (let s = 1; s < steps; s++) {
      const a = a1 + sweep * (s / steps);
      out.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
    }
    out.push(p2);
  }
  return out;
}

/** 2D rounded-rect outline, counter-clockwise, centered at origin. */
function roundedRectOutline(halfW, halfD, radius, segments = 8) {
  const r = clamp(radius, 0, Math.min(halfW, halfD) - 0.01);
  const pts = [];
  const corners = [
    [halfW - r, halfD - r, 0, Math.PI / 2],
    [-(halfW - r), halfD - r, Math.PI / 2, Math.PI],
    [-(halfW - r), -(halfD - r), Math.PI, (3 * Math.PI) / 2],
    [halfW - r, -(halfD - r), (3 * Math.PI) / 2, 2 * Math.PI],
  ];
  for (const [cx, cy, a0, a1] of corners) {
    const steps = r > 0 ? segments : 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = a0 + (a1 - a0) * t;
      if (r > 0) pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      else if (i === 0) pts.push([cx, cy]);
    }
  }
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) pts.pop();
  }
  return pts;
}

/** Teardrop footprint: round bulb + point (tip toward +X). */
function teardropOutline(length, width, arcSegments = 28) {
  const r = width / 2;
  const tipX = length / 2;
  const cx = -tipX + r;
  if (length <= width + 2) {
    return circleVertices(r, arcSegments);
  }
  const distCT = tipX - cx;
  const phi = Math.acos(clamp(r / distCT, 0, 1));
  const aLo = -phi;
  const aHi = phi;
  let sweep = aHi - aLo;
  if (sweep > 0) sweep -= Math.PI * 2;

  const pts = [];
  const steps = Math.max(14, arcSegments);
  for (let i = 0; i <= steps; i++) {
    const a = aLo + sweep * (i / steps);
    pts.push([cx + r * Math.cos(a), r * Math.sin(a)]);
  }
  pts.push([tipX, 0]);
  return pts;
}

function starOutline(tipRadius, innerRatio = 0.42, points = 5) {
  const innerR = tipRadius * clamp(innerRatio, 0.2, 0.8);
  const pts = [];
  const step = Math.PI / points;
  const phase = -Math.PI / 2;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? tipRadius : innerR;
    const a = phase + step * i;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function heartOutline(width, height, segments = 52) {
  const raw = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push([x, y]);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const pts = raw.map(([x, y]) => [((x - cx) / spanX) * width, ((y - cy) / spanY) * height]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  if (area < 0) pts.reverse();
  return pts;
}

function extrudeProfileSides(outPos, outIdx, points, z0, z1, outward = true) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = vec3(points[i][0], points[i][1], z0);
    const b = vec3(points[j][0], points[j][1], z0);
    const c = vec3(points[j][0], points[j][1], z1);
    const d = vec3(points[i][0], points[i][1], z1);
    if (outward) pushQuad(outPos, outIdx, a, b, c, d);
    else pushQuad(outPos, outIdx, a, d, c, b);
  }
}

function capRing(outPos, outIdx, outer, inner, z, normalUp) {
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

function capSolid(outPos, outIdx, points, z, normalUp) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = vec3(points[i][0], points[i][1], z);
    const b = vec3(points[j][0], points[j][1], z);
    const c = vec3(0, 0, z);
    if (normalUp) pushTri(outPos, outIdx, a, b, c);
    else pushTri(outPos, outIdx, a, c, b);
  }
}

/** Earcut cap — avoids center-fan triangulation edges that show through transparent preview. */
function cleanCapRing(points) {
  let ring = points;
  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    ring = ring.slice(0, -1);
  }
  const out = [];
  for (const p of ring) {
    if (!out.length) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-6) out.push(p);
  }
  return out.length >= 3 ? out : ring;
}

function capProfileSolid(outPos, outIdx, points, z, normalUp) {
  const ring = cleanCapRing(points);
  if (ring.length < 3) return;
  const base = outPos.length / 3;
  for (const [x, y] of ring) {
    const w = vec3(x, y, z);
    outPos.push(w[0], w[1], w[2]);
  }
  let tri = earcut(ring.flat());
  if (!tri.length) {
    for (let i = 1; i < ring.length - 1; i++) {
      if (normalUp) pushTriIdx(outIdx, base, base + i, base + i + 1);
      else pushTriIdx(outIdx, base, base + i + 1, base + i);
    }
    return;
  }
  for (let i = 0; i < tri.length; i += 3) {
    const a = base + tri[i];
    const b = base + tri[i + 1];
    const c = base + tri[i + 2];
    if (normalUp) pushTriIdx(outIdx, a, b, c);
    else pushTriIdx(outIdx, a, c, b);
  }
}

const FLOOR_SLAB = 0.08;

function capFloorSlab(outPos, outIdx, profile, zTop, upward) {
  const zBot = upward ? zTop - FLOOR_SLAB : zTop;
  const zCap = upward ? zTop : zTop + FLOOR_SLAB;
  capProfileSolid(outPos, outIdx, profile, zCap, upward);
  capProfileSolid(outPos, outIdx, profile, zBot, !upward);
  extrudeProfileSides(outPos, outIdx, profile, zBot, zCap, upward);
}

function buildProfileShell(outPos, outIdx, outer, inner, floor, totalH, cavityH) {
  const zFloor = floor;
  const zTop = totalH;
  const zCavityTop = floor + cavityH;

  capFloorSlab(outPos, outIdx, outer, 0, false);
  capFloorSlab(outPos, outIdx, inner, zFloor, true);
  capRing(outPos, outIdx, outer, inner, zFloor, true);
  extrudeProfileSides(outPos, outIdx, outer, 0, zTop, true);
  extrudeProfileSides(outPos, outIdx, inner, zFloor, zCavityTop, false);
  capRing(outPos, outIdx, outer, inner, zTop, true);
}

function shellFromProfiles(outer, inner, floor, totalH, cavityH) {
  const positions = [];
  const indices = [];
  buildProfileShell(positions, indices, outer, inner, floor, totalH, cavityH);
  return { positions, indices };
}

/** Dovetail joiner on a long flat wall — Left = male (+), Right = female (−) along the long axis. */
function resolveJoinerFace(outerW, outerD, hand) {
  const longAxis = outerW >= outerD ? "y" : "x";
  const sign = hand === "left" ? 1 : -1;
  if (longAxis === "y") {
    return {
      longAxis,
      sign,
      wallCoord: sign > 0 ? outerD / 2 : -outerD / 2,
      tangent: "x",
      outward: "y",
      span: outerW,
    };
  }
  return {
    longAxis,
    sign,
    wallCoord: sign > 0 ? outerW / 2 : -outerW / 2,
    tangent: "y",
    outward: "x",
    span: outerD,
  };
}

function pt3(axis, wallCoord, tangentCoord, z) {
  if (axis === "y") return vec3(tangentCoord, wallCoord, z);
  return vec3(wallCoord, tangentCoord, z);
}

function appendMaleDovetail(outPos, outIdx, face, spec) {
  const { wallCoord, tangent, outward, sign } = face;
  const { centerT, z0, z1, baseW, neckW, depth } = spec;
  const tipCoord = wallCoord + sign * depth;
  const b0 = centerT - baseW / 2;
  const b1 = centerT + baseW / 2;
  const n0 = centerT - neckW / 2;
  const n1 = centerT + neckW / 2;

  const w00 = pt3(outward, wallCoord, b0, z0);
  const w10 = pt3(outward, wallCoord, b1, z0);
  const w01 = pt3(outward, wallCoord, b0, z1);
  const w11 = pt3(outward, wallCoord, b1, z1);
  const t00 = pt3(outward, tipCoord, n0, z0);
  const t10 = pt3(outward, tipCoord, n1, z0);
  const t01 = pt3(outward, tipCoord, n0, z1);
  const t11 = pt3(outward, tipCoord, n1, z1);

  pushQuad(outPos, outIdx, w00, w10, t10, t00);
  pushQuad(outPos, outIdx, w01, t01, t11, w11);
  pushQuad(outPos, outIdx, w00, t00, t01, w01);
  pushQuad(outPos, outIdx, w10, w11, t11, t10);
  pushQuad(outPos, outIdx, w00, w01, w11, w10);
  pushQuad(outPos, outIdx, t00, t10, t11, t01);
}

function appendFemaleDovetailPocket(outPos, outIdx, face, spec) {
  const { wallCoord, outward, sign } = face;
  const { centerT, z0, z1, baseW, neckW, depth, clearance } = spec;
  const openW = neckW + clearance;
  const deepW = baseW + clearance;
  const outerCoord = wallCoord;
  const deepCoord = wallCoord - sign * depth;

  const o0 = centerT - openW / 2;
  const o1 = centerT + openW / 2;
  const d0 = centerT - deepW / 2;
  const d1 = centerT + deepW / 2;

  const p = (coord, t, z) => pt3(outward, coord, t, z);

  const o00 = p(outerCoord, o0, z0);
  const o10 = p(outerCoord, o1, z0);
  const o01 = p(outerCoord, o0, z1);
  const o11 = p(outerCoord, o1, z1);
  const d00 = p(deepCoord, d0, z0);
  const d10 = p(deepCoord, d1, z0);
  const d01 = p(deepCoord, d0, z1);
  const d11 = p(deepCoord, d1, z1);

  pushQuad(outPos, outIdx, o00, o10, d10, d00);
  pushQuad(outPos, outIdx, o01, d01, d11, o11);
  pushQuad(outPos, outIdx, o00, d00, d01, o01);
  pushQuad(outPos, outIdx, o10, o11, d11, d10);
  pushQuad(outPos, outIdx, d00, d10, d11, d01);
}

function extrudeRectWall(outPos, outIdx, face, t0, t1, z0, z1, outward) {
  const { wallCoord, tangent, outward: axis } = face;
  const a0 = pt3(axis, wallCoord, t0, z0);
  const a1 = pt3(axis, wallCoord, t1, z0);
  const a2 = pt3(axis, wallCoord, t1, z1);
  const a3 = pt3(axis, wallCoord, t0, z1);
  if (outward) pushQuad(outPos, outIdx, a0, a1, a2, a3);
  else pushQuad(outPos, outIdx, a0, a3, a2, a1);
}

function buildRectShellWithJoiner(outerW, outerD, innerW, innerD, floor, totalH, cavityH, joiner) {
  const positions = [];
  const indices = [];
  const ow2 = outerW / 2;
  const od2 = outerD / 2;
  const iw2 = innerW / 2;
  const id2 = innerD / 2;
  const zCavityTop = floor + cavityH;

  capFloorSlab(positions, indices, [
    [-ow2, -od2], [ow2, -od2], [ow2, od2], [-ow2, od2],
  ], 0, false);
  capFloorSlab(positions, indices, [
    [-iw2, -id2], [iw2, -id2], [iw2, id2], [-iw2, id2],
  ], floor, true);
  capRing(positions, indices,
    [[-ow2, -od2], [ow2, -od2], [ow2, od2], [-ow2, od2]],
    [[-iw2, -id2], [iw2, -id2], [iw2, id2], [-iw2, id2]],
    floor, true);
  capRing(positions, indices,
    [[-ow2, -od2], [ow2, -od2], [ow2, od2], [-ow2, od2]],
    [[-iw2, -id2], [iw2, -id2], [iw2, id2], [-iw2, id2]],
    totalH, true);

  const face = resolveJoinerFace(outerW, outerD, joiner.hand);
  const baseW = joiner.width;
  const neckW = joiner.neck;
  const marginZ = 4;
  const z0 = floor + marginZ;
  const z1 = totalH - 2;
  const slotT0 = -baseW / 2 - 0.5;
  const slotT1 = baseW / 2 + 0.5;
  const span = face.span;

  const wallFaces = [
    { outward: "y", sign: 1, wallCoord: od2, t0: -ow2, t1: ow2 },
    { outward: "y", sign: -1, wallCoord: -od2, t0: -ow2, t1: ow2 },
    { outward: "x", sign: 1, wallCoord: ow2, t0: -od2, t1: od2 },
    { outward: "x", sign: -1, wallCoord: -ow2, t0: -od2, t1: od2 },
  ];

  for (const wf of wallFaces) {
    const isJoinerWall = wf.outward === face.outward && wf.sign === face.sign;
    const f = { ...face, wallCoord: wf.wallCoord, tangent: wf.outward === "y" ? "x" : "y", outward: wf.outward, sign: wf.sign, span };

    if (!isJoinerWall) {
      extrudeRectWall(positions, indices, f, wf.t0, wf.t1, 0, totalH, true);
      const innerWall = wf.outward === "y" ? id2 : iw2;
      const innerCoord = wf.sign > 0 ? innerWall : -innerWall;
      const innerFace = { ...f, wallCoord: innerCoord };
      const it0 = wf.outward === "y" ? -iw2 : -id2;
      const it1 = wf.outward === "y" ? iw2 : id2;
      extrudeRectWall(positions, indices, innerFace, it0, it1, floor, zCavityTop, false);
      continue;
    }

    if (joiner.hand === "left") {
      extrudeRectWall(positions, indices, f, wf.t0, wf.t1, 0, totalH, true);
      const innerWall = wf.outward === "y" ? id2 : iw2;
      const innerCoord = wf.sign > 0 ? innerWall : -innerWall;
      const innerFace = { ...f, wallCoord: innerCoord };
      const it0 = wf.outward === "y" ? -iw2 : -id2;
      const it1 = wf.outward === "y" ? iw2 : id2;
      extrudeRectWall(positions, indices, innerFace, it0, it1, floor, zCavityTop, false);
      appendMaleDovetail(positions, indices, f, {
        centerT: 0,
        z0,
        z1,
        baseW,
        neckW,
        depth: joiner.protrusion,
      });
    } else {
      if (wf.t0 < slotT0) extrudeRectWall(positions, indices, f, wf.t0, slotT0, 0, totalH, true);
      if (wf.t1 > slotT1) extrudeRectWall(positions, indices, f, slotT1, wf.t1, 0, totalH, true);
      extrudeRectWall(positions, indices, f, slotT0, slotT1, 0, z0, true);
      extrudeRectWall(positions, indices, f, slotT0, slotT1, z1, totalH, true);

      const innerWall = wf.outward === "y" ? id2 : iw2;
      const innerCoord = wf.sign > 0 ? innerWall : -innerWall;
      const innerFace = { ...f, wallCoord: innerCoord };
      const it0 = wf.outward === "y" ? -iw2 : -id2;
      const it1 = wf.outward === "y" ? iw2 : id2;
      if (it0 < slotT0) extrudeRectWall(positions, indices, innerFace, it0, slotT0, floor, zCavityTop, false);
      if (it1 > slotT1) extrudeRectWall(positions, indices, innerFace, slotT1, it1, floor, zCavityTop, false);

      appendFemaleDovetailPocket(positions, indices, f, {
        centerT: 0,
        z0,
        z1,
        baseW,
        neckW,
        depth: joiner.wall + joiner.protrusion,
        clearance: joiner.clearance,
      });
    }
  }

  return { positions, indices };
}

export function shapeSupportsJoiner(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencil" || shape === "pencilBox";
}

function offsetProfileOutward(points, offset) {
  if (offset <= 0) return points.map((p) => [p[0], p[1]]);
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

function offsetProfileInward(points, offset) {
  if (offset <= 0) return points.map((p) => [p[0], p[1]]);
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
    return [x - (dx / len) * offset, y - (dy / len) * offset];
  });
}

function buildSlipLidShell(outPos, outIdx, boxOuter, skirtDepth, lidThickness, clearance, lidWall) {
  const inner = offsetProfileOutward(boxOuter, clearance);
  const outer = offsetProfileOutward(boxOuter, clearance + lidWall);
  const zTop = skirtDepth + lidThickness;

  capRing(outPos, outIdx, outer, inner, 0, false);
  extrudeProfileSides(outPos, outIdx, outer, 0, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, inner, 0, skirtDepth, false);
  capRing(outPos, outIdx, outer, inner, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, outer, skirtDepth, zTop, true);
  extrudeProfileSides(outPos, outIdx, inner, skirtDepth, zTop, false);
  capRing(outPos, outIdx, outer, inner, zTop, true);
}

function buildPlugLidShell(outPos, outIdx, boxOuter, boxInner, skirtDepth, lidThickness, clearance, lidWall) {
  const plugOuter = offsetProfileInward(boxInner, clearance);
  const plugInner = offsetProfileInward(boxInner, clearance + lidWall);
  const zTop = skirtDepth + lidThickness;

  capRing(outPos, outIdx, plugOuter, plugInner, 0, false);
  extrudeProfileSides(outPos, outIdx, plugOuter, 0, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, plugInner, 0, skirtDepth, false);
  capRing(outPos, outIdx, plugOuter, plugInner, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, boxOuter, skirtDepth, zTop, true);
  capProfileSolid(outPos, outIdx, boxOuter, zTop, true);
}

function buildFlatLidShell(outPos, outIdx, boxOuter, lidThickness) {
  capProfileSolid(outPos, outIdx, boxOuter, 0, false);
  extrudeProfileSides(outPos, outIdx, boxOuter, 0, lidThickness, true);
  capProfileSolid(outPos, outIdx, boxOuter, lidThickness, true);
}

function computeLidFitGuides(resolved, params) {
  const clearance = clamp(params.lidClearance ?? 0.35, 0.1, 1.2);
  const lidWall = clamp(params.lidWall ?? params.wall ?? 2.4, 1.2, 6);
  const lidType = params.lidType === "plug" || params.lidType === "flat" || params.lidType === "slide"
    ? params.lidType
    : "slip";
  if (lidType === "slide" && params.slideMeta) {
    return computeSlideFitGuides(resolved, params, params.slideMeta);
  }
  const skirtDepth = clamp(params.lidSkirt ?? 10, 4, 30);
  const lidThickness = clamp(params.lidThickness ?? 2.4, 1.2, 8);
  const lidHeight = lidType === "flat" ? lidThickness : skirtDepth + lidThickness;
  const guides = {
    seatZ: resolved.totalH,
    lidType,
    skirtDepth,
    lidHeight,
    boxOuter: resolved.outer,
    boxInner: resolved.inner,
  };
  if (lidType === "slip") {
    guides.skirtOuter = offsetProfileOutward(resolved.outer, clearance + lidWall);
    guides.skirtInner = offsetProfileOutward(resolved.outer, clearance);
  } else if (lidType === "plug") {
    guides.skirtOuter = offsetProfileInward(resolved.inner, clearance);
    guides.skirtInner = offsetProfileInward(resolved.inner, clearance + lidWall);
    guides.plateOuter = resolved.outer;
  } else {
    guides.plateOuter = resolved.outer;
  }
  return guides;
}

function buildSlipLidMesh(boxOuter, options) {
  const clearance = clamp(options.clearance ?? 0.35, 0.1, 1.2);
  const lidWall = clamp(options.lidWall ?? 2.4, 1.2, 6);
  const skirtDepth = clamp(options.skirtDepth ?? 10, 4, 30);
  const lidThickness = clamp(options.lidThickness ?? 2.4, 1.2, 8);
  const positions = [];
  const indices = [];
  buildSlipLidShell(positions, indices, boxOuter, skirtDepth, lidThickness, clearance, lidWall);
  return {
    positions,
    indices,
    lidHeight: skirtDepth + lidThickness,
  };
}

function buildPlugLidMesh(boxOuter, boxInner, options) {
  const clearance = clamp(options.clearance ?? 0.35, 0.1, 1.2);
  const lidWall = clamp(options.lidWall ?? 2.4, 1.2, 6);
  const skirtDepth = clamp(options.skirtDepth ?? 10, 4, 30);
  const lidThickness = clamp(options.lidThickness ?? 2.4, 1.2, 8);
  const positions = [];
  const indices = [];
  buildPlugLidShell(positions, indices, boxOuter, boxInner, skirtDepth, lidThickness, clearance, lidWall);
  return {
    positions,
    indices,
    lidHeight: skirtDepth + lidThickness,
  };
}

function buildFlatLidMesh(boxOuter, options) {
  const lidThickness = clamp(options.lidThickness ?? 2.4, 1.2, 8);
  const positions = [];
  const indices = [];
  buildFlatLidShell(positions, indices, boxOuter, lidThickness);
  return {
    positions,
    indices,
    lidHeight: lidThickness,
  };
}

export const LID_TYPES = [
  { id: "slip", label: "Slip-over", optionLabel: "Slip-over — skirt outside", hint: "Skirt wraps outside the box walls — classic loose fit." },
  { id: "plug", label: "Inset plug", optionLabel: "Inset plug — skirt inside", hint: "Skirt slides inside the opening; top plate sits flush on the rim." },
  { id: "slide", label: "Channel slide", optionLabel: "Channel slide — rail grooves", hint: "Angled grooves on the long walls; beveled lid slides in from the short end and seats at the far end." },
  { id: "flat", label: "Flat cap", optionLabel: "Flat cap — plate only", hint: "Single plate that rests on the rim — no skirt." },
];

export function shapeSupportsLid(shape) {
  return shape !== "vase";
}

function resolveContainer(params) {
  const shape = params.shape || "rect";
  const wall = clamp(params.wall, 1.2, 10);
  const floor = clamp(params.floor, 1.2, 10);

  if (shape === "circle") {
    const diameter = clamp(params.innerWidth, 10, 500);
    const innerH = clamp(params.innerHeight, 5, 400);
    const innerR = diameter / 2;
    const outerR = innerR + wall;
    return {
      outer: circleVertices(outerR, 56),
      inner: circleVertices(innerR, 56),
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW: diameter, innerD: diameter, innerH, wall, floor, shape: "circle" }),
    };
  }

  if (shape === "hex") {
    const flat = clamp(params.innerWidth, 10, 500);
    const innerH = clamp(params.innerHeight, 5, 400);
    const sides = clamp(Math.round(params.sides || 6), 3, 12);
    const vertexFillet = clamp(params.vertexFillet || 0, 0, flat / 4);
    const innerR = flatToCircumradius(flat, sides);
    const outerR = innerR + wall;
    let outer = regularPolygonVertices(sides, outerR);
    let inner = regularPolygonVertices(sides, innerR);
    if (vertexFillet > 0.3) {
      outer = filletedOutline(outer, vertexFillet + wall * 0.5, 6);
      inner = filletedOutline(inner, vertexFillet, 6);
    }
    const polyShape = sides === 6 ? "hex" : "polygon";
    return {
      outer,
      inner,
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW: flat, innerD: flat, innerH, wall, floor, shape: polyShape, sides }),
    };
  }

  if (shape === "pencil") {
    const innerL = clamp(params.innerWidth, 80, 320);
    const innerW = clamp(params.innerDepth, 30, 120);
    const innerH = clamp(params.innerHeight, 15, 80);
    const endR = Math.min(innerW / 2, innerL / 2 - 0.5);
    const outerL = innerL + wall * 2;
    const outerW = innerW + wall * 2;
    const outerEndR = Math.min(endR + wall, outerW / 2 - 0.1);
    const innerEndR = Math.min(endR, innerW / 2 - 0.1);
    return {
      outer: roundedRectOutline(outerL / 2, outerW / 2, outerEndR, 14),
      inner: roundedRectOutline(innerL / 2, innerW / 2, innerEndR, 14),
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW: innerL, innerD: innerW, innerH, wall, floor, shape: "pencil" }),
    };
  }

  if (shape === "pencilBox") {
    const innerL = clamp(params.innerWidth, 120, 300);
    const innerW = clamp(params.innerDepth, 40, 100);
    const innerH = clamp(params.innerHeight, 15, 60);
    const corner = clamp(params.cornerRadius ?? 4, 0, Math.min(innerW, innerL) / 2 - 1);
    const outerL = innerL + wall * 2;
    const outerW = innerW + wall * 2;
    let outer;
    let inner;
    if (corner > 0.5) {
      outer = roundedRectOutline(outerL / 2, outerW / 2, corner + wall, 10);
      inner = roundedRectOutline(innerL / 2, innerW / 2, corner, 10);
    } else {
      outer = [[-outerL / 2, -outerW / 2], [outerL / 2, -outerW / 2], [outerL / 2, outerW / 2], [-outerL / 2, outerW / 2]];
      inner = [[-innerL / 2, -innerW / 2], [innerL / 2, -innerW / 2], [innerL / 2, innerW / 2], [-innerL / 2, innerW / 2]];
    }
    return {
      outer,
      inner,
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW: innerL, innerD: innerW, innerH, wall, floor, shape: "pencilBox" }),
    };
  }

  if (shape === "teardrop") {
    const innerL = clamp(params.innerWidth, 50, 280);
    const innerW = clamp(params.innerDepth, 30, 160);
    const innerH = clamp(params.innerHeight, 15, 120);
    return {
      outer: teardropOutline(innerL + wall * 2, innerW + wall * 2, 32),
      inner: teardropOutline(innerL, innerW, 32),
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW: innerL, innerD: innerW, innerH, wall, floor, shape: "teardrop" }),
    };
  }

  if (shape === "star") {
    const tipDiam = clamp(params.innerWidth, 40, 220);
    const innerH = clamp(params.innerHeight, 15, 120);
    const points = clamp(Math.round(params.starPoints || 5), 5, 8);
    const inset = clamp(params.starInset ?? 0.42, 0.25, 0.7);
    const vertexFillet = clamp(params.vertexFillet || 0, 0, tipDiam / 8);
    const innerTipR = tipDiam / 2;
    const outerTipR = innerTipR + wall;
    let outer = starOutline(outerTipR, inset, points);
    let inner = starOutline(innerTipR, inset, points);
    if (vertexFillet > 0.3) {
      outer = filletedOutline(outer, vertexFillet + wall * 0.35, 5);
      inner = filletedOutline(inner, vertexFillet, 5);
    }
    return {
      outer,
      inner,
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({
        innerW: tipDiam, innerD: tipDiam, innerH, wall, floor, shape: "star", sides: points, starPoints: points,
      }),
    };
  }

  if (shape === "heart") {
    const innerW = clamp(params.innerWidth, 40, 200);
    const innerD = clamp(params.innerDepth, 35, 180);
    const innerH = clamp(params.innerHeight, 15, 120);
    const vertexFillet = clamp(params.vertexFillet || 0, 0, Math.min(innerW, innerD) / 8);
    let outer = heartOutline(innerW + wall * 2, innerD + wall * 2, 52);
    let inner = heartOutline(innerW, innerD, 52);
    if (vertexFillet > 0.3) {
      outer = filletedOutline(outer, vertexFillet + wall * 0.35, 6);
      inner = filletedOutline(inner, vertexFillet, 6);
    }
    return {
      outer,
      inner,
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW, innerD, innerH, wall, floor, shape: "heart" }),
    };
  }

  const innerW = clamp(params.innerWidth, 10, 500);
  const innerD = clamp(params.innerDepth, 10, 500);
  const innerH = clamp(params.innerHeight, 5, 400);
  const corner = clamp(params.cornerRadius || 0, 0, Math.min(innerW, innerD) / 2 - 1);
  const edgeFillet = clamp(params.vertexFillet || 0, 0, Math.min(innerW, innerD) / 2 - 1);
  const outerW = innerW + wall * 2;
  const outerD = innerD + wall * 2;
  let outer;
  let inner;
  let metaShape = shape;
  if (corner > 0.5) {
    outer = roundedRectOutline(outerW / 2, outerD / 2, corner + wall, 10);
    inner = roundedRectOutline(innerW / 2, innerD / 2, Math.max(corner, 0.5), 10);
    metaShape = "rounded";
  } else if (edgeFillet > 0.5) {
    const sharpOuter = [[-outerW / 2, -outerD / 2], [outerW / 2, -outerD / 2], [outerW / 2, outerD / 2], [-outerW / 2, outerD / 2]];
    const sharpInner = [[-innerW / 2, -innerD / 2], [innerW / 2, -innerD / 2], [innerW / 2, innerD / 2], [-innerW / 2, innerD / 2]];
    outer = filletedOutline(sharpOuter, edgeFillet + wall, 6);
    inner = filletedOutline(sharpInner, edgeFillet, 6);
  } else {
    outer = [[-outerW / 2, -outerD / 2], [outerW / 2, -outerD / 2], [outerW / 2, outerD / 2], [-outerW / 2, outerD / 2]];
    inner = [[-innerW / 2, -innerD / 2], [innerW / 2, -innerD / 2], [innerW / 2, innerD / 2], [-innerW / 2, innerD / 2]];
  }
  return {
    outer,
    inner,
    floor,
    totalH: innerH + floor,
    cavityH: innerH,
    meta: computeMeta({ innerW, innerD, innerH, wall, floor, shape: metaShape }),
  };
}


function hexAreaFromFlat(flat) {
  const r = flat / Math.sqrt(3);
  return ((3 * Math.sqrt(3)) / 2) * r * r;
}

function polygonAreaFromFlat(flat, sides) {
  const r = flatToCircumradius(flat, sides);
  return 0.5 * sides * r * r * Math.sin((2 * Math.PI) / sides);
}

function computeMeta({ innerW, innerD, innerH, wall, floor, shape, sides = 6, starPoints }) {
  const outerH = innerH + floor;
  let cavityMl;
  let outerMl;
  let outerW;
  let outerD;

  if (shape === "circle") {
    const r = innerW / 2;
    const outerDia = innerW + wall * 2;
    cavityMl = (Math.PI * r * r * innerH) / 1000;
    outerMl = (Math.PI * (outerDia / 2) ** 2 * outerH) / 1000;
    outerW = round1(outerDia);
    outerD = round1(outerDia);
  } else if (shape === "hex" || shape === "polygon") {
    const flat = innerW;
    const innerR = flatToCircumradius(flat, sides);
    const outerFlat = circumradiusToFlat(innerR + wall, sides);
    cavityMl = (polygonAreaFromFlat(flat, sides) * innerH) / 1000;
    outerMl = (polygonAreaFromFlat(outerFlat, sides) * outerH) / 1000;
    outerW = round1(outerFlat);
    outerD = round1(outerFlat);
  } else {
    outerW = innerW + wall * 2;
    outerD = innerD + wall * 2;
    cavityMl = (innerW * innerD * innerH) / 1000;
    outerMl = (outerW * outerD * outerH) / 1000;
    outerW = round1(outerW);
    outerD = round1(outerD);
  }

  const materialMl = Math.max(0, outerMl - cavityMl);
  return {
    shape,
    sides,
    starPoints: starPoints || (shape === "star" ? sides : undefined),
    inner: { w: round1(innerW), d: round1(innerD), h: round1(innerH) },
    outer: { w: outerW, d: outerD, h: round1(outerH) },
    cavityMl: round1(cavityMl),
    materialMl: round1(materialMl),
    estGrams: round1(materialMl * 1.24),
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function buildContainer(params) {
  if (params.shape === "vase") {
    const vaseMesh = buildVase(params);
    centerPositions(vaseMesh.positions, 0, 0);
    const meta = vaseMeta(params);
    let saucerMesh = null;
    if (params.vaseSaucerEnabled) {
      saucerMesh = buildVaseSaucer(params);
      centerPositions(saucerMesh.positions, 0, 0);
    }
    return {
      positions: vaseMesh.positions,
      indices: vaseMesh.indices,
      shellMesh: vaseMesh,
      meta,
      totalH: meta.outer.h,
      accentMesh: null,
      labelMesh: null,
      debossCutterMesh: null,
      saucerMesh,
    };
  }
  const resolved = resolveContainer(params);
  const joinerShape = (resolved.meta.shape === "rect" || resolved.meta.shape === "pencilBox") && (params.cornerRadius || 0) > 0.5
    ? "rounded"
    : resolved.meta.shape;
  const useJoiner = params.joinerEnabled && shapeSupportsJoiner(joinerShape);

  let mesh;
  if (useJoiner) {
    const { inner, outer } = resolved.meta;
    const joiner = resolveJoinerDims(params, outer.w, outer.d);
    mesh = buildRectShellWithJoiner(
      outer.w,
      outer.d,
      inner.w,
      inner.d,
      resolved.floor,
      resolved.totalH,
      resolved.cavityH,
      joiner,
    );
  } else {
    mesh = shellFromProfiles(
      resolved.outer,
      resolved.inner,
      resolved.floor,
      resolved.totalH,
      resolved.cavityH,
    );
  }

  centerPositions(mesh.positions, 0, 0);

  if (
    params.lidType === "slide" &&
    shapeSupportsSlideLid(resolved.meta.shape)
  ) {
    appendSlideChannelsToBody(mesh.positions, mesh.indices, resolved.meta, resolved.totalH, params);
  }

  const decorShape = joinerShape;
  let accentMesh = null;
  let labelMesh = null;
  let debossCutterMesh = null;
  if (shapeSupportsDecor(decorShape)) {
    const shellMesh = applyBodyDecorations(mesh, resolved.meta, params);
    const isLidFace = params.embossFace === "lid";
    const previewDraft = !!params._artPreviewDraft;
    if (!isLidFace && !previewDraft) {
      labelMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "emboss");
      if (labelMesh) centerPositions(labelMesh.positions, 0, 0);
      if (params.embossDeboss) {
        debossCutterMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "deboss-cutter");
        if (debossCutterMesh) centerPositions(debossCutterMesh.positions, 0, 0);
        mesh = shellMesh;
      } else {
        mesh = labelMesh ? mergeMeshes(shellMesh, labelMesh) : shellMesh;
      }
    } else {
      mesh = shellMesh;
    }
    if (params.accentEnabled) {
      accentMesh = buildAccentMesh(resolved.meta, params);
      centerPositions(accentMesh.positions, 0, 0);
    }
    return {
      positions: mesh.positions,
      indices: mesh.indices,
      shellMesh,
      meta: {
        ...resolved.meta,
        joinerHand: useJoiner ? (params.joinerHand === "right" ? "right" : "left") : undefined,
        joinerScale: useJoiner ? resolveJoinerDims(params, resolved.meta.outer.w, resolved.meta.outer.d).scale : undefined,
        embossFace: params.embossFace || "front",
        embossDeboss: !!params.embossDeboss,
      },
      totalH: resolved.totalH,
      accentMesh,
      labelMesh,
      debossCutterMesh,
    };
  }

  const meta = {
    ...resolved.meta,
    joinerHand: useJoiner ? (params.joinerHand === "right" ? "right" : "left") : undefined,
    joinerScale: useJoiner ? resolveJoinerDims(params, resolved.meta.outer.w, resolved.meta.outer.d).scale : undefined,
  };
  return { ...mesh, meta, totalH: resolved.totalH, accentMesh, labelMesh };
}

export function buildLid(params) {
  const resolved = resolveContainer(params);
  let lidType = params.lidType === "plug" || params.lidType === "flat" || params.lidType === "slide"
    ? params.lidType
    : "slip";
  if (lidType === "slide" && !shapeSupportsSlideLid(resolved.meta.shape)) {
    lidType = "plug";
  }
  const options = {
    clearance: params.lidClearance,
    lidWall: params.lidWall ?? params.wall,
    skirtDepth: params.lidSkirt,
    lidThickness: params.lidThickness,
    slideGrooveHeight: params.slideGrooveHeight,
    slideUndercut: params.slideUndercut,
    slideGrooveDepth: params.slideGrooveDepth,
    slideStopLength: params.slideStopLength,
    slideEntryRamp: params.slideEntryRamp,
  };
  let lid;
  let slideMeta = null;
  if (lidType === "flat") {
    lid = buildFlatLidMesh(resolved.outer, options);
  } else if (lidType === "plug") {
    lid = buildPlugLidMesh(resolved.outer, resolved.inner, options);
  } else if (lidType === "slide") {
    lid = buildSlideLidMesh(resolved.meta, resolved.totalH, params);
    slideMeta = lid.slideMeta;
    lidType = "slide";
  } else {
    lid = buildSlipLidMesh(resolved.outer, options);
  }

  const decorShape =
    (resolved.meta.shape === "rect" || resolved.meta.shape === "pencilBox") &&
    (params.cornerRadius || 0) > 0.5
      ? "rounded"
      : resolved.meta.shape;
  let labelMesh = null;
  let debossCutterMesh = null;
  if (params.embossFace === "lid" && shapeSupportsDecor(decorShape) && !params._artPreviewDraft) {
    labelMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "emboss");
    if (labelMesh) centerPositions(labelMesh.positions, 0, 0);
    if (params.embossDeboss) {
      debossCutterMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "deboss-cutter");
      if (debossCutterMesh) centerPositions(debossCutterMesh.positions, 0, 0);
    } else if (labelMesh) {
      lid = mergeMeshes(lid, labelMesh);
    }
  }

  centerPositions(lid.positions, 0, 0);
  const guideParams = { ...params, lidType, slideMeta };
  return {
    positions: lid.positions,
    indices: lid.indices,
    meta: { ...resolved.meta, part: "lid", lidType },
    lidHeight: lid.lidHeight,
    seatZ: resolved.totalH,
    slideMeta,
    fitGuides: computeLidFitGuides(resolved, guideParams),
    labelMesh,
    debossCutterMesh,
  };
}

/** Flip lid so the solid plate sits on the print bed (skirt points up). Preview keeps natural on-box orientation. */
export function orientLidForPrint(lid) {
  let h = lid.lidHeight;
  if (!Number.isFinite(h) || h <= 0) {
    h = 0;
    for (let i = 2; i < lid.positions.length; i += 3) {
      h = Math.max(h, lid.positions[i]);
    }
  }
  if (!Number.isFinite(h) || h <= 0) {
    return { positions: lid.positions.slice(), indices: lid.indices.slice() };
  }
  const positions = lid.positions.slice();
  for (let i = 2; i < positions.length; i += 3) positions[i] = h - positions[i];
  return { positions, indices: lid.indices.slice() };
}

/** Map CAD Z-up (print/STL) coords to Three.js Y-up for preview. */
export function toBufferGeometry(THREE, mesh) {
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) {
    const idx = mesh.indices[i] * 3;
    pos[i * 3] = mesh.positions[idx];
    pos[i * 3 + 1] = mesh.positions[idx + 2];
    pos[i * 3 + 2] = -mesh.positions[idx + 1];
  }
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.computeVertexNormals();
  return geom;
}

export const PENCIL_PRESET = {
  innerWidth: 200,
  innerDepth: 72,
  innerHeight: 25,
  wall: 2.4,
  floor: 2.4,
};

export const PENCIL_BOX_PRESET = {
  innerWidth: 200,
  innerDepth: 72,
  innerHeight: 25,
  wall: 2.4,
  floor: 2.4,
  cornerRadius: 4,
  lidEnabled: true,
  lidType: "slide",
  lidSkirt: 12,
  lidThickness: 2.4,
  lidClearance: 0.25,
  slideGrooveHeight: 6,
  slideUndercut: 1.8,
  slideGrooveDepth: 2.4,
  slideStopLength: 10,
  slideEntryRamp: 10,
  embossFace: "lid",
};

export const TEARDROP_PRESET = {
  innerWidth: 110,
  innerDepth: 80,
  innerHeight: 35,
  wall: 2.4,
  floor: 2.4,
};

export const STAR_PRESET = {
  innerWidth: 90,
  innerDepth: 90,
  innerHeight: 35,
  wall: 2.4,
  floor: 2.4,
  starPoints: 5,
  starInset: 0.42,
  vertexFillet: 1.5,
};

export const HEART_PRESET = {
  innerWidth: 90,
  innerDepth: 82,
  innerHeight: 35,
  wall: 2.4,
  floor: 2.4,
  vertexFillet: 2,
};

export const DEFAULTS = {
  ...VASE_DEFAULTS,
  shape: "rect",
  innerWidth: 80,
  innerDepth: 60,
  innerHeight: 40,
  wall: 2.4,
  floor: 2.4,
  cornerRadius: 6,
  vertexFillet: 2,
  sides: 6,
  starPoints: 5,
  starInset: 0.42,
  lidEnabled: false,
  lidType: "slip",
  lidSkirt: 10,
  lidThickness: 2.4,
  lidClearance: 0.35,
  slideGrooveHeight: 6,
  slideUndercut: 1.8,
  slideGrooveDepth: 2.4,
  slideStopLength: 10,
  slideEntryRamp: 10,
  joinerEnabled: false,
  joinerHand: "left",
  joinerWidth: 9,
  joinerNeck: 6,
  joinerProtrusion: 4,
  joinerClearance: 0.3,
  joinerAutoScale: true,
  accentEnabled: false,
  accentFace: "rim",
  accentHeight: 4,
  accentInset: 4,
  accentColor: "#f97316",
  boxColor: "#38bdf8",
  embossText: "",
  embossFont: "inter",
  embossDepth: 0.7,
  embossHeight: 7,
  embossFace: "front",
  embossDeboss: false,
  embossSvgEnabled: false,
  embossSvgText: "",
  embossTraceEnabled: false,
  embossTraceRects: null,
  embossTraceSize: 16,
  decorOffsetX: 0,
  decorOffsetY: 0,
  decorRotation: 0,
  traceThreshold: 128,
  traceInvert: false,
  traceMode: "silhouette",
  honeycombEnabled: false,
  honeycombFace: "back",
  honeycombSize: 2.5,
  honeycombDepth: 0.6,
  stackableEnabled: false,
  stackHexSize: 2.8,
  stackFootHeight: 1.4,
  stackClearance: 0.35,
};
