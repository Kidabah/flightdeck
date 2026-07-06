/**
 * Vase / plant pot generator.
 * Builds a lofted revolve mesh with configurable profile, drainage hole and optional saucer.
 * Returns { positions, indices } in mm, Z-up, centered on XY, base at z=0.
 */

import earcut from "https://esm.sh/earcut@2.2.4";

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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

function ringXY(radius, segments) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

/** Vase profile presets — return list of [t, radiusScale] where t is 0..1 bottom→top. */
const PROFILES = {
  cylinder: [[0, 1], [1, 1]],
  tapered: [[0, 1], [1, 1.18]],
  potted: [[0, 0.86], [1, 1]],
  urn: [[0, 0.9], [0.15, 1.02], [0.35, 1.16], [0.55, 1.14], [0.75, 0.95], [1, 0.86]],
  amphora: [[0, 0.75], [0.15, 0.88], [0.35, 1.05], [0.55, 1.06], [0.75, 0.9], [0.9, 0.78], [1, 0.82]],
};

export const VASE_STYLES = [
  { id: "cylinder", label: "Cylinder pot", drainageDefault: true },
  { id: "tapered", label: "Tapered pot (wider top)", drainageDefault: true },
  { id: "potted", label: "Herbal pot (narrow top)", drainageDefault: true },
  { id: "urn", label: "Urn (belly)", drainageDefault: false },
  { id: "amphora", label: "Amphora (long belly)", drainageDefault: false },
];

function sampleProfile(styleId, layers) {
  const profile = PROFILES[styleId] || PROFILES.cylinder;
  const out = new Array(layers);
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    let a = profile[0];
    let b = profile[profile.length - 1];
    for (let j = 0; j < profile.length - 1; j++) {
      if (t >= profile[j][0] && t <= profile[j + 1][0]) {
        a = profile[j];
        b = profile[j + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const local = (t - a[0]) / span;
    out[i] = a[1] + (b[1] - a[1]) * local;
  }
  return out;
}

/** Earcut cap — avoids center-fan triangulation spokes visible in preview. */
function capProfileSolid(outPos, outIdx, ring, z, up) {
  let clean = ring;
  if (
    clean.length > 1 &&
    clean[0][0] === clean[clean.length - 1][0] &&
    clean[0][1] === clean[clean.length - 1][1]
  ) {
    clean = clean.slice(0, -1);
  }
  if (clean.length < 3) return;
  const base = outPos.length / 3;
  for (const [x, y] of clean) outPos.push(x, y, z);
  const tri = earcut(clean.flat());
  if (!tri.length) {
    for (let i = 1; i < clean.length - 1; i++) {
      if (up) outIdx.push(base, base + i, base + i + 1);
      else outIdx.push(base, base + i + 1, base + i);
    }
    return;
  }
  for (let i = 0; i < tri.length; i += 3) {
    const a = base + tri[i];
    const b = base + tri[i + 1];
    const c = base + tri[i + 2];
    if (up) outIdx.push(a, b, c);
    else outIdx.push(a, c, b);
  }
}

/** @deprecated use capProfileSolid */
function capSolid(outPos, outIdx, ring, z, up) {
  capProfileSolid(outPos, outIdx, ring, z, up);
}

/** Ring-shaped cap (annulus) between outer and inner ring at same z. */
function capAnnulus(outPos, outIdx, outer, inner, z, up) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = [outer[i][0], outer[i][1], z];
    const o1 = [outer[j][0], outer[j][1], z];
    const i0 = [inner[i][0], inner[i][1], z];
    const i1 = [inner[j][0], inner[j][1], z];
    if (up) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

/** Loft between two rings of same length at different z values. */
function loftBetween(outPos, outIdx, ringA, ringB, zA, zB, outward) {
  const n = ringA.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = [ringA[i][0], ringA[i][1], zA];
    const a1 = [ringA[j][0], ringA[j][1], zA];
    const b1 = [ringB[j][0], ringB[j][1], zB];
    const b0 = [ringB[i][0], ringB[i][1], zB];
    if (outward) pushQuad(outPos, outIdx, a0, a1, b1, b0);
    else pushQuad(outPos, outIdx, a0, b0, b1, a1);
  }
}

/** Scaled ring at radius = baseRadius * scaleFactor. */
function scaledRing(baseRing, factor) {
  return baseRing.map(([x, y]) => [x * factor, y * factor]);
}

/** Build the vase mesh. */
export function buildVase(params) {
  const style = params.vaseStyle || "cylinder";
  const diameter = clamp(params.vaseDiameter ?? 80, 30, 260);
  const height = clamp(params.vaseHeight ?? 100, 20, 320);
  const wall = clamp(params.vaseWall ?? 1.6, 1.0, 4);
  const floor = clamp(params.vaseFloor ?? 2.4, 1.4, 6);
  const segments = clamp(Math.round(params.vaseSegments ?? 72), 24, 128);
  const layers = clamp(Math.round(params.vaseLayers ?? 24), 6, 96);
  const drainage = !!params.vaseDrainage;

  const baseR = diameter / 2;
  const outerScale = sampleProfile(style, layers);
  // Inner radius = outer radius - wall thickness (radial offset).
  const outerRings = outerScale.map((s) => ringXY(baseR * s, segments));
  const innerRings = outerScale.map((s) => {
    const outerR = baseR * s;
    const innerR = Math.max(2, outerR - wall);
    return ringXY(innerR, segments);
  });

  const positions = [];
  const indices = [];

  const zFloor = floor;
  const zTop = height;
  const layerZ = (i) => (i / (layers - 1)) * height;

  // Outer skin
  for (let i = 0; i < layers - 1; i++) {
    loftBetween(positions, indices, outerRings[i], outerRings[i + 1], layerZ(i), layerZ(i + 1), true);
  }

  // Find first layer index at or above floor for the inner surface.
  let firstAbove = 0;
  for (let i = 0; i < layers; i++) {
    if (layerZ(i) >= zFloor) {
      firstAbove = i;
      break;
    }
  }
  // Compute the inner ring at exactly zFloor by interpolating between layer firstAbove-1 and firstAbove.
  let ringAtFloor;
  if (firstAbove === 0) {
    ringAtFloor = innerRings[0];
  } else {
    const zA = layerZ(firstAbove - 1);
    const zB = layerZ(firstAbove);
    const t = zB === zA ? 0 : (zFloor - zA) / (zB - zA);
    const rA = baseR * outerScale[firstAbove - 1];
    const rB = baseR * outerScale[firstAbove];
    const rMix = rA + (rB - rA) * t;
    const innerR = Math.max(2, rMix - wall);
    ringAtFloor = ringXY(innerR, segments);
  }

  // Inner skin from zFloor upward
  let prevRing = ringAtFloor;
  let prevZ = zFloor;
  for (let i = firstAbove; i < layers; i++) {
    const z = layerZ(i);
    if (z <= zFloor + 0.001) continue;
    loftBetween(positions, indices, prevRing, innerRings[i], prevZ, z, false);
    prevRing = innerRings[i];
    prevZ = z;
  }
  if (prevZ < zTop - 0.001) {
    loftBetween(positions, indices, prevRing, innerRings[layers - 1], prevZ, zTop, false);
  }

  // Bottom cap (outside, facing down) — with optional drainage hole
  if (drainage) {
    const rawR = clamp(params.vaseDrainageSize ?? 8, 3, Math.max(4, diameter * 0.35));
    const drainR = Math.min(rawR, baseR * outerScale[0] - wall - 2);
    if (drainR >= 3) {
      // Match outer segment count so capAnnulus / loftBetween line up.
      const drain = ringXY(drainR, segments);
      capAnnulus(positions, indices, outerRings[0], drain, 0, false);
      // Drainage bore walls (through floor)
      loftBetween(positions, indices, drain, drain, 0, zFloor, false);
      // Inner floor cap (annulus around drain hole)
      capAnnulus(positions, indices, ringAtFloor, drain, zFloor, true);
    } else {
      capSolid(positions, indices, outerRings[0], 0, false);
      capSolid(positions, indices, ringAtFloor, zFloor, true);
    }
  } else {
    capSolid(positions, indices, outerRings[0], 0, false);
    capSolid(positions, indices, ringAtFloor, zFloor, true);
  }

  // Top rim (annulus outer→inner at zTop)
  capAnnulus(positions, indices, outerRings[layers - 1], innerRings[layers - 1], zTop, true);

  return { positions, indices };
}

export function buildVaseSaucer(params) {
  const diameter = clamp(params.vaseDiameter ?? 80, 30, 260);
  const segments = clamp(Math.round(params.vaseSegments ?? 72), 24, 128);
  const outerR = diameter / 2 + 8;
  const innerR = outerR - 3;
  const rimH = 6;
  const floorH = 2.4;
  const outer = ringXY(outerR, segments);
  const inner = ringXY(innerR, segments);
  const bottomFloor = ringXY(outerR - 0.5, segments);
  const positions = [];
  const indices = [];

  capSolid(positions, indices, bottomFloor, 0, false);
  loftBetween(positions, indices, bottomFloor, outer, 0, floorH, true);
  capAnnulus(positions, indices, outer, inner, floorH, false);
  loftBetween(positions, indices, outer, outer, floorH, floorH + rimH, true);
  loftBetween(positions, indices, inner, inner, floorH, floorH + rimH, false);
  capAnnulus(positions, indices, outer, inner, floorH + rimH, true);
  // Inner floor to hold water
  capSolid(positions, indices, inner, floorH, true);

  return { positions, indices };
}

export function vaseMeta(params) {
  const style = params.vaseStyle || "cylinder";
  const diameter = clamp(params.vaseDiameter ?? 80, 30, 260);
  const height = clamp(params.vaseHeight ?? 100, 20, 320);
  const wall = clamp(params.vaseWall ?? 1.6, 1.0, 4);
  const floor = clamp(params.vaseFloor ?? 2.4, 1.4, 6);
  const styleLabel = VASE_STYLES.find((s) => s.id === style)?.label || style;

  const profile = sampleProfile(style, 24);
  const outerR = diameter / 2;
  // Approximate volume by summing frustum slices
  let outerVol = 0;
  let cavityVol = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const r0 = outerR * profile[i];
    const r1 = outerR * profile[i + 1];
    const dz = (height / (profile.length - 1));
    outerVol += (Math.PI * dz / 3) * (r0 * r0 + r0 * r1 + r1 * r1);
    const ir0 = Math.max(0, r0 - wall);
    const ir1 = Math.max(0, r1 - wall);
    const zBottom = i * dz;
    if (zBottom >= floor) {
      cavityVol += (Math.PI * dz / 3) * (ir0 * ir0 + ir0 * ir1 + ir1 * ir1);
    }
  }
  const materialMl = Math.max(0, (outerVol - cavityVol) / 1000);
  const cavityMl = cavityVol / 1000;

  const maxR = outerR * Math.max(...profile);
  const outerW = Math.round(maxR * 2 * 10) / 10;
  return {
    shape: "vase",
    styleLabel,
    style,
    inner: { w: outerW - Math.round(wall * 2 * 10) / 10, d: outerW - Math.round(wall * 2 * 10) / 10, h: Math.round((height - floor) * 10) / 10 },
    outer: { w: outerW, d: outerW, h: Math.round(height * 10) / 10 },
    cavityMl: Math.round(cavityMl * 10) / 10,
    materialMl: Math.round(materialMl * 10) / 10,
    estGrams: Math.round(materialMl * 1.24 * 10) / 10,
  };
}

export const VASE_DEFAULTS = {
  vaseStyle: "cylinder",
  vaseDiameter: 80,
  vaseHeight: 110,
  vaseWall: 1.6,
  vaseFloor: 2.4,
  vaseDrainage: true,
  vaseDrainageSize: 8,
  vaseSaucerEnabled: false,
  vaseSegments: 72,
  vaseLayers: 24,
};
