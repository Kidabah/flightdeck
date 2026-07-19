/**
 * MakerDeck STL Painter Engine — b414
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

/** Current paint class of a face: 'body' | 'emboss' | 'deboss'. */
export function paintClassOf(i, embossMask, debossMask) {
  if (embossMask && embossMask[i]) return 'emboss';
  if (debossMask && debossMask[i]) return 'deboss';
  return 'body';
}

/**
 * Flood-fill connected faces that share the seed's paint class.
 * Optional `region` mask limits the fill (box-select then flood).
 * @returns {number[]} face indices
 */
export function floodFillFaces(seed, embossMask, debossMask, nTri, faceAdj, opts = {}) {
  const region = opts.region || null;
  if (seed < 0 || seed >= nTri) return [];
  if (region && !region[seed]) return [];
  const matchClass = paintClassOf(seed, embossMask, debossMask);
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
      if (paintClassOf(nb, embossMask, debossMask) !== matchClass) continue;
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
 * Orca-style smart fill: grow from seed through faces within `radius` mm of
 * the hit point whose normals are within `maxAngleDeg` of the seed normal.
 * `samePaintOnly` (default true) stops at emboss/deboss boundaries.
 * @returns {number[]} face indices
 */
export function smartFillFaces(seed, hitPoint, verts, faces, nTri, embossMask, debossMask, faceAdj, opts = {}) {
  const radius = Math.max(0.1, opts.radius ?? 8);
  const maxAngleDeg = Math.max(1, Math.min(120, opts.maxAngleDeg ?? 40));
  const samePaintOnly = opts.samePaintOnly !== false;
  if (seed < 0 || seed >= nTri) return [];

  const cosThr = Math.cos((maxAngleDeg * Math.PI) / 180);
  const seedGeo = faceNormalCentroid(verts, faces, seed);
  const matchClass = paintClassOf(seed, embossMask, debossMask);
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
    if (samePaintOnly && paintClassOf(fi, embossMask, debossMask) !== matchClass) continue;

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

export function export3MF(verts, faces, nVerts, nTri, embossMask, debossMask, options = {}) {
  const {
    bodyColor = '#BBBBBB',
    embossColor = '#FF6600',
    debossColor = '#0066FF',
    filamentType = ['PLA', 'PLA', 'PLA'],
    filamentSettingsId = ['Generic PLA', 'Generic PLA', 'Generic PLA'],
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
    if (embossMask[i]) {
      attrs = ' paint_color="8"';
    } else if (debossMask[i]) {
      attrs = ' paint_color="4"';
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

  const colorsArr = [bodyColor.toUpperCase(), embossColor.toUpperCase(), debossColor.toUpperCase()];
  const projectSettings = JSON.stringify({
    filament_colour: colorsArr,
    filament_settings_id: filamentSettingsId,
    filament_type: filamentType
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
