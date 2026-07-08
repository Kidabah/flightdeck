/**
 * Parametric surface relief for vase / pot walls.
 * Displacement is always radial: r(a,z) = baseR + f(angle, z).
 */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const VASE_TEXTURE_STYLES = [
  { id: "ripple", label: "Ripple (horizontal waves)" },
  { id: "scales", label: "Scales" },
  { id: "bark", label: "Bark (vertical ridges)" },
  { id: "weave", label: "Basket weave" },
  { id: "knit", label: "Knitted" },
];

export function resolveVaseTexture(params, ctx) {
  if (!params?.vaseTextureEnabled) return { style: "none", depth: 0 };
  const style = VASE_TEXTURE_STYLES.some((s) => s.id === params.vaseTextureStyle)
    ? params.vaseTextureStyle
    : "ripple";
  const height = ctx.height;
  const floor = ctx.floor;
  const diameter = ctx.diameter;
  const depth = clamp(params.vaseTextureDepth ?? 1.2, 0.2, 3);
  const scale = clamp(params.vaseTextureScale ?? 14, 4, 48);
  const bandLo = clamp(params.vaseTextureBandLo ?? 8, 0, 85) / 100;
  const bandHi = clamp(params.vaseTextureBandHi ?? 94, 15, 100) / 100;
  return {
    style,
    depth,
    scale,
    bandLo: Math.min(bandLo, bandHi - 0.08),
    bandHi,
    height,
    floor,
    diameter,
  };
}

/** Fade texture at floor (bed adhesion) and inside the height band. */
export function vaseTextureStrength(z, spec) {
  if (!spec || spec.style === "none" || spec.depth <= 0) return 0;
  const t = z / Math.max(1e-9, spec.height);
  const band = smoothstep(spec.bandLo, spec.bandLo + 0.04, t)
    * (1 - smoothstep(spec.bandHi - 0.04, spec.bandHi, t));
  const floorFade = smoothstep(0, Math.max(spec.floor + 1, 8), z);
  return band * floorFade;
}

/** Extra radial offset in mm at (angle, z). */
export function vaseTextureDisplacement(angle, z, spec) {
  const s = vaseTextureStrength(z, spec);
  if (s <= 0) return 0;
  const depth = spec.depth * s;
  const scale = Math.max(4, spec.scale);

  switch (spec.style) {
    case "ripple":
      // scale ≈ wavelength in mm along Z
      return depth * 0.5 * Math.sin((2 * Math.PI * z) / scale);
    case "scales": {
      const cellH = scale;
      const circumference = Math.PI * spec.diameter;
      const u = ((angle + Math.PI) / (2 * Math.PI)) * circumference;
      const row = Math.floor(z / cellH);
      const uShift = (row % 2) * cellH * 0.5;
      const uc = (((u + uShift) % cellH) + cellH) % cellH / cellH;
      const vc = (z % cellH) / cellH;
      const dx = Math.abs(uc - 0.5) * 2;
      const dy = Math.abs(vc - 0.5) * 2;
      const d = dx + dy;
      if (d >= 1) return 0;
      const dome = (1 - d) * (1 - d);
      return depth * 0.55 * dome;
    }
    case "bark": {
      const count = clamp(Math.round(spec.diameter / scale), 6, 36);
      const ridge = Math.cos(count * angle + Math.sin(z * 0.12) * 1.8);
      const wobble = Math.sin(z * 0.35 + angle * 2.4);
      return depth * (0.42 * ridge + 0.18 * wobble);
    }
    case "weave": {
      const cell = scale;
      const circumference = Math.PI * spec.diameter;
      const u = ((angle + Math.PI) / (2 * Math.PI)) * circumference;
      const row = Math.floor(z / cell);
      const uLocal = (u % cell) / cell;
      const zLocal = (z % cell) / cell;
      const over = row % 2 === 0;
      const strand = over
        ? Math.sin(uLocal * Math.PI) * (0.35 + 0.65 * Math.sin(zLocal * Math.PI * 2) ** 2)
        : Math.sin(zLocal * Math.PI) * (0.35 + 0.65 * Math.sin(uLocal * Math.PI * 2) ** 2);
      const groove = Math.cos((u / cell) * Math.PI * 2) * Math.cos((z / cell) * Math.PI * 2);
      return depth * (0.55 * strand + 0.15 * groove);
    }
    case "knit": {
      const stitchW = scale * 0.62;
      const stitchH = scale * 0.82;
      const circumference = Math.PI * spec.diameter;
      const u = ((angle + Math.PI) / (2 * Math.PI)) * circumference;
      const col = Math.floor(u / stitchW);
      const row = Math.floor(z / stitchH);
      const uLocal = (u % stitchW) / stitchW;
      const zLocal = (z % stitchH) / stitchH;
      const rowShift = (col % 2) * 0.5;
      const zAdj = (zLocal + rowShift) % 1;
      const vShape = 1 - Math.abs(uLocal - 0.5) * 2;
      const stitch = Math.max(0, vShape) ** 1.15 * Math.sin(zAdj * Math.PI);
      const purl = row % 2 === 1 ? 0.28 : 1;
      const gutter = 0.12 * Math.cos((u / stitchW) * Math.PI * 2);
      return depth * (0.62 * stitch * purl + gutter);
    }
    default:
      return 0;
  }
}

/** Flute + texture radial displacement at one sample point. */
export function surfaceRadialOffset(angle, z, fluteSpec, textureSpec, phase) {
  let dr = 0;
  if (fluteSpec.count > 0 && fluteSpec.depth > 0.01) {
    dr += (fluteSpec.depth / 2) * Math.cos(fluteSpec.count * (angle - phase));
  }
  if (textureSpec?.style && textureSpec.style !== "none") {
    dr += vaseTextureDisplacement(angle, z, textureSpec);
  }
  return dr;
}

/** Closed ring with flute ribs and/or surface texture at height z. */
export function surfaceRing(radius, segments, z, fluteSpec, textureSpec, phase) {
  const pts = [];
  const active = (fluteSpec.count > 0 && fluteSpec.depth > 0.01)
    || (textureSpec?.style && textureSpec.style !== "none");
  if (!active) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
    }
    return pts;
  }
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const dr = surfaceRadialOffset(a, z, fluteSpec, textureSpec, phase);
    const r = Math.max(1, radius + dr);
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/** Bump tessellation when a texture is active. */
export function vaseTextureTessellation(spec, diameter, height, segments, layers) {
  if (!spec || spec.style === "none") return { segments, layers };
  const circ = Math.PI * diameter;
  const scale = Math.max(4, spec.scale);
  let seg = segments;
  let lay = layers;
  if (spec.style === "ripple") {
    lay = clamp(Math.max(lay, Math.ceil(height / Math.max(2, scale / 2.5))), 6, 200);
  } else if (spec.style === "knit" || spec.style === "weave") {
    const fine = scale * 0.45;
    seg = clamp(Math.max(seg, Math.ceil(circ / fine)), 24, 320);
    lay = clamp(Math.max(lay, Math.ceil(height / fine)), 6, 240);
  } else {
    seg = clamp(Math.max(seg, Math.ceil(circ / (scale * 0.55))), 24, 280);
    lay = clamp(Math.max(lay, Math.ceil(height / (scale * 0.55))), 6, 200);
  }
  return { segments: seg, layers: lay };
}
