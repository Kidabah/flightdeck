/**
 * Binary STL writer from indexed mesh { positions, indices }.
 */

function facetNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function writeFloatLE(view, offset, value) {
  view.setFloat32(offset, value, true);
}

function triArea2(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz);
}

/** Drop invalid/degenerate triangles and weld near-duplicate verts for slicer-friendly STLs. */
export function sanitizeMeshForStl(mesh) {
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  if (!positions?.length || !indices?.length) return null;

  const welded = weldMeshVertices(positions, indices, 0.012);
  const deduped = removeDuplicateTriangles(welded.indices);
  const cleanIdx = [];
  const pos = welded.positions;

  for (let t = 0; t < deduped.length; t += 3) {
    const ia = deduped[t];
    const ib = deduped[t + 1];
    const ic = deduped[t + 2];
    const vertCount = pos.length / 3;
    if (ia < 0 || ib < 0 || ic < 0 || ia >= vertCount || ib >= vertCount || ic >= vertCount) continue;
    if (ia === ib || ib === ic || ia === ic) continue;

    const ax = pos[ia * 3];
    const ay = pos[ia * 3 + 1];
    const az = pos[ia * 3 + 2];
    const bx = pos[ib * 3];
    const by = pos[ib * 3 + 1];
    const bz = pos[ib * 3 + 2];
    const cx = pos[ic * 3];
    const cy = pos[ic * 3 + 1];
    const cz = pos[ic * 3 + 2];
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) continue;

    const a = [ax, ay, az];
    const b = [bx, by, bz];
    const c = [cx, cy, cz];
    if (triArea2(a, b, c) < 1e-8) continue;
    cleanIdx.push(ia, ib, ic);
  }

  if (!cleanIdx.length) return null;
  return { positions: pos, indices: cleanIdx };
}

function weldMeshVertices(positions, indices, eps = 0.012) {
  const table = new Map();
  const outPos = [];

  function indexOf(x, y, z) {
    const k = `${Math.round(x / eps)}|${Math.round(y / eps)}|${Math.round(z / eps)}`;
    let idx = table.get(k);
    if (idx === undefined) {
      idx = outPos.length / 3;
      outPos.push(x, y, z);
      table.set(k, idx);
    }
    return idx;
  }

  const outIdx = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    outIdx.push(
      indexOf(positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]),
      indexOf(positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]),
      indexOf(positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]),
    );
  }
  return { positions: outPos, indices: outIdx };
}

function removeDuplicateTriangles(indices) {
  const seen = new Set();
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]].sort((a, b) => a - b).join("|");
    if (seen.has(tri)) continue;
    seen.add(tri);
    out.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return out;
}

export function meshToStl(mesh, name = "makerdeck") {
  const clean = sanitizeMeshForStl(mesh);
  if (!clean) throw new Error("No valid triangles to export");

  const triCount = clean.indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triCount, true);

  let offset = 84;
  const pos = clean.positions;
  for (let t = 0; t < clean.indices.length; t += 3) {
    const ia = clean.indices[t] * 3;
    const ib = clean.indices[t + 1] * 3;
    const ic = clean.indices[t + 2] * 3;
    const a = [pos[ia], pos[ia + 1], pos[ia + 2]];
    const b = [pos[ib], pos[ib + 1], pos[ib + 2]];
    const c = [pos[ic], pos[ic + 1], pos[ic + 2]];
    const n = facetNormal(a, b, c);
    writeFloatLE(view, offset, n[0]);
    writeFloatLE(view, offset + 4, n[1]);
    writeFloatLE(view, offset + 8, n[2]);
    writeFloatLE(view, offset + 12, a[0]);
    writeFloatLE(view, offset + 16, a[1]);
    writeFloatLE(view, offset + 20, a[2]);
    writeFloatLE(view, offset + 24, b[0]);
    writeFloatLE(view, offset + 28, b[1]);
    writeFloatLE(view, offset + 32, b[2]);
    writeFloatLE(view, offset + 36, c[0]);
    writeFloatLE(view, offset + 40, c[1]);
    writeFloatLE(view, offset + 44, c[2]);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return new Blob([buffer], { type: "application/sla" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function filenameFor(meta, part = "body") {
  const base = baseFilename(meta);
  let name = base;
  if (part === "lid") name = base.replace(/\.stl$/, "-lid.stl");
  if (part === "accent") name = base.replace(/\.stl$/, "-accent.stl");
  if (meta.joinerHand) {
    name = name.replace(/\.stl$/, `-link-${meta.joinerHand}.stl`);
  }
  return name;
}

function baseFilename(meta) {
  const { w, d, h } = meta.inner;
  if (meta.shape === "circle") return `circle-${w}x${h}mm.stl`;
  if (meta.shape === "pencil") return `pencil-${w}x${d}x${h}mm.stl`;
  if (meta.shape === "pencilBox") return `pencil-box-${w}x${d}x${h}mm.stl`;
  if (meta.shape === "teardrop") return `teardrop-${w}x${d}x${h}mm.stl`;
  if (meta.shape === "star") return `star${meta.starPoints || 5}-${w}x${h}mm.stl`;
  if (meta.shape === "heart") return `heart-${w}x${d}x${h}mm.stl`;
  if (meta.shape === "hex") return `hex-${w}x${h}mm.stl`;
  if (meta.shape === "polygon") return `poly${meta.sides}-${w}x${h}mm.stl`;
  if (meta.shape === "rounded") return `round-${w}x${d}x${h}mm.stl`;
  return `box-${w}x${d}x${h}mm.stl`;
}
