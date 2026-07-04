/** Face-local placement for embossed art (mm). */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Horizontal (px) and vertical (py / CAD Z) offsets from default centred position. */
export function decorPlacementOffsets(params, frame, artW, artH) {
  const maxOx = Math.max(4, frame.faceW * 0.48 - artW * 0.5);
  const maxOy = Math.max(4, frame.faceH * 0.42 - artH * 0.5);
  const ox = clamp(params.decorOffsetX ?? 0, -maxOx, maxOx);
  const oy = clamp(params.decorOffsetY ?? 0, -maxOy, maxOy);
  return {
    xOff: -artW / 2 + ox,
    zOff: frame.centerZ - artH + oy,
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
