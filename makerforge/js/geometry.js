/**
 * Parametric hollow container mesh builder.
 * Returns { positions, indices } in mm, Z-up, centered on XY, base at z=0.
 */

import {
  applyBodyDecorations,
  buildLabelEmboss,
  buildAccentMesh,
  buildDividerInsert,
  mergeMeshes,
  appendStackableLidPockets,
  resolveJoinerDims,
  shapeSupportsDecor,
  shapeSupportsInsert,
} from "./features.js";
import earcut from "https://esm.sh/earcut@2.2.4";
import { buildVase, buildVaseSaucer, buildVaseAccentMesh, vaseMeta, VASE_DEFAULTS, VASE_STYLES } from "./vase.js?v=121";

import { appendInsertShelfSlotsToBody } from "./insert-slots.js";

export { shapeSupportsDecor, shapeSupportsInsert, VASE_STYLES };

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

/** Circle outline segments — targets ~1.5 mm facet length for smooth FDM walls. */
function circleSegmentsForRadius(radius) {
  if (radius <= 0) return 96;
  const maxFacet = 1.5;
  const n = Math.ceil((Math.PI * 2 * radius) / maxFacet);
  return clamp(Math.ceil(n / 4) * 4, 96, 256);
}

function ellipseVertices(rx, ry, segments) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = ((Math.PI * 2) / segments) * i;
    pts.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return pts;
}

/** Constant-thickness offset along the ellipse normal. */
function offsetEllipseProfile(inner, rx, ry, wall) {
  return inner.map(([x, y]) => {
    const nx = x / (rx * rx);
    const ny = y / (ry * ry);
    const len = Math.hypot(nx, ny) || 1;
    return [x + (wall * nx) / len, y + (wall * ny) / len];
  });
}

function ellipseSegmentsForRadii(rx, ry) {
  return circleSegmentsForRadius(Math.max(rx, ry));
}

function filletArcSegments(radius, sweepRadians = Math.PI / 2) {
  if (radius <= 0.5) return 4;
  const maxFacet = 1.0;
  const n = Math.ceil((sweepRadians * radius) / maxFacet);
  return clamp(n, 12, 96);
}

function polygonSignedArea2(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return area / 2;
}

/** Round polygon vertices with circular fillets — convex corners only.
 * Reflex corners (heart notch, star inner points) are skipped: forcing an
 * arc there sweeps the wrong way and draws full-circle "knuckles". */
function filletedOutline(vertices, filletR, arcSegments) {
  const r = filletR;
  if (r < 0.2 || vertices.length < 3) return vertices.map((p) => [p[0], p[1]]);

  const ccw = polygonSignedArea2(vertices) > 0;
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
    const cross = inDir[0] * outDir[1] - inDir[1] * outDir[0];
    const convex = ccw ? cross < 0 : cross > 0;
    if (!convex || theta < 0.08 || theta > Math.PI - 0.08) {
      out.push([curr[0], curr[1]]);
      continue;
    }
    const trim = Math.min(r / Math.tan(theta / 2), Math.hypot(prev[0] - curr[0], prev[1] - curr[1]) * 0.42, Math.hypot(next[0] - curr[0], next[1] - curr[1]) * 0.42);
    if (trim < 0.05) {
      out.push([curr[0], curr[1]]);
      continue;
    }
    // Effective radius from the (possibly clamped) trim so the arc stays
    // tangent to both edges even on short segments near sharp tips.
    const rEff = trim * Math.tan(theta / 2);
    const p1 = [curr[0] + inDir[0] * trim, curr[1] + inDir[1] * trim];
    const p2 = [curr[0] + outDir[0] * trim, curr[1] + outDir[1] * trim];
    const bis = norm2(inDir[0] + outDir[0], inDir[1] + outDir[1]);
    const distCenter = rEff / Math.sin(theta / 2);
    const center = [curr[0] + bis[0] * distCenter, curr[1] + bis[1] * distCenter];
    const a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    const a2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
    let sweep = a2 - a1;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    if (Math.abs(sweep) < 1e-4) {
      out.push([curr[0], curr[1]]);
      continue;
    }
    const steps = Math.max(2, arcSegments ?? filletArcSegments(rEff, Math.abs(sweep)));
    out.push(p1);
    for (let s = 1; s < steps; s++) {
      const a = a1 + sweep * (s / steps);
      out.push([center[0] + rEff * Math.cos(a), center[1] + rEff * Math.sin(a)]);
    }
    out.push(p2);
  }
  return out;
}

function roundedRectCornerSegments(radius) {
  if (radius <= 0.5) return 1;
  const maxFacet = 1.5;
  const n = Math.ceil(((Math.PI / 2) * radius) / maxFacet);
  return clamp(n, 4, 64);
}

/** 2D rounded-rect outline, counter-clockwise, centered at origin. */
function roundedRectOutline(halfW, halfD, radius, segments) {
  const r = clamp(radius, 0, Math.min(halfW, halfD) - 0.01);
  const steps = r > 0 ? (segments ?? roundedRectCornerSegments(r)) : 1;
  const pts = [];
  const corners = [
    [halfW - r, halfD - r, 0, Math.PI / 2],
    [-(halfW - r), halfD - r, Math.PI / 2, Math.PI],
    [-(halfW - r), -(halfD - r), Math.PI, (3 * Math.PI) / 2],
    [halfW - r, -(halfD - r), (3 * Math.PI) / 2, 2 * Math.PI],
  ];
  for (const [cx, cy, a0, a1] of corners) {
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
  const innerRing = radialMatchInner(outer, inner);
  const n = outer.length;
  if (n < 3) return;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(innerRing[i][0], innerRing[i][1], z);
    const i1 = vec3(innerRing[j][0], innerRing[j][1], z);
    if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

/** True when a profile edge lies on the front face (y ≈ min) — skip for open-front bookcases. */
function isFrontProfileEdge(p0, p1, frontY) {
  const tol = 0.85;
  return p0[1] <= frontY + tol && p1[1] <= frontY + tol;
}

function profileFrontY(points) {
  let minY = Infinity;
  for (const p of points) minY = Math.min(minY, p[1]);
  return minY;
}

function extrudeProfileSidesSkipFront(outPos, outIdx, points, z0, z1, outward = true) {
  const frontY = profileFrontY(points);
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (isFrontProfileEdge(points[i], points[j], frontY)) continue;
    const a = vec3(points[i][0], points[i][1], z0);
    const b = vec3(points[j][0], points[j][1], z0);
    const c = vec3(points[j][0], points[j][1], z1);
    const d = vec3(points[i][0], points[i][1], z1);
    if (outward) pushQuad(outPos, outIdx, a, b, c, d);
    else pushQuad(outPos, outIdx, a, d, c, b);
  }
}

function capRingSkipFront(outPos, outIdx, outer, inner, z, normalUp) {
  const innerRing = radialMatchInner(outer, inner);
  const frontY = profileFrontY(outer);
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (isFrontProfileEdge(outer[i], outer[j], frontY)) continue;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(innerRing[i][0], innerRing[i][1], z);
    const i1 = vec3(innerRing[j][0], innerRing[j][1], z);
    if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

function capSolid(outPos, outIdx, points, z, normalUp) {
  capProfileSolid(outPos, outIdx, points, z, normalUp);
}

/** Resample a closed profile to a target vertex count (arc-length spacing). */
function resampleProfileClosed(points, targetCount) {
  if (targetCount < 3 || points.length < 3) return points.map((p) => [p[0], p[1]]);
  if (points.length === targetCount) return points.map((p) => [p[0], p[1]]);

  const n = points.length;
  const dists = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
    dists.push(d);
    total += d;
  }
  if (total < 1e-9) return points.map((p) => [p[0], p[1]]);

  const out = [];
  for (let k = 0; k < targetCount; k++) {
    const target = (k / targetCount) * total;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const seg = dists[i];
      const next = acc + seg;
      if (next >= target - 1e-9 || i === n - 1) {
        const t = seg > 1e-9 ? clamp((target - acc) / seg, 0, 1) : 0;
        const j = (i + 1) % n;
        out.push([
          points[i][0] + (points[j][0] - points[i][0]) * t,
          points[i][1] + (points[j][1] - points[i][1]) * t,
        ]);
        break;
      }
      acc = next;
    }
  }
  return out;
}

function profileCentroid(points) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  const n = points.length || 1;
  return [cx / n, cy / n];
}

/** Ray from (cx,cy) along (dx,dy) hits a profile edge; return closest hit distance. */
function rayProfileHit(points, cx, cy, dx, dy) {
  let bestT = Infinity;
  let best = null;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = points[i][0];
    const y1 = points[i][1];
    const x2 = points[j][0];
    const y2 = points[j][1];
    const sx = x2 - x1;
    const sy = y2 - y1;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((x1 - cx) * sy - (y1 - cy) * sx) / denom;
    const s = ((x1 - cx) * dy - (y1 - cy) * dx) / denom;
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < bestT) {
      bestT = t;
      best = [cx + dx * t, cy + dy * t];
    }
  }
  return best;
}

/** Pair each outer vertex with the inner profile point at the same angle from centroid. */
function radialMatchInner(outer, inner) {
  const [cx, cy] = profileCentroid(outer);
  return outer.map(([ox, oy]) => {
    const ang = Math.atan2(oy - cy, ox - cx);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    return rayProfileHit(inner, cx, cy, dx, dy) ?? [ox, oy];
  });
}

/** @deprecated arc-length resample — use radialMatchInner for capRing pairing */
function matchInnerToOuter(outer, inner) {
  return radialMatchInner(outer, inner);
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

/** Earcut annulus cap (outer ring + inner hole) — no twisted capRing quads. */
function capProfileAnnulus(outPos, outIdx, outer, hole, z, normalUp) {
  const outerRing = cleanCapRing(outer);
  let holeRing = cleanCapRing(hole);
  if (outerRing.length < 3 || holeRing.length < 3) return;
  // Earcut expects hole winding opposite to outer.
  holeRing = holeRing.slice().reverse();
  try {
    const flat = outerRing.flat().concat(holeRing.flat());
    const tri = earcut(flat, [outerRing.length]);
    if (!tri.length) throw new Error("empty annulus");
    const base = outPos.length / 3;
    for (const [x, y] of outerRing) outPos.push(x, y, z);
    for (const [x, y] of holeRing) outPos.push(x, y, z);
    for (let i = 0; i < tri.length; i += 3) {
      const a = base + tri[i];
      const b = base + tri[i + 1];
      const c = base + tri[i + 2];
      if (normalUp) pushTriIdx(outIdx, a, b, c);
      else pushTriIdx(outIdx, a, c, b);
    }
  } catch {
    capRing(outPos, outIdx, outerRing, holeRing, z, normalUp);
  }
}

const FLOOR_SLAB = 0.08;

function capFloorSlab(outPos, outIdx, profile, zTop, upward) {
  const zBot = upward ? zTop - FLOOR_SLAB : zTop;
  const zCap = upward ? zTop : zTop + FLOOR_SLAB;
  if (upward) {
    extrudeProfileSides(outPos, outIdx, profile, zBot, zTop, true);
    capProfileSolid(outPos, outIdx, profile, zTop, true);
  } else {
    extrudeProfileSides(outPos, outIdx, profile, zBot, zCap, true);
    capProfileSolid(outPos, outIdx, profile, zBot, false);
  }
}

function buildProfileShell(outPos, outIdx, outer, inner, floor, totalH, cavityH) {
  const zFloor = floor;
  const zTop = totalH;
  const zCavityTop = floor + cavityH;

  capFloorSlab(outPos, outIdx, outer, 0, false);
  capProfileSolid(outPos, outIdx, inner, zFloor, true);
  capProfileAnnulus(outPos, outIdx, outer, inner, zFloor, true);
  extrudeProfileSides(outPos, outIdx, outer, 0, zTop, true);
  extrudeProfileSides(outPos, outIdx, inner, zFloor, zCavityTop, false);
  capProfileAnnulus(outPos, outIdx, outer, inner, zTop, true);
}

/** Open-front bookcase shell — back + sides + floor + top rim; front face omitted. */
function buildOpenFrontBookcaseShell(outPos, outIdx, outer, inner, floor, totalH, cavityH) {
  const zFloor = floor;
  const zTop = totalH;
  const zCavityTop = floor + cavityH;

  capFloorSlab(outPos, outIdx, outer, 0, false);
  capProfileSolid(outPos, outIdx, inner, zFloor, true);
  capProfileAnnulus(outPos, outIdx, outer, inner, zFloor, true);
  extrudeProfileSidesSkipFront(outPos, outIdx, outer, 0, zTop, true);
  extrudeProfileSidesSkipFront(outPos, outIdx, inner, zFloor, zCavityTop, false);
  capProfileAnnulus(outPos, outIdx, outer, inner, zTop, true);
}

function shellFromProfiles(outer, inner, floor, totalH, cavityH, openFront = false) {
  const positions = [];
  const indices = [];
  if (openFront) {
    buildOpenFrontBookcaseShell(positions, indices, outer, inner, floor, totalH, cavityH);
  } else {
    buildProfileShell(positions, indices, outer, inner, floor, totalH, cavityH);
  }
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

  // Hollow skirt tube
  capRing(outPos, outIdx, outer, inner, 0, false);
  extrudeProfileSides(outPos, outIdx, outer, 0, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, inner, 0, skirtDepth, false);

  // Solid top plate — no hollow rim (avoids visible internal skirt floor in preview)
  capProfileSolid(outPos, outIdx, outer, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, outer, skirtDepth, zTop, true);
  capProfileSolid(outPos, outIdx, outer, zTop, true);
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

function buildFlatLidShell(outPos, outIdx, boxOuter, boxInner, lidThickness, lipDepth, clearance) {
  capProfileSolid(outPos, outIdx, boxOuter, 0, false);
  extrudeProfileSides(outPos, outIdx, boxOuter, 0, lidThickness, true);
  capProfileSolid(outPos, outIdx, boxOuter, lidThickness, true);

  if (lipDepth > 0.4 && boxInner?.length >= 3) {
    const lipOuter = offsetProfileInward(boxInner, clearance);
    const lipInner = offsetProfileInward(lipOuter, Math.min(1.4, clearance + 0.9));
    extrudeProfileSides(outPos, outIdx, lipOuter, -lipDepth, 0, true);
    extrudeProfileSides(outPos, outIdx, lipInner, -lipDepth, 0, false);
    capRing(outPos, outIdx, lipOuter, lipInner, -lipDepth, false);
    capRing(outPos, outIdx, lipOuter, lipInner, 0, true);
  }
}

/** Printable jar thread — coarse 2-start trapezoid. */
const SCREW_THREAD = {
  pitch: 4.0,
  starts: 2,
  depth: 1.4,
  rootHalfWidth: 1.1,
  crestHalfWidth: 0.5,
  embed: 0.2,
  // FDM compensation: lid bores print undersize and external threads print
  // oversize, so the cap gets extra radial room and narrower thread flanks
  // on top of the user-facing Fit clearance.
  fitRadialComp: 0.25,
  fitFlankComp: 0.15,
};

/** Scalloped circle — vertical grip flutes on the screw lid outside. */
function knurledCircleVertices(radius, segments, lobes = 24, amp = 0.8) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = ((Math.PI * 2) / segments) * i;
    const r = radius - amp * (0.5 + 0.5 * Math.cos(lobes * a));
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Helical thread solid swept around the Z axis.
 * direction +1 grows outward from baseRadius (box neck), -1 inward (lid skirt).
 * Root is embedded into the wall so slicers union it with the shell.
 */
function appendThreadHelix(outPos, outIdx, opts) {
  const {
    baseRadius,
    direction,
    zStart,
    zEnd,
    lead,
    phase = 0,
    depth,
    rootHalfWidth,
    crestHalfWidth,
    embed = 0.2,
    segmentsPerTurn = 96,
  } = opts;
  const height = zEnd - zStart;
  if (height <= rootHalfWidth * 2 || lead <= 0) return;

  const turns = height / lead;
  const steps = Math.max(12, Math.ceil(turns * segmentsPerTurn));
  const taperSteps = Math.max(4, Math.round(segmentsPerTurn * 0.15));
  const r0 = baseRadius - embed * direction;

  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const theta = phase + Math.PI * 2 * turns * f;
    const zc = zStart + height * f;
    // Depth tapers to zero at both ends so the thread fades into the wall.
    const dScale = Math.min(1, i / taperSteps, (steps - i) / taperSteps);
    const r1 = baseRadius + depth * Math.max(0, dScale) * direction;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const section = [
      [r0, -rootHalfWidth],
      [r1, -crestHalfWidth],
      [r1, crestHalfWidth],
      [r0, rootHalfWidth],
    ];
    rings.push(section.map(([r, dz]) => [r * cos, r * sin, zc + dz]));
  }

  const flip = direction < 0;
  const quad = (a, b, c, d) => {
    if (flip) pushQuad(outPos, outIdx, a, d, c, b);
    else pushQuad(outPos, outIdx, a, b, c, d);
  };
  for (let i = 0; i < steps; i++) {
    const cur = rings[i];
    const nxt = rings[i + 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      quad(cur[k], nxt[k], nxt[k2], cur[k2]);
    }
  }
  const first = rings[0];
  const last = rings[steps];
  quad(first[0], first[1], first[2], first[3]);
  quad(last[3], last[2], last[1], last[0]);
}

function profileMaxRadius(points) {
  let r = 0;
  for (const [x, y] of points) r = Math.max(r, Math.hypot(x, y));
  return r;
}

function screwSkirtDepth(params) {
  return clamp(params.lidSkirt ?? 10, 6, 30);
}

/** External threads on the round box neck for the screw-top lid. */
function appendBodyNeckThreads(outPos, outIdx, resolved, params) {
  const t = SCREW_THREAD;
  const skirtDepth = screwSkirtDepth(params);
  const outerR = profileMaxRadius(resolved.outer);
  const lead = t.pitch * t.starts;
  // Margin must exceed rootHalfWidth so the thread never pokes past the rim.
  const zTop = resolved.totalH - (t.rootHalfWidth + 0.3);
  const zBot = Math.max(resolved.floor + 1, resolved.totalH - skirtDepth + t.rootHalfWidth + 0.3);
  for (let s = 0; s < t.starts; s++) {
    appendThreadHelix(outPos, outIdx, {
      baseRadius: outerR,
      direction: 1,
      zStart: zBot,
      zEnd: zTop,
      lead,
      phase: (Math.PI * 2 * s) / t.starts,
      depth: t.depth,
      rootHalfWidth: t.rootHalfWidth,
      crestHalfWidth: t.crestHalfWidth,
      embed: t.embed,
    });
  }
}

/** Screw-top lid: knurled cap with internal threads matching the neck. */
function buildScrewLidMesh(bodyOuterR, options, params) {
  const t = SCREW_THREAD;
  const clearance = clamp(options.clearance ?? 0.35, 0.15, 0.8);
  const lidWall = clamp(options.lidWall ?? 2.4, 1.6, 6);
  const skirtDepth = screwSkirtDepth(params);
  const lidThickness = clamp(options.lidThickness ?? 2.4, 1.2, 8);
  const knurlAmp = 0.8;

  // Bore = body crest + fit clearance + FDM compensation (bores print small).
  const innerR = bodyOuterR + t.depth + clearance + t.fitRadialComp;
  const outerR = innerR + Math.max(lidWall, t.depth + 1.2) + knurlAmp;
  const zTop = skirtDepth + lidThickness;
  const segments = Math.max(circleSegmentsForRadius(outerR), 192);

  const inner = circleVertices(innerR, segments);
  const outer = knurledCircleVertices(outerR, segments, 24, knurlAmp);

  const positions = [];
  const indices = [];
  capRing(positions, indices, outer, inner, 0, false);
  extrudeProfileSides(positions, indices, outer, 0, zTop, true);
  extrudeProfileSides(positions, indices, inner, 0, skirtDepth, false);
  capProfileSolid(positions, indices, inner, skirtDepth, false);
  capProfileSolid(positions, indices, outer, zTop, true);

  const lead = t.pitch * t.starts;
  for (let s = 0; s < t.starts; s++) {
    appendThreadHelix(positions, indices, {
      baseRadius: innerR,
      direction: -1,
      zStart: t.rootHalfWidth + 0.3,
      zEnd: skirtDepth - (t.rootHalfWidth + 0.3),
      lead,
      phase: (Math.PI * 2 * s) / t.starts,
      depth: t.depth,
      // Slimmer flanks on the internal thread so it doesn't bind axially
      // against the neck thread once both parts swell in print.
      rootHalfWidth: t.rootHalfWidth - t.fitFlankComp,
      crestHalfWidth: Math.max(0.25, t.crestHalfWidth - t.fitFlankComp),
      embed: t.embed,
    });
  }

  return {
    positions,
    indices,
    lidHeight: zTop,
  };
}

function buildFlatLidMesh(boxOuter, boxInner, meta, params, options) {
  const lidThickness = clamp(options.lidThickness ?? 2.4, 1.2, 8);
  const lipDepth = clamp(options.lipDepth ?? 0, 0, 12);
  const clearance = clamp(options.clearance ?? 0.35, 0.1, 1.2);
  const positions = [];
  const indices = [];
  buildFlatLidShell(positions, indices, boxOuter, boxInner, lidThickness, lipDepth, clearance);
  if (params?.stackableEnabled && meta) {
    appendStackableLidPockets(positions, indices, meta, params, lidThickness);
  }
  return {
    positions,
    indices,
    lidHeight: lidThickness + lipDepth,
  };
}

function computeLidFitGuides(resolved, params) {
  const clearance = clamp(params.lidClearance ?? 0.35, 0.1, 1.2);
  const lidWall = clamp(params.lidWall ?? params.wall ?? 2.4, 1.2, 6);
  const lidType = normalizeLidType(params.lidType, params.shape);
  const skirtDepth = lidType === "screw" ? screwSkirtDepth(params) : clamp(params.lidSkirt ?? 10, 4, 30);
  const lidThickness = clamp(params.lidThickness ?? 2.4, 1.2, 8);
  const lipDepth = clamp(params.lidLipDepth ?? 0, 0, 12);
  const lidHeight = lidType === "flat" ? lidThickness + lipDepth : skirtDepth + lidThickness;
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
  } else if (lidType === "screw") {
    const t = SCREW_THREAD;
    guides.skirtInner = offsetProfileOutward(resolved.outer, clearance + t.depth + t.fitRadialComp);
    guides.skirtOuter = offsetProfileOutward(resolved.outer, clearance + t.depth + t.fitRadialComp + Math.max(lidWall, t.depth + 1.2) + 0.8);
  } else if (lidType === "plug") {
    guides.skirtOuter = offsetProfileInward(resolved.inner, clearance);
    guides.skirtInner = offsetProfileInward(resolved.inner, clearance + lidWall);
    guides.plateOuter = resolved.outer;
  } else {
    guides.plateOuter = resolved.outer;
    if (lipDepth > 0.4) {
      guides.lipOuter = offsetProfileInward(resolved.inner, clearance);
    }
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

export const LID_TYPES = [
  { id: "slip", label: "Slip-over", optionLabel: "Slip-over — skirt outside", hint: "Skirt wraps outside the box walls — classic loose fit." },
  { id: "plug", label: "Inset plug", optionLabel: "Inset plug — skirt inside", hint: "Skirt slides inside the opening; top plate sits flush on the rim." },
  { id: "screw", label: "Screw top", optionLabel: "Screw top — threaded jar lid", hint: "Twist-on jar lid — matching threads print onto the box neck. Round containers only; a 8–12 mm skirt works best.", circleOnly: true },
  { id: "flat", label: "Flat cap", optionLabel: "Flat cap — plate + optional lip", hint: "Plate on the rim with an optional inner lip for alignment — good for storage trays and stacking." },
];

export function normalizeLidType(lidType, shape) {
  if (lidType === "flat") return "flat";
  if (lidType === "plug") return "plug";
  if (lidType === "screw") return !shape || shape === "circle" ? "screw" : "slip";
  return "slip";
}

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
    const segments = circleSegmentsForRadius(outerR);
    return {
      outer: circleVertices(outerR, segments),
      inner: circleVertices(innerR, segments),
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW: diameter, innerD: diameter, innerH, wall, floor, shape: "circle" }),
    };
  }

  if (shape === "oval") {
    const innerW = clamp(params.innerWidth, 10, 500);
    const innerD = clamp(params.innerDepth, 10, 500);
    const innerH = clamp(params.innerHeight, 5, 400);
    const innerRx = innerW / 2;
    const innerRy = innerD / 2;
    const segments = ellipseSegmentsForRadii(innerRx + wall, innerRy + wall);
    const inner = ellipseVertices(innerRx, innerRy, segments);
    const outer = offsetEllipseProfile(inner, innerRx, innerRy, wall);
    return {
      outer,
      inner,
      floor,
      totalH: innerH + floor,
      cavityH: innerH,
      meta: computeMeta({ innerW, innerD, innerH, wall, floor, shape: "oval" }),
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
      const outerFillet = vertexFillet + wall * 0.5;
      const filletSegs = filletArcSegments(outerFillet);
      outer = filletedOutline(outer, outerFillet, filletSegs);
      inner = filletedOutline(inner, vertexFillet, filletSegs);
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
    const cornerSegs = roundedRectCornerSegments(outerEndR);
    return {
      outer: roundedRectOutline(outerL / 2, outerW / 2, outerEndR, cornerSegs),
      inner: roundedRectOutline(innerL / 2, innerW / 2, innerEndR, cornerSegs),
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
      const outerCorner = corner + wall;
      const cornerSegs = roundedRectCornerSegments(outerCorner);
      outer = roundedRectOutline(outerL / 2, outerW / 2, outerCorner, cornerSegs);
      inner = roundedRectOutline(innerL / 2, innerW / 2, corner, cornerSegs);
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
      outer: teardropOutline(innerL + wall * 2, innerW + wall * 2, 72),
      inner: teardropOutline(innerL, innerW, 72),
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
      const outerFillet = vertexFillet + wall * 0.35;
      const filletSegs = filletArcSegments(outerFillet);
      outer = filletedOutline(outer, outerFillet, filletSegs);
      inner = filletedOutline(inner, vertexFillet, filletSegs);
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
    let outer = heartOutline(innerW + wall * 2, innerD + wall * 2, 160);
    let inner = heartOutline(innerW, innerD, 160);
    if (vertexFillet > 0.3) {
      const outerFillet = vertexFillet + wall * 0.35;
      const filletSegs = filletArcSegments(outerFillet);
      outer = filletedOutline(outer, outerFillet, filletSegs);
      inner = filletedOutline(inner, vertexFillet, filletSegs);
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
    const outerCorner = corner + wall;
    const innerCorner = Math.max(corner, 0.5);
    const cornerSegs = roundedRectCornerSegments(outerCorner);
    outer = roundedRectOutline(outerW / 2, outerD / 2, outerCorner, cornerSegs);
    inner = roundedRectOutline(innerW / 2, innerD / 2, innerCorner, cornerSegs);
    metaShape = "rounded";
  } else if (edgeFillet > 0.5) {
    const sharpOuter = [[-outerW / 2, -outerD / 2], [outerW / 2, -outerD / 2], [outerW / 2, outerD / 2], [-outerW / 2, outerD / 2]];
    const sharpInner = [[-innerW / 2, -innerD / 2], [innerW / 2, -innerD / 2], [innerW / 2, innerD / 2], [-innerW / 2, innerD / 2]];
    const outerFillet = edgeFillet + wall;
    const filletSegs = filletArcSegments(outerFillet);
    outer = filletedOutline(sharpOuter, outerFillet, filletSegs);
    inner = filletedOutline(sharpInner, edgeFillet, filletSegs);
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
  } else if (shape === "oval") {
    const a = innerW / 2;
    const b = innerD / 2;
    const outerA = a + wall;
    const outerB = b + wall;
    cavityMl = (Math.PI * a * b * innerH) / 1000;
    outerMl = (Math.PI * outerA * outerB * outerH) / 1000;
    outerW = round1(innerW + wall * 2);
    outerD = round1(innerD + wall * 2);
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
    let accentMesh = null;
    if (params.accentEnabled) {
      accentMesh = buildVaseAccentMesh(params);
      centerPositions(accentMesh.positions, 0, 0);
    }
    return {
      positions: vaseMesh.positions,
      indices: vaseMesh.indices,
      shellMesh: vaseMesh,
      meta,
      totalH: meta.outer.h,
      accentMesh,
      insertMesh: null,
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
      !!params.bookcaseOpenFront,
    );
  }

  centerPositions(mesh.positions, 0, 0);

  if (
    params.lidEnabled &&
    params.shape === "circle" &&
    normalizeLidType(params.lidType, params.shape) === "screw"
  ) {
    appendBodyNeckThreads(mesh.positions, mesh.indices, resolved, params);
  }

  const decorShape = joinerShape;

  if (
    params.insertEnabled &&
    params.insertMount === "slot" &&
    params.insertAxis === "height" &&
    shapeSupportsInsert(decorShape)
  ) {
    appendInsertShelfSlotsToBody(mesh.positions, mesh.indices, resolved.meta, params);
  }

  let accentMesh = null;
  let insertMesh = null;
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
      accentMesh = buildAccentMesh(resolved.meta, params, resolved.outer);
      centerPositions(accentMesh.positions, 0, 0);
    }
    if (params.insertEnabled && shapeSupportsInsert(decorShape)) {
      insertMesh = buildDividerInsert(resolved.meta, params);
      if (insertMesh) centerPositions(insertMesh.positions, 0, 0);
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
      insertMesh,
      labelMesh,
      debossCutterMesh,
    };
  }

  const meta = {
    ...resolved.meta,
    joinerHand: useJoiner ? (params.joinerHand === "right" ? "right" : "left") : undefined,
    joinerScale: useJoiner ? resolveJoinerDims(params, resolved.meta.outer.w, resolved.meta.outer.d).scale : undefined,
  };
  return { ...mesh, shellMesh: mesh, meta, totalH: resolved.totalH, accentMesh, insertMesh: null, labelMesh };
}

export function buildLid(params) {
  const resolved = resolveContainer(params);
  const lidType = normalizeLidType(params.lidType, params.shape);
  const options = {
    clearance: params.lidClearance,
    lidWall: params.lidWall ?? params.wall,
    skirtDepth: params.lidSkirt,
    lidThickness: params.lidThickness,
  };
  let lid;
  if (lidType === "flat") {
    lid = buildFlatLidMesh(resolved.outer, resolved.inner, resolved.meta, params, {
      ...options,
      lipDepth: params.lidLipDepth,
    });
  } else if (lidType === "plug") {
    lid = buildPlugLidMesh(resolved.outer, resolved.inner, options);
  } else if (lidType === "screw") {
    lid = buildScrewLidMesh(profileMaxRadius(resolved.outer), options, params);
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
  const guideParams = { ...params, lidType };
  const shellLid = { positions: lid.positions.slice(), indices: lid.indices.slice() };

  if (params.embossFace === "lid" && shapeSupportsDecor(decorShape) && !params._artPreviewDraft) {
    labelMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "emboss");
    if (labelMesh) centerPositions(labelMesh.positions, 0, 0);
    if (params.embossDeboss) {
      debossCutterMesh = buildLabelEmboss(resolved.meta, params, params.embossSvgText || "", "deboss-cutter");
      if (debossCutterMesh) centerPositions(debossCutterMesh.positions, 0, 0);
      lid = shellLid;
    } else if (labelMesh) {
      lid = mergeMeshes(shellLid, labelMesh);
    }
  }

  centerPositions(lid.positions, 0, 0);
  centerPositions(shellLid.positions, 0, 0);
  return {
    positions: lid.positions,
    indices: lid.indices,
    meta: { ...resolved.meta, part: "lid", lidType },
    lidHeight: lid.lidHeight,
    seatZ: resolved.totalH,
    fitGuides: computeLidFitGuides(resolved, guideParams),
    labelMesh,
    debossCutterMesh,
    shellLid,
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
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) minZ = Math.min(minZ, positions[i]);
  if (Number.isFinite(minZ) && minZ !== 0) {
    for (let i = 2; i < positions.length; i += 3) positions[i] -= minZ;
  }
  return { positions, indices: lid.indices.slice() };
}

/** Map CAD Z-up (print/STL) coords to Three.js Y-up for preview. */
export function toBufferGeometry(THREE, mesh) {
  if (!mesh?.positions?.length || !mesh?.indices?.length) {
    throw new Error("Empty mesh — nothing to preview");
  }
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
  geom.computeBoundingSphere();
  return geom;
}

export const PENCIL_PRESET = {
  innerWidth: 200,
  innerDepth: 72,
  innerHeight: 25,
  wall: 2.4,
  floor: 2.4,
  cornerRadius: 0,
  lidEnabled: false,
  lidType: "slip",
  lidSkirt: 10,
  lidThickness: 2.4,
  lidClearance: 0.35,
  embossFace: "front",
};

export const PENCIL_BOX_PRESET = {
  innerWidth: 200,
  innerDepth: 72,
  innerHeight: 25,
  wall: 2.4,
  floor: 2.4,
  cornerRadius: 4,
  lidEnabled: true,
  lidType: "slip",
  lidSkirt: 12,
  lidThickness: 2.4,
  lidClearance: 0.25,
  insertEnabled: true,
  insertAxis: "length",
  insertCount: 1,
  insertThickness: 2.4,
  insertClearance: 0.35,
  insertTopClearance: 0.6,
  embossFace: "lid",
};

export const FAT_QUARTERS_PRESET = {
  innerWidth: 300,
  innerDepth: 300,
  innerHeight: 55,
  wall: 2.4,
  floor: 2.4,
  cornerRadius: 6,
  lidEnabled: false,
  accentEnabled: false,
  insertEnabled: true,
  insertAxis: "length",
  insertCount: 2,
  insertThickness: 3.2,
  insertClearance: 0.35,
  insertTopClearance: 0.6,
  insertMount: "snap",
  lidType: "flat",
  lidThickness: 2.4,
  lidClearance: 0.35,
  lidLipDepth: 3,
  embossFace: "front",
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
  lidLipDepth: 0,
  joinerEnabled: false,
  joinerHand: "left",
  joinerWidth: 9,
  joinerNeck: 6,
  joinerProtrusion: 4,
  joinerClearance: 0.3,
  joinerAutoScale: true,
  accentEnabled: false,
  accentFace: "rim",
  accentPos: 100,
  accentHeight: 4,
  accentEdge: "straight",
  accentWaveAmp: 3,
  accentWaveCount: 6,
  accentInset: 4,
  accentColor: "#f97316",
  boxColor: "#38bdf8",
  embossTextColor: "#f8fafc",
  embossTextAlign: "left",
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
  insertEnabled: false,
  insertAxis: "length",
  insertCount: 1,
  insertThickness: 2.4,
  insertClearance: 0.35,
  insertTopClearance: 0.6,
  insertTopClearanceAuto: true,
  insertMount: "snap",
  insertSlotDepth: 2,
  insertSlotRamp: 8,
  insertBodyGap: 0.12,
};
