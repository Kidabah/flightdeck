/**
 * Ooshies display stand — multi-tier peg rack kit.
 *
 * Join: open-front tab-and-slot.
 *  - Side panels have U-notches (slots) cut from the front edge.
 *  - Each shelf has left/right tabs that slide into those notches.
 *  - Fit clearance (~0.25 mm) on tab vs slot for FDM press/slide fit.
 *  - No glue required; friction holds for light figures.
 *
 * Assembled pose: Z-up, centered on XY. Export returns separate kit parts
 * laid out for printing (sides + shelves flat on bed).
 */
import { extrudeShapeGroupBetween } from "./contour.js?v=241";

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function cleanRing(pts, eps = 0.02) {
  const out = [];
  for (const pt of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > eps) out.push([pt[0], pt[1]]);
  }
  while (
    out.length > 3
    && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps
  ) {
    out.pop();
  }
  return out;
}

function ringArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a * 0.5;
}

function ensureCCW(pts) {
  const ring = cleanRing(pts);
  return ringArea(ring) < 0 ? ring.slice().reverse() : ring;
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

function appendSolidBox(outPos, outIdx, x0, y0, z0, x1, y1, z1) {
  const xmin = Math.min(x0, x1);
  const xmax = Math.max(x0, x1);
  const ymin = Math.min(y0, y1);
  const ymax = Math.max(y0, y1);
  const zmin = Math.min(z0, z1);
  const zmax = Math.max(z0, z1);
  const c = [
    [xmin, ymin, zmin], [xmax, ymin, zmin], [xmax, ymax, zmin], [xmin, ymax, zmin],
    [xmin, ymin, zmax], [xmax, ymin, zmax], [xmax, ymax, zmax], [xmin, ymax, zmax],
  ];
  pushQuad(outPos, outIdx, c[0], c[2], c[1], c[3]);
  pushQuad(outPos, outIdx, c[4], c[5], c[6], c[7]);
  pushQuad(outPos, outIdx, c[0], c[1], c[5], c[4]);
  pushQuad(outPos, outIdx, c[3], c[7], c[6], c[2]);
  pushQuad(outPos, outIdx, c[0], c[4], c[7], c[3]);
  pushQuad(outPos, outIdx, c[1], c[2], c[6], c[5]);
}

/** Solid cylinder along +Z from z0, centered at (cx,cy). */
function appendPeg(outPos, outIdx, cx, cy, z0, radius, height, seg = 20) {
  const z1 = z0 + height;
  const bot = [];
  const top = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    bot.push([x, y, z0]);
    top.push([x, y, z1]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    pushQuad(outPos, outIdx, bot[i], bot[j], top[j], top[i]);
  }
  // caps
  for (let i = 1; i < seg - 1; i++) {
    pushTri(outPos, outIdx, bot[0], bot[i + 1], bot[i]);
    pushTri(outPos, outIdx, top[0], top[i], top[i + 1]);
  }
}

function translateMesh(mesh, dx, dy, dz) {
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    P[i] += dx;
    P[i + 1] += dy;
    P[i + 2] += dz;
  }
  return mesh;
}

function appendMesh(dst, src) {
  const base = dst.positions.length / 3;
  dst.positions.push(...src.positions);
  for (const i of src.indices) dst.indices.push(base + i);
}

function cloneMesh(mesh) {
  return {
    positions: mesh.positions.slice(),
    indices: mesh.indices.slice(),
  };
}

/** Rotate mesh +90° around X so Y-up print flat becomes Z-up standing (or reverse). */
function rotateX90(mesh) {
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    const y = P[i + 1];
    const z = P[i + 2];
    P[i + 1] = -z;
    P[i + 2] = y;
  }
  return mesh;
}

function rotateY180(mesh) {
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    P[i] = -P[i];
    P[i + 1] = -P[i + 1];
  }
  return mesh;
}

export const OOSHIE_DEFAULTS = {
  ooshiePegDia: 6.5,
  ooshiePegHeight: 10,
  ooshiePegsPerShelf: 5,
  ooshiePitch: 19.5,
  ooshieUpperShelves: 6,
  ooshieShelfThick: 5,
  ooshieShelfDepth: 16,
  ooshieClearance: 52,
  ooshieSideThick: 5,
  ooshieFitClearance: 0.25,
  ooshieSideMargin: 8.5,
  ooshieBaseExtraDepth: 14,
  ooshieBaseFrontPegs: 2,
  ooshieCornerR: 3,
  ooshieCutouts: true,
  ooshieTabInset: 1.2,
};

export function resolveOoshieDims(params = {}) {
  const pegDia = clamp(Number(params.ooshiePegDia) || OOSHIE_DEFAULTS.ooshiePegDia, 3, 12);
  const pegH = clamp(Number(params.ooshiePegHeight) || OOSHIE_DEFAULTS.ooshiePegHeight, 4, 20);
  const pegs = clamp(Math.round(Number(params.ooshiePegsPerShelf) || OOSHIE_DEFAULTS.ooshiePegsPerShelf), 2, 10);
  const pitch = clamp(Number(params.ooshiePitch) || Math.max(pegDia * 2.8, pegDia + 8), pegDia + 4, 40);
  const upper = clamp(Math.round(Number(params.ooshieUpperShelves) || OOSHIE_DEFAULTS.ooshieUpperShelves), 1, 10);
  const shelfT = clamp(Number(params.ooshieShelfThick) || OOSHIE_DEFAULTS.ooshieShelfThick, 2.4, 10);
  const shelfD = clamp(Number(params.ooshieShelfDepth) || OOSHIE_DEFAULTS.ooshieShelfDepth, pegDia + 4, 40);
  const clear = clamp(Number(params.ooshieClearance) || OOSHIE_DEFAULTS.ooshieClearance, 30, 80);
  const sideT = clamp(Number(params.ooshieSideThick) || OOSHIE_DEFAULTS.ooshieSideThick, 2.4, 10);
  const fit = clamp(Number(params.ooshieFitClearance) || OOSHIE_DEFAULTS.ooshieFitClearance, 0.1, 0.6);
  const margin = clamp(Number(params.ooshieSideMargin) || Math.max(pegDia * 1.3, 6), pegDia, 25);
  const baseExtra = clamp(Number(params.ooshieBaseExtraDepth) || OOSHIE_DEFAULTS.ooshieBaseExtraDepth, 6, 40);
  const baseFrontPegs = clamp(Math.round(Number(params.ooshieBaseFrontPegs) || OOSHIE_DEFAULTS.ooshieBaseFrontPegs), 0, 4);
  const cornerR = clamp(Number(params.ooshieCornerR) || OOSHIE_DEFAULTS.ooshieCornerR, 0, 12);
  const cutouts = params.ooshieCutouts !== false;
  const tabInset = clamp(Number(params.ooshieTabInset) || OOSHIE_DEFAULTS.ooshieTabInset, 0.4, 4);

  const shelfW = (pegs - 1) * pitch + 2 * margin;
  const tabLen = Math.max(2.2, sideT - 0.35);
  const tabDepth = Math.max(pegDia + 2, shelfD - 2 * tabInset);
  const slotH = shelfT + 2 * fit;
  const slotD = tabDepth + 2 * fit;
  // Notch depth from front edge into the side panel (Y)
  const notchDepth = Math.min(shelfD * 0.92, slotD + 1.5);

  // Shelf bottom Z for each level: base=0, then upper shelves
  const shelfCount = upper + 1; // base + uppers
  const shelfZs = [];
  let z = 0;
  for (let i = 0; i < shelfCount; i++) {
    shelfZs.push(z);
    z += shelfT + clear;
  }
  const totalH = shelfZs[shelfZs.length - 1] + shelfT + pegH + 2;
  const baseDepth = shelfD + baseExtra;
  const sideDepth = baseDepth; // sides span full base depth
  const overallW = shelfW + 2 * sideT;

  return {
    pegDia,
    pegR: pegDia / 2,
    pegH,
    pegs,
    pitch,
    upper,
    shelfT,
    shelfD,
    clear,
    sideT,
    fit,
    margin,
    baseExtra,
    baseFrontPegs,
    cornerR,
    cutouts,
    tabInset,
    shelfW,
    tabLen,
    tabDepth,
    slotH,
    slotD,
    notchDepth,
    shelfCount,
    shelfZs,
    totalH,
    baseDepth,
    sideDepth,
    overallW,
  };
}

function pegXs(d) {
  const xs = [];
  const start = -((d.pegs - 1) * d.pitch) / 2;
  for (let i = 0; i < d.pegs; i++) xs.push(start + i * d.pitch);
  return xs;
}

/** Build one shelf (or base) in assembled coordinates, centered on X, front toward -Y. */
function buildShelfMesh(d, { z, depth, isBase }) {
  const positions = [];
  const indices = [];
  const halfW = d.shelfW / 2;
  const yFront = -depth / 2;
  const yRear = depth / 2;
  const z1 = z + d.shelfT;

  // Deck
  appendSolidBox(positions, indices, -halfW, yFront, z, halfW, yRear, z1);

  // End tabs (slide into side notches)
  const tabHalfD = d.tabDepth / 2;
  const tabY0 = -tabHalfD;
  const tabY1 = tabHalfD;
  // Slightly thinner than shelf for fit
  const tabZ0 = z + d.fit;
  const tabZ1 = z1 - d.fit;
  appendSolidBox(positions, indices, -halfW - d.tabLen, tabY0, tabZ0, -halfW, tabY1, tabZ1);
  appendSolidBox(positions, indices, halfW, tabY0, tabZ0, halfW + d.tabLen, tabY1, tabZ1);

  // Pegs on top
  const xs = pegXs(d);
  const pegY = isBase ? yRear - depth * 0.28 : 0; // main row slightly rearward on base
  for (const x of xs) {
    appendPeg(positions, indices, x, isBase ? pegY : 0, z1, d.pegR * 0.98, d.pegH);
  }
  if (isBase && d.baseFrontPegs > 0) {
    const frontY = yFront + d.pegDia * 0.9;
    if (d.baseFrontPegs === 1) {
      appendPeg(positions, indices, 0, frontY, z1, d.pegR * 0.98, d.pegH);
    } else {
      const span = Math.min(d.pitch * (d.baseFrontPegs - 1), d.shelfW * 0.45);
      const x0 = -span / 2;
      for (let i = 0; i < d.baseFrontPegs; i++) {
        const x = d.baseFrontPegs === 1 ? 0 : x0 + (span * i) / (d.baseFrontPegs - 1);
        appendPeg(positions, indices, x, frontY, z1, d.pegR * 0.98, d.pegH);
      }
    }
  }

  return { positions, indices };
}

/**
 * Side panel in local coords: plate in YZ, thickness along +X from 0..sideT.
 * Front = -Y, back = +Y, bottom z=0.
 * Closed rectangular through-slots for shelf tabs (assemble: seat shelves in one
 * side, then press the other side on).
 */
function buildSidePanelLocal(d) {
  const positions = [];
  const indices = [];
  const yFront = -d.sideDepth / 2;
  const yBack = d.sideDepth / 2;
  const zTop = d.totalH;
  const step = Math.min(6, d.sideDepth * 0.12);

  // Outer outline with a small stepped top (matches the photo vibe)
  const outer = ensureCCW([
    [yFront, 0],
    [yFront, zTop],
    [yFront + step, zTop],
    [yFront + step, zTop - step * 0.6],
    [yBack, zTop - step * 0.6],
    [yBack, 0],
  ]);

  const holes = [];
  // Slot holes — centered on Y=0 like the shelf tabs; height matches tab + fit
  const slotHalfD = d.slotD / 2;
  for (let i = 0; i < d.shelfCount; i++) {
    const z0 = d.shelfZs[i] + d.fit;
    const z1 = z0 + d.slotH;
    // Keep slots inside the panel with a little rear/front meat
    const y0 = Math.max(yFront + 1.2, -slotHalfD);
    const y1 = Math.min(yBack - 1.2, slotHalfD);
    if (y1 - y0 < 4 || z1 - z0 < 2) continue;
    holes.push(ensureCCW([
      [y0, z0],
      [y1, z0],
      [y1, z1],
      [y0, z1],
    ]).slice().reverse());
  }

  if (d.cutouts) {
    const pillW = Math.min(10, d.sideDepth * 0.28);
    const pillH = Math.min(28, (zTop - 20) / 4);
    const cx = yBack - d.sideDepth * 0.28;
    for (let k = 0; k < 3; k++) {
      const cz = 18 + k * (pillH + 10);
      if (cz + pillH / 2 > zTop - 12) break;
      // Skip pills that collide with a slot band
      let hit = false;
      for (const z of d.shelfZs) {
        if (Math.abs(cz - (z + d.shelfT / 2)) < pillH / 2 + d.slotH) hit = true;
      }
      if (hit) continue;
      holes.push(ensureCCW(pillHole(cx, cz, pillW / 2, pillH / 2)).slice().reverse());
    }
  }

  const group = { outer, holes };
  const x0 = 0;
  const x1 = d.sideT;
  const map0 = (y, z) => [x0, y, z];
  const map1 = (y, z) => [x1, y, z];
  extrudeShapeGroupBetween(
    positions,
    indices,
    group,
    map1,
    map0,
    (w) => [w[1], w[2]],
    "both",
    null,
  );
  return { positions, indices };
}

function pillHole(cx, cy, rx, ry, seg = 16) {
  const pts = [];
  // stadium: two semicircles + straight sides, axis along Z (cy)
  const straight = Math.max(0, ry - rx);
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + Math.PI * (i / seg);
    pts.push([cx + rx * Math.cos(a), cy - straight + rx * Math.sin(a)]);
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + Math.PI * (i / seg);
    pts.push([cx + rx * Math.cos(a), cy + straight + rx * Math.sin(a)]);
  }
  return pts;
}

function buildAssembled(d) {
  const positions = [];
  const indices = [];
  const halfW = d.shelfW / 2;

  // Shelves
  for (let i = 0; i < d.shelfCount; i++) {
    const isBase = i === 0;
    const depth = isBase ? d.baseDepth : d.shelfD;
    const shelf = buildShelfMesh(d, { z: d.shelfZs[i], depth, isBase });
    appendMesh({ positions, indices }, shelf);
  }

  // Left side (inner face at x = -halfW)
  const left = buildSidePanelLocal(d);
  // Panel local X=0..sideT; place so inner face (x=sideT) meets shelf end at -halfW
  // Actually tabs extend to -halfW-tabLen; slot is in the side. Inner face should be at -halfW.
  // Local: x=0 is outer, x=sideT is inner — OR x=0 inner.
  // buildSidePanelLocal: x=0..sideT. Put inner at -halfW → translate so x_local=sideT maps to -halfW
  // => translate X by -halfW - sideT
  translateMesh(left, -halfW - d.sideT, 0, 0);
  appendMesh({ positions, indices }, left);

  // Right side: mirror — build then flip X
  const right = buildSidePanelLocal(d);
  // Mirror in local X then place inner at +halfW
  const RP = right.positions;
  for (let i = 0; i < RP.length; i += 3) RP[i] = d.sideT - RP[i];
  translateMesh(right, halfW, 0, 0);
  appendMesh({ positions, indices }, right);

  return { positions, indices };
}

/** Lay a side panel flat on the bed (thickness up Z). */
function flattenSideForPrint(sideMesh, d) {
  // Currently: thickness along X, plate in YZ.
  // Want: plate in XY, thickness along Z.
  // Rotate -90° around Y: (x,y,z)->(z,y,-x) then fix…
  // Simpler: rebuild mapping — rotate +90° around Y: (x,y,z)->(z,y,-x) no
  // (x,y,z) -> (y, z, x) maps thickness X to Z.
  const m = cloneMesh(sideMesh);
  const P = m.positions;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i];
    const y = P[i + 1];
    const z = P[i + 2];
    P[i] = y;
    P[i + 1] = z;
    P[i + 2] = x;
  }
  // shift to z=0 and center XY
  let zmin = Infinity;
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    xmin = Math.min(xmin, P[i]);
    xmax = Math.max(xmax, P[i]);
    ymin = Math.min(ymin, P[i + 1]);
    ymax = Math.max(ymax, P[i + 1]);
    zmin = Math.min(zmin, P[i + 2]);
  }
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] -= cx;
    P[i + 1] -= cy;
    P[i + 2] -= zmin;
  }
  return m;
}

function flattenShelfForPrint(shelfMesh) {
  // Already Z-up deck; just drop to z=0 and center
  const m = cloneMesh(shelfMesh);
  const P = m.positions;
  let zmin = Infinity;
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    xmin = Math.min(xmin, P[i]);
    xmax = Math.max(xmax, P[i]);
    ymin = Math.min(ymin, P[i + 1]);
    ymax = Math.max(ymax, P[i + 1]);
    zmin = Math.min(zmin, P[i + 2]);
  }
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] -= cx;
    P[i + 1] -= cy;
    P[i + 2] -= zmin;
  }
  return m;
}

export function ooshieMeta(params) {
  const d = resolveOoshieDims(params);
  return {
    shape: "ooshieStand",
    outer: { w: d.overallW, d: d.baseDepth, h: d.totalH },
    inner: { w: d.shelfW, d: d.shelfD, h: d.totalH },
    dims: d,
    label: "Ooshies stand",
  };
}

/**
 * Build preview (assembled) + printable kit parts.
 * @returns {{ positions, indices, shellMesh, meta, totalH, ooshieParts }}
 */
export function buildOoshieStand(params = {}) {
  const d = resolveOoshieDims(params);
  const assembled = buildAssembled(d);

  // Kit parts for export (print pose)
  const parts = [];
  const leftLocal = buildSidePanelLocal(d);
  parts.push({ name: "Side L", mesh: flattenSideForPrint(leftLocal, d), role: "side" });
  const rightLocal = buildSidePanelLocal(d);
  // Mirror for right before flatten
  const RP = rightLocal.positions;
  for (let i = 0; i < RP.length; i += 3) RP[i] = d.sideT - RP[i];
  parts.push({ name: "Side R", mesh: flattenSideForPrint(rightLocal, d), role: "side" });

  for (let i = 0; i < d.shelfCount; i++) {
    const isBase = i === 0;
    const depth = isBase ? d.baseDepth : d.shelfD;
    const shelf = buildShelfMesh(d, { z: 0, depth, isBase }); // build at z=0 for print
    parts.push({
      name: isBase ? "Base shelf" : `Shelf ${i}`,
      mesh: flattenShelfForPrint(shelf),
      role: isBase ? "base" : "shelf",
    });
  }

  return {
    positions: assembled.positions,
    indices: assembled.indices,
    shellMesh: assembled,
    meta: ooshieMeta(params),
    totalH: d.totalH,
    ooshieParts: parts,
    insertMesh: null,
    labelMesh: null,
    debossCutterMesh: null,
  };
}
