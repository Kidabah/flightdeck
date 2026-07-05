/**
 * Flip / hinge lid — vertical rim knuckles on the back top edge.
 * All export meshes are closed (manifold); pin tunnels use capped end faces.
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

export function shapeSupportsHingeLid(shape) {
  return shape === "rect" || shape === "rounded" || shape === "fatQuarters"
    || shape === "pencilBox" || shape === "pencil";
}

export function resolveHingeOpts(params) {
  const clearance = clamp(params.lidClearance ?? 0.35, 0.15, 0.8);
  const lidWall = clamp(params.lidWall ?? params.wall ?? 2.4, 1.2, 6);
  const skirtDepth = clamp(params.lidSkirt ?? 8, 4, 18);
  const lidThickness = clamp(params.lidThickness ?? 2.4, 1.2, 6);
  const knuckleR = clamp(params.hingeKnuckleRadius ?? 4, 3, 6);
  const knuckleCount = clamp(Math.round(params.hingeKnuckleCount ?? 5), 3, 7);
  const pinD = clamp(params.hingePinDiameter ?? 1.75, 1.5, 2.2);
  const knuckleHeight = knuckleR * 2.1;
  const pitch = pinD + 2 * knuckleR + clearance * 0.45;
  return {
    clearance,
    lidWall,
    skirtDepth,
    lidThickness,
    knuckleR,
    knuckleCount,
    pinD,
    knuckleHeight,
    pitch,
    pinGap: pinD + clearance * 0.5,
  };
}

function knuckleCenters(opts, outerW) {
  const n = opts.knuckleCount % 2 === 0 ? opts.knuckleCount + 1 : opts.knuckleCount;
  const pitch = opts.pitch;
  const span = (n - 1) * pitch;
  const maxSpan = outerW - opts.knuckleR * 2.5;
  const scale = span > maxSpan ? maxSpan / span : 1;
  const xs = [];
  for (let i = 0; i < n; i++) xs.push((-span / 2 + i * pitch) * scale);
  return xs;
}

/** Washer-shaped end cap on a constant-X face — closes the pin tunnel for manifold export. */
function appendPinEndCap(outPos, outIdx, x, y0, y1, z0, z1, hy0, hy1, hz0, hz1, flip) {
  const quad = (a, b, c, d) => {
    if (flip) pushQuad(outPos, outIdx, a, d, c, b);
    else pushQuad(outPos, outIdx, a, b, c, d);
  };
  if (hz0 > z0) quad(vec3(x, y0, z0), vec3(x, y1, z0), vec3(x, y1, hz0), vec3(x, y0, hz0));
  if (hz1 < z1) quad(vec3(x, y0, hz1), vec3(x, y1, hz1), vec3(x, y1, z1), vec3(x, y0, z1));
  if (hy0 > y0) quad(vec3(x, y0, hz0), vec3(x, hy0, hz0), vec3(x, hy0, hz1), vec3(x, y0, hz1));
  if (hy1 < y1) quad(vec3(x, hy1, hz0), vec3(x, y1, hz0), vec3(x, y1, hz1), vec3(x, hy1, hz1));
}

/** Closed rim knuckle with capped pin tunnel (filament passes through bore, mesh stays watertight). */
function appendRimKnuckle(outPos, outIdx, cx, yBack, z0, opts, wall) {
  const { knuckleR: r, knuckleHeight: height, pinD } = opts;
  const z1 = z0 + height;
  const y0 = yBack - r * 0.38;
  const y1 = yBack + 0.2;
  const pinHalf = pinD / 2 + 0.22;
  const cx0 = cx - r;
  const cx1 = cx + r;
  const cap = Math.max(wall, 1.1);
  const holeZ0 = z0 + cap;
  const holeZ1 = z1 - cap;
  const holeY0 = yBack - 0.04;
  const holeY1 = yBack + pinHalf + 0.04;

  if (pinHalf * 2 >= r * 1.55) {
    solidBox(outPos, outIdx, cx0, cx1, y0, y1, z0, z1);
    return;
  }

  solidBox(outPos, outIdx, cx0, cx - pinHalf, y0, y1, z0, z1);
  solidBox(outPos, outIdx, cx + pinHalf, cx1, y0, y1, z0, z1);
  solidBox(outPos, outIdx, cx - pinHalf, cx + pinHalf, y0, holeY0, z0, z1);
  solidBox(outPos, outIdx, cx - pinHalf, cx + pinHalf, holeY1, y1, z0, z1);
  solidBox(outPos, outIdx, cx0, cx1, y0, y1, z0, z0 + cap);
  solidBox(outPos, outIdx, cx0, cx1, y0, y1, z1 - cap, z1);
  appendPinEndCap(outPos, outIdx, cx0, y0, y1, z0, z1, holeY0, holeY1, holeZ0, holeZ1, true);
  appendPinEndCap(outPos, outIdx, cx1, y0, y1, z0, z1, holeY0, holeY1, holeZ0, holeZ1, false);
}

function appendKnuckleRow(outPos, outIdx, meta, z0, opts, parity, wall) {
  const od2 = meta.outer.d / 2;
  const yBack = od2 - 0.04;
  const xs = knuckleCenters(opts, meta.outer.w);
  for (let i = 0; i < xs.length; i++) {
    if (i % 2 !== parity) continue;
    appendRimKnuckle(outPos, outIdx, xs[i], yBack, z0, opts, wall);
  }
}

export function appendHingeKnucklesToBody(outPos, outIdx, meta, totalH, params) {
  const opts = resolveHingeOpts(params);
  const wall = clamp(params.wall ?? 2.4, 1.2, 6);
  appendKnuckleRow(outPos, outIdx, meta, totalH, opts, 0, wall);
}

function offsetProfileInward(points, offset) {
  if (offset <= 0) return points.map((p) => [p[0], p[1]]);
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x - (dx / len) * offset, y - (dy / len) * offset];
  });
}

function extrudeProfileSides(outPos, outIdx, points, z0, z1, outward = true) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = vec3(points[i][0], points[i][1], z0);
    const b = vec3(points[j][0], points[j][1], z0);
    const c = vec3(points[j][0], points[j][1], z1);
    const d = vec3(points[i][0], points[i][1], z1);
    if (outward) pushQuad(outPos, outIdx, a, b, c, d);
    else pushQuad(outPos, outIdx, a, d, c, b);
  }
}

function capRing(outPos, outIdx, outer, inner, z, normalUp) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(inner[i][0], inner[i][1], z);
    const i1 = vec3(inner[j][0], inner[j][1], z);
    if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

function capProfileSolid(outPos, outIdx, points, z, normalUp) {
  const n = points.length;
  for (let i = 1; i < n - 1; i++) {
    const a = vec3(points[0][0], points[0][1], z);
    const b = vec3(points[i][0], points[i][1], z);
    const c = vec3(points[i + 1][0], points[i + 1][1], z);
    if (normalUp) pushTri(outPos, outIdx, a, b, c);
    else pushTri(outPos, outIdx, a, c, b);
  }
}

/** Closed plug-style lid shell (no open back — knuckles sit on the outer rim). */
function buildClosedHingeLidShell(outPos, outIdx, boxOuter, boxInner, skirtDepth, lidThickness, clearance, lidWall) {
  const plugOuter = offsetProfileInward(boxInner, clearance);
  const plugInner = offsetProfileInward(boxInner, clearance + lidWall);
  const zTop = skirtDepth + lidThickness;

  capRing(outPos, outIdx, plugOuter, plugInner, 0, false);
  extrudeProfileSides(outPos, outIdx, plugOuter, 0, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, plugInner, 0, skirtDepth, false);
  capRing(outPos, outIdx, plugOuter, plugInner, skirtDepth, true);
  extrudeProfileSides(outPos, outIdx, boxOuter, skirtDepth, zTop, true);
  capProfileSolid(outPos, outIdx, boxOuter, zTop, true);
}

export function buildHingeLidMesh(meta, totalH, params) {
  const opts = resolveHingeOpts(params);
  const wall = clamp(params.wall ?? params.lidWall ?? 2.4, 1.2, 6);
  const positions = [];
  const indices = [];
  const iw2 = meta.inner.w / 2;
  const id2 = meta.inner.d / 2;
  const ow2 = meta.outer.w / 2;
  const od2 = meta.outer.d / 2;

  const outer = [
    [-ow2, -od2],
    [ow2, -od2],
    [ow2, od2],
    [-ow2, od2],
  ];
  const inner = [
    [-iw2, -id2],
    [iw2, -id2],
    [iw2, id2],
    [-iw2, id2],
  ];

  buildClosedHingeLidShell(
    positions,
    indices,
    outer,
    inner,
    opts.skirtDepth,
    opts.lidThickness,
    opts.clearance,
    opts.lidWall,
  );

  const lidHeight = opts.skirtDepth + opts.lidThickness;
  appendKnuckleRow(positions, indices, meta, lidHeight - opts.knuckleHeight, opts, 1, wall);

  return {
    positions,
    indices,
    lidHeight,
    hingeMeta: {
      mode: "hinge",
      seatZ: totalH,
      hingeY: od2 - 0.15,
      hingeZ: totalH + opts.knuckleHeight * 0.5,
      knuckleHeight: opts.knuckleHeight,
      lidArm: lidHeight * 0.92,
      openAngle: -2.15,
      closedAngle: 0,
      restAngle: -0.35,
    },
  };
}

export function computeHingeFitGuides(resolved, params) {
  const opts = resolveHingeOpts(params);
  const od2 = resolved.meta.outer.d / 2;
  return {
    seatZ: resolved.totalH,
    lidType: "hinge",
    skirtDepth: opts.skirtDepth,
    lidHeight: opts.skirtDepth + opts.lidThickness,
    boxOuter: resolved.outer,
    boxInner: resolved.inner,
    plateOuter: resolved.outer,
    hingeY: od2 - 0.15,
    hingeZ: resolved.totalH + opts.knuckleHeight * 0.5,
  };
}

export function orientHingeLidForPrint(lid) {
  let h = lid.lidHeight;
  if (!Number.isFinite(h) || h <= 0) {
    h = 0;
    for (let i = 2; i < lid.positions.length; i += 3) h = Math.max(h, lid.positions[i]);
  }
  const positions = lid.positions.slice();
  for (let i = 2; i < positions.length; i += 3) positions[i] = h - positions[i];
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) minZ = Math.min(minZ, positions[i]);
  if (Number.isFinite(minZ) && minZ !== 0) {
    for (let i = 2; i < positions.length; i += 3) positions[i] -= minZ;
  }
  return { positions, indices: lid.indices.slice() };
}
