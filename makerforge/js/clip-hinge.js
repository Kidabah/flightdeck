/**
 * Snap-rail clip hinge — box/lid get clean rim rails; separate clip + pin parts.
 * Print clips on their side; snap onto back rails; pin through knuckle barrels.
 */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function vec3(x, y, z) {
  return [x, y, z];
}

function pushTri(outPos, outIdx, a, b, c) {
  const base = outPos.length / 3;
  outPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  outIdx.push(base, base + 1, base + 2);
}

function pushQuad(outPos, outIdx, a, b, c, d) {
  pushTri(outPos, outIdx, a, b, c);
  pushTri(outPos, outIdx, a, c, d);
}

function solidBox(outPos, outIdx, x0, x1, y0, y1, z0, z1) {
  if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x1, y0, z0), vec3(x1, y1, z0), vec3(x0, y1, z0));
  pushQuad(outPos, outIdx, vec3(x0, y1, z1), vec3(x1, y1, z1), vec3(x1, y0, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x0, y1, z0), vec3(x0, y1, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x1, y0, z1), vec3(x1, y1, z1), vec3(x1, y1, z0), vec3(x1, y0, z0));
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x1, y0, z0), vec3(x1, y0, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x0, y1, z1), vec3(x1, y1, z1), vec3(x1, y1, z0), vec3(x0, y1, z0));
}

/** Solid cylinder along X (manifold). Ring verts shared with end caps. */
function appendCylinderX(outPos, outIdx, x0, x1, y, z, r, segments = 16) {
  if (x1 <= x0 || r <= 0) return;
  const n = Math.max(8, segments);
  const ring0 = [];
  const ring1 = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cy = y + Math.cos(a) * r;
    const cz = z + Math.sin(a) * r;
    ring0.push(vec3(x0, cy, cz));
    ring1.push(vec3(x1, cy, cz));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(outPos, outIdx, ring0[i], ring1[i], ring1[j], ring0[j]);
  }
  const c0 = vec3(x0, y, z);
  const c1 = vec3(x1, y, z);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushTri(outPos, outIdx, c0, ring0[i], ring0[j]);
    pushTri(outPos, outIdx, c1, ring1[j], ring1[i]);
  }
}

function appendRingCapX(outPos, outIdx, x, y, z, outerR, innerR, segs, flip) {
  const n = Math.max(8, segs);
  const quad = (a, b, c, d) => {
    if (flip) pushQuad(outPos, outIdx, a, d, c, b);
    else pushQuad(outPos, outIdx, a, b, c, d);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ao = (i / n) * Math.PI * 2;
    const aj = (j / n) * Math.PI * 2;
    const o0 = vec3(x, y + Math.cos(ao) * outerR, z + Math.sin(ao) * outerR);
    const o1 = vec3(x, y + Math.cos(aj) * outerR, z + Math.sin(aj) * outerR);
    const i0 = vec3(x, y + Math.cos(ao) * innerR, z + Math.sin(ao) * innerR);
    const i1 = vec3(x, y + Math.cos(aj) * innerR, z + Math.sin(aj) * innerR);
    quad(o0, o1, i1, i0);
  }
}

export function shapeSupportsClipHinge(shape) {
  return shape === "rect" || shape === "rounded" || shape === "fatQuarters"
    || shape === "pencilBox" || shape === "pencil";
}

export function resolveClipHingeOpts(params) {
  const railD = clamp(params.clipRailDiameter ?? 4, 3, 6);
  const railLen = clamp(params.clipRailLength ?? 12, 8, 20);
  const pinD = clamp(params.clipPinDiameter ?? 3, 1.75, 4);
  const clipCount = clamp(Math.round(params.clipHingeCount ?? 2), 1, 3);
  const gripClear = clamp(params.lidClearance ?? 0.35, 0.15, 0.8) * 0.5 + 0.2;
  const barrelR = clamp(railD * 1.15, 3.5, 6);
  const barrelLen = clamp(railD * 2.2, 7, 12);
  return {
    railD,
    railLen,
    pinD,
    clipCount,
    gripClear,
    barrelR,
    barrelLen,
    gripInnerR: railD / 2 + gripClear,
  };
}

function railCenters(meta, count, railLen) {
  const margin = railLen * 0.65 + 4;
  const half = meta.outer.w / 2 - margin;
  if (count <= 1) return [0];
  if (count === 2) return [-half * 0.72, half * 0.72];
  return [-half * 0.85, 0, half * 0.85];
}

function appendSnapRail(outPos, outIdx, cx, meta, zTop, opts) {
  const od2 = meta.outer.d / 2;
  const r = opts.railD / 2;
  const y = od2 + r * 0.55;
  const z = zTop - r * 0.35;
  appendCylinderX(outPos, outIdx, cx - opts.railLen / 2, cx + opts.railLen / 2, y, z, r, 14);
}

export function appendClipHingeRailsToBody(outPos, outIdx, meta, totalH, params) {
  const opts = resolveClipHingeOpts(params);
  for (const cx of railCenters(meta, opts.clipCount, opts.railLen)) {
    appendSnapRail(outPos, outIdx, cx, meta, totalH, opts);
  }
}

export function appendClipHingeRailsToLid(outPos, outIdx, meta, lidHeight, params) {
  const opts = resolveClipHingeOpts(params);
  for (const cx of railCenters(meta, opts.clipCount, opts.railLen)) {
    appendSnapRail(outPos, outIdx, cx, meta, lidHeight, opts);
  }
}

/** Cap a C-profile ring at fixed X using a centroid fan (convex band). */
function appendProfileCapX(outPos, outIdx, ringBase, n, flip) {
  const ring = [];
  let cy = 0;
  let cz = 0;
  for (let i = 0; i <= n; i++) {
    const vi = ringBase + i;
    const y = outPos[vi * 3 + 1];
    const z = outPos[vi * 3 + 2];
    ring.push(vi);
    cy += y;
    cz += z;
  }
  for (let i = n; i >= 0; i--) {
    const vi = ringBase + (n + 1) + i;
    const y = outPos[vi * 3 + 1];
    const z = outPos[vi * 3 + 2];
    ring.push(vi);
    cy += y;
    cz += z;
  }
  const x = outPos[ringBase * 3];
  cy /= ring.length;
  cz /= ring.length;
  const ci = outPos.length / 3;
  outPos.push(x, cy, cz);
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    if (flip) pushTriIdx(outIdx, ci, ring[j], ring[i]);
    else pushTriIdx(outIdx, ci, ring[i], ring[j]);
  }
}

function pushTriIdx(outIdx, a, b, c) {
  outIdx.push(a, b, c);
}

function appendCGripExtrusion(outPos, outIdx, x0, x1, innerR, outerR, openDeg, segs) {
  const n = Math.max(10, segs);
  const openRad = (openDeg * Math.PI) / 180;
  const aStart = -Math.PI / 2 + openRad / 2;
  const aEnd = Math.PI / 2 - openRad / 2;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = aStart + t * (aEnd - aStart);
    inner.push([Math.cos(a) * innerR, Math.sin(a) * innerR]);
    outer.push([Math.cos(a) * outerR, Math.sin(a) * outerR]);
  }

  const ring0 = outPos.length / 3;
  for (let i = 0; i <= n; i++) outPos.push(x0, outer[i][0], outer[i][1]);
  for (let i = 0; i <= n; i++) outPos.push(x0, inner[i][0], inner[i][1]);
  const ring1 = outPos.length / 3;
  for (let i = 0; i <= n; i++) outPos.push(x1, outer[i][0], outer[i][1]);
  for (let i = 0; i <= n; i++) outPos.push(x1, inner[i][0], inner[i][1]);

  const o0 = (i) => ring0 + i;
  const i0 = (j) => ring0 + (n + 1) + j;
  const o1 = (i) => ring1 + i;
  const i1 = (j) => ring1 + (n + 1) + j;

  for (let k = 0; k < n; k++) {
    pushQuadIdx(outIdx, i0(k), i0(k + 1), i1(k + 1), i1(k));
    pushQuadIdx(outIdx, o0(k), o1(k), o1(k + 1), o0(k + 1));
  }
  pushQuadIdx(outIdx, i0(0), o0(0), o1(0), i1(0));
  pushQuadIdx(outIdx, i0(n), i1(n), o1(n), o0(n));

  appendProfileCapX(outPos, outIdx, ring0, n, true);
  appendProfileCapX(outPos, outIdx, ring1, n, false);
}

function pushQuadIdx(outIdx, a, b, c, d) {
  pushTriIdx(outIdx, a, b, c);
  pushTriIdx(outIdx, a, c, d);
}

/** Hollow cylinder along X (manifold tube). */
function appendHollowCylinderX(outPos, outIdx, x0, x1, y, z, outerR, innerR, n = 16) {
  if (innerR >= outerR - 0.3) {
    appendCylinderX(outPos, outIdx, x0, x1, y, z, outerR, n);
    return;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = (i / n) * Math.PI * 2;
    const aj = (j / n) * Math.PI * 2;
    const o0 = vec3(x0, y + Math.cos(ai) * outerR, z + Math.sin(ai) * outerR);
    const o1 = vec3(x0, y + Math.cos(aj) * outerR, z + Math.sin(aj) * outerR);
    const o2 = vec3(x1, y + Math.cos(aj) * outerR, z + Math.sin(aj) * outerR);
    const o3 = vec3(x1, y + Math.cos(ai) * outerR, z + Math.sin(ai) * outerR);
    pushQuad(outPos, outIdx, o0, o3, o2, o1);
    const i0 = vec3(x0, y + Math.cos(ai) * innerR, z + Math.sin(ai) * innerR);
    const i1 = vec3(x0, y + Math.cos(aj) * innerR, z + Math.sin(aj) * innerR);
    const i2 = vec3(x1, y + Math.cos(aj) * innerR, z + Math.sin(aj) * innerR);
    const i3 = vec3(x1, y + Math.cos(ai) * innerR, z + Math.sin(ai) * innerR);
    pushQuad(outPos, outIdx, i0, i1, i2, i3);
  }
  appendRingCapX(outPos, outIdx, x0, y, z, outerR, innerR, n, true);
  appendRingCapX(outPos, outIdx, x1, y, z, outerR, innerR, n, false);
}

function appendKnuckleBarrel(outPos, outIdx, x0, x1, y, z, outerR, pinD) {
  appendHollowCylinderX(outPos, outIdx, x0, x1, y, z, outerR, pinD / 2 + 0.22, 18);
}

/** Webs that fuse the C-grip to the knuckle barrel (single printable solid). */
function appendClipFusionWebs(outPos, outIdx, x0, x1, gripOuterR, barrelY, barrelR) {
  const webTop = barrelY + barrelR * 0.92;
  const webBottom = -gripOuterR * 0.35;
  const webZ = Math.min(gripOuterR * 0.55, barrelR * 0.65);
  const inset = Math.min(2.4, (x1 - x0) * 0.18);
  solidBox(outPos, outIdx, x0 + inset, x0 + inset + 2.4, webBottom, webTop, -webZ, webZ);
  solidBox(outPos, outIdx, x1 - inset - 2.4, x1 - inset, webBottom, webTop, -webZ, webZ);
  solidBox(outPos, outIdx, x0 + inset + 0.8, x1 - inset - 0.8, webBottom, webBottom + 1.1, -webZ * 0.55, webZ * 0.55);
}

/** Single snap clip: C-grip + knuckle barrel fused into one solid. */
export function buildHingeClipMesh(params) {
  const opts = resolveClipHingeOpts(params);
  const positions = [];
  const indices = [];
  const gripWall = 1.4;
  const gripOuterR = opts.gripInnerR + gripWall;
  const gripLen = opts.railLen + 1.6;
  const x0 = 0;
  const x1 = gripLen;
  appendCGripExtrusion(
    positions,
    indices,
    x0,
    x1,
    opts.gripInnerR,
    gripOuterR,
    52,
    14,
  );
  const openHalf = (52 * Math.PI) / 180 / 2;
  const gripBottomY = -Math.cos(openHalf) * gripOuterR;
  const barrelY = gripBottomY - opts.barrelR * 0.88;
  appendKnuckleBarrel(positions, indices, x0 + 0.8, x1 - 0.8, barrelY, 0, opts.barrelR, opts.pinD);
  appendClipFusionWebs(positions, indices, x0, x1, gripOuterR, barrelY, opts.barrelR);
  return { positions, indices };
}

export function buildHingePinMesh(params) {
  const opts = resolveClipHingeOpts(params);
  const pinLen = opts.railLen + opts.barrelR * 2.4;
  const positions = [];
  const indices = [];
  appendCylinderX(positions, indices, 0, pinLen, 0, 0, opts.pinD / 2, 16);
  return { positions, indices };
}

/** Lay clip on the bed: barrel down, grip arch above, length along X. */
export function orientClipForPrint(mesh) {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    positions[i] = x;
    positions[i + 1] = z;
    positions[i + 2] = -y;
  }
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) minZ = Math.min(minZ, positions[i]);
  if (Number.isFinite(minZ) && minZ !== 0) {
    for (let i = 2; i < positions.length; i += 3) positions[i] -= minZ;
  }
  return { positions, indices: mesh.indices.slice() };
}

/** Duplicate a mesh on the bed (for printing multiple clips/pins per file). */
export function layoutMeshCopies(mesh, count, pitchX, pitchY = pitchX) {
  if (count <= 1) return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
  const positions = [];
  const indices = [];
  const cols = Math.ceil(Math.sqrt(count));
  for (let n = 0; n < count; n++) {
    const col = n % cols;
    const row = Math.floor(n / cols);
    const ox = col * pitchX;
    const oy = row * pitchY;
    const base = positions.length / 3;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      positions.push(
        mesh.positions[i] + ox,
        mesh.positions[i + 1] + oy,
        mesh.positions[i + 2],
      );
    }
    for (const idx of mesh.indices) indices.push(idx + base);
  }
  return { positions, indices };
}

export function orientPinForPrint(mesh) {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) minZ = Math.min(minZ, positions[i]);
  if (Number.isFinite(minZ) && minZ !== 0) {
    for (let i = 2; i < positions.length; i += 3) positions[i] -= minZ;
  }
  return { positions, indices: mesh.indices.slice() };
}

export function computeClipHingeMeta(resolved, params, lidHeight) {
  const opts = resolveClipHingeOpts(params);
  const od2 = resolved.meta.outer.d / 2;
  return {
    mode: "clip",
    seatZ: resolved.totalH,
    lidHeight,
    clipCount: opts.clipCount,
    railD: opts.railD,
    pinD: opts.pinD,
    railCenters: railCenters(resolved.meta, opts.clipCount, opts.railLen),
    hingeY: od2 + opts.railD * 0.55,
    hingeZ: resolved.totalH,
    knuckleHeight: opts.barrelLen,
    restAngle: -0.35,
    openAngle: -2.1,
  };
}
