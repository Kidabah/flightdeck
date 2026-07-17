/**
 * Flat sign plates (b383) — door/name plaques, desk plates, house numbers, hanging signs.
 *
 * A sign is a solid flat plate lying on the bed (z=0..thickness), text/art embossed on the
 * TOP face via the shared emboss engine. Mount cutouts (keyhole / screw / hanging holes) are
 * modelled as HOLES in the plate outline — no CSG needed: one extrudeShapeGroupBetween with
 * outer ring + hole rings gives a watertight solid. An optional raised border sits on top.
 */
import { extrudeShapeGroupBetween } from "./contour.js?v=241";

const TAU = Math.PI * 2;

function roundedRect(halfW, halfH, r, seg = 10) {
  r = Math.max(0, Math.min(r, halfW - 0.01, halfH - 0.01));
  if (r < 0.05) return [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]];
  const pts = [];
  const corners = [[halfW - r, -(halfH - r), -Math.PI / 2], [halfW - r, halfH - r, 0], [-(halfW - r), halfH - r, Math.PI / 2], [-(halfW - r), -(halfH - r), Math.PI]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * (i / seg); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Remove near-duplicate consecutive points + accidental closure dup (breaks wall extrusion). */
function cleanRing(pts, eps = 0.02) {
  const out = [];
  for (const pt of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > eps) out.push([pt[0], pt[1]]);
  }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}

/** Plate outline for a named shape, centred in a halfW x halfH box. Returns a clean CCW ring. */
function shapeOutline(shape, halfW, halfH, corner = 8) {
  let pts;
  if (shape === "rectangle") pts = roundedRect(halfW, halfH, 0);
  else if (shape === "pill") pts = roundedRect(halfW, halfH, Math.min(halfW, halfH));
  else if (shape === "oval") {
    pts = []; const n = 72;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([halfW * Math.cos(a), halfH * Math.sin(a)]); }
  } else if (shape === "hexagon") {
    const k = halfW * 0.5;
    pts = [[-halfW + k, -halfH], [halfW - k, -halfH], [halfW, 0], [halfW - k, halfH], [-halfW + k, halfH], [-halfW, 0]];
  } else if (shape === "arch") {
    // straight sides for the lower half, elliptical arch on top — always fits the box.
    const spring = 0;
    const ry = halfH - spring;
    pts = [[-halfW, -halfH], [halfW, -halfH], [halfW, spring]];
    const n = 44;
    for (let i = 0; i <= n; i++) { const a = 0 + Math.PI * (i / n); pts.push([halfW * Math.cos(a), spring + ry * Math.sin(a)]); }
    pts.push([-halfW, spring]);
  } else if (shape === "shield") {
    pts = [[-halfW, halfH], [halfW, halfH], [halfW, -halfH * 0.15]];
    const n = 22;
    for (let i = 1; i <= n; i++) { const t = i / n; const x = halfW * Math.cos(t * Math.PI / 2); const y = -halfH * 0.15 - (halfH * 0.85) * Math.sin(t * Math.PI / 2); pts.push([x, y]); }
    // now at bottom point (0,-halfH); go up the left side symmetric
    for (let i = 1; i <= n; i++) { const t = i / n; const x = -halfW * Math.sin(t * Math.PI / 2); const y = -halfH + (halfH * 0.85) * (1 - Math.cos(t * Math.PI / 2)); pts.push([x, y]); }
  } else if (shape === "banner") {
    const notch = halfW * 0.16;
    pts = [[-halfW, -halfH], [halfW, -halfH], [halfW - notch, 0], [halfW, halfH], [-halfW, halfH], [-halfW + notch, 0]];
  } else {
    pts = roundedRect(halfW, halfH, corner);
  }
  return cleanRing(pts);
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Pull a mount-hole centre toward the plate centre until it (+margin ring) is inside the shape. */
function clampInside(cx, cy, outline, margin) {
  const ok = (x, y) => pointInPoly(x, y, outline)
    && pointInPoly(x + margin, y, outline) && pointInPoly(x - margin, y, outline)
    && pointInPoly(x, y + margin, outline) && pointInPoly(x, y - margin, outline);
  let x = cx, y = cy, f = 1;
  for (let i = 0; i < 30 && !ok(x, y); i++) { f *= 0.9; x = cx * f; y = cy * f; }
  return [x, y];
}

function circle(cx, cy, r, seg = 28) {
  const pts = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * TAU; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Keyhole: big hole (screw head) with a narrower slot rising from it (screw shaft slides down). */
function keyholeHole(cx, cy, headR, slotW, slotLen, seg = 24) {
  const hw = slotW / 2;
  const pts = [];
  // start at slot bottom-left, up the left side, around the head, down the right side of slot
  // build as: head circle centred at (cx, cy) + rectangular slot going UP (+y) from head centre
  // Compose an explicit CCW outline.
  const headTop = cy + Math.sqrt(Math.max(0, headR * headR - hw * hw));
  const slotTopY = cy + slotLen;
  // left slot edge (from head tangent up)
  pts.push([cx - hw, headTop]);
  pts.push([cx - hw, slotTopY]);
  pts.push([cx + hw, slotTopY]);
  pts.push([cx + hw, headTop]);
  // head arc (from right tangent, clockwise around the bottom back to left tangent)
  const a0 = Math.atan2(headTop - cy, hw);       // right tangent angle
  const a1 = Math.atan2(headTop - cy, -hw);       // left tangent angle
  // go the long way round the bottom: from a0 decreasing through -pi/2 to a1-2pi
  const start = a0, end = a1 - TAU;
  for (let i = 0; i <= seg; i++) { const a = start + (end - start) * (i / seg); pts.push([cx + headR * Math.cos(a), cy + headR * Math.sin(a)]); }
  return pts;
}

function ensureCCW(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]; }
  return area < 0 ? ring.slice().reverse() : ring;
}

/** Mount hole rings (in plate face coords, origin centre) for the chosen mount style. */
function mountHoles(type, W, H, opts = {}) {
  const holes = [];
  const margin = Math.min(W, H) * 0.12 + 4;
  const x = W / 2 - margin, y = H / 2 - margin;
  const outline = opts.outline;
  const fit = (cx, cy, r) => outline ? clampInside(cx, cy, outline, r + 1.5) : [cx, cy];
  if (type === "keyhole") {
    const headR = opts.headR ?? 4.2;
    for (const sx of [-x, x]) { const [hx, hy] = fit(sx, y - 3, headR + 7); holes.push(keyholeHole(hx, hy, headR, headR * 0.62, 7)); }
  } else if (type === "screw") {
    const r = opts.screwR ?? 2.2;
    for (const [sx, sy] of [[-x, y], [x, y], [-x, -y], [x, -y]]) { const [hx, hy] = fit(sx, sy, r); holes.push(circle(hx, hy, r)); }
  } else if (type === "hanging") {
    const r = opts.hangR ?? 3.0;
    for (const sx of [-x, x]) { const [hx, hy] = fit(sx, y, r); holes.push(circle(hx, hy, r)); }
  }
  return holes.map(ensureCCW);
}

/**
 * Build a watertight flat plate. Returns { positions, indices }.
 * W,H = plate size (mm), th = thickness, corner = corner radius, holes = array of hole rings.
 */
export function buildSignPlate(W, H, th, corner, holes = [], shape = "rounded") {
  const outer = ensureCCW(cleanRing(shapeOutline(shape, W / 2, H / 2, corner)));
  // holes must wind opposite to outer for earcut; ensureCCW made them CCW, reverse to CW
  const holeRings = holes.map((h) => h.slice().reverse());
  const group = { outer, holes: holeRings };
  const positions = [];
  const indices = [];
  const mapTop = (px, py) => [px, py, th];
  const mapBot = (px, py) => [px, py, 0];
  const flat = (w) => [w[0], w[1]];
  extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flat, "both", null);
  return { positions, indices };
}

/** Raised border frame — a closed rim slightly inset from the plate edge and embedded a
 * little into the plate top, so it unions cleanly (no coincident faces with the plate cap). */
export function buildSignBorder(W, H, th, corner, borderW, bh, shape = "rounded") {
  const inset = 1.2;           // gap from plate edge (avoids coplanar outer walls)
  const embed = 0.4;           // sink into the plate (avoids coplanar with the top cap)
  const oHalfW = W / 2 - inset, oHalfH = H / 2 - inset;
  const outer = ensureCCW(cleanRing(shapeOutline(shape, oHalfW, oHalfH, Math.max(0.5, corner - inset))));
  const inner = ensureCCW(cleanRing(shapeOutline(shape, oHalfW - borderW, oHalfH - borderW, Math.max(0.5, corner - inset - borderW))));
  const group = { outer, holes: [inner.slice().reverse()] };
  const positions = [];
  const indices = [];
  const mapTop = (px, py) => [px, py, th + bh];
  const mapBot = (px, py) => [px, py, th - embed];
  const flat = (w) => [w[0], w[1]];
  extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flat, "both", null);
  return { positions, indices };
}

export { mountHoles, roundedRect, keyholeHole, shapeOutline };
