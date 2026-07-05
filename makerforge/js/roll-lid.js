/**
 * Roll / bayonet lid — push down + quarter-turn lock for round-ish containers.
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

export function shapeSupportsRollLid(shape) {
  return shape === "circle" || shape === "oval" || shape === "hex" || shape === "polygon";
}

export function resolveRollOpts(params) {
  const clearance = clamp(params.lidClearance ?? 0.35, 0.15, 0.8);
  const lidWall = clamp(params.lidWall ?? params.wall ?? 2.4, 1.2, 6);
  const skirtDepth = clamp(params.lidSkirt ?? 8, 5, 16);
  const lidThickness = clamp(params.lidThickness ?? 2.4, 1.2, 6);
  const lugCount = clamp(Math.round(params.rollLugCount ?? 3), 2, 4);
  const turnDeg = clamp(params.rollTurnDegrees ?? 55, 30, 90);
  const lugDepth = clamp(params.rollLugDepth ?? 1.6, 1, 3);
  const lugHeight = clamp(params.rollLugHeight ?? 2.2, 1.2, 4);
  return {
    clearance,
    lidWall,
    skirtDepth,
    lidThickness,
    lugCount,
    turnDeg,
    lugDepth,
    lugHeight,
  };
}

function circleVertices(radius, segments) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = ((Math.PI * 2) / segments) * i;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
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

function appendRadialLug(outPos, outIdx, angle, innerR, lugDepth, lugHeight, z0, z1) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const r0 = innerR - lugDepth * 0.25;
  const r1 = innerR + lugDepth;
  const tang = lugDepth * 0.55;
  const px = ca;
  const py = sa;
  const tx = -sa;
  const ty = ca;
  const x0 = px * r0 + tx * tang;
  const y0 = py * r0 + ty * tang;
  const x1 = px * r1 - tx * tang;
  const y1 = py * r1 - ty * tang;
  const x2 = px * r1 + tx * tang;
  const y2 = py * r1 + ty * tang;
  const x3 = px * r0 - tx * tang;
  const y3 = py * r0 - ty * tang;
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x1, y1, z0), vec3(x2, y2, z0), vec3(x3, y3, z0));
  pushQuad(outPos, outIdx, vec3(x0, y0, z1), vec3(x3, y3, z1), vec3(x2, y2, z1), vec3(x1, y1, z1));
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x0, y0, z1), vec3(x1, y1, z1), vec3(x1, y1, z0));
  pushQuad(outPos, outIdx, vec3(x2, y2, z0), vec3(x2, y2, z1), vec3(x3, y3, z1), vec3(x3, y3, z0));
  pushQuad(outPos, outIdx, vec3(x1, y1, z0), vec3(x1, y1, z1), vec3(x2, y2, z1), vec3(x2, y2, z0));
}

function appendBayonetTrack(outPos, outIdx, angle, innerR, wall, totalH, opts) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const trackW = opts.lugDepth + opts.clearance + 0.5;
  const drop = opts.skirtDepth + 1.2;
  const zTop = totalH - 0.2;
  const zBay = totalH - drop;
  const zBot = totalH - drop - opts.lugHeight - 0.8;
  const rInner = innerR + 0.15;
  const rOuter = innerR + wall - 0.25;
  const turn = (opts.turnDeg * Math.PI) / 180;
  const steps = Math.max(3, Math.round(opts.turnDeg / 18));

  for (let s = 0; s < steps; s++) {
    const a0 = angle + (turn * s) / steps;
    const a1 = angle + (turn * (s + 1)) / steps;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const px0 = c0 * trackW;
    const py0 = s0 * trackW;
    const px1 = c1 * trackW;
    const py1 = s1 * trackW;
    solidBox(
      outPos,
      outIdx,
      rInner * c0 - px0,
      rOuter * c0 + px0,
      rInner * s0 - py0,
      rOuter * s0 + py0,
      zBot,
      zTop,
    );
    if (s === steps - 1) {
      solidBox(
        outPos,
        outIdx,
        rInner * c1 - px1,
        rOuter * c1 + px1,
        rInner * s1 - py1,
        rOuter * s1 + py1,
        zBay,
        zTop,
      );
    }
  }
}

/** L-shaped bayonet tracks on inner wall near rim. */
export function appendRollBayonetToBody(outPos, outIdx, meta, totalH, params) {
  const opts = resolveRollOpts(params);
  const innerR = Math.min(meta.inner.w, meta.inner.d) / 2;
  const wall = meta.outer.w / 2 - innerR;
  const count = opts.lugCount;
  for (let i = 0; i < count; i++) {
    const angle = ((Math.PI * 2) / count) * i + Math.PI / count;
    appendBayonetTrack(outPos, outIdx, angle, innerR, wall, totalH, opts);
  }
}

export function buildRollLidMesh(meta, totalH, params) {
  const opts = resolveRollOpts(params);
  const innerR = Math.min(meta.inner.w, meta.inner.d) / 2;
  const outerR = Math.min(meta.outer.w, meta.outer.d) / 2;
  const segments = 96;
  const positions = [];
  const indices = [];

  const plugOuter = offsetProfileInward(circleVertices(innerR, segments), opts.clearance);
  const plugInner = offsetProfileInward(circleVertices(innerR, segments), opts.clearance + opts.lidWall);
  const plateOuter = circleVertices(outerR, segments);
  const zTop = opts.skirtDepth + opts.lidThickness;

  capRing(positions, indices, plugOuter, plugInner, 0, false);
  extrudeProfileSides(positions, indices, plugOuter, 0, opts.skirtDepth, true);
  extrudeProfileSides(positions, indices, plugInner, 0, opts.skirtDepth, false);
  capRing(positions, indices, plugOuter, plugInner, opts.skirtDepth, true);
  extrudeProfileSides(positions, indices, plateOuter, opts.skirtDepth, zTop, true);
  capProfileSolid(positions, indices, plateOuter, zTop, true);

  const zLug0 = opts.skirtDepth - opts.lugHeight;
  const zLug1 = opts.skirtDepth + 0.15;
  for (let i = 0; i < opts.lugCount; i++) {
    const angle = ((Math.PI * 2) / opts.lugCount) * i;
    appendRadialLug(positions, indices, angle, innerR - opts.clearance, opts.lugDepth, opts.lugHeight, zLug0, zLug1);
  }

  const turnRad = (opts.turnDeg * Math.PI) / 180;
  return {
    positions,
    indices,
    lidHeight: zTop,
    rollMeta: {
      mode: "roll",
      seatZ: totalH,
      seatY: totalH + 0.02,
      turnRad,
      lift: opts.skirtDepth + 4,
      closedRot: 0,
      openRot: turnRad,
      restRot: turnRad * 0.4,
    },
  };
}

export function computeRollFitGuides(resolved, params) {
  const opts = resolveRollOpts(params);
  const r = Math.min(resolved.meta.outer.w, resolved.meta.outer.d) / 2;
  const outer = circleVertices(r, 64);
  return {
    seatZ: resolved.totalH,
    lidType: "roll",
    skirtDepth: opts.skirtDepth,
    lidHeight: opts.skirtDepth + opts.lidThickness,
    boxOuter: resolved.outer,
    boxInner: resolved.inner,
    plateOuter: outer,
  };
}
