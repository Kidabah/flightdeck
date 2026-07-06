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

/**
 * Ring with optional flute (rib) modulation, rotated by `phase` radians.
 * r(a) = radius + (depth/2) * cos(flutes * (a - phase)) — the whole rib
 * pattern rotates by phase (not phase/flutes), the mean radius is preserved,
 * and depth is the total peak-to-valley amplitude in mm.
 */
function flutedRing(radius, segments, flutes, depth, phase) {
  if (!flutes || depth <= 0.01) return ringXY(radius, segments);
  const pts = [];
  const half = depth / 2;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = Math.max(1, radius + half * Math.cos(flutes * (a - phase)));
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/** Smoothstep 0→1 between edges. */
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Vase profile presets — return list of [t, radiusScale] where t is 0..1 bottom→top. */
const PROFILES = {
  cylinder: [[0, 1], [1, 1]],
  tapered: [[0, 1], [1, 1.18]],
  potted: [[0, 0.86], [1, 1]],
  urn: [[0, 0.9], [0.15, 1.02], [0.35, 1.16], [0.55, 1.14], [0.75, 0.95], [1, 0.86]],
  amphora: [[0, 0.75], [0.15, 0.88], [0.35, 1.05], [0.55, 1.06], [0.75, 0.9], [0.9, 0.78], [1, 0.82]],
  goblet: [[0, 1.0], [0.14, 0.58], [0.34, 0.52], [0.55, 0.78], [0.8, 0.98], [1, 1.06]],
  hourglass: [[0, 1.02], [0.5, 0.58], [1, 1.02]],
  bud: [[0, 0.72], [0.22, 1.04], [0.45, 0.85], [0.7, 0.46], [0.88, 0.4], [1, 0.5]],
  bowl: [[0, 0.55], [0.35, 0.92], [0.7, 1.08], [1, 1.16]],
};

export const VASE_STYLES = [
  { id: "cylinder", label: "Cylinder pot", drainageDefault: true },
  { id: "tapered", label: "Tapered pot (wider top)", drainageDefault: true },
  { id: "potted", label: "Herbal pot (narrow top)", drainageDefault: true },
  { id: "bowl", label: "Bowl planter (low + wide)", drainageDefault: true },
  { id: "urn", label: "Urn (belly)", drainageDefault: false },
  { id: "amphora", label: "Amphora (long belly)", drainageDefault: false },
  { id: "goblet", label: "Goblet (stem + cup)", drainageDefault: false },
  { id: "hourglass", label: "Hourglass (pinched waist)", drainageDefault: false },
  { id: "bud", label: "Bud vase (narrow neck)", drainageDefault: false },
];

/**
 * Monotone cubic (Fritsch-Carlson) interpolation through profile control
 * points — smooth bellies and necks with no overshoot, so radii never go
 * negative or wobble past the control values. Linear data stays linear.
 */
function monotoneSampler(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i] || 1e-9);
    slope.push((ys[i + 1] - ys[i]) / (dx[i] || 1e-9));
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  return (t) => {
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && t > xs[i + 1]) i++;
    const h = dx[i];
    const s = (t - xs[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * ys[i] +
      (s3 - 2 * s2 + s) * h * m[i] +
      (-2 * s3 + 3 * s2) * ys[i + 1] +
      (s3 - s2) * h * m[i + 1]
    );
  };
}

const _samplerCache = new Map();

function profileSampler(styleId) {
  let fn = _samplerCache.get(styleId);
  if (!fn) {
    fn = monotoneSampler(PROFILES[styleId] || PROFILES.cylinder);
    _samplerCache.set(styleId, fn);
  }
  return fn;
}

function sampleProfile(styleId, layers) {
  const at = profileSampler(styleId);
  const out = new Array(layers);
  for (let i = 0; i < layers; i++) out[i] = at(i / (layers - 1));
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

/**
 * Resolve the shared outer-surface parameters (profile sampler, flute fade,
 * twist phase, tessellation) used by both the vase body and the accent band.
 */
function vaseSurface(params) {
  const style = params.vaseStyle || "cylinder";
  const diameter = clamp(params.vaseDiameter ?? 80, 30, 260);
  const height = clamp(params.vaseHeight ?? 100, 20, 320);
  const floor = clamp(params.vaseFloor ?? 2.4, 1.4, 6);

  const flutes = clamp(Math.round(params.vaseFlutes ?? 0), 0, 36);
  const fluteDepth = flutes ? clamp(params.vaseFluteDepth ?? 2, 0, Math.min(8, diameter * 0.12)) : 0;
  const twistDeg = clamp(params.vaseTwist ?? 0, -360, 360);
  const twistRad = (twistDeg * Math.PI) / 180;

  // Flutes and twist need finer tessellation to stay smooth.
  let segments = clamp(Math.round(params.vaseSegments ?? 72), 24, 128);
  if (flutes && fluteDepth > 0.01) segments = clamp(Math.max(segments, flutes * 10), 24, 240);
  let layers = clamp(Math.round(params.vaseLayers ?? 24), 6, 96);
  if (Math.abs(twistDeg) > 1) layers = clamp(Math.max(layers, Math.ceil(Math.abs(twistDeg) / 4)), 6, 160);

  const baseR = diameter / 2;
  const sampler = profileSampler(style);

  // Flutes fade in above the floor so the base perimeter stays circular
  // (better bed adhesion, clean bottom cap) and reach full depth ~8mm up.
  const fluteDepthAt = (z) => fluteDepth * smoothstep(0, Math.max(floor + 1, 8), z);
  const phaseAtZ = (z) => twistRad * (z / height);
  const outerRadiusAt = (z) => baseR * sampler(clamp(z / height, 0, 1));
  const outerRingAt = (z, radialOffset = 0) =>
    flutedRing(outerRadiusAt(z) + radialOffset, segments, flutes, fluteDepthAt(z), phaseAtZ(z));

  return {
    style, diameter, height, floor, flutes, fluteDepth, twistRad,
    segments, layers, baseR,
    fluteDepthAt, phaseAtZ, outerRadiusAt, outerRingAt,
  };
}

/** Build the vase mesh. */
export function buildVase(params) {
  const wall = clamp(params.vaseWall ?? 1.6, 1.0, 4);
  const drainage = !!params.vaseDrainage;
  const surf = vaseSurface(params);
  const { height, floor, flutes, segments, layers, baseR, fluteDepthAt } = surf;

  const outerScale = sampleProfile(surf.style, layers);
  const layerT = (i) => i / (layers - 1);
  const phaseAt = (t) => surf.twistRad * t;

  // Inner radius = outer radius - wall thickness (radial offset).
  // Inner surface follows the same flute wave so wall thickness stays
  // constant — required for spiral/vase-mode printing.
  const outerRings = outerScale.map((s, i) => {
    const z = layerT(i) * height;
    return flutedRing(baseR * s, segments, flutes, fluteDepthAt(z), phaseAt(layerT(i)));
  });
  const innerRings = outerScale.map((s, i) => {
    const outerR = baseR * s;
    const innerR = Math.max(2, outerR - wall);
    const z = layerT(i) * height;
    const innerDepth = Math.min(fluteDepthAt(z), Math.max(0, (innerR - 2) * 2));
    return flutedRing(innerR, segments, flutes, innerDepth, phaseAt(layerT(i)));
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
    const tFloor = zFloor / height;
    const innerDepth = Math.min(fluteDepthAt(zFloor), Math.max(0, (innerR - 2) * 2));
    ringAtFloor = flutedRing(innerR, segments, flutes, innerDepth, phaseAt(tFloor));
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
    const rawR = clamp(params.vaseDrainageSize ?? 8, 3, Math.max(4, surf.diameter * 0.35));
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

  const flutes = Math.round(params.vaseFlutes ?? 0);
  const fluteDepth = flutes ? clamp(params.vaseFluteDepth ?? 2, 0, Math.min(8, diameter * 0.12)) : 0;
  const maxR = outerR * Math.max(...profile) + fluteDepth / 2;
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

/**
 * Accent colour band hugging the vase outer surface (0.08mm skin, same as
 * container accents). Follows the profile curve, flutes and twist.
 * face: "rim" = band below the top edge, "floor" = band above the base.
 */
export function buildVaseAccentMesh(params) {
  const surf = vaseSurface(params);
  const skin = 0.08;
  const bandH = clamp(params.accentHeight ?? 4, 2, 12);
  const face = params.accentFace === "floor" ? "floor" : "rim";
  const z0 = face === "floor" ? 0 : Math.max(0, surf.height - bandH);
  const z1 = face === "floor" ? Math.min(surf.height, bandH) : surf.height;

  // Enough slices to follow profile curvature and twist through the band.
  const twistInBand = Math.abs(surf.twistRad) * ((z1 - z0) / surf.height);
  const steps = Math.max(4, Math.ceil((z1 - z0) / 1.5), Math.ceil((twistInBand / (Math.PI * 2)) * 48));

  const positions = [];
  const indices = [];
  let prevRing = surf.outerRingAt(z0, skin);
  let prevZ = z0;
  for (let i = 1; i <= steps; i++) {
    const z = z0 + ((z1 - z0) * i) / steps;
    const ring = surf.outerRingAt(z, skin);
    loftBetween(positions, indices, prevRing, ring, prevZ, z, true);
    prevRing = ring;
    prevZ = z;
  }
  return { positions, indices };
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
  vaseFlutes: 0,
  vaseFluteDepth: 2,
  vaseTwist: 0,
};
