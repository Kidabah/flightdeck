/**
 * Channel slide lid — angled grooves on long walls, beveled lid rails, end stop pocket.
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
  };
}

/** Append rail lips + end stop pocket to an axis-aligned box shell. */
export function appendSlideChannelsToBody(outPos, outIdx, meta, totalH, params) {
  const iw2 = meta.inner.w / 2;
  const id2 = meta.inner.d / 2;
  const opts = resolveSlideOpts(params);
  const { grooveHeight, undercut, grooveDepth, stopLength, entryRamp, margin, lipDrop } = opts;
  const zTop = totalH - lipDrop;
  const zBot = totalH - grooveHeight;

  function lipSlice(x, undercutT, signY) {
    const yWall = signY * id2;
    const yLip = signY * (id2 - undercut * undercutT);
    const yFloor = signY * (id2 - grooveDepth);
    return [
      vec3(x, yWall, zTop),
      vec3(x, yWall, zBot),
      vec3(x, yFloor, zBot),
      vec3(x, yLip, zTop),
    ];
  }

  function extrudeRamp(signY) {
    const x0 = -iw2 + margin;
    const x1 = Math.min(-iw2 + margin + entryRamp, iw2 - stopLength - margin);
    const steps = Math.max(4, Math.round(entryRamp / 2));
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      stitchSlices(
        outPos,
        outIdx,
        lipSlice(x0 + t0 * entryRamp, t0, signY),
        lipSlice(x0 + t1 * entryRamp, t1, signY),
      );
    }
    if (x1 < iw2 - stopLength - margin) {
      stitchSlices(
        outPos,
        outIdx,
        lipSlice(x1, 1, signY),
        lipSlice(iw2 - stopLength - margin, 1, signY),
      );
    }
  }

  extrudeRamp(1);
  extrudeRamp(-1);

  // End stop pocket on +X short wall — shelf the lid nose drops into.
  const xWall = iw2;
  const xIn = iw2 - grooveDepth - 0.6;
  const yStop = Math.min(id2 * 0.42, id2 - grooveDepth - 1);
  const zSeat = zBot + 0.8;
  const p0 = vec3(xWall, -yStop, zBot);
  const p1 = vec3(xWall, yStop, zBot);
  const p2 = vec3(xIn, yStop, zSeat);
  const p3 = vec3(xIn, -yStop, zSeat);
  pushQuad(outPos, outIdx, p0, p1, p2, p3);
  pushQuad(outPos, outIdx, p0, p3, vec3(xIn, -yStop, zTop), vec3(xWall, -yStop, zTop));
  pushQuad(outPos, outIdx, p1, vec3(xWall, yStop, zTop), vec3(xIn, yStop, zTop), p2);
}

export function buildSlideLidMesh(meta, totalH, params) {
  const iw2 = meta.inner.w / 2;
  const id2 = meta.inner.d / 2;
  const opts = resolveSlideOpts(params);
  const {
    clearance,
    grooveHeight,
    undercut,
    grooveDepth,
    stopLength,
    lidThickness,
    margin,
    railHeight,
    lipDrop,
  } = opts;

  const positions = [];
  const indices = [];

  const yRailOut = id2 - clearance;
  const yRailIn = id2 - grooveDepth + clearance;
  const yPlateIn = id2 - grooveDepth - clearance - 0.4;
  const tabLen = Math.min(3.5, stopLength * 0.35);
  const lidLen = Math.max(20, meta.inner.w - stopLength - margin * 2 - tabLen);
  const halfLen = lidLen / 2;
  const xTab = halfLen;
  const xLead = -halfLen;

  const z0 = 0;
  const zRail = railHeight;
  const zTop = railHeight + lidThickness;

  // Top plate
  capPlate(positions, indices, xLead, xTab + tabLen, -yPlateIn, yPlateIn, zRail, zTop);

  // Long rail +Y (beveled outer bottom for groove angle)
  buildLongRail(positions, indices, xLead, xTab, yRailOut, yRailIn, z0, zRail, undercut, 1);
  buildLongRail(positions, indices, xLead, xTab, -yRailOut, -yRailIn, z0, zRail, undercut, -1);

  // Entry end (+Y−X corner chamfer on rails — short wall at entry)
  chamferEntryEnd(positions, indices, xLead, yRailOut, yRailIn, z0, zRail, undercut);

  // Stop nose tab on +X short end
  buildStopTab(
    positions,
    indices,
    xTab,
    xTab + tabLen,
    yPlateIn * 0.55,
    zRail - 0.5,
    zTop,
    grooveDepth,
  );

  const closedX = -stopLength / 2;
  const openX = closedX - iw2 * 0.55;
  const seatY = totalH - grooveHeight;

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

function capPlate(outPos, outIdx, x0, x1, y0, y1, z0, z1) {
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x1, y0, z0), vec3(x1, y1, z0), vec3(x0, y1, z0));
  pushQuad(outPos, outIdx, vec3(x0, y1, z1), vec3(x1, y1, z1), vec3(x1, y0, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x0, y0, z0), vec3(x0, y1, z0), vec3(x0, y1, z1), vec3(x0, y0, z1));
  pushQuad(outPos, outIdx, vec3(x1, y0, z1), vec3(x1, y1, z1), vec3(x1, y1, z0), vec3(x1, y0, z0));
}

function buildLongRail(outPos, outIdx, x0, x1, yOut, yIn, z0, z1, undercut, signY) {
  const yBevel = yOut - signY * undercut * 0.85;
  const zBevel = z0 + (z1 - z0) * 0.42;
  const a = vec3(x0, yOut, z0);
  const b = vec3(x1, yOut, z0);
  const c = vec3(x1, yIn, z1);
  const d = vec3(x0, yIn, z1);
  pushQuad(outPos, outIdx, a, b, c, d);
  pushQuad(outPos, outIdx, a, d, vec3(x0, yIn, zBevel), vec3(x0, yBevel, zBevel));
  pushQuad(outPos, outIdx, b, vec3(x1, yBevel, zBevel), vec3(x1, yIn, zBevel), c);
  pushQuad(outPos, outIdx, a, vec3(x0, yBevel, zBevel), vec3(x1, yBevel, zBevel), b);
}

function chamferEntryEnd(outPos, outIdx, xLead, yOut, yIn, z0, z1, undercut) {
  const xCh = xLead + undercut * 1.2;
  pushQuad(
    outPos,
    outIdx,
    vec3(xLead, yOut, z0),
    vec3(xCh, yOut, z0),
    vec3(xCh, yIn, z1),
    vec3(xLead, yIn, z1),
  );
  pushQuad(
    outPos,
    outIdx,
    vec3(xLead, -yOut, z0),
    vec3(xLead, -yIn, z1),
    vec3(xCh, -yIn, z1),
    vec3(xCh, -yOut, z0),
  );
}

function buildStopTab(outPos, outIdx, x0, x1, halfY, z0, z1, grooveDepth) {
  const xCatch = x1 + Math.min(grooveDepth * 0.5, 2);
  pushQuad(outPos, outIdx, vec3(x0, -halfY, z0), vec3(xCatch, -halfY, z0), vec3(xCatch, halfY, z0), vec3(x0, halfY, z0));
  pushQuad(outPos, outIdx, vec3(x0, halfY, z1), vec3(xCatch, halfY, z1), vec3(xCatch, -halfY, z1), vec3(x0, -halfY, z1));
  pushQuad(outPos, outIdx, vec3(x0, -halfY, z0), vec3(x0, halfY, z0), vec3(x0, halfY, z1), vec3(x0, -halfY, z1));
  pushQuad(outPos, outIdx, vec3(xCatch, -halfY, z1), vec3(xCatch, halfY, z1), vec3(xCatch, halfY, z0), vec3(xCatch, -halfY, z0));
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
    channelLineY: id2 - opts.grooveDepth * 0.5,
    channelZ: (zTop + zBot) / 2,
    entryX: -iw2,
    stopX: iw2 - opts.stopLength,
    iw2,
    id2,
  };
}
