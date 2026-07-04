/**
 * Binary mask → boundary polygons → extruded emboss mesh.
 */

import earcut from "https://esm.sh/earcut@2.2.4";

function perpDist(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(point[0] - lineStart[0], point[1] - lineStart[1]);
  const t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / len2;
  const px = lineStart[0] + t * dx;
  const py = lineStart[1] + t * dy;
  return Math.hypot(point[0] - px, point[1] - py);
}

export function simplifyPolygon(points, tolerance = 1.25) {
  if (points.length <= 3) return points.slice();
  const closed = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
  const ring = closed ? points.slice(0, -1) : points.slice();
  if (ring.length < 3) return points.slice();

  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    if (end <= start + 1) continue;
    let maxDist = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDist(ring[i], ring[start], ring[end]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > tolerance && idx >= 0) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }

  const out = ring.filter((_, i) => keep[i]);
  if (out.length < 3) return points.slice();
  out.push(out[0]);
  return out;
}

/** Round pixel-staircase contours into smoother curves. */
export function chaikinSmooth(points, iterations = 2) {
  if (points.length < 4) return points.slice();
  const closed = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
  let pts = closed ? points.slice(0, -1) : points.slice();
  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      next.push(
        [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]],
        [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]],
      );
    }
    pts = next;
    if (pts.length > 360) break;
  }
  if (!closed) return pts;
  pts.push(pts[0]);
  return pts;
}

/** Simplify pixel stairs, then round corners for print-friendly curves.
 * `smoothPasses` controls Chaikin iterations (1 = light, 2 = medium, 3 = extra smooth).
 */
export function prepareContourRing(poly, simplifyTol = 1, round = true, smoothPasses = 1) {
  const light = simplifyPolygon(poly, simplifyTol);
  const passes = Math.max(0, Math.min(4, smoothPasses));
  if (!round || passes === 0) return light;
  const smooth = chaikinSmooth(light, passes);
  const budget = passes >= 4 ? 560 : passes >= 3 ? 480 : passes >= 2 ? 320 : 220;
  if (smooth.length > budget) return simplifyPolygon(smooth, simplifyTol * 0.35);
  return smooth;
}

export function prepareShapeGroups(groups, simplifyTol = 1, smoothPasses = 1) {
  const holePasses = smoothPasses >= 2 ? Math.max(1, smoothPasses - 1) : 0;
  return groups.map(({ outer, holes }) => ({
    outer: prepareContourRing(outer, simplifyTol, true, smoothPasses),
    holes: holes.map((hole) => prepareContourRing(hole, simplifyTol * 0.5, holePasses > 0, holePasses)),
  }));
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function ringCentroid(ring) {
  const pts = ring.slice(0, -1);
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Group boundary loops into outers with nested holes (donut-safe). */
export function groupPolygonsWithHoles(polygons) {
  const loops = polygons
    .filter((p) => p.length >= 4)
    .map((ring) => ({
      ring,
      area: Math.abs(ringArea(ring)),
      center: ringCentroid(ring),
    }))
    .sort((a, b) => b.area - a.area);

  const used = new Uint8Array(loops.length);
  const groups = [];

  for (let i = 0; i < loops.length; i++) {
    if (used[i]) continue;
    const outer = loops[i];
    used[i] = 1;
    const holes = [];

    for (let j = i + 1; j < loops.length; j++) {
      if (used[j]) continue;
      const candidate = loops[j];
      if (!pointInRing(candidate.center[0], candidate.center[1], outer.ring)) continue;

      const nestedInHole = holes.some((hole) => pointInRing(candidate.center[0], candidate.center[1], hole));
      if (nestedInHole) continue;

      holes.push(candidate.ring);
      used[j] = 1;
    }

    groups.push({ outer: outer.ring, holes });
  }

  return groups;
}

/** Trace outer boundaries of filled cells as closed corner loops. */
export function maskToPolygons(mask, width, height) {
  const edgeSet = new Set();
  const edgeKey = (x1, y1, x2, y2) => `${x1},${y1},${x2},${y2}`;
  const addEdge = (x1, y1, x2, y2) => edgeSet.add(edgeKey(x1, y1, x2, y2));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x === 0 || !mask[y * width + x - 1]) addEdge(x, y + 1, x, y);
      if (x === width - 1 || !mask[y * width + x + 1]) addEdge(x + 1, y, x + 1, y + 1);
      if (y === 0 || !mask[(y - 1) * width + x]) addEdge(x, y, x + 1, y);
      if (y === height - 1 || !mask[(y + 1) * width + x]) addEdge(x + 1, y + 1, x, y + 1);
    }
  }

  const nextFrom = new Map();
  for (const e of edgeSet) {
    const [x1, y1, x2, y2] = e.split(",").map(Number);
    const from = `${x1},${y1}`;
    const list = nextFrom.get(from) || [];
    list.push([x2, y2, e]);
    nextFrom.set(from, list);
  }

  const polygons = [];
  while (edgeSet.size) {
    const first = edgeSet.values().next().value;
    edgeSet.delete(first);
    const [sx, sy, cx, cy] = first.split(",").map(Number);
    const loop = [[sx, sy]];
    let px = cx;
    let py = cy;
    let guard = 0;
    while (guard++ < width * height * 8) {
      loop.push([px, py]);
      if (px === sx && py === sy) break;
      const from = `${px},${py}`;
      const outs = nextFrom.get(from);
      if (!outs?.length) break;
      const pick = outs.find(([, , key]) => edgeSet.has(key)) || outs[0];
      const [nx, ny, key] = pick;
      edgeSet.delete(key);
      const remain = outs.filter((item) => item[2] !== key);
      if (remain.length) nextFrom.set(from, remain);
      else nextFrom.delete(from);
      px = nx;
      py = ny;
    }
    if (loop.length >= 4) polygons.push(loop);
  }

  return polygons;
}

export function polygonsToSvg(groups, width, height) {
  if (!groups.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`;
  }
  const d = groups
    .map(({ outer, holes }) => {
      const parts = [outer, ...holes].map((poly) => {
        const pts = poly.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ");
        return `M ${pts} Z`;
      });
      return parts.join(" ");
    })
    .join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="#000" fill-rule="evenodd" d="${d}"/></svg>`;
}

/** Collect outer + hole perimeters as separate closed stroke loops. */
export function shapeGroupsToStrokePaths(groups) {
  const paths = [];
  for (const { outer, holes } of groups) {
    if (outer?.length >= 4) paths.push(outer);
    for (const hole of holes) {
      if (hole?.length >= 4) paths.push(hole);
    }
  }
  return paths;
}

/** Smooth boundary loops for line-art emboss / SVG export. */
export function prepareStrokePaths(paths, simplifyTol = 1, smoothPasses = 2) {
  const passes = Math.max(1, Math.min(4, smoothPasses));
  return paths.map((path) => prepareContourRing(path, simplifyTol, true, passes));
}

/** Stroke-based SVG (line art) matching professional trace converters. */
export function strokePathsToSvg(paths, width, height, strokeWidth = 1.5) {
  if (!paths.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`;
  }
  const d = paths
    .map((poly) => {
      const pts = poly.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ");
      return `M ${pts} Z`;
    })
    .join(" ");
  const sw = strokeWidth.toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke="#000" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"><path d="${d}"/></svg>`;
}

function pushTri(outIdx, a, b, c) {
  outIdx.push(a, b, c);
}

function pushQuad(outIdx, a, b, c, d) {
  pushTri(outIdx, a, b, c);
  pushTri(outIdx, a, c, d);
}

function ringPoints(ring) {
  return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
}

/** Extrude one shape (outer + holes) as a single solid slab along Y (legacy front-face path). */
export function extrudeShapeGroup(outPos, outIdx, group, y0, y1, mapPoint) {
  const mapTop = (px, py) => {
    const w = mapPoint(px, py);
    return [w[0], y1, w[2]];
  };
  const mapBot = (px, py) => {
    const w = mapPoint(px, py);
    return [w[0], y0, w[2]];
  };
  extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, (w) => [w[0], w[2]]);
}

/** Extrude one shape (outer + holes) between two full 3D surface mappers.
 * `flatCoord(w)` projects a world point to 2D for earcut cap triangulation. */
export function extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, flatCoord) {
  const outerPts = ringPoints(group.outer);
  if (outerPts.length < 3) return;

  const holeRings = group.holes.map(ringPoints).filter((h) => h.length >= 3);
  const flat = [];
  const topWorld = [];
  const botWorld = [];
  const holeIndices = [];

  for (const p of outerPts) {
    topWorld.push(mapTop(p[0], p[1]));
    botWorld.push(mapBot(p[0], p[1]));
    flat.push(...flatCoord(topWorld[topWorld.length - 1]));
  }
  holeIndices.push(outerPts.length);

  for (const hole of holeRings) {
    holeIndices.push(holeIndices[holeIndices.length - 1] + hole.length);
    for (const p of hole) {
      topWorld.push(mapTop(p[0], p[1]));
      botWorld.push(mapBot(p[0], p[1]));
      flat.push(...flatCoord(topWorld[topWorld.length - 1]));
    }
  }

  const tri = earcut(flat, holeIndices.length > 1 ? holeIndices.slice(0, -1) : null);
  if (!tri.length) return;

  const topBase = outPos.length / 3;
  for (const w of topWorld) outPos.push(w[0], w[1], w[2]);
  const botBase = outPos.length / 3;
  for (const w of botWorld) outPos.push(w[0], w[1], w[2]);

  for (let i = 0; i < tri.length; i += 3) {
    pushTri(outIdx, topBase + tri[i], topBase + tri[i + 1], topBase + tri[i + 2]);
    pushTri(outIdx, botBase + tri[i + 2], botBase + tri[i + 1], botBase + tri[i]);
  }

  let vertOffset = 0;
  const wallRings = [outerPts, ...holeRings];
  for (const ring of wallRings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pushQuad(outIdx, botBase + vertOffset + i, botBase + vertOffset + j, topBase + vertOffset + j, topBase + vertOffset + i);
    }
    vertOffset += n;
  }
}
