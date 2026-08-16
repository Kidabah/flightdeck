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

function round1(n) {
  return Math.round(n * 10) / 10;
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
  return {
    shape: "stubbyHolder",
    inner: { w: HOODIE_WELL_MM, d: HOODIE_WELL_MM, h: round1(innerH) },
    outer: { w: round1(w), d: round1(d), h: round1(h) },
    cavityMl: round1(cavityMl),
    materialMl: round1(materialMl),
    estGrams: round1(materialMl * 1.24),
    styleLabel: "Hoodie stubby",
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
  return { positions, indices, meta: metaFromMesh(positions) };
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
      cache = { mesh: { positions: loaded.positions, indices: loaded.indices }, meta: loaded.meta };
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
