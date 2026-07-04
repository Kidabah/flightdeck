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

export function meshToStl(mesh, name = "makerdeck") {
  const triCount = mesh.indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triCount, true);

  let offset = 84;
  const pos = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t] * 3;
    const ib = mesh.indices[t + 1] * 3;
    const ic = mesh.indices[t + 2] * 3;
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
