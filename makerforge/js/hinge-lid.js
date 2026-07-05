/**
 * Flip / hinge lid — pin knuckles on the back edge (+Y), lid opens like a clamshell.
 * Use 1.75 mm filament as a hinge pin through alternating knuckles.
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
  const knuckleR = clamp(params.hingeKnuckleRadius ?? 3, 2.2, 5);
  const knuckleCount = clamp(Math.round(params.hingeKnuckleCount ?? 3), 2, 5);
  const pinD = clamp(params.hingePinDiameter ?? 1.75, 1.5, 2.2);
  return {
    clearance,
    lidWall,
    skirtDepth,
    lidThickness,
    knuckleR,
    knuckleCount,
    pinD,
    pinGap: pinD + clearance * 0.6,
  };
}

function knuckleCenters(count, span) {
  const n = Math.max(2, count);
  const xs = [];
  if (n === 1) return [0];
  const step = span / (n - 1);
  const x0 = -span / 2;
  for (let i = 0; i < n; i++) xs.push(x0 + i * step);
  return xs;
}

function appendKnuckle(outPos, outIdx, cx, y0, z0, r, depth, signY) {
  const y1 = y0 + signY * depth;
  solidBox(outPos, outIdx, cx - r, cx + r, Math.min(y0, y1), Math.max(y0, y1), z0 - r, z0 + r);
}

function appendKnuckleRow(outPos, outIdx, meta, zCenter, opts, parity) {
  const ow2 = meta.outer.w / 2;
  const od2 = meta.outer.d / 2;
  const yFace = od2 - 0.1;
  const span = Math.min(meta.outer.w * 0.78, meta.outer.w - opts.knuckleR * 4);
  const xs = knuckleCenters(opts.knuckleCount, span);
  const depth = opts.knuckleR * 1.55;
  for (let i = 0; i < xs.length; i++) {
    if (i % 2 !== parity) continue;
    appendKnuckle(outPos, outIdx, xs[i], yFace, zCenter, opts.knuckleR, depth, 1);
  }
}

/** Body knuckles (even indices) on back outer wall. */
export function appendHingeKnucklesToBody(outPos, outIdx, meta, totalH, params) {
  const opts = resolveHingeOpts(params);
  const zCenter = totalH - opts.knuckleR - 0.35;
  appendKnuckleRow(outPos, outIdx, meta, zCenter, opts, 0);
}

function profileBackY(points) {
  let maxY = -Infinity;
  for (const [, y] of points) maxY = Math.max(maxY, y);
  return maxY;
}

function extrudeProfileSidesSkipBack(outPos, outIdx, points, z0, z1, backY, outward = true) {
  const n = points.length;
  const tol = 0.85;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (points[i][1] >= backY - tol && points[j][1] >= backY - tol) continue;
    const a = vec3(points[i][0], points[i][1], z0);
    const b = vec3(points[j][0], points[j][1], z0);
    const c = vec3(points[j][0], points[j][1], z1);
    const d = vec3(points[i][0], points[i][1], z1);
    if (outward) pushQuad(outPos, outIdx, a, b, c, d);
    else pushQuad(outPos, outIdx, a, d, c, b);
  }
}

function capRingSkipBack(outPos, outIdx, outer, inner, z, backY, normalUp) {
  const n = outer.length;
  const tol = 0.85;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (outer[i][1] >= backY - tol && outer[j][1] >= backY - tol) continue;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(inner[i][0], inner[i][1], z);
    const i1 = vec3(inner[j][0], inner[j][1], z);
    if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
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

function buildHingeLidShell(outPos, outIdx, boxOuter, boxInner, skirtDepth, lidThickness, clearance, lidWall) {
  const plugOuter = offsetProfileInward(boxInner, clearance);
  const plugInner = offsetProfileInward(boxInner, clearance + lidWall);
  const backY = profileBackY(boxOuter);
  const zTop = skirtDepth + lidThickness;

  capRingSkipBack(outPos, outIdx, plugOuter, plugInner, 0, backY, false);
  extrudeProfileSidesSkipBack(outPos, outIdx, plugOuter, 0, skirtDepth, backY, true);
  extrudeProfileSidesSkipBack(outPos, outIdx, plugInner, 0, skirtDepth, backY, false);
  capRingSkipBack(outPos, outIdx, plugOuter, plugInner, skirtDepth, backY, true);
  extrudeProfileSidesSkipBack(outPos, outIdx, boxOuter, skirtDepth, zTop, backY, true);
  capProfileSolid(outPos, outIdx, boxOuter, zTop, true);
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

export function buildHingeLidMesh(meta, totalH, params) {
  const opts = resolveHingeOpts(params);
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

  buildHingeLidShell(
    positions,
    indices,
    outer,
    inner,
    opts.skirtDepth,
    opts.lidThickness,
    opts.clearance,
    opts.lidWall,
  );

  const zCenter = opts.skirtDepth + opts.lidThickness * 0.5;
  appendKnuckleRow(positions, indices, meta, zCenter, opts, 1);

  const hingeY = od2 - 0.15;
  const seatZ = totalH;
  const lidHeight = opts.skirtDepth + opts.lidThickness;

  return {
    positions,
    indices,
    lidHeight,
    hingeMeta: {
      mode: "hinge",
      seatZ,
      hingeY,
      hingeZ: seatZ,
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
    hingeZ: resolved.totalH,
  };
}
