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

function triArea(positions, ia, ib, ic) {
  return triArea2(
    [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]],
    [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]],
    [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]],
  );
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Count boundary edges (each should be 0 for a closed manifold mesh). */
export function countOpenEdges(positions, indices) {
  const edgeFaces = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    const fi = t / 3;
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(tri[k], tri[(k + 1) % 3]);
      edgeFaces.set(key, [...(edgeFaces.get(key) || []), fi]);
    }
  }
  let open = 0;
  for (const faces of edgeFaces.values()) {
    if (faces.length === 1) open += 1;
  }
  return open;
}

/** Drop bad tris, weld verts, peel non-manifold faces, and verify the shell is closed. */
export function sanitizeMeshForStl(mesh, { strict = true } = {}) {
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  if (!positions?.length || !indices?.length) return null;

  let welded = weldMeshVertices(positions, indices, 0.008);
  let idx = removeDuplicateTriangles(welded.indices);
  idx = removeDegenerateTriangles(welded.positions, idx);
  idx = repairNonManifoldFaces(welded.positions, idx, 8);

  if (!idx.length) return null;

  const open = countOpenEdges(welded.positions, idx);
  if (strict && open > 0) {
    console.warn(`MakerDeck export: ${open} open edge(s) remain after sanitize — mesh may need repair in slicer`);
  }

  return { positions: welded.positions, indices: idx, openEdgeCount: open };
}

function removeDegenerateTriangles(positions, indices) {
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const vertCount = positions.length / 3;
    if (ia < 0 || ib < 0 || ic < 0 || ia >= vertCount || ib >= vertCount || ic >= vertCount) continue;
    if (ia === ib || ib === ic || ia === ic) continue;
    if (triArea(positions, ia, ib, ic) < 1e-8) continue;
    const coords = [ia, ib, ic].flatMap((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    if (!coords.every(Number.isFinite)) continue;
    out.push(ia, ib, ic);
  }
  return out;
}

function repairNonManifoldFaces(positions, indices, maxPasses = 4) {
  let tris = [];
  for (let t = 0; t < indices.length; t += 3) {
    tris.push([indices[t], indices[t + 1], indices[t + 2]]);
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    const edgeFaces = new Map();
    for (let fi = 0; fi < tris.length; fi++) {
      const tri = tris[fi];
      if (!tri) continue;
      const [a, b, c] = tri;
      edgeFaces.set(edgeKey(a, b), [...(edgeFaces.get(edgeKey(a, b)) || []), fi]);
      edgeFaces.set(edgeKey(b, c), [...(edgeFaces.get(edgeKey(b, c)) || []), fi]);
      edgeFaces.set(edgeKey(c, a), [...(edgeFaces.get(edgeKey(c, a)) || []), fi]);
    }

    let removed = false;
    for (const faces of edgeFaces.values()) {
      if (!faces?.length || faces.length <= 2) continue;
      let worst = -1;
      let worstArea = Infinity;
      for (const fi of faces) {
        const tri = tris[fi];
        if (!tri) continue;
        const [a, b, c] = tri;
        const area = triArea(positions, a, b, c);
        if (area < worstArea) {
          worstArea = area;
          worst = fi;
        }
      }
      if (worst < 0) continue;
      tris[worst] = null;
      removed = true;
    }
    if (!removed) break;
    tris = tris.filter(Boolean);
  }

  const out = [];
  for (const tri of tris) {
    if (!tri) continue;
    const [a, b, c] = tri;
    out.push(a, b, c);
  }
  return out;
}

function weldMeshVertices(positions, indices, eps = 0.008) {
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
  if (part === "insert") name = base.replace(/\.stl$/, "-insert.stl");
  if (part === "clip") name = base.replace(/\.stl$/, "-hinge-clip.stl");
  if (part === "clip-pin") name = base.replace(/\.stl$/, "-hinge-pin.stl");
  if (meta.joinerHand) {
    name = name.replace(/\.stl$/, `-link-${meta.joinerHand}.stl`);
  }
  return name;
}

function baseFilename(meta) {
  const { w, d, h } = meta.inner;
  if (meta.shape === "circle") return `circle-${w}x${h}mm.stl`;
  if (meta.shape === "oval") return `oval-${w}x${d}x${h}mm.stl`;
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
