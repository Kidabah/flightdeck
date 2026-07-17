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
  if (type === "keyhole") {
    const headR = opts.headR ?? 4.2;
    holes.push(keyholeHole(-x, y - 3, headR, headR * 0.62, 7));
    holes.push(keyholeHole(x, y - 3, headR, headR * 0.62, 7));
  } else if (type === "screw") {
    const r = opts.screwR ?? 2.2;
    holes.push(circle(-x, y, r), circle(x, y, r), circle(-x, -y, r), circle(x, -y, r));
  } else if (type === "hanging") {
    const r = opts.hangR ?? 3.0;
    holes.push(circle(-x, y, r), circle(x, y, r));
  }
  return holes.map(ensureCCW);
}

/**
 * Build a watertight flat plate. Returns { positions, indices }.
 * W,H = plate size (mm), th = thickness, corner = corner radius, holes = array of hole rings.
 */
export function buildSignPlate(W, H, th, corner, holes = []) {
  const outer = ensureCCW(roundedRect(W / 2, H / 2, corner, 12));
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
export function buildSignBorder(W, H, th, corner, borderW, bh) {
  const inset = 1.2;           // gap from plate edge (avoids coplanar outer walls)
  const embed = 0.4;           // sink into the plate (avoids coplanar with the top cap)
  const oHalfW = W / 2 - inset, oHalfH = H / 2 - inset;
  const outer = ensureCCW(roundedRect(oHalfW, oHalfH, Math.max(0.5, corner - inset), 12));
  const inner = ensureCCW(roundedRect(oHalfW - borderW, oHalfH - borderW, Math.max(0.5, corner - inset - borderW), 12));
  const group = { outer, holes: [inner.slice().reverse()] };
  const positions = [];
  const indices = [];
  const mapTop = (px, py) => [px, py, th + bh];
  const mapBot = (px, py) => [px, py, th - embed];
  const flat = (w) => [w[0], w[1]];
  extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flat, "both", null);
  return { positions, indices };
}

export { mountHoles, roundedRect, keyholeHole };
