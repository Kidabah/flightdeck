/**
 * Silhouette animal container profiles (experimental — b381).
 *
 * Each animal is a union of primitive blobs (discs, rounded boxes) rasterised to a
 * mask, then the boundary is extracted with the same maskToPolygons the trace engine
 * uses — guaranteeing a single clean, simple closed polygon suitable for the standard
 * profile -> container pipeline (outer wall + inward-offset inner wall + floor + lid).
 *
 * Shapes are deliberately CHUNKY: no feature narrower than ~2x a typical wall (2.4mm),
 * so offsetProfileInward() never self-intersects on ears/legs.
 */
import { maskToPolygons, simplifyPolygon } from "./contour.js?v=241";

const GRID = 240; // mask resolution; profile is scaled to real mm afterwards

function fillDisc(mask, w, h, cx, cy, r) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h, Math.ceil(cy + r));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= r2) mask[y * w + x] = 1;
  }
}

function fillRoundedBox(mask, w, h, cx, cy, halfW, halfH, r) {
  r = Math.min(r, halfW, halfH);
  const x0 = Math.max(0, Math.floor(cx - halfW)), x1 = Math.min(w, Math.ceil(cx + halfW));
  const y0 = Math.max(0, Math.floor(cy - halfH)), y1 = Math.min(h, Math.ceil(cy + halfH));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const dx = Math.abs(x + 0.5 - cx) - (halfW - r);
    const dy = Math.abs(y + 0.5 - cy) - (halfH - r);
    const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
    const d = Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0);
    if (d <= r) mask[y * w + x] = 1;
  }
}

/** Primitive recipes in a 0..1 x 0..1 box (y up). Kept chunky. */
const ANIMALS = {
  bear: (m, w, h) => {
    const S = w;
    fillDisc(m, w, h, 0.5 * S, 0.44 * S, 0.34 * S);   // body
    fillDisc(m, w, h, 0.5 * S, 0.74 * S, 0.24 * S);   // head
    fillDisc(m, w, h, 0.34 * S, 0.92 * S, 0.10 * S);  // ear L
    fillDisc(m, w, h, 0.66 * S, 0.92 * S, 0.10 * S);  // ear R
  },
  cat: (m, w, h) => {
    const S = w;
    fillRoundedBox(m, w, h, 0.5 * S, 0.40 * S, 0.30 * S, 0.32 * S, 0.16 * S); // body
    fillDisc(m, w, h, 0.5 * S, 0.72 * S, 0.22 * S);   // head
    // triangular-ish ears as overlapping discs kept thick
    fillDisc(m, w, h, 0.36 * S, 0.90 * S, 0.09 * S);
    fillDisc(m, w, h, 0.64 * S, 0.90 * S, 0.09 * S);
  },
  bunny: (m, w, h) => {
    const S = w;
    fillDisc(m, w, h, 0.5 * S, 0.38 * S, 0.30 * S);   // body
    fillDisc(m, w, h, 0.5 * S, 0.64 * S, 0.20 * S);   // head
    fillRoundedBox(m, w, h, 0.40 * S, 0.86 * S, 0.075 * S, 0.16 * S, 0.07 * S); // ear L (thick)
    fillRoundedBox(m, w, h, 0.60 * S, 0.86 * S, 0.075 * S, 0.16 * S, 0.07 * S); // ear R
  },
  dog: (m, w, h) => {
    const S = w;
    fillRoundedBox(m, w, h, 0.5 * S, 0.42 * S, 0.32 * S, 0.30 * S, 0.15 * S); // body
    fillDisc(m, w, h, 0.5 * S, 0.72 * S, 0.22 * S);   // head
    fillRoundedBox(m, w, h, 0.34 * S, 0.80 * S, 0.08 * S, 0.13 * S, 0.07 * S); // floppy ear L
    fillRoundedBox(m, w, h, 0.66 * S, 0.80 * S, 0.08 * S, 0.13 * S, 0.07 * S); // floppy ear R
  },
};

export const ANIMAL_NAMES = Object.keys(ANIMALS);

/** Largest boundary loop of the union mask, simplified, scaled to targetW mm, centred. y-up. */
export function animalProfile(name, targetW = 120, targetD = null) {
  const recipe = ANIMALS[name] || ANIMALS.bear;
  const mask = new Uint8Array(GRID * GRID);
  recipe(mask, GRID, GRID);
  const loops = maskToPolygons(mask, GRID, GRID);
  if (!loops.length) return null;
  // pick the longest loop (outer silhouette)
  let best = loops[0];
  for (const l of loops) if (l.length > best.length) best = l;
  let poly = simplifyPolygon(best, 1.1);
  if (poly.length > 3 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) {
    poly = poly.slice(0, -1);
  }
  // mask bounds -> scale to targetW (keep aspect unless targetD given), flip y to y-up, centre at origin
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const sx = targetW / spanX;
  const sy = targetD != null ? targetD / spanY : sx;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const pts = poly.map(([x, y]) => [(x - cx) * sx, -(y - cy) * sy]);
  // ensure CCW winding
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  if (area < 0) pts.reverse();
  return pts;
}
