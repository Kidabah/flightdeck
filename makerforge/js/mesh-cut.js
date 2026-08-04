/**
 * MakerDeck — plane-based mesh cutting.
 *
 * sliceMeshByPlane splits an indexed {positions,indices} mesh into two
 * watertight pieces (`above`/`below` the plane's positive-normal side),
 * capping the new cross-section on both sides. No CSG engine exists
 * elsewhere in the repo — this is a from-scratch triangle-clip + earcut-cap
 * implementation, verified with countOpenEdges (from stl.js) on every cut.
 */
import earcut from "https://esm.sh/earcut@2.2.4";
import { weldMeshVertices, countOpenEdges } from "./stl.js?v=372";

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function computeBounds(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

function boundsDiagonal(positions) {
  const { size } = computeBounds(positions);
  return Math.hypot(size[0], size[1], size[2]) || 1;
}

/** Orthonormal in-plane basis (u,v) such that u × v = normal. */
function buildPlaneBasis(normal) {
  const n = normalize(normal);
  const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  return { u, v };
}

/** Sutherland-Hodgman clip of a (possibly already-clipped) coplanar polygon by a half-space. */
function clipPolygon(pts, dists, keepPositive) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const curr = pts[i], currD = dists[i];
    const next = pts[(i + 1) % n], nextD = dists[(i + 1) % n];
    const currIn = keepPositive ? currD >= 0 : currD <= 0;
    const nextIn = keepPositive ? nextD >= 0 : nextD <= 0;
    if (currIn) out.push({ pt: curr, boundary: currD === 0 });
    if (currIn !== nextIn) {
      const t = currD / (currD - nextD);
      out.push({ pt: lerp3(curr, next, t), boundary: true });
    }
  }
  return out;
}

function pushFan(outPos, poly) {
  for (let i = 1; i < poly.length - 1; i++) {
    outPos.push(...poly[0].pt, ...poly[i].pt, ...poly[i + 1].pt);
  }
}

/** Chain cut-boundary segments into closed loops (each a list of loopPts indices). */
function chainLoops(segList, loopVertexCount) {
  const adj = new Map();
  segList.forEach((seg, si) => {
    for (const vid of seg) {
      if (!adj.has(vid)) adj.set(vid, []);
      adj.get(vid).push(si);
    }
  });
  const used = new Array(segList.length).fill(false);
  const loops = [];
  for (let si = 0; si < segList.length; si++) {
    if (used[si]) continue;
    const loop = [];
    let currentSeg = si;
    const startVid = segList[si][0];
    let currentVid = startVid;
    let open = false;
    let guard = 0;
    while (true) {
      used[currentSeg] = true;
      const [a, b] = segList[currentSeg];
      const nextVid = a === currentVid ? b : a;
      loop.push(currentVid);
      currentVid = nextVid;
      if (currentVid === startVid) break;
      const candidates = (adj.get(currentVid) || []).filter((s) => !used[s]);
      if (!candidates.length) { open = true; break; }
      currentSeg = candidates[0];
      if (++guard > segList.length + loopVertexCount + 5) { open = true; break; }
    }
    if (!open && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function polygon2DArea(pts2d) {
  let a = 0;
  for (let i = 0; i < pts2d.length; i++) {
    const [x1, y1] = pts2d[i];
    const [x2, y2] = pts2d[(i + 1) % pts2d.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function pointInPolygon2D(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const crosses = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function fixWinding(tri, normal) {
  const [a, b, c] = tri;
  const n = cross(sub(b, a), sub(c, a));
  return dot(n, normal) < 0 ? [a, c, b] : [a, b, c];
}

/**
 * Cap one or more coplanar loops. Nested loops (single level) become
 * earcut holes so a cut through a tube-like section doesn't fill solid.
 * Returns triangles wound so their normal points along +normal.
 */
function capLoops(loops, loopPts, planePoint, normal) {
  const { u, v } = buildPlaneBasis(normal);
  const project = (id) => {
    const rel = sub(loopPts[id], planePoint);
    return [dot(rel, u), dot(rel, v)];
  };
  const loops2D = loops.map((loop) => loop.map(project));
  const areas = loops2D.map(polygon2DArea);

  const parent = new Array(loops.length).fill(-1);
  for (let i = 0; i < loops.length; i++) {
    let bestParent = -1, bestArea = Infinity;
    for (let j = 0; j < loops.length; j++) {
      if (i === j || Math.abs(areas[j]) <= Math.abs(areas[i])) continue;
      if (pointInPolygon2D(loops2D[i][0], loops2D[j]) && Math.abs(areas[j]) < bestArea) {
        bestArea = Math.abs(areas[j]);
        bestParent = j;
      }
    }
    parent[i] = bestParent;
  }
  const childrenOf = new Map();
  parent.forEach((p, i) => {
    if (p === -1) return;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(i);
  });

  const outTris = [];
  for (let i = 0; i < loops.length; i++) {
    if (parent[i] !== -1) continue;
    const outerRing2D = loops2D[i];
    const outer3D = loops[i].map((id) => loopPts[id]);
    const outerSign = Math.sign(areas[i]) || 1;
    const holes = childrenOf.get(i) || [];

    let flat = outerRing2D.flat();
    let allPts3D = outer3D.slice();
    const holeIdx = [];
    for (const h of holes) {
      let holeRing2D = loops2D[h];
      let holeRing3D = loops[h].map((id) => loopPts[id]);
      if (Math.sign(areas[h]) === outerSign) {
        holeRing2D = holeRing2D.slice().reverse();
        holeRing3D = holeRing3D.slice().reverse();
      }
      holeIdx.push(flat.length / 2);
      flat = flat.concat(holeRing2D.flat());
      allPts3D = allPts3D.concat(holeRing3D);
    }

    let triIdx = [];
    try { triIdx = earcut(flat, holeIdx.length ? holeIdx : undefined); } catch { triIdx = []; }
    if (!triIdx.length) {
      for (let k = 1; k < outer3D.length - 1; k++) {
        outTris.push(fixWinding([outer3D[0], outer3D[k], outer3D[k + 1]], normal));
      }
      continue;
    }
    for (let t = 0; t < triIdx.length; t += 3) {
      const a = allPts3D[triIdx[t]], b = allPts3D[triIdx[t + 1]], c = allPts3D[triIdx[t + 2]];
      outTris.push(fixWinding([a, b, c], normal));
    }
  }
  return outTris;
}

function finalizeSide(flatPos) {
  if (!flatPos.length) return null;
  const nVerts = flatPos.length / 3;
  const naiveIdx = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) naiveIdx[i] = i;
  const welded = weldMeshVertices(flatPos, naiveIdx);
  const openEdgeCount = countOpenEdges(welded.positions, welded.indices);
  return { positions: welded.positions, indices: welded.indices, openEdgeCount };
}

/**
 * Slice `mesh` by the plane through `planePoint` with unit `planeNormal`.
 * Returns { above, below, loopCount }. `above`/`below` are each either a
 * watertight {positions,indices,openEdgeCount} piece or null if the plane
 * didn't intersect that side (e.g. the plane misses the mesh entirely).
 */
export function sliceMeshByPlane(mesh, planePoint, planeNormal) {
  const positions = mesh.positions;
  const indices = mesh.indices;
  const normal = normalize(planeNormal);
  const eps = boundsDiagonal(positions) * 1e-6;

  const nVerts = positions.length / 3;
  const dist = new Float64Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    let d = dot(sub(p, planePoint), normal);
    if (Math.abs(d) < eps) d = 0;
    dist[i] = d;
  }

  const abovePos = [];
  const belowPos = [];
  const segIdOf = new Map();
  const loopPts = [];
  const segList = [];

  function loopVertexId(pt) {
    const k = `${Math.round(pt[0] / eps)}|${Math.round(pt[1] / eps)}|${Math.round(pt[2] / eps)}`;
    let id = segIdOf.get(k);
    if (id === undefined) {
      id = loopPts.length;
      loopPts.push(pt);
      segIdOf.set(k, id);
    }
    return id;
  }

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
    const pa = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const pb = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
    const pc = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
    const da = dist[ia], db = dist[ib], dc = dist[ic];

    if (da === 0 && db === 0 && dc === 0) continue; // coplanar sliver — no volume, no boundary

    if (da >= 0 && db >= 0 && dc >= 0) { abovePos.push(...pa, ...pb, ...pc); continue; }
    if (da <= 0 && db <= 0 && dc <= 0) { belowPos.push(...pa, ...pb, ...pc); continue; }

    const pts = [pa, pb, pc];
    const dd = [da, db, dc];
    const abovePoly = clipPolygon(pts, dd, true);
    const belowPoly = clipPolygon(pts, dd, false);
    pushFan(abovePos, abovePoly);
    pushFan(belowPos, belowPoly);

    for (let i = 0; i < abovePoly.length; i++) {
      const A = abovePoly[i], B = abovePoly[(i + 1) % abovePoly.length];
      if (A.boundary && B.boundary) {
        const idA = loopVertexId(A.pt);
        const idB = loopVertexId(B.pt);
        if (idA !== idB) segList.push([idA, idB]);
      }
    }
  }

  const loops = chainLoops(segList, loopPts.length);
  const capTris = capLoops(loops, loopPts, planePoint, normal); // wound to +normal

  for (const [a, b, c] of capTris) {
    belowPos.push(...a, ...b, ...c); // below's outward face = +normal, canonical winding
    abovePos.push(...a, ...c, ...b); // above's outward face = -normal, flipped
  }

  return {
    above: finalizeSide(abovePos),
    below: finalizeSide(belowPos),
    loopCount: loops.length,
  };
}
