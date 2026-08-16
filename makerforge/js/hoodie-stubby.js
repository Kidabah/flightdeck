/**
 * Panthers hoodie stubby — 150 mm tall, 65 mm well.
 * Loaded as a solid mesh (not the parametric can cup).
 */
import { weldMeshVertices } from "./stl.js?v=374";

export const HOODIE_STUBBY_STL_URL = "models/hoodie-stubby.stl?v=578";
export const HOODIE_WELL_MM = 65;
export const HOODIE_FLOOR_MM = 5;

let cache = null;
let loadPromise = null;

function parseBinaryStlPositions(buffer) {
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  if (84 + nTri * 50 !== buffer.byteLength) {
    throw new Error("Hoodie STL is not a valid binary STL");
  }
  const positions = new Float32Array(nTri * 9);
  let off = 84;
  for (let i = 0; i < nTri; i++) {
    off += 12;
    for (let v = 0; v < 9; v++, off += 4) positions[i * 9 + v] = dv.getFloat32(off, true);
    off += 2;
  }
  return positions;
}

function meshBounds(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function sitOnBedCentered(positions) {
  const b = meshBounds(positions);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = b.min[2];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= cz;
  }
}

function chestFrontY(positions) {
  const ys = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (z >= 58 && z <= 102 && Math.abs(x) < 28 && y < 0) ys.push(y);
  }
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length * 0.12)];
}

function buildChestHeightfield(positions) {
  const xMin = -52, xMax = 52, zMin = 8, zMax = 148;
  const nx = 72, nz = 96;
  const best = new Float32Array(nx * nz);
  best.fill(Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (!(y < 8)) continue;
    const ix = Math.round((x - xMin) / (xMax - xMin) * (nx - 1));
    const iz = Math.round((z - zMin) / (zMax - zMin) * (nz - 1));
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
    const k = iz * nx + ix;
    if (y < best[k]) best[k] = y;
  }
  for (let pass = 0; pass < 8; pass++) {
    let filledAny = false;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iz * nx + ix;
        if (best[k] !== Infinity) continue;
        let acc = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const jx = ix + dx, jz = iz + dz;
            if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
            const v = best[jz * nx + jx];
            if (v === Infinity) continue;
            acc += v;
            n++;
          }
        }
        if (n) {
          best[k] = acc / n;
          filledAny = true;
        }
      }
    }
    if (!filledAny) break;
  }
  return { y: best, xMin, xMax, zMin, zMax, nx, nz };
}

function sampleChestY(field, x, z) {
  if (!field) return null;
  const { y, xMin, xMax, zMin, zMax, nx, nz } = field;
  const fx = (x - xMin) / (xMax - xMin) * (nx - 1);
  const fz = (z - zMin) / (zMax - zMin) * (nz - 1);
  if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return null;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(nx - 1, x0 + 1), z1 = Math.min(nz - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const v00 = y[z0 * nx + x0], v10 = y[z0 * nx + x1], v01 = y[z1 * nx + x0], v11 = y[z1 * nx + x1];
  if (![v00, v10, v01, v11].every(Number.isFinite) || [v00, v10, v01, v11].some((v) => v === Infinity)) {
    const vals = [v00, v10, v01, v11].filter((v) => Number.isFinite(v) && v !== Infinity);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  const v0 = v00 * (1 - tx) + v10 * tx;
  const v1 = v01 * (1 - tx) + v11 * tx;
  return v0 * (1 - tz) + v1 * tz;
}

/** Slide a front-face art slab onto the hoodie chest, keeping slab thickness. */
export function drapeArtOntoHoodieChest(mesh, field, proudMm = 0.22) {
  if (!mesh?.positions?.length || !field || mesh.__hoodieDraped) return mesh;
  const p = mesh.positions;
  let planeY = Infinity;
  for (let i = 1; i < p.length; i += 3) if (p[i] < planeY) planeY = p[i];
  if (!Number.isFinite(planeY)) return mesh;
  for (let i = 0; i < p.length; i += 3) {
    const ySurf = sampleChestY(field, p[i], p[i + 2]);
    if (!Number.isFinite(ySurf)) continue;
    p[i + 1] += (ySurf - proudMm) - planeY;
  }
  mesh.__hoodieDraped = true;
  return mesh;
}

function metaFromMesh(positions) {
  const b = meshBounds(positions);
  const w = b.max[0] - b.min[0];
  const d = b.max[1] - b.min[1];
  const h = b.max[2] - b.min[2];
  const innerH = Math.max(5, h - HOODIE_FLOOR_MM);
  const cavityMl = (Math.PI * (HOODIE_WELL_MM / 2) ** 2 * innerH) / 1000;
  const outerMl = (w * d * h) / 1000;
  const materialMl = Math.max(0, outerMl - cavityMl);
  const chestY = chestFrontY(positions);
  return {
    shape: "stubbyHolder",
    inner: { w: HOODIE_WELL_MM, d: HOODIE_WELL_MM, h: round1(innerH) },
    outer: { w: round1(w), d: round1(d), h: round1(h) },
    cavityMl: round1(cavityMl),
    materialMl: round1(materialMl),
    estGrams: round1(materialMl * 1.24),
    styleLabel: "Hoodie stubby",
    chestY: chestY == null ? undefined : round1(chestY),
  };
}

function meshFromStlBuffer(buffer) {
  const flat = parseBinaryStlPositions(buffer);
  const nVerts = flat.length / 3;
  const naive = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) naive[i] = i;
  const diagonal = (() => {
    const b = meshBounds(flat);
    return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
  })();
  const welded = weldMeshVertices(Array.from(flat), naive, diagonal * 1e-5);
  const positions = welded.positions instanceof Float32Array
    ? welded.positions
    : Float32Array.from(welded.positions);
  const indices = welded.indices instanceof Uint32Array
    ? welded.indices
    : Uint32Array.from(welded.indices);
  sitOnBedCentered(positions);
  return {
    positions,
    indices,
    meta: metaFromMesh(positions),
    chestField: buildChestHeightfield(positions),
  };
}

export function getHoodieStubbyCache() {
  return cache;
}

export async function ensureHoodieStubbyMesh() {
  if (cache?.mesh?.positions?.length) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch(HOODIE_STUBBY_STL_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load hoodie stubby (${res.status})`);
      const buffer = await res.arrayBuffer();
      const loaded = meshFromStlBuffer(buffer);
      cache = {
        mesh: { positions: loaded.positions, indices: loaded.indices },
        meta: loaded.meta,
        chestField: loaded.chestField,
      };
      return cache;
    })();
  }
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}
