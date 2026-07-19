/**
 * MakerDeck STL Painter Engine — b502
 * Pure computation module: STL parsing, feature detection, 3MF export.
 */

/* ------------------------------------------------------------------ */
/*  STL Parsing                                                       */
/* ------------------------------------------------------------------ */

export function parseSTLBinary(buffer) {
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  const vertices = new Float32Array(nTri * 9);
  const normals = new Float32Array(nTri * 3);
  let off = 84;
  for (let i = 0; i < nTri; i++) {
    normals[i * 3]     = dv.getFloat32(off, true);
    normals[i * 3 + 1] = dv.getFloat32(off + 4, true);
    normals[i * 3 + 2] = dv.getFloat32(off + 8, true);
    off += 12;
    for (let v = 0; v < 9; v++) {
      vertices[i * 9 + v] = dv.getFloat32(off, true);
      off += 4;
    }
    off += 2; // attribute byte count
  }
  return { vertices, normals, nTri };
}

/* ------------------------------------------------------------------ */
/*  Vertex Deduplication                                              */
/* ------------------------------------------------------------------ */

export function deduplicateVertices(vertices, nTri) {
  const EPS = 1e-6;
  const map = new Map();
  const faces = new Uint32Array(nTri * 3);
  const tempVerts = [];
  let nVerts = 0;

  function key(x, y, z) {
    const sx = (Math.round(x / EPS) * EPS).toFixed(5);
    const sy = (Math.round(y / EPS) * EPS).toFixed(5);
    const sz = (Math.round(z / EPS) * EPS).toFixed(5);
    return `${sx},${sy},${sz}`;
  }

  for (let i = 0; i < nTri; i++) {
    for (let v = 0; v < 3; v++) {
      const off = i * 9 + v * 3;
      const x = vertices[off], y = vertices[off + 1], z = vertices[off + 2];
      const k = key(x, y, z);
      let idx = map.get(k);
      if (idx === undefined) {
        idx = nVerts++;
        map.set(k, idx);
        tempVerts.push(x, y, z);
      }
      faces[i * 3 + v] = idx;
    }
  }

  const verts = new Float32Array(tempVerts);
  return { verts, faces, nVerts };
}

/**
 * One mid-point subdivision pass (each triangle → 4). Paint masks remap
 * so each child keeps its parent's colour. Soft-caps huge meshes.
 * @returns {{ verts, faces, nVerts, nTri, embossMask, debossMask, trimMask }}
 */
export function upgradePaintResolution(verts, faces, nVerts, nTri, masks = {}, opts = {}) {
  const maxFaces = opts.maxFaces ?? 1_500_000;
  if (nTri * 4 > maxFaces) {
    throw new Error(`Resolution upgrade would exceed ${maxFaces.toLocaleString()} faces (now ${nTri.toLocaleString()})`);
  }

  const embossMask = masks.embossMask || new Uint8Array(nTri);
  const debossMask = masks.debossMask || new Uint8Array(nTri);
  const trimMask = masks.trimMask || new Uint8Array(nTri);

  const vertList = new Array(nVerts * 3);
  for (let i = 0; i < nVerts * 3; i++) vertList[i] = verts[i];
  let nextVi = nVerts;
  const midMap = new Map();

  function midpoint(a, b) {
    const key = a < b ? a + ':' + b : b + ':' + a;
    let m = midMap.get(key);
    if (m !== undefined) return m;
    m = nextVi++;
    midMap.set(key, m);
    vertList.push(
      (vertList[a * 3] + vertList[b * 3]) * 0.5,
      (vertList[a * 3 + 1] + vertList[b * 3 + 1]) * 0.5,
      (vertList[a * 3 + 2] + vertList[b * 3 + 2]) * 0.5
    );
    return m;
  }

  const newFaces = new Uint32Array(nTri * 4 * 3);
  const newEmboss = new Uint8Array(nTri * 4);
  const newDeboss = new Uint8Array(nTri * 4);
  const newTrim = new Uint8Array(nTri * 4);
  let fi = 0;

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    const children = [
      [a, ab, ca],
      [ab, b, bc],
      [ca, bc, c],
      [ab, bc, ca],
    ];
    for (const tri of children) {
      newFaces[fi * 3] = tri[0];
      newFaces[fi * 3 + 1] = tri[1];
      newFaces[fi * 3 + 2] = tri[2];
      newEmboss[fi] = embossMask[i];
      newDeboss[fi] = debossMask[i];
      newTrim[fi] = trimMask[i];
      fi++;
    }
  }

  return {
    verts: new Float32Array(vertList),
    faces: newFaces,
    nVerts: nextVi,
    nTri: fi,
    embossMask: newEmboss,
    debossMask: newDeboss,
    trimMask: newTrim,
  };
}

/* ------------------------------------------------------------------ */
/*  Face adjacency + morphological cleanup                            */
/* ------------------------------------------------------------------ */

function edgeKey(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }

export function buildFaceAdj(faces, nTri) {
  const edgeToFace = new Map();
  const faceAdj = new Array(nTri);
  for (let i = 0; i < nTri; i++) faceAdj[i] = [];

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const edges = [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)];
    for (const ek of edges) {
      const prev = edgeToFace.get(ek);
      if (prev !== undefined) {
        faceAdj[prev].push(i);
        faceAdj[i].push(prev);
      }
      edgeToFace.set(ek, i);
    }
  }
  return faceAdj;
}

function morphDilate(mask, faceAdj, nTri, steps) {
  if (steps <= 0) return;
  let cur = mask.slice();
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    for (let i = 0; i < nTri; i++) {
      if (cur[i]) continue;
      for (const nb of faceAdj[i]) {
        if (cur[nb]) { next[i] = 1; break; }
      }
    }
    cur = next;
  }
  mask.set(cur);
}

function morphErode(mask, faceAdj, nTri, steps) {
  if (steps <= 0) return;
  let cur = mask.slice();
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    for (let i = 0; i < nTri; i++) {
      if (!cur[i]) continue;
      for (const nb of faceAdj[i]) {
        if (!cur[nb]) { next[i] = 0; break; }
      }
    }
    cur = next;
  }
  mask.set(cur);
}

/** Dilate then erode — bridge pinholes in thin ridges. */
export function morphClose(mask, faceAdj, nTri, steps) {
  morphDilate(mask, faceAdj, nTri, steps);
  morphErode(mask, faceAdj, nTri, steps);
}

/** Erode then dilate — strip speckles. */
export function morphOpen(mask, faceAdj, nTri, steps) {
  morphErode(mask, faceAdj, nTri, steps);
  morphDilate(mask, faceAdj, nTri, steps);
}

/** Current paint class of a face: 'body' | 'emboss' | 'deboss' | 'trim'. */
export function paintClassOf(i, embossMask, debossMask, trimMask) {
  if (embossMask && embossMask[i]) return 'emboss';
  if (debossMask && debossMask[i]) return 'deboss';
  if (trimMask && trimMask[i]) return 'trim';
  return 'body';
}

/**
 * Flood-fill connected faces that share the seed's paint class.
 * Optional `region` mask limits the fill (box-select then flood).
 * Pass `trimMask` in opts for AMS slot 4.
 * @returns {number[]} face indices
 */
export function floodFillFaces(seed, embossMask, debossMask, nTri, faceAdj, opts = {}) {
  const region = opts.region || null;
  const trimMask = opts.trimMask || null;
  if (seed < 0 || seed >= nTri) return [];
  if (region && !region[seed]) return [];
  const matchClass = paintClassOf(seed, embossMask, debossMask, trimMask);
  const out = [];
  const visited = new Uint8Array(nTri);
  const queue = [seed];
  visited[seed] = 1;
  while (queue.length) {
    const fi = queue.pop();
    out.push(fi);
    for (const nb of faceAdj[fi]) {
      if (visited[nb]) continue;
      if (region && !region[nb]) continue;
      if (paintClassOf(nb, embossMask, debossMask, trimMask) !== matchClass) continue;
      visited[nb] = 1;
      queue.push(nb);
    }
  }
  return out;
}

function faceNormalCentroid(verts, faces, fi) {
  const a = faces[fi * 3], b = faces[fi * 3 + 1], c = faces[fi * 3 + 2];
  const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
  const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
  const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 1e-12) { nx /= len; ny /= len; nz /= len; }
  return {
    nx, ny, nz,
    cx: (ax + bx + cx) / 3,
    cy: (ay + by + cy) / 3,
    cz: (az + bz + cz) / 3,
  };
}

/**
 * Brush / spray dab: faces near hit within `radius` mm, front-facing vs seed.
 * `density` < 1 scatters like spray (distance-weighted random keep).
 * @returns {number[]} face indices
 */
export function brushDabFaces(seed, hitPoint, verts, faces, nTri, faceAdj, opts = {}) {
  const radius = Math.max(0.1, opts.radius ?? 2.5);
  const maxAngleDeg = Math.max(5, Math.min(120, opts.maxAngleDeg ?? 80));
  const density = Math.max(0.05, Math.min(1, opts.density ?? 1));
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  if (seed < 0 || seed >= nTri) return [];

  const cosThr = Math.cos((maxAngleDeg * Math.PI) / 180);
  const seedGeo = faceNormalCentroid(verts, faces, seed);
  const hx = hitPoint.x ?? hitPoint[0];
  const hy = hitPoint.y ?? hitPoint[1];
  const hz = hitPoint.z ?? hitPoint[2];
  const r2 = radius * radius;

  const out = [];
  const queued = new Uint8Array(nTri);
  const queue = [seed];
  queued[seed] = 1;

  while (queue.length) {
    const fi = queue.pop();
    const g = faceNormalCentroid(verts, faces, fi);
    const dx = g.cx - hx, dy = g.cy - hy, dz = g.cz - hz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const dot = g.nx * seedGeo.nx + g.ny * seedGeo.ny + g.nz * seedGeo.nz;
    if (dot < cosThr) continue;

    let keep = true;
    if (density < 1 && fi !== seed) {
      const t = Math.sqrt(d2) / radius;
      keep = rng() < density * (1 - t * 0.85);
    }
    if (keep) out.push(fi);

    for (const nb of faceAdj[fi]) {
      if (queued[nb]) continue;
      queued[nb] = 1;
      queue.push(nb);
    }
  }
  return out;
}

/**
 * Orca-style smart fill: grow from seed through faces within `radius` mm of
 * the hit point whose normals are within `maxAngleDeg` of the seed normal.
 * `samePaintOnly` (default true) stops at emboss/deboss boundaries.
 * @returns {number[]} face indices
 */
export function smartFillFaces(seed, hitPoint, verts, faces, nTri, embossMask, debossMask, faceAdj, opts = {}) {
  const radius = Math.max(0.1, opts.radius ?? 8);
  const maxAngleDeg = Math.max(1, Math.min(120, opts.maxAngleDeg ?? 40));
  const samePaintOnly = opts.samePaintOnly !== false;
  const trimMask = opts.trimMask || null;
  if (seed < 0 || seed >= nTri) return [];

  const cosThr = Math.cos((maxAngleDeg * Math.PI) / 180);
  const seedGeo = faceNormalCentroid(verts, faces, seed);
  const matchClass = paintClassOf(seed, embossMask, debossMask, trimMask);
  const hx = hitPoint.x ?? hitPoint[0];
  const hy = hitPoint.y ?? hitPoint[1];
  const hz = hitPoint.z ?? hitPoint[2];
  const r2 = radius * radius;

  const out = [];
  const queued = new Uint8Array(nTri);
  const queue = [seed];
  queued[seed] = 1;

  while (queue.length) {
    const fi = queue.pop();
    const g = faceNormalCentroid(verts, faces, fi);
    const dx = g.cx - hx, dy = g.cy - hy, dz = g.cz - hz;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    const dot = g.nx * seedGeo.nx + g.ny * seedGeo.ny + g.nz * seedGeo.nz;
    if (dot < cosThr) continue;
    if (samePaintOnly && paintClassOf(fi, embossMask, debossMask, trimMask) !== matchClass) continue;

    out.push(fi);
    for (const nb of faceAdj[fi]) {
      if (queued[nb]) continue;
      queued[nb] = 1;
      queue.push(nb);
    }
  }
  return out;
}

/**
 * Find the rough paint edge band between emboss (paintMask) and body.
 * Seeds = faces that touch the opposite colour; then grow `width` rings
 * into body (default) so you can fill the jagged red fringe with black.
 *
 * @param {Uint8Array} paintMask  emboss (or deboss) paint map
 * @param {Uint32Array} faces
 * @param {number} nTri
 * @param {{ width?: number, growInto?: 'body'|'paint'|'both', region?: Uint8Array|null, faceAdj?: any[] }} opts
 * @returns {Uint8Array} highlight mask (1 = selected edge band)
 */
export function findPaintBoundary(paintMask, faces, nTri, opts = {}) {
  const {
    width = 2,
    growInto = 'body',
    region = null,
    faceAdj: faceAdjIn = null,
  } = opts;
  const faceAdj = faceAdjIn || buildFaceAdj(faces, nTri);
  const inRegion = (i) => !region || region[i];

  const band = new Uint8Array(nTri);
  for (let i = 0; i < nTri; i++) {
    if (!inRegion(i)) continue;
    const painted = paintMask[i] ? 1 : 0;
    for (const nb of faceAdj[i]) {
      if ((paintMask[nb] ? 1 : 0) !== painted) {
        band[i] = 1;
        break;
      }
    }
  }

  // Grow outward; default grows into body so Fill Emboss thickens the web edge.
  let cur = band;
  const steps = Math.max(0, width | 0);
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    for (let i = 0; i < nTri; i++) {
      if (cur[i]) continue;
      if (region && !region[i]) continue;
      if (growInto === 'body' && paintMask[i]) continue;
      if (growInto === 'paint' && !paintMask[i]) continue;
      for (const nb of faceAdj[i]) {
        if (cur[nb]) { next[i] = 1; break; }
      }
    }
    cur = next;
  }
  return cur;
}

/** Neighbour majority vote — cleans stair-step / speckled boundaries. */
export function majorityFilter(mask, faceAdj, nTri, passes = 1) {
  if (passes <= 0) return;
  for (let p = 0; p < passes; p++) {
    const next = mask.slice();
    for (let i = 0; i < nTri; i++) {
      let on = mask[i] ? 1 : 0;
      let total = 1;
      for (const nb of faceAdj[i]) {
        total++;
        if (mask[nb]) on++;
      }
      next[i] = on * 2 >= total ? 1 : 0;
    }
    mask.set(next);
  }
}

function smoothFaceScores(scores, faceAdj, nTri, passes) {
  if (passes <= 0) return scores;
  let cur = scores;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(nTri);
    for (let i = 0; i < nTri; i++) {
      let s = cur[i];
      let n = 1;
      for (const nb of faceAdj[i]) {
        s += cur[nb];
        n++;
      }
      next[i] = s / n;
    }
    cur = next;
  }
  return cur;
}

function growByHysteresis(scores, nTri, faceAdj, highThr, lowThr, positive) {
  const mask = new Uint8Array(nTri);
  const queue = [];
  for (let i = 0; i < nTri; i++) {
    const ok = positive ? scores[i] >= highThr : scores[i] <= -highThr;
    if (ok) {
      mask[i] = 1;
      queue.push(i);
    }
  }
  while (queue.length) {
    const fi = queue.pop();
    for (const nb of faceAdj[fi]) {
      if (mask[nb]) continue;
      const ok = positive ? scores[nb] >= lowThr : scores[nb] <= -lowThr;
      if (ok) {
        mask[nb] = 1;
        queue.push(nb);
      }
    }
  }
  return mask;
}

function percentileCut(sortedAsc, keepTopFraction) {
  if (!sortedAsc.length) return Infinity;
  const keep = Math.min(0.95, Math.max(0.05, keepTopFraction));
  const idx = Math.floor((1 - keep) * (sortedAsc.length - 1));
  return sortedAsc[idx];
}

/* ------------------------------------------------------------------ */
/*  Feature Detection — Laplacian Smoothing Method                    */
/* ------------------------------------------------------------------ */

export function detectFeatures(verts, faces, nVerts, nTri, opts = {}) {
  const {
    iterations = 60,
    weight = 0.5,
    threshold = 0.35,
    mode = 'both', // 'emboss', 'deboss', 'both'
    adaptive = true,
    absFloor = 0.05,
    ridgeTop = true,
    morphCloseSteps = 0,
    morphOpenSteps = 0,
    scoreSmoothPasses = 2,
    hysteresis = 0.55, // lowThr = highThr * hysteresis; 1 = off
    majorityPasses = 1,
  } = opts;

  // 1. Build adjacency
  const adjOffsets = new Uint32Array(nVerts + 1);
  const edgeSet = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) edgeSet[i] = new Set();
  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    edgeSet[a].add(b); edgeSet[a].add(c);
    edgeSet[b].add(a); edgeSet[b].add(c);
    edgeSet[c].add(a); edgeSet[c].add(b);
  }
  let totalAdj = 0;
  for (let i = 0; i < nVerts; i++) {
    adjOffsets[i] = totalAdj;
    totalAdj += edgeSet[i].size;
  }
  adjOffsets[nVerts] = totalAdj;
  const adjList = new Uint32Array(totalAdj);
  for (let i = 0; i < nVerts; i++) {
    let off = adjOffsets[i];
    for (const nb of edgeSet[i]) adjList[off++] = nb;
  }

  // 2. Compute vertex normals (area-weighted)
  const vertNormals = new Float32Array(nVerts * 3);
  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    vertNormals[a * 3] += nx; vertNormals[a * 3 + 1] += ny; vertNormals[a * 3 + 2] += nz;
    vertNormals[b * 3] += nx; vertNormals[b * 3 + 1] += ny; vertNormals[b * 3 + 2] += nz;
    vertNormals[c * 3] += nx; vertNormals[c * 3 + 1] += ny; vertNormals[c * 3 + 2] += nz;
  }
  for (let i = 0; i < nVerts; i++) {
    const off = i * 3;
    const len = Math.sqrt(vertNormals[off] ** 2 + vertNormals[off + 1] ** 2 + vertNormals[off + 2] ** 2);
    if (len > 1e-10) {
      vertNormals[off] /= len;
      vertNormals[off + 1] /= len;
      vertNormals[off + 2] /= len;
    }
  }

  // 3. Laplacian smoothing
  let smooth = new Float32Array(verts);
  let tmp = new Float32Array(nVerts * 3);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nVerts; i++) {
      const start = adjOffsets[i], end = adjOffsets[i + 1];
      const count = end - start;
      if (count === 0) {
        tmp[i * 3] = smooth[i * 3];
        tmp[i * 3 + 1] = smooth[i * 3 + 1];
        tmp[i * 3 + 2] = smooth[i * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (let j = start; j < end; j++) {
        const nb = adjList[j];
        sx += smooth[nb * 3];
        sy += smooth[nb * 3 + 1];
        sz += smooth[nb * 3 + 2];
      }
      sx /= count; sy /= count; sz /= count;
      tmp[i * 3]     = weight * smooth[i * 3]     + (1 - weight) * sx;
      tmp[i * 3 + 1] = weight * smooth[i * 3 + 1] + (1 - weight) * sy;
      tmp[i * 3 + 2] = weight * smooth[i * 3 + 2] + (1 - weight) * sz;
    }
    [smooth, tmp] = [tmp, smooth];
  }

  // 4. Signed displacement per vertex + raw offset vectors
  const displacement = new Float32Array(nVerts);
  const offsetX = new Float32Array(nVerts);
  const offsetY = new Float32Array(nVerts);
  const offsetZ = new Float32Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const dx = verts[i * 3]     - smooth[i * 3];
    const dy = verts[i * 3 + 1] - smooth[i * 3 + 1];
    const dz = verts[i * 3 + 2] - smooth[i * 3 + 2];
    offsetX[i] = dx; offsetY[i] = dy; offsetZ[i] = dz;
    displacement[i] = dx * vertNormals[i * 3] + dy * vertNormals[i * 3 + 1] + dz * vertNormals[i * 3 + 2];
  }

  // 5. Per-face scores (displacement × ridge-top alignment)
  const embossScores = new Float32Array(nTri);
  const debossScores = new Float32Array(nTri);
  const wantEmboss = mode === 'emboss' || mode === 'both';
  const wantDeboss = mode === 'deboss' || mode === 'both';

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let fnx = e1y * e2z - e1z * e2y;
    let fny = e1z * e2x - e1x * e2z;
    let fnz = e1x * e2y - e1y * e2x;
    const flen = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
    if (flen > 1e-12) { fnx /= flen; fny /= flen; fnz /= flen; }

    const avg = (displacement[a] + displacement[b] + displacement[c]) / 3;
    let align = 1;
    if (ridgeTop) {
      let ox = (offsetX[a] + offsetX[b] + offsetX[c]) / 3;
      let oy = (offsetY[a] + offsetY[b] + offsetY[c]) / 3;
      let oz = (offsetZ[a] + offsetZ[b] + offsetZ[c]) / 3;
      const olen = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (olen > 1e-10) {
        ox /= olen; oy /= olen; oz /= olen;
        // Signed alignment: ridge caps face along the offset; side walls do not.
        const dot = fnx * ox + fny * oy + fnz * oz;
        align = 0.12 + 0.88 * Math.max(0, dot);
      } else {
        align = 0.12;
      }
    }
    embossScores[i] = avg > 0 ? avg * align : avg;
    debossScores[i] = avg < 0 ? avg * align : avg;
  }

  // Need face adjacency for score smooth / hysteresis / morph / majority
  const needAdj = scoreSmoothPasses > 0 || hysteresis < 0.999
    || morphCloseSteps > 0 || morphOpenSteps > 0 || majorityPasses > 0;
  const faceAdj = needAdj ? buildFaceAdj(faces, nTri) : null;

  let embossScoresUse = embossScores;
  let debossScoresUse = debossScores;
  if (faceAdj && scoreSmoothPasses > 0) {
    if (wantEmboss) embossScoresUse = smoothFaceScores(embossScores, faceAdj, nTri, scoreSmoothPasses);
    if (wantDeboss) debossScoresUse = smoothFaceScores(debossScores, faceAdj, nTri, scoreSmoothPasses);
  }

  // 6. Resolve thresholds (adaptive percentile or absolute mm)
  let embossThr = threshold;
  let debossThr = threshold;
  if (adaptive) {
    const keepTop = Math.min(0.95, Math.max(0.05, threshold > 1 ? 0.95 : threshold));
    if (wantEmboss) {
      const pos = [];
      for (let i = 0; i < nTri; i++) {
        if (embossScoresUse[i] > absFloor) pos.push(embossScoresUse[i]);
      }
      pos.sort((x, y) => x - y);
      embossThr = Math.max(absFloor, percentileCut(pos, keepTop));
    }
    if (wantDeboss) {
      const neg = [];
      for (let i = 0; i < nTri; i++) {
        if (debossScoresUse[i] < -absFloor) neg.push(-debossScoresUse[i]);
      }
      neg.sort((x, y) => x - y);
      debossThr = Math.max(absFloor, percentileCut(neg, keepTop));
    }
  } else {
    embossThr = Math.max(absFloor, threshold);
    debossThr = Math.max(absFloor, threshold);
  }

  // 7. Classify (hysteresis grow when enabled — smoother region edges)
  let embossMask = new Uint8Array(nTri);
  let debossMask = new Uint8Array(nTri);
  const useHyst = faceAdj && hysteresis > 0 && hysteresis < 0.999;

  if (wantEmboss) {
    if (useHyst) {
      const low = embossThr * hysteresis;
      embossMask = growByHysteresis(embossScoresUse, nTri, faceAdj, embossThr, low, true);
    } else {
      for (let i = 0; i < nTri; i++) {
        if (embossScoresUse[i] >= embossThr) embossMask[i] = 1;
      }
    }
  }
  if (wantDeboss) {
    if (useHyst) {
      const low = debossThr * hysteresis;
      debossMask = growByHysteresis(debossScoresUse, nTri, faceAdj, debossThr, low, false);
    } else {
      for (let i = 0; i < nTri; i++) {
        if (debossScoresUse[i] <= -debossThr) debossMask[i] = 1;
      }
    }
  }

  // 8. Morph + majority cleanup
  if (faceAdj) {
    if (wantEmboss) {
      morphClose(embossMask, faceAdj, nTri, morphCloseSteps);
      morphOpen(embossMask, faceAdj, nTri, morphOpenSteps);
      majorityFilter(embossMask, faceAdj, nTri, majorityPasses);
    }
    if (wantDeboss) {
      morphClose(debossMask, faceAdj, nTri, morphCloseSteps);
      morphOpen(debossMask, faceAdj, nTri, morphOpenSteps);
      majorityFilter(debossMask, faceAdj, nTri, majorityPasses);
    }
  }

  let embossCount = 0, debossCount = 0;
  for (let i = 0; i < nTri; i++) {
    if (embossMask[i]) embossCount++;
    if (debossMask[i]) debossCount++;
  }

  return {
    embossMask,
    debossMask,
    embossCount,
    debossCount,
    embossThr,
    debossThr,
  };
}

/* ------------------------------------------------------------------ */
/*  Cluster Cleaning — BFS Connected Components                       */
/* ------------------------------------------------------------------ */

export function cleanClusters(mask, faces, nTri, verts, minArea, faceAdjIn) {
  const faceAdj = faceAdjIn || buildFaceAdj(faces, nTri);

  function triArea(fi) {
    const a = faces[fi * 3], b = faces[fi * 3 + 1], c = faces[fi * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    return 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
  }

  const visited = new Uint8Array(nTri);
  let removed = 0;

  for (let i = 0; i < nTri; i++) {
    if (!mask[i] || visited[i]) continue;
    const cluster = [];
    const queue = [i];
    visited[i] = 1;
    let area = 0;
    while (queue.length > 0) {
      const fi = queue.pop();
      cluster.push(fi);
      area += triArea(fi);
      for (const nb of faceAdj[fi]) {
        if (!visited[nb] && mask[nb]) {
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
    if (area < minArea) {
      for (const fi of cluster) {
        mask[fi] = 0;
        removed++;
      }
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/*  Minimal Store-Only ZIP Creator                                    */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const enc = new TextEncoder();
  const entries = files.map(f => ({
    name: enc.encode(f.name),
    data: f.data instanceof Uint8Array ? f.data : enc.encode(f.data)
  }));

  let localSize = 0;
  for (const e of entries) localSize += 30 + e.name.length + e.data.length;
  let centralSize = 0;
  for (const e of entries) centralSize += 46 + e.name.length;
  const totalSize = localSize + centralSize + 22;

  const buf = new Uint8Array(totalSize);
  const dv = new DataView(buf.buffer);
  let localOff = 0;
  const offsets = [];

  for (const e of entries) {
    offsets.push(localOff);
    const crc = crc32(e.data);
    dv.setUint32(localOff, 0x04034b50, true); localOff += 4;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0x0021, true); localOff += 2;
    dv.setUint32(localOff, crc, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint16(localOff, e.name.length, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    buf.set(e.name, localOff); localOff += e.name.length;
    buf.set(e.data, localOff); localOff += e.data.length;
  }

  const centralStart = localOff;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const crc = crc32(e.data);
    dv.setUint32(localOff, 0x02014b50, true); localOff += 4;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0x0021, true); localOff += 2;
    dv.setUint32(localOff, crc, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint16(localOff, e.name.length, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint32(localOff, 0, true); localOff += 4;
    dv.setUint32(localOff, offsets[i], true); localOff += 4;
    buf.set(e.name, localOff); localOff += e.name.length;
  }
  const centralEnd = localOff;

  dv.setUint32(localOff, 0x06054b50, true); localOff += 4;
  dv.setUint16(localOff, 0, true); localOff += 2;
  dv.setUint16(localOff, 0, true); localOff += 2;
  dv.setUint16(localOff, entries.length, true); localOff += 2;
  dv.setUint16(localOff, entries.length, true); localOff += 2;
  dv.setUint32(localOff, centralEnd - centralStart, true); localOff += 4;
  dv.setUint32(localOff, centralStart, true); localOff += 4;
  dv.setUint16(localOff, 0, true); localOff += 2;

  return buf;
}

/* ------------------------------------------------------------------ */
/*  3MF Export (OrcaSlicer / BambuStudio Compatible)                  */
/* ------------------------------------------------------------------ */

/** Bambu/Orca paint codes — same table as makerforge/js/3mf.js (slot 1–4). */
const PAINT_CODES = { emboss: '8', deboss: '0C', trim: '1C' };


/* ------------------------------------------------------------------ */
/*  ZIP Reader (for 3MF import)                                       */
/* ------------------------------------------------------------------ */

/**
 * Parse ZIP central directory and extract entries.
 * Handles both stored (method 0) and deflated (method 8) via DecompressionStream.
 */
async function unzipEntries(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  // Find End-of-Central-Directory (scan backwards)
  let eocdOff = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error('Not a valid ZIP file');

  const cdCount = dv.getUint16(eocdOff + 10, true);
  let cdOff = dv.getUint32(eocdOff + 16, true);

  const entries = [];
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(cdOff, true) !== 0x02014b50) break;
    const method = dv.getUint16(cdOff + 10, true);
    const compSize = dv.getUint32(cdOff + 20, true);
    const uncompSize = dv.getUint32(cdOff + 24, true);
    const nameLen = dv.getUint16(cdOff + 28, true);
    const extraLen = dv.getUint16(cdOff + 30, true);
    const commentLen = dv.getUint16(cdOff + 32, true);
    const localOff = dv.getUint32(cdOff + 42, true);
    const name = new TextDecoder().decode(u8.slice(cdOff + 46, cdOff + 46 + nameLen));

    // Local header → skip to data
    const lnameLen = dv.getUint16(localOff + 26, true);
    const lextraLen = dv.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + lnameLen + lextraLen;
    const raw = u8.slice(dataOff, dataOff + compSize);

    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      // Deflate → use browser DecompressionStream
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(raw); writer.close();
      const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      data = new Uint8Array(total);
      let p = 0; for (const c of chunks) { data.set(c, p); p += c.length; }
    } else {
      data = raw; // Unsupported method — try raw
    }

    entries.push({ name, data });
    cdOff += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/*  3MF Import                                                        */
/* ------------------------------------------------------------------ */

/** Bambu/Orca paint_color → slot mapping (reverse of PAINT_CODES). */
const PAINT_IMPORT = { '8': 'emboss', '0C': 'deboss', '0c': 'deboss', '1C': 'trim', '1c': 'trim' };

/**
 * Parse a 3MF file (ZIP) and extract geometry + paint state.
 * @returns {{ verts, faces, nVerts, nTri, embossMask, debossMask, trimMask, colors }}
 */
export async function import3MF(buffer) {
  const entries = await unzipEntries(buffer);

  // Find the object model XML
  const modelEntry = entries.find(e =>
    e.name.endsWith('.model') && (e.name.includes('Objects/') || e.name.includes('objects/'))
  );
  if (!modelEntry) throw new Error('No object model found in 3MF');

  const xml = new TextDecoder().decode(modelEntry.data);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  // Namespace-aware queries (3MF uses a default namespace)
  const ns = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
  const vertexEls = doc.getElementsByTagNameNS(ns, 'vertex');
  // Fallback: try without namespace
  const vertEls = vertexEls.length ? vertexEls : doc.querySelectorAll('vertex');
  const nVerts = vertEls.length;
  const verts = new Float32Array(nVerts * 3);
  for (let i = 0; i < nVerts; i++) {
    const v = vertEls[i];
    verts[i * 3]     = parseFloat(v.getAttribute('x'));
    verts[i * 3 + 1] = parseFloat(v.getAttribute('y'));
    verts[i * 3 + 2] = parseFloat(v.getAttribute('z'));
  }

  const triEls = doc.getElementsByTagNameNS(ns, 'triangle');
  const tEls = triEls.length ? triEls : doc.querySelectorAll('triangle');
  const nTri = tEls.length;
  const faces = new Uint32Array(nTri * 3);
  const embossMask = new Uint8Array(nTri);
  const debossMask = new Uint8Array(nTri);
  const trimMask = new Uint8Array(nTri);

  for (let i = 0; i < nTri; i++) {
    const t = tEls[i];
    faces[i * 3]     = parseInt(t.getAttribute('v1'));
    faces[i * 3 + 1] = parseInt(t.getAttribute('v2'));
    faces[i * 3 + 2] = parseInt(t.getAttribute('v3'));

    const pc = t.getAttribute('paint_color');
    if (pc) {
      const slot = PAINT_IMPORT[pc];
      if (slot === 'emboss') embossMask[i] = 1;
      else if (slot === 'deboss') debossMask[i] = 1;
      else if (slot === 'trim') trimMask[i] = 1;
    }
  }

  // Try to read filament colours from project_settings.config
  let colors = null;
  const settingsEntry = entries.find(e => e.name.includes('project_settings'));
  if (settingsEntry) {
    try {
      const json = JSON.parse(new TextDecoder().decode(settingsEntry.data));
      if (json.filament_colour && json.filament_colour.length >= 4) {
        colors = json.filament_colour.slice(0, 4);
      }
    } catch { /* not JSON or missing */ }
  }

  return { verts, faces, nVerts, nTri, embossMask, debossMask, trimMask, colors };
}

export function export3MF(verts, faces, nVerts, nTri, embossMask, debossMask, options = {}) {
  const {
    bodyColor = '#BBBBBB',
    embossColor = '#FF6600',
    debossColor = '#0066FF',
    trimColor = '#1E40AF',
    trimMask = null,
    filamentType = ['PLA', 'PLA', 'PLA', 'PLA'],
    filamentSettingsId = ['Generic PLA', 'Generic PLA', 'Generic PLA', 'Generic PLA'],
    filamentProfile = 'Generic PLA'
  } = options;

  // Build object_1.model (with painted faces)
  let objVertices = '';
  for (let i = 0; i < nVerts; i++) {
    objVertices += `        <vertex x="${verts[i * 3]}" y="${verts[i * 3 + 1]}" z="${verts[i * 3 + 2]}" />\n`;
  }

  let objTriangles = '';
  for (let i = 0; i < nTri; i++) {
    const v1 = faces[i * 3], v2 = faces[i * 3 + 1], v3 = faces[i * 3 + 2];
    let attrs = '';
    // Slot 1 (body) = default extruder — no paint_color. Slots 2–4 use Bambu codes.
    if (embossMask[i]) {
      attrs = ` paint_color="${PAINT_CODES.emboss}"`;
    } else if (debossMask[i]) {
      attrs = ` paint_color="${PAINT_CODES.deboss}"`;
    } else if (trimMask && trimMask[i]) {
      attrs = ` paint_color="${PAINT_CODES.trim}"`;
    }
    objTriangles += `        <triangle v1="${v1}" v2="${v2}" v3="${v3}"${attrs} />\n`;
  }

  const objectModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
  xmlns:b="http://schemas.bambulab.com/package/2021">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${objVertices}        </vertices>
        <triangles>
${objTriangles}        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const mainModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="1" type="model" p:path="/3D/Objects/object_1.model">
      <components>
        <component objectid="1" p:path="/3D/Objects/object_1.model" />
      </components>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="application/vnd.ms-printing.printticket+xml" />
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/Objects/object_1.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="painted_object" />
    <part id="1" subtype="normal_part">
      <metadata key="name" value="part_1" />
      <metadata key="extruder" value="1" />
    </part>
  </object>
</config>`;

  const colorsArr = [
    bodyColor.toUpperCase(),
    embossColor.toUpperCase(),
    debossColor.toUpperCase(),
    trimColor.toUpperCase(),
  ];
  const filTypes = filamentType.length >= 4
    ? filamentType
    : [...filamentType, ...Array(4 - filamentType.length).fill(filamentType[0] || 'PLA')];
  const filSettings = filamentSettingsId.length >= 4
    ? filamentSettingsId
    : [...filamentSettingsId, ...Array(4 - filamentSettingsId.length).fill(filamentSettingsId[0] || filamentProfile)];
  const projectSettings = JSON.stringify({
    filament_colour: colorsArr,
    filament_settings_id: filSettings,
    filament_type: filTypes
  }, null, 2);

  const zipFiles = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: '3D/3dmodel.model', data: mainModel },
    { name: '3D/_rels/3dmodel.model.rels', data: modelRels },
    { name: '3D/Objects/object_1.model', data: objectModel },
    { name: 'Metadata/model_settings.config', data: modelSettings },
    { name: 'Metadata/project_settings.config', data: projectSettings }
  ];

  const enc = new TextEncoder();
  const prepared = zipFiles.map(f => ({
    name: f.name,
    data: typeof f.data === 'string' ? enc.encode(f.data) : f.data
  }));

  return createZip(prepared);
}

/* ------------------------------------------------------------------ */
/*  Mesh Islands (connected components)                               */
/* ------------------------------------------------------------------ */

/**
 * Find disconnected mesh islands via DFS on face adjacency.
 * @returns {Array<{id:number, faces:Uint32Array, faceCount:number, bbox:{min:[x,y,z], max:[x,y,z], size:[x,y,z]}}>}
 */
export function findMeshIslands(faces, nTri, faceAdj, verts) {
  const visited = new Uint8Array(nTri);
  const islands = [];

  for (let seed = 0; seed < nTri; seed++) {
    if (visited[seed]) continue;
    const stack = [seed];
    const bucket = [];
    visited[seed] = 1;

    while (stack.length) {
      const f = stack.pop();
      bucket.push(f);
      const nb = faceAdj[f];
      if (nb) for (const n of nb) {
        if (!visited[n]) { visited[n] = 1; stack.push(n); }
      }
    }

    // Bounding box of this island
    let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
    let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
    for (const fi of bucket) {
      for (let k = 0; k < 3; k++) {
        const vi = faces[fi * 3 + k];
        const x = verts[vi * 3], y = verts[vi * 3 + 1], z = verts[vi * 3 + 2];
        if (x < mnX) mnX = x; if (x > mxX) mxX = x;
        if (y < mnY) mnY = y; if (y > mxY) mxY = y;
        if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
      }
    }

    islands.push({
      id: islands.length,
      faces: new Uint32Array(bucket),
      faceCount: bucket.length,
      bbox: {
        min: [mnX, mnY, mnZ],
        max: [mxX, mxY, mxZ],
        size: [mxX - mnX, mxY - mnY, mxZ - mnZ],
      },
    });
  }

  islands.sort((a, b) => b.faceCount - a.faceCount);
  islands.forEach((isl, i) => isl.id = i);
  return islands;
}

/**
 * Build per-face → island-id lookup.  arr[faceIdx] = islandId.
 */
export function buildIslandMap(islands, nTri) {
  const map = new Uint32Array(nTri);
  for (const isl of islands) for (const f of isl.faces) map[f] = isl.id;
  return map;
}

/**
 * Flood fill from seed to all connected faces sharing the same paint class.
 */
export function floodFillSameClass(seed, embossMask, debossMask, trimMask, nTri, faceAdj) {
  const cls = paintClassOf(seed, embossMask, debossMask, trimMask);
  const visited = new Uint8Array(nTri);
  const result = [];
  const stack = [seed];
  visited[seed] = 1;

  while (stack.length) {
    const f = stack.pop();
    result.push(f);
    const nb = faceAdj[f];
    if (nb) for (const n of nb) {
      if (!visited[n] && paintClassOf(n, embossMask, debossMask, trimMask) === cls) {
        visited[n] = 1;
        stack.push(n);
      }
    }
  }
  return result;
}

/**
 * Select all faces belonging to the same island as the seed face.
 */
export function selectIsland(seedFace, islandMap, islands) {
  const islandId = islandMap[seedFace];
  const island = islands.find(isl => isl.id === islandId);
  return island ? Array.from(island.faces) : [seedFace];
}

/* ================================================================== */
/*  SYMMETRY MAP                                                      */
/* ================================================================== */

/**
 * Build a mirror map across the X axis (X=centerX).
 * For each face, find the face whose centroid is closest to the
 * reflected centroid. Returns Int32Array where map[i] = mirror face index
 * or -1 if no suitable mirror found within tolerance.
 */
export function buildSymmetryMap(verts, faces, nTri, { tolerance = 0.5 } = {}) {
  // Compute centroids
  const cx = new Float32Array(nTri);
  const cy = new Float32Array(nTri);
  const cz = new Float32Array(nTri);
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < nTri; i++) {
    let sx = 0, sy = 0, sz = 0;
    for (let v = 0; v < 3; v++) {
      const vi = faces[i * 3 + v];
      sx += verts[vi * 3]; sy += verts[vi * 3 + 1]; sz += verts[vi * 3 + 2];
    }
    cx[i] = sx / 3; cy[i] = sy / 3; cz[i] = sz / 3;
    if (cx[i] < minX) minX = cx[i];
    if (cx[i] > maxX) maxX = cx[i];
  }
  const centerX = (minX + maxX) / 2;
  const tolSq = tolerance * tolerance;

  // Spatial grid for fast lookup
  const cellSize = tolerance * 2;
  const grid = new Map();
  function key(x, y, z) {
    return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
  }
  for (let i = 0; i < nTri; i++) {
    const k = key(cx[i], cy[i], cz[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  const map = new Int32Array(nTri).fill(-1);
  for (let i = 0; i < nTri; i++) {
    const mx = 2 * centerX - cx[i]; // mirrored X
    const my = cy[i];
    const mz = cz[i];

    let bestDist = tolSq;
    let bestJ = -1;

    // Search neighbouring cells
    const gx = Math.floor(mx / cellSize), gy = Math.floor(my / cellSize), gz = Math.floor(mz / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const k = `${gx+dx},${gy+dy},${gz+dz}`;
          const bucket = grid.get(k);
          if (!bucket) continue;
          for (const j of bucket) {
            const d = (cx[j]-mx)**2 + (cy[j]-my)**2 + (cz[j]-mz)**2;
            if (d < bestDist) { bestDist = d; bestJ = j; }
          }
        }
      }
    }
    map[i] = bestJ;
  }
  return { map, centerX };
}
