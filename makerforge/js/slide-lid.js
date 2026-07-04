/**
 * Channel slide lid — rectangular dados on long walls, flat lid slab, end stop pocket.
 * Slide direction: +X (entry at −X short end). Length = inner width (X), width = inner depth (Y).
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

function stitchSlices(outPos, outIdx, ring0, ring1) {
  const n = ring0.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(outPos, outIdx, ring0[i], ring0[j], ring1[j], ring1[i]);
  }
}

const WALL_EPS = 0.1;
const SHELF_DROP = 0.14;

export function shapeSupportsSlideLid(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencilBox" || shape === "pencil";
}

export function resolveSlideOpts(params) {
  const clearance = clamp(params.lidClearance ?? 0.25, 0.1, 0.55);
  const grooveHeight = clamp(params.slideGrooveHeight ?? 6, 3.5, 12);
  const undercut = clamp(params.slideUndercut ?? 1.8, 0.9, 3.2);
  const grooveDepth = clamp(params.slideGrooveDepth ?? 2.4, 1.2, 4);
  const stopLength = clamp(params.slideStopLength ?? 10, 5, 22);
  const entryRamp = clamp(params.slideEntryRamp ?? 10, 5, 18);
  const lidThickness = clamp(params.lidThickness ?? 2.4, 1.2, 6);
  const margin = 2;
  const lipDrop = 0.35;
  const railHeight = grooveHeight - lipDrop - lidThickness;
  return {
    clearance,
    grooveHeight,
    undercut,
    grooveDepth,
    stopLength,
    entryRamp,
    lidThickness,
    margin,
    lipDrop,
    railHeight: Math.max(1.2, railHeight),
    shelfZ: 0,
  };
}

function grooveSlice(x, undercutT, signY, id2, grooveDepth, undercut, zTop, zBot, zShelf) {
  const yOuter = signY * (id2 - WALL_EPS);
  const yLip = signY * (id2 - WALL_EPS - undercut * undercutT);
  const yInner = signY * (id2 - grooveDepth);
  return [
    vec3(x, yOuter, zTop),
    vec3(x, yOuter, zShelf),
    vec3(x, yInner, zShelf),
    vec3(x, yLip, zTop),
  ];
}

/** Rectangular dado grooves on long walls + end stop shelf (inset from shell to avoid z-fighting). */
export function appendSlideChannelsToBody(outPos, outIdx, meta, totalH, params) {
  const iw2 = meta.inner.w / 2;
  const id2 = meta.inner.d / 2;
  const opts = resolveSlideOpts(params);
  const { grooveHeight, undercut, grooveDepth, stopLength, entryRamp, margin, lipDrop } = opts;
  const zTop = totalH - lipDrop;
  const zBot = totalH - grooveHeight;
  const zShelf = zBot - SHELF_DROP;

  function extrudeGroove(signY) {
    const xOpen = -iw2 + margin;
    const xRunEnd = iw2 - stopLength - margin;
    const steps = Math.max(4, Math.round(entryRamp / 2));

    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const x0 = xOpen + t0 * entryRamp;
      const x1 = xOpen + t1 * entryRamp;
      stitchSlices(
        outPos,
        outIdx,
        grooveSlice(x0, t0, signY, id2, grooveDepth, undercut, zTop, zBot, zShelf),
        grooveSlice(x1, t1, signY, id2, grooveDepth, undercut, zTop, zBot, zShelf),
      );
    }

    const xMain0 = Math.min(xOpen + entryRamp, xRunEnd);
    if (xMain0 < xRunEnd) {
      stitchSlices(
        outPos,
        outIdx,
        grooveSlice(xMain0, 1, signY, id2, grooveDepth, undercut, zTop, zBot, zShelf),
        grooveSlice(xRunEnd, 1, signY, id2, grooveDepth, undercut, zTop, zBot, zShelf),
      );
    }
  }

  extrudeGroove(1);
  extrudeGroove(-1);

  // End stop shelf on +X short wall (inset from wall face).
  const xFace = iw2 - WALL_EPS;
  const xBack = iw2 - grooveDepth - 0.8;
  const yStop = Math.min(id2 * 0.38, id2 - grooveDepth - 1.2);
  const zCatch = zShelf + 0.25;
  pushQuad(outPos, outIdx, vec3(xFace, -yStop, zShelf), vec3(xFace, yStop, zShelf), vec3(xBack, yStop, zCatch), vec3(xBack, -yStop, zCatch));
  pushQuad(outPos, outIdx, vec3(xFace, -yStop, zTop), vec3(xBack, -yStop, zTop), vec3(xBack, -yStop, zCatch), vec3(xFace, -yStop, zShelf));
  pushQuad(outPos, outIdx, vec3(xFace, yStop, zShelf), vec3(xFace, yStop, zTop), vec3(xBack, yStop, zTop), vec3(xBack, yStop, zCatch));
}

export function buildSlideLidMesh(meta, totalH, params) {
  const iw2 = meta.inner.w / 2;
  const id2 = meta.inner.d / 2;
  const opts = resolveSlideOpts(params);
  const {
    clearance,
    grooveHeight,
    stopLength,
    lidThickness,
    margin,
    railHeight,
  } = opts;

  const positions = [];
  const indices = [];

  const yEdge = id2 - clearance - WALL_EPS;
  const tabLen = Math.min(3.5, stopLength * 0.32);
  const lidLen = Math.max(20, meta.inner.w - stopLength - margin * 2 - tabLen);
  const halfLen = lidLen / 2;
  const x0 = -halfLen;
  const x1 = halfLen + tabLen;

  const z0 = clearance * 0.5;
  const zTop = railHeight + lidThickness;

  // Single watertight slab — no internal faces, no overlapping tops.
  solidBox(positions, indices, x0, x1, -yEdge, yEdge, z0, zTop);

  // Shallow thumb pocket below the top face (walls + floor only — top stays one quad).
  const thumbW = Math.min(14, lidLen * 0.12);
  const thumbHalf = Math.min(yEdge * 0.22, 8);
  const pocketFloor = zTop - Math.min(1.1, lidThickness * 0.45);
  thumbPocket(positions, indices, x0 + 1.2, x0 + 1.2 + thumbW, -thumbHalf, thumbHalf, pocketFloor, zTop);

  const closedX = -stopLength / 2;
  const openX = closedX - iw2 * 0.55;
  const seatY = totalH - grooveHeight + SHELF_DROP * 0.5;

  return {
    positions,
    indices,
    lidHeight: zTop,
    slideMeta: {
      mode: "slide",
      openX,
      closedX,
      seatY,
      grooveHeight,
      stopLength,
      iw2,
      id2,
    },
  };
}

/** Axis-aligned box — six faces, no duplicates. */
function solidBox(outPos, outIdx, x0, x1, y0, y1, z0, z1) {
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x1, y0, z0), vec3(x1, y1, z0), vec3(x0, y1, z0));
  pushQuad(outPos, outIdx, vec3(x0, y1, z1), vec3(x1, y1, z1), vec3(x1, y0, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x0, y1, z0), vec3(x0, y1, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x1, y0, z1), vec3(x1, y1, z1), vec3(x1, y1, z0), vec3(x1, y0, z0));
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x1, y0, z0), vec3(x1, y0, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x0, y1, z1), vec3(x1, y1, z1), vec3(x1, y1, z0), vec3(x0, y1, z0));
}

/** Open-top pocket — inset walls + floor, does not duplicate the outer top face. */
function thumbPocket(outPos, outIdx, x0, x1, y0, y1, zFloor, zTop) {
  pushQuad(outPos, outIdx, vec3(x0, y0, zFloor), vec3(x1, y0, zFloor), vec3(x1, y1, zFloor), vec3(x0, y1, zFloor));
  pushQuad(outPos, outIdx, vec3(x0, y0, zFloor), vec3(x0, y0, zTop), vec3(x0, y1, zTop), vec3(x0, y1, zFloor));
  pushQuad(outPos, outIdx, vec3(x1, y0, zTop), vec3(x1, y0, zFloor), vec3(x1, y1, zFloor), vec3(x1, y1, zTop));
  pushQuad(outPos, outIdx, vec3(x0, y0, zFloor), vec3(x1, y0, zFloor), vec3(x1, y0, zTop), vec3(x0, y0, zTop));
  pushQuad(outPos, outIdx, vec3(x0, y1, zTop), vec3(x1, y1, zTop), vec3(x1, y1, zFloor), vec3(x0, y1, zFloor));
}

export function computeSlideFitGuides(resolved, params, slideMeta) {
  const iw2 = resolved.meta.inner.w / 2;
  const id2 = resolved.meta.inner.d / 2;
  const opts = resolveSlideOpts(params);
  const zTop = resolved.totalH - opts.lipDrop;
  const zBot = resolved.totalH - opts.grooveHeight;
  return {
    seatZ: resolved.totalH,
    lidType: "slide",
    skirtDepth: 0,
    lidHeight: slideMeta?.lidHeight ?? opts.railHeight + opts.lidThickness,
    boxOuter: resolved.outer,
    boxInner: resolved.inner,
    slideMeta,
    channelLineY: id2 - opts.grooveDepth * 0.55,
    channelZ: (zTop + zBot) / 2 - SHELF_DROP * 0.5,
    entryX: -iw2,
    stopX: iw2 - opts.stopLength,
    iw2,
    id2,
  };
}
