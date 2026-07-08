/** Face-local placement for embossed art (mm). */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Rotate a point in face-local 2D (px, py). */
export function rotateFacePoint(cx, cy, px, py, deg) {
  if (!deg) return [px, py];
  const rad = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return [
    cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  ];
}

export function rotateShapeGroup(group, cx, cy, deg) {
  if (!deg) return group;
  const map = ([px, py]) => rotateFacePoint(cx, cy, px, py, deg);
  return {
    outer: group.outer.map(map),
    holes: group.holes.map((h) => h.map(map)),
  };
}

/** Horizontal (px) and vertical (py / CAD Z) offsets from default centred position. */
export function decorPlacementOffsets(params, frame, artW, artH) {
  const maxOx = Math.max(4, frame.faceW * 0.48 - artW * 0.5);
  const maxOy = Math.max(4, frame.faceH * 0.42 - artH * 0.5);
  const ox = clamp(params.decorOffsetX ?? 0, -maxOx, maxOx);
  const oy = clamp(params.decorOffsetY ?? 0, -maxOy, maxOy);
  if (frame.face === "wrap") {
    return {
      xOff: frame.faceW / 2 - artW / 2 + ox,
      zOff: (frame.faceH - artH) / 2 + oy,
      ox,
      oy,
    };
  }
  return {
    xOff: -artW / 2 + ox,
    zOff: frame.horizontal ? -artH / 2 + oy : frame.centerZ - artH + oy,
    ox,
    oy,
  };
}

/** Art bounding rect in face-local coords (px horizontal, py = CAD Z). */
export function decorArtRect(frame, xOff, zOff, artW, artH) {
  return {
    left: xOff,
    right: xOff + artW,
    bottom: zOff,
    top: zOff + artH,
    cx: xOff + artW / 2,
    cy: zOff + artH / 2,
    artW,
    artH,
  };
}
