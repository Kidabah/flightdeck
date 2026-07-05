/**
 * Standalone hinge hardware — snap clip, butt pin, strap door presets.
 */

import {
  buildHingeClipMesh,
  buildHingePinMesh,
  orientClipForPrint,
  orientPinForPrint,
  layoutMeshCopies,
} from "./clip-hinge.js";

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

/** Solid cylinder, axis parallel to +Y. */
function appendCylinderY(outPos, outIdx, y0, y1, x, z, r, segments = 16) {
  if (y1 <= y0 || r <= 0) return;
  const n = Math.max(8, segments);
  const ring0 = [];
  const ring1 = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring0.push(vec3(x + Math.cos(a) * r, y0, z + Math.sin(a) * r));
    ring1.push(vec3(x + Math.cos(a) * r, y1, z + Math.sin(a) * r));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(outPos, outIdx, ring0[i], ring1[i], ring1[j], ring0[j]);
  }
  const c0 = vec3(x, y0, z);
  const c1 = vec3(x, y1, z);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushTri(outPos, outIdx, c0, ring0[j], ring0[i]);
    pushTri(outPos, outIdx, c1, ring1[i], ring1[j]);
  }
}

function appendHollowCylinderY(outPos, outIdx, y0, y1, x, z, outerR, innerR, n = 16) {
  if (innerR >= outerR - 0.25) {
    appendCylinderY(outPos, outIdx, y0, y1, x, z, outerR, n);
    return;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = (i / n) * Math.PI * 2;
    const aj = (j / n) * Math.PI * 2;
    const o0 = vec3(x + Math.cos(ai) * outerR, y0, z + Math.sin(ai) * outerR);
    const o1 = vec3(x + Math.cos(aj) * outerR, y0, z + Math.sin(aj) * outerR);
    const o2 = vec3(x + Math.cos(aj) * outerR, y1, z + Math.sin(aj) * outerR);
    const o3 = vec3(x + Math.cos(ai) * outerR, y1, z + Math.sin(ai) * outerR);
    pushQuad(outPos, outIdx, o0, o3, o2, o1);
    const i0 = vec3(x + Math.cos(ai) * innerR, y0, z + Math.sin(ai) * innerR);
    const i1 = vec3(x + Math.cos(aj) * innerR, y0, z + Math.sin(aj) * innerR);
    const i2 = vec3(x + Math.cos(aj) * innerR, y1, z + Math.sin(aj) * innerR);
    const i3 = vec3(x + Math.cos(ai) * innerR, y1, z + Math.sin(ai) * innerR);
    pushQuad(outPos, outIdx, i0, i1, i2, i3);
  }
  // cap rings with fan from center
  for (const [y, flip] of [[y0, true], [y1, false]]) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ai = (i / n) * Math.PI * 2;
      const aj = (j / n) * Math.PI * 2;
      const o0 = vec3(x + Math.cos(ai) * outerR, y, z + Math.sin(ai) * outerR);
      const o1 = vec3(x + Math.cos(aj) * outerR, y, z + Math.sin(aj) * outerR);
      const i0 = vec3(x + Math.cos(ai) * innerR, y, z + Math.sin(ai) * innerR);
      const i1 = vec3(x + Math.cos(aj) * innerR, y, z + Math.sin(aj) * innerR);
      if (flip) {
        pushTri(outPos, outIdx, vec3(x, y, z), o0, o1);
        pushTri(outPos, outIdx, vec3(x, y, z), i1, i0);
      } else {
        pushTri(outPos, outIdx, vec3(x, y, z), o1, o0);
        pushTri(outPos, outIdx, vec3(x, y, z), i0, i1);
      }
    }
  }
}

function mergeMeshes(a, b) {
  if (!a?.positions?.length) return b;
  if (!b?.positions?.length) return a;
  const offset = a.positions.length / 3;
  return {
    positions: a.positions.concat(b.positions),
    indices: a.indices.concat(b.indices.map((i) => i + offset)),
  };
}

function shiftMesh(mesh, dx, dy, dz) {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += dx;
    positions[i + 1] += dy;
    positions[i + 2] += dz;
  }
  return { positions, indices: mesh.indices.slice() };
}

export const HINGE_STYLE_PRESETS = [
  {
    id: "snapClip",
    label: "Snap clip",
    hint: "C-clips + rails for box lids. Needs Clip hinge on the Lid tab — rails export with body/lid.",
    needsClipLid: true,
  },
  {
    id: "buttPin",
    label: "Butt pin",
    hint: "Classic flat-leaf butt hinge — two plates with alternating knuckles. Screw each leaf to your parts.",
    needsClipLid: false,
  },
  {
    id: "strapDoor",
    label: "Strap door",
    hint: "Strap hinge for doors and lids — one long leaf, one short frame leaf, pin through end barrels.",
    needsClipLid: false,
  },
  {
    id: "flushBarrel",
    label: "Flush barrel",
    hint: "Compact barrel hinge for inset cabinet doors — small plates, tight knuckle stack.",
    needsClipLid: false,
  },
];

export function normalizeHingeStyle(style) {
  return HINGE_STYLE_PRESETS.some((p) => p.id === style) ? style : "snapClip";
}

function resolveLeafOpts(params) {
  return {
    leafL: clamp(params.hingeLeafLength ?? 28, 16, 60),
    leafW: clamp(params.hingeLeafWidth ?? 18, 10, 40),
    leafT: clamp(params.hingeLeafThickness ?? 2.4, 1.6, 5),
    knuckleR: clamp(params.hingeKnuckleRadius ?? 4, 2.5, 7),
    knuckleCount: clamp(Math.round(params.hingeKnuckleCount ?? 3), 3, 7),
    pinD: clamp(params.hingePinDiameter ?? params.clipPinDiameter ?? 3, 1.75, 4),
  };
}

/** Alternating-knuckle pin hinge — leaf A (−X) and leaf B (+X). */
function buildPinLeafHinge(opts, { strap = false } = {}) {
  const positions = [];
  const indices = [];
  const n = opts.knuckleCount % 2 === 0 ? opts.knuckleCount + 1 : opts.knuckleCount;
  const pitch = opts.knuckleR * 1.55;
  const span = (n - 1) * pitch;
  const y0 = -span / 2;
  const pinInner = opts.pinD / 2 + 0.22;
  const leafAL = strap ? opts.leafL * 0.45 : opts.leafL;
  const leafBL = strap ? opts.leafL * 1.35 : opts.leafL;
  const mountGap = opts.knuckleR * 0.35;

  solidBox(positions, indices, -leafAL, -mountGap, 0, opts.leafW, 0, opts.leafT);
  solidBox(positions, indices, mountGap, leafBL, 0, opts.leafW, 0, opts.leafT);

  for (let i = 0; i < n; i++) {
    const cy = y0 + i * pitch;
    const onA = i % 2 === 0;
    const cx = onA ? -mountGap * 0.55 : mountGap * 0.55;
    appendHollowCylinderY(
      positions,
      indices,
      cy - opts.knuckleR * 0.92,
      cy + opts.knuckleR * 0.92,
      cx,
      opts.leafT * 0.5,
      opts.knuckleR,
      pinInner,
      18,
    );
    const webX0 = onA ? -mountGap : mountGap * 0.15;
    const webX1 = onA ? -mountGap * 0.15 : mountGap;
    solidBox(
      positions,
      indices,
      Math.min(webX0, webX1),
      Math.max(webX0, webX1),
      cy - opts.knuckleR * 0.55,
      cy + opts.knuckleR * 0.55,
      0,
      opts.leafT,
    );
  }

  return { positions, indices };
}

function buildButtPinHingeMesh(params) {
  return buildPinLeafHinge(resolveLeafOpts(params));
}

function buildStrapDoorHingeMesh(params) {
  return buildPinLeafHinge(resolveLeafOpts(params), { strap: true });
}

function buildFlushBarrelHingeMesh(params) {
  const opts = resolveLeafOpts(params);
  opts.leafL = clamp(opts.leafL * 0.65, 12, 28);
  opts.leafW = clamp(opts.leafW * 0.85, 10, 24);
  opts.knuckleCount = 3;
  opts.knuckleR = clamp(opts.knuckleR * 0.9, 2.5, 5);
  return buildPinLeafHinge(opts);
}

function buildLeafPinMesh(params) {
  const opts = resolveLeafOpts(params);
  const pinLen = (opts.knuckleCount + 1) * opts.knuckleR * 1.6;
  const positions = [];
  const indices = [];
  appendCylinderY(positions, indices, -pinLen / 2, pinLen / 2, 0, opts.leafT * 0.5, opts.pinD / 2, 16);
  return { positions, indices };
}

export function buildHingeHardwareMesh(style, params) {
  const id = normalizeHingeStyle(style);
  if (id === "snapClip") return buildHingeClipMesh(params);
  if (id === "buttPin") return buildButtPinHingeMesh(params);
  if (id === "strapDoor") return buildStrapDoorHingeMesh(params);
  if (id === "flushBarrel") return buildFlushBarrelHingeMesh(params);
  return buildHingeClipMesh(params);
}

export function buildHingeHardwarePin(style, params) {
  const id = normalizeHingeStyle(style);
  if (id === "snapClip") return buildHingePinMesh(params);
  return buildLeafPinMesh(params);
}

/** Lay hinge flat on bed — knuckle axis vertical, leaves spread in XY. */
export function orientLeafHingeForPrint(mesh) {
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

export function orientHingeHardwareForPrint(style, mesh) {
  const id = normalizeHingeStyle(style);
  if (id === "snapClip") return orientClipForPrint(mesh);
  return orientLeafHingeForPrint(mesh);
}

export function orientHingeHardwarePinForPrint(style, mesh) {
  const id = normalizeHingeStyle(style);
  if (id === "snapClip") return orientPinForPrint(mesh);
  const positions = mesh.positions.slice();
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) minZ = Math.min(minZ, positions[i]);
  if (Number.isFinite(minZ) && minZ !== 0) {
    for (let i = 2; i < positions.length; i += 3) positions[i] -= minZ;
  }
  return { positions, indices: mesh.indices.slice() };
}

function mapPositions(positions, fn) {
  const out = positions.slice();
  for (let i = 0; i < out.length; i += 3) {
    const mapped = fn(out[i], out[i + 1], out[i + 2]);
    out[i] = mapped[0];
    out[i + 1] = mapped[1];
    out[i + 2] = mapped[2];
  }
  return out;
}

function rotatePositionsX(positions, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return mapPositions(positions, (x, y, z) => [x, y * c - z * s, y * s + z * c]);
}

function rotatePositionsY(positions, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return mapPositions(positions, (x, y, z) => [x * c + z * s, y, -x * s + z * c]);
}

function floorAndCenterMesh(mesh) {
  const positions = mesh.positions.slice();
  const indices = mesh.indices.slice();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= minZ;
  }
  return { positions, indices, bounds: { minX: - (maxX - minX) / 2, maxX: (maxX - minX) / 2, minY: - (maxY - minY) / 2, maxY: (maxY - minY) / 2, minZ: 0, maxZ: maxZ - minZ, w: maxX - minX, d: maxY - minY, h: maxZ - minZ } };
}

/** Stand hinge on the bed for viewport preview (knuckle / grip facing the camera). */
export function orientHingeHardwareForPreview(style, mesh) {
  const id = normalizeHingeStyle(style);
  let positions = mesh.positions.slice();
  const indices = mesh.indices.slice();
  if (id === "snapClip") {
    const laid = orientClipForPrint({ positions, indices });
    positions = rotatePositionsY(laid.positions, Math.PI / 2);
  } else {
    positions = rotatePositionsX(positions, Math.PI / 2);
  }
  return floorAndCenterMesh({ positions, indices });
}

export function orientHingeHardwarePinForPreview(style, mesh) {
  const id = normalizeHingeStyle(style);
  if (id === "snapClip") {
    const laid = orientPinForPrint(mesh);
    const positions = rotatePositionsY(laid.positions, Math.PI / 2);
    return floorAndCenterMesh({ positions, indices: laid.indices.slice() });
  }
  return orientHingeHardwarePinForPrint(style, mesh);
}

export function hingeStyleMeta(style) {
  return HINGE_STYLE_PRESETS.find((p) => p.id === normalizeHingeStyle(style)) || HINGE_STYLE_PRESETS[0];
}

export { layoutMeshCopies };
