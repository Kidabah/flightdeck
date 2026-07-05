/**
 * Flip / hinge lid — vertical rim knuckles on the back top edge.
 * Pin axis runs along box width (X); insert 1.75 mm filament from either side.
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

/** Odd count → symmetric B-L-B-L-B… positions packed along the back edge. */
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

/**
 * Rim knuckle bracket with pin tunnel along X (filament slides through from either side).
 * Minimal +Y overhang so the lid STL sits flat on the bed after orientLidForPrint.
 */
function appendRimKnuckle(outPos, outIdx, cx, yBack, z0, opts, wall) {
  const { knuckleR: r, knuckleHeight: height, pinD } = opts;
  const z1 = z0 + height;
  const y0 = yBack - r * 0.38;
  const y1 = yBack + 0.2;
  const pinHalf = pinD / 2 + 0.22;
  const cx0 = cx - r;
  const cx1 = cx + r;
  const cap = Math.max(wall, 1.1);

  if (pinHalf * 2 >= r * 1.55) {
    solidBox(outPos, outIdx, cx0, cx1, y0, y1, z0, z1);
    return;
  }

  solidBox(outPos, outIdx, cx0, cx - pinHalf, y0, y1, z0, z1);
  solidBox(outPos, outIdx, cx + pinHalf, cx1, y0, y1, z0, z1);
  solidBox(outPos, outIdx, cx - pinHalf, cx + pinHalf, y0, yBack - 0.04, z0, z1);
  solidBox(outPos, outIdx, cx - pinHalf, cx + pinHalf, yBack + pinHalf + 0.04, y1, z0, z1);
  solidBox(outPos, outIdx, cx0, cx1, y0, y1, z0, z0 + cap);
  solidBox(outPos, outIdx, cx0, cx1, y0, y1, z1 - cap, z1);
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

/** Body knuckles (even indices) — grow upward from the back rim. */
export function appendHingeKnucklesToBody(outPos, outIdx, meta, totalH, params) {
  const opts = resolveHingeOpts(params);
  const wall = clamp(params.wall ?? 2.4, 1.2, 6);
  appendKnuckleRow(outPos, outIdx, meta, totalH, opts, 0, wall);
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

/** Close the open back edge between knuckle gaps (keeps shell watertight). */
function capBackStrap(outPos, outIdx, boxOuter, z0, z1, backY, strapHalfW) {
  const tol = 0.85;
  const n = boxOuter.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (pointsOnBack(boxOuter[i], boxOuter[j], backY, tol)) {
      const mx = (boxOuter[i][0] + boxOuter[j][0]) / 2;
      solidBox(outPos, outIdx, mx - strapHalfW, mx + strapHalfW, backY - 0.15, backY + 0.05, z0, z1);
    }
  }
}

function pointsOnBack(p0, p1, backY, tol) {
  return p0[1] >= backY - tol && p1[1] >= backY - tol;
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

function buildHingeLidShell(outPos, outIdx, boxOuter, boxInner, skirtDepth, lidThickness, clearance, lidWall, opts, wall) {
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
  capBackStrap(outPos, outIdx, boxOuter, skirtDepth, zTop, backY, opts.pitch * 0.35);
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

  buildHingeLidShell(
    positions,
    indices,
    outer,
    inner,
    opts.skirtDepth,
    opts.lidThickness,
    opts.clearance,
    opts.lidWall,
    opts,
    wall,
  );

  const lidHeight = opts.skirtDepth + opts.lidThickness;
  appendKnuckleRow(positions, indices, meta, lidHeight - opts.knuckleHeight, opts, 1, wall);

  const hingeY = od2 - 0.15;
  const seatZ = totalH;

  return {
    positions,
    indices,
    lidHeight,
    hingeMeta: {
      mode: "hinge",
      seatZ,
      hingeY,
      hingeZ: seatZ + opts.knuckleHeight * 0.5,
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

/** Flip lid for print bed — plate down, skirt up; shift so bottom sits on Z=0. */
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
