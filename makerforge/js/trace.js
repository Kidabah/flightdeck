/**

 * Bitmap → mask polygons for smooth emboss + preview rects.

 */



import {
  groupPolygonsWithHoles,
  maskToPolygons,
  polygonsToSvg,
  prepareContourRing,
  prepareShapeGroups,
  prepareStrokePaths,
  strokePathIsClosed,
  shapeGroupsToStrokePaths,
  strokePathsToSvg,
} from "./contour.js?v=191";



const MAX_TRACE_PX = 4096;
const SVG_RASTER_PX = 4096;
const MAX_COLOR_LAYERS = 10;
const BLUR_SKIP_PIXELS = 1_800_000;

export const MAX_TRACE_RECTS = 50000;

export const MAX_TRACE_POLYGONS = 600;

const traceYield = () => new Promise((resolve) => setTimeout(resolve, 0));



function downsampleMask(mask, width, height) {

  const nw = Math.max(1, Math.floor(width / 2));

  const nh = Math.max(1, Math.floor(height / 2));

  const out = new Uint8Array(nw * nh);

  for (let y = 0; y < nh; y++) {

    for (let x = 0; x < nw; x++) {

      let on = 0;

      for (let dy = 0; dy < 2; dy++) {

        for (let dx = 0; dx < 2; dx++) {

          const sx = x * 2 + dx;

          const sy = y * 2 + dy;

          if (sx < width && sy < height && mask[sy * width + sx]) on = 1;

        }

      }

      out[y * nw + x] = on;

    }

  }

  return { mask: out, width: nw, height: nh };

}



function clamp(n, min, max) {

  return Math.min(max, Math.max(min, n));

}



function mergeRuns(runs) {

  runs.sort((a, b) => a.x - b.x || a.y - b.y);

  const merged = [];

  for (const r of runs) {

    const prev = merged[merged.length - 1];

    if (prev && prev.x === r.x && prev.w === r.w && prev.y + prev.h === r.y) {

      prev.h += 1;

    } else {

      merged.push({ x: r.x, y: r.y, w: r.w, h: r.h });

    }

  }

  return merged;

}



function maskToRuns(mask, width, height) {

  const runs = [];

  for (let y = 0; y < height; y++) {

    let start = -1;

    for (let x = 0; x <= width; x++) {

      const on = x < width && mask[y * width + x];

      if (on && start < 0) start = x;

      if (!on && start >= 0) {

        runs.push({ x: start, y, w: x - start, h: 1 });

        start = -1;

      }

    }

  }

  return mergeRuns(runs);

}



function cropMask(mask, width, height) {

  let minX = width;

  let minY = height;

  let maxX = -1;

  let maxY = -1;

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      if (!mask[y * width + x]) continue;

      minX = Math.min(minX, x);

      minY = Math.min(minY, y);

      maxX = Math.max(maxX, x);

      maxY = Math.max(maxY, y);

    }

  }

  if (maxX < minX || maxY < minY) return null;

  const cw = maxX - minX + 1;

  const ch = maxY - minY + 1;

  const cropped = new Uint8Array(cw * ch);

  for (let y = 0; y < ch; y++) {

    for (let x = 0; x < cw; x++) {

      cropped[y * cw + x] = mask[(y + minY) * width + (x + minX)];

    }

  }

  return { mask: cropped, width: cw, height: ch, ox: minX, oy: minY };

}



function erodeMask(mask, width, height) {

  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      if (!mask[y * width + x]) continue;

      let keep = true;

      for (let dy = -1; dy <= 1 && keep; dy++) {

        for (let dx = -1; dx <= 1 && keep; dx++) {

          const nx = x + dx;

          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {

            keep = false;

          }

        }

      }

      out[y * width + x] = keep ? 1 : 0;

    }

  }

  return out;

}



function morphologicalSkeleton(mask, width, height) {
  const skel = new Uint8Array(width * height);
  let work = mask.slice();
  for (let guard = 0; guard < Math.max(width, height); guard++) {
    const eroded = erodeMask(work, width, height);
    let any = false;
    for (let i = 0; i < eroded.length; i++) {
      if (eroded[i]) {
        any = true;
        break;
      }
    }
    if (!any) break;
    const opened = dilateMask(eroded, width, height);
    for (let i = 0; i < work.length; i++) {
      if (work[i] && !opened[i]) skel[i] = 1;
    }
    work = eroded;
  }
  return skel;
}

function skeletonDegree(skel, width, height, x, y) {
  let d = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && skel[ny * width + nx]) d++;
    }
  }
  return d;
}

/** Walk 8-connected skeleton pixels into polylines (centerlines, not boundaries). */
function skeletonToPolylines(skel, width, height) {
  const used = new Uint8Array(width * height);
  const polylines = [];
  const nbrs = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];

  function walkFrom(sx, sy) {
    const path = [[sx, sy]];
    used[sy * width + sx] = 1;
    let x = sx;
    let y = sy;
    let px = -1;
    let py = -1;
    while (true) {
      let next = null;
      for (const [dx, dy] of nbrs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!skel[ny * width + nx] || used[ny * width + nx]) continue;
        if (nx === px && ny === py) continue;
        next = [nx, ny];
        break;
      }
      if (!next) break;
      path.push(next);
      used[next[1] * width + next[0]] = 1;
      px = x;
      py = y;
      x = next[0];
      y = next[1];
      if (skeletonDegree(skel, width, height, x, y) > 2) break;
    }
    return path.length >= 2 ? path : null;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!skel[i] || used[i] || skeletonDegree(skel, width, height, x, y) !== 1) continue;
      const path = walkFrom(x, y);
      if (path) polylines.push(path);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!skel[i] || used[i]) continue;
      const path = walkFrom(x, y);
      if (path) polylines.push(path);
    }
  }
  return polylines;
}

/** Outline = skeleton centerlines. Double-edge art returns too many paths → caller should fall back. */
function outlineCenterlinePaths(inkMask, width, height) {
  const cleaned = openMask(inkMask, width, height);
  const skel = morphologicalSkeleton(cleaned, width, height);
  return skeletonToPolylines(skel, width, height);
}

function polylineLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return len;
}

/** Detect skeleton ring garbage from double-edge / edge-detected raster art. */
function shouldFallbackOutline(rawPaths, strokePaths, tw) {
  if (!strokePaths.length) return true;
  if (strokePaths.length > 6) return true;

  let ringLike = 0;
  let totalLen = 0;
  for (const path of rawPaths) {
    const len = polylineLength(path);
    totalLen += len;
    const gap = Math.hypot(
      path[0][0] - path[path.length - 1][0],
      path[0][1] - path[path.length - 1][1],
    );
    if (len > 4 && gap < Math.max(4, len * 0.12)) ringLike++;
  }
  if (ringLike >= 2 && ringLike / rawPaths.length >= 0.2) return true;

  const avgLen = totalLen / rawPaths.length;
  if (rawPaths.length >= 3 && avgLen < tw * 0.045) return true;

  return false;
}

function ensurePrintableWidth(mask, width, height, targetMinPx) {
  let out = mask;
  const passes = Math.min(1, Math.max(0, Math.ceil(targetMinPx / 16) - 2));
  for (let i = 0; i < passes; i++) out = dilateMask(out, width, height);
  return out;
}

function traceQualityParams(tw, options = {}) {
  const smoothPasses = options.smoothPasses ?? 5;
  const simplifyTol = Math.max(0.1, tw / 1400);
  return { smoothPasses, simplifyTol, fbTol: Math.max(0.12, tw / 1200) };
}

function isBackgroundPixel(r, g, b, a, lum, threshold) {
  if (a < 16) return true;
  const bgCutoff = clamp(252 - threshold * 0.55, 170, 252);
  return lum < bgCutoff ? false : true;
}

function quantizeInkColor(r, g, b) {
  const step = 28;
  return `${Math.round(r / step) * step},${Math.round(g / step) * step},${Math.round(b / step) * step}`;
}

function collectInkColorLayers(data, width, height, threshold, invert, blur) {
  const buckets = new Map();
  const minPixels = Math.max(80, Math.round((width * height) / 25000));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const lum = blur ? blur[y * width + x] : r * 0.299 + g * 0.587 + b * 0.114;
      let bg = isBackgroundPixel(r, g, b, a, lum, threshold);
      if (invert) bg = !bg;
      if (bg) continue;
      const key = quantizeInkColor(r, g, b);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }
  const layers = [...buckets.entries()]
    .filter(([, count]) => count >= minPixels)
    .sort((a, b) => b[1] - a[1]);
  return layers.length >= 2 ? layers.map(([key]) => key) : null;
}

function maskForInkColor(data, width, height, colorKey, threshold, invert, blur) {
  const [tr, tg, tb] = colorKey.split(",").map(Number);
  const tol = 40;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const lum = blur ? blur[y * width + x] : r * 0.299 + g * 0.587 + b * 0.114;
      let bg = isBackgroundPixel(r, g, b, a, lum, threshold);
      if (invert) bg = !bg;
      if (bg) continue;
      if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) {
        mask[y * width + x] = 1;
      }
    }
  }
  return openMask(mask, width, height);
}

async function prepareShapeGroupsAsync(groups, simplifyTol, smoothPasses) {
  const holePasses = smoothPasses >= 2 ? Math.max(1, smoothPasses - 1) : 0;
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    if (i % 3 === 0) await traceYield();
    const { outer, holes } = groups[i];
    out.push({
      outer: prepareContourRing(outer, simplifyTol, true, smoothPasses),
      holes: holes.map((hole) => prepareContourRing(hole, simplifyTol * 0.5, holePasses > 0, holePasses)),
    });
  }
  return out;
}

async function traceColorLayerGroupsAsync(data, width, height, tw, th, ox, oy, threshold, invert, blur, options, quality) {
  const colorLayers = collectInkColorLayers(data, width, height, threshold, invert, blur);
  if (!colorLayers || colorLayers.length < 2) return null;

  const allGroups = [];
  const combined = new Uint8Array(tw * th);
  for (const colorKey of colorLayers.slice(0, MAX_COLOR_LAYERS)) {
    await traceYield();
    let layerMask = maskForInkColor(data, width, height, colorKey, threshold, invert, blur);
    if (options.strengthen) layerMask = closeMask(layerMask, width, height);
    const layerCrop = cropMask(layerMask, width, height);
    if (!layerCrop) continue;
    const lm = layerCrop.mask;
    const lw = layerCrop.width;
    const lh = layerCrop.height;
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        if (!lm[y * lw + x]) continue;
        const gx = layerCrop.ox - ox + x;
        const gy = layerCrop.oy - oy + y;
        if (gx >= 0 && gy >= 0 && gx < tw && gy < th) combined[gy * tw + gx] = 1;
      }
    }
    const polys = maskToPolygons(lm, lw, lh);
    let groups = await prepareShapeGroupsAsync(groupPolygonsWithHoles(polys), quality.simplifyTol, quality.smoothPasses);
    const ds = downsampleUntilComplexity(lm, lw, lh, groups, 1, quality.simplifyTol, quality.smoothPasses);
    groups = ds.groups.map(({ outer, holes }) => ({
      outer: outer.map(([px, py]) => [px + layerCrop.ox - ox, py + layerCrop.oy - oy]),
      holes: holes.map((hole) => hole.map(([px, py]) => [px + layerCrop.ox - ox, py + layerCrop.oy - oy])),
    }));
    allGroups.push(...groups);
  }
  if (allGroups.length < 2) return null;
  return { shapeGroups: allGroups, combined, colorLayerCount: Math.min(colorLayers.length, MAX_COLOR_LAYERS) };
}

function compactTraceMask(workMask, shapeGroups) {
  if (shapeGroups?.length) return [];
  if (!workMask?.length || workMask.length > 400_000) return [];
  return workMask.slice();
}

function finishSilhouetteTrace(workMask, tw, th, ox, oy, shapeGroups, simplifyFactor, width, height, extra = {}) {
  const rects = maskToRuns(workMask, tw, th);
  const svg = polygonsToSvg(shapeGroups, tw, th);
  return {
    rects,
    mask: compactTraceMask(workMask, shapeGroups),
    polygons: [],
    shapeGroups,
    strokePaths: [],
    width: tw,
    height: th,
    cropOx: ox,
    cropOy: oy,
    svg,
    rectCount: rects.length,
    polygonCount: shapeGroups.length,
    simplified: simplifyFactor > 1,
    simplifyFactor,
    tooComplex: shapeGroups.length > MAX_TRACE_POLYGONS,
    mode: "silhouette",
    tracePx: `${width}×${height}`,
    ...extra,
  };
}

function downsampleUntilComplexity(workMask, tw, th, shapeGroups, simplifyFactor, simplifyTol, smoothPasses) {
  let mask = workMask;
  let w = tw;
  let h = th;
  let factor = simplifyFactor;
  let groups = shapeGroups;
  let tol = simplifyTol;
  let passes = smoothPasses;
  while (groups.length > MAX_TRACE_POLYGONS && factor < 8) {
    const ds = downsampleMask(mask, w, h);
    mask = ds.mask;
    w = ds.width;
    h = ds.height;
    factor *= 2;
    tol *= 1.08;
    passes = Math.max(3, passes - 1);
    const polygons = maskToPolygons(mask, w, h);
    groups = prepareShapeGroups(groupPolygonsWithHoles(polygons), tol, passes);
  }
  return { mask, w, h, factor, groups, tol, passes };
}



function blurAlphaMask(data, width, height) {
  if (width * height > BLUR_SKIP_PIXELS) return null;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const i = (ny * width + nx) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}



function binarizeImageData(data, width, height, threshold, invert, mode = "silhouette", blur = null) {

  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      const i = (y * width + x) * 4;

      const a = data[i + 3];

      const lum = blur ? blur[y * width + x] : data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

      let on;

      if (mode === "silhouette") {

        const bgCutoff = clamp(252 - threshold * 0.55, 170, 252);

        on = a > 16 && lum < bgCutoff;

      } else {

        const inkCutoff = clamp(threshold, 40, 220);

        on = a > 16 && lum < inkCutoff;

      }

      if (invert) on = !on;

      mask[y * width + x] = on ? 1 : 0;

    }

  }

  return mask;

}



function openMask(mask, width, height) {
  const eroded = erodeMask(mask, width, height);
  return dilateMask(eroded, width, height);
}

function closeMask(mask, width, height) {
  const dilated = dilateMask(mask, width, height);
  return erodeMask(dilated, width, height);
}



function dilateMask(mask, width, height) {

  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      let on = 0;

      for (let dy = -1; dy <= 1 && !on; dy++) {

        for (let dx = -1; dx <= 1 && !on; dx++) {

          const nx = x + dx;

          const ny = y + dy;

          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) on = 1;

        }

      }

      out[y * width + x] = on;

    }

  }

  return out;

}



function scaleCanvasToMaxPx(source, maxPx) {
  const w = source.width;
  const h = source.height;
  if (w <= 0 || h <= 0) return source;
  const scale = maxPx / Math.max(w, h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, tw, th);
  return canvas;
}

/** Ensure SVG has explicit dimensions, then rasterize for reliable tracing. */
export function rasterizeSvgToCanvas(svgText, maxPx = SVG_RASTER_PX) {
  return new Promise((resolve, reject) => {
    if (!svgText?.trim()) {
      reject(new Error("Empty SVG"));
      return;
    }
    let serialized = svgText;
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const svg = doc.documentElement;
      if (svg && svg.nodeName.toLowerCase() !== "parsererror") {
        const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
        if (!svg.getAttribute("width") && vb?.length === 4) {
          svg.setAttribute("width", String(vb[2]));
          svg.setAttribute("height", String(vb[3]));
        }
        serialized = new XMLSerializer().serializeToString(svg);
      }
    }
    const blob = new Blob([serialized], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || img.width || maxPx;
      const ih = img.naturalHeight || img.height || maxPx;
      const targetScale = maxPx / Math.max(iw, ih);
      const ss = 2;
      const hiW = Math.max(1, Math.round(iw * targetScale * ss));
      const hiH = Math.max(1, Math.round(ih * targetScale * ss));
      const hiCanvas = document.createElement("canvas");
      hiCanvas.width = hiW;
      hiCanvas.height = hiH;
      const hiCtx = hiCanvas.getContext("2d");
      hiCtx.fillStyle = "#ffffff";
      hiCtx.fillRect(0, 0, hiW, hiH);
      hiCtx.imageSmoothingEnabled = true;
      hiCtx.imageSmoothingQuality = "high";
      hiCtx.drawImage(img, 0, 0, hiW, hiH);
      URL.revokeObjectURL(url);
      resolve(scaleCanvasToMaxPx(hiCanvas, maxPx));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize SVG"));
    };
    img.src = url;
  });
}

/** SVG imports always use silhouette — outline on edge-detected art creates ring garbage. */
export function detectSvgTraceMode() {
  return "silhouette";
}



/** Load a data URL (e.g. saved session JPEG) into a trace canvas. */

export function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      reject(new Error("No image data"));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scaled = scaleCanvasToMaxPx(img, MAX_TRACE_PX);
      resolve({
        canvas: scaled,
        width: scaled.width,
        height: scaled.height,
        previewUrl: scaled.toDataURL("image/png"),
      });
    };
    img.onerror = () => reject(new Error("Could not load saved image"));
    img.src = dataUrl;
  });
}

/** Load PNG / JPG / WEBP into a canvas. */

export function loadImageFromFile(file) {

  return new Promise((resolve, reject) => {

    if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {

      reject(new Error("Use PNG, JPG, or WEBP"));

      return;

    }

    const url = URL.createObjectURL(file);

    const img = new Image();

    img.onload = () => {

      const scaled = scaleCanvasToMaxPx(img, MAX_TRACE_PX);

      URL.revokeObjectURL(url);

      resolve({

        canvas: scaled,

        width: scaled.width,

        height: scaled.height,

        previewUrl: scaled.toDataURL("image/png"),

      });

    };

    img.onerror = () => {

      URL.revokeObjectURL(url);

      reject(new Error("Could not load image"));

    };

    img.src = url;

  });

}



/**

 * Trace a prepared canvas to merged rects + SVG.

 * @param {HTMLCanvasElement} canvas

 * @param {{ threshold?: number, invert?: boolean, mode?: 'silhouette'|'outline' }} options

 */

export async function traceCanvasAsync(canvas, options = {}) {

  await traceYield();

  const threshold = clamp(options.threshold ?? 128, 1, 254);

  const invert = !!options.invert;

  const mode = options.mode === "outline" ? "outline" : "silhouette";



  const ctx = canvas.getContext("2d");

  const { width, height } = canvas;

  const { data } = ctx.getImageData(0, 0, width, height);

  const blur = blurAlphaMask(data, width, height);

  await traceYield();

  let ink = binarizeImageData(data, width, height, threshold, invert, "silhouette", blur);
  let mask = openMask(ink, width, height);
  if (mode === "silhouette") {
    if (options.strengthen) {
      mask = closeMask(mask, width, height);
    }
    if (options.printableWidth !== false) {
      const minFeaturePx = Math.max(4, Math.round(height / 200));
      mask = ensurePrintableWidth(mask, width, height, minFeaturePx);
    }
  }



  const cropped = cropMask(mask, width, height);

  if (!cropped) {

    return { rects: [], width: 0, height: 0, svg: "", rectCount: 0, simplified: false, simplifyFactor: 1 };

  }



  let { mask: workMask, width: tw, height: th, ox, oy } = cropped;

  let simplifyFactor = 1;

  let rects = maskToRuns(workMask, tw, th);

  const quality = traceQualityParams(tw, options);

  await traceYield();

  if (options.colorSeparation !== false) {
    const colorTrace = await traceColorLayerGroupsAsync(data, width, height, tw, th, ox, oy, threshold, invert, blur, options, quality);
    if (colorTrace) {
      let shapeGroups = colorTrace.shapeGroups;
      let combined = colorTrace.combined;
      let sf = simplifyFactor;
      if (shapeGroups.length > MAX_TRACE_POLYGONS) {
        const ds = downsampleUntilComplexity(combined, tw, th, shapeGroups, sf, quality.simplifyTol, quality.smoothPasses);
        combined = ds.mask;
        tw = ds.w;
        th = ds.h;
        sf = ds.factor;
        shapeGroups = ds.groups;
      }
      return finishSilhouetteTrace(combined, tw, th, ox, oy, shapeGroups, sf, width, height, {
        colorLayers: colorTrace.colorLayerCount,
      });
    }
  }

  if (mode === "outline") {
    const simplifyTol = quality.simplifyTol;
    const smoothPasses = quality.smoothPasses;
    let rawPaths = outlineCenterlinePaths(workMask, tw, th);
    let strokePaths = prepareStrokePaths(rawPaths, simplifyTol, smoothPasses);

    // Edge-detected / double-line art produces dozens of ring centerlines — use silhouette instead.
    const outlineFallback = shouldFallbackOutline(rawPaths, strokePaths, tw);
    if (outlineFallback) {
      await traceYield();
      const colorTrace = await traceColorLayerGroupsAsync(data, width, height, tw, th, ox, oy, threshold, invert, blur, options, quality);
      if (colorTrace) {
        let shapeGroups = colorTrace.shapeGroups;
        let combined = colorTrace.combined;
        let sf = simplifyFactor;
        if (shapeGroups.length > MAX_TRACE_POLYGONS) {
          const ds = downsampleUntilComplexity(combined, tw, th, shapeGroups, sf, quality.simplifyTol, quality.smoothPasses);
          combined = ds.mask;
          tw = ds.w;
          th = ds.h;
          sf = ds.factor;
          shapeGroups = ds.groups;
        }
        return finishSilhouetteTrace(combined, tw, th, ox, oy, shapeGroups, sf, width, height, {
          outlineFallback: true,
          colorLayers: colorTrace.colorLayerCount,
        });
      }
      const fbTol = quality.fbTol;
      const fbPasses = quality.smoothPasses;
      await traceYield();
      let polygons = maskToPolygons(workMask, tw, th);
      let shapeGroups = await prepareShapeGroupsAsync(groupPolygonsWithHoles(polygons), fbTol, fbPasses);
      const ds = downsampleUntilComplexity(workMask, tw, th, shapeGroups, simplifyFactor, fbTol, fbPasses);
      workMask = ds.mask;
      tw = ds.w;
      th = ds.h;
      simplifyFactor = ds.factor;
      shapeGroups = ds.groups;
      return finishSilhouetteTrace(workMask, tw, th, ox, oy, shapeGroups, simplifyFactor, width, height, {
        outlineFallback: true,
        polygons: maskToPolygons(workMask, tw, th),
      });
    }

    while (strokePaths.length > MAX_TRACE_POLYGONS && simplifyFactor < 16) {
      const ds = downsampleMask(workMask, tw, th);
      workMask = ds.mask;
      tw = ds.width;
      th = ds.height;
      simplifyFactor *= 2;
      rects = maskToRuns(workMask, tw, th);
      rawPaths = outlineCenterlinePaths(workMask, tw, th);
      strokePaths = prepareStrokePaths(rawPaths, simplifyTol * 1.1, Math.max(3, smoothPasses - 1));
    }

    const strokeWidth = Math.max(2.2, tw / 72);
    const svg = strokePathsToSvg(strokePaths, tw, th, strokeWidth);

    return {
      rects,
      mask: compactTraceMask(workMask, []),
      polygons: [],
      shapeGroups: [],
      strokePaths,
      strokeWidth,
      width: tw,
      height: th,
      cropOx: ox,
      cropOy: oy,
      svg,
      rectCount: rects.length,
      polygonCount: strokePaths.length,
      simplified: simplifyFactor > 1,
      simplifyFactor,
      tooComplex: strokePaths.length > MAX_TRACE_POLYGONS,
      mode: "outline",
      outlineFallback: false,
    };
  }

  await traceYield();
  let polygons = maskToPolygons(workMask, tw, th);
  let shapeGroups = await prepareShapeGroupsAsync(groupPolygonsWithHoles(polygons), quality.simplifyTol, quality.smoothPasses);

  const ds = downsampleUntilComplexity(workMask, tw, th, shapeGroups, simplifyFactor, quality.simplifyTol, quality.smoothPasses);
  workMask = ds.mask;
  tw = ds.w;
  th = ds.h;
  simplifyFactor = ds.factor;
  shapeGroups = ds.groups;

  return finishSilhouetteTrace(workMask, tw, th, ox, oy, shapeGroups, simplifyFactor, width, height, {
    polygons: maskToPolygons(workMask, tw, th),
    mode,
  });

}

/** @deprecated Use traceCanvasAsync — kept as alias for imports. */
export const traceCanvas = traceCanvasAsync;

/** Render trace preview onto a canvas (source image + green overlay). */

export function drawTracePreview(previewCanvas, sourceCanvas, traceResult) {

  const ctx = previewCanvas.getContext("2d");

  const pad = 8;

  const sw = sourceCanvas.width;

  const sh = sourceCanvas.height;

  previewCanvas.width = sw + pad * 2;

  previewCanvas.height = sh + pad * 2;



  ctx.fillStyle = "#0f172a";

  ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  ctx.drawImage(sourceCanvas, pad, pad);



  const factor = traceResult.simplifyFactor || 1;
  const ox = traceResult.cropOx ?? 0;
  const oy = traceResult.cropOy ?? 0;

  if (traceResult.mode === "outline" && traceResult.strokePaths?.length) {
    ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
    ctx.lineWidth = Math.max(1.5, (traceResult.width || 100) / 70);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const path of traceResult.strokePaths) {
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const px = pad + ox + path[i][0] * factor;
        const py = pad + oy + path[i][1] * factor;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (strokePathIsClosed(path, Math.max(1.5, (traceResult.width || 100) / 400))) ctx.closePath();
      ctx.stroke();
    }
    return;
  }

  ctx.fillStyle = "rgba(56, 189, 248, 0.55)";

  const groups = traceResult.shapeGroups?.length ? traceResult.shapeGroups : null;

  if (groups?.length) {

    for (const group of groups) {

      ctx.beginPath();

      for (let i = 0; i < group.outer.length; i++) {

        const px = pad + ox + group.outer[i][0] * factor;

        const py = pad + oy + group.outer[i][1] * factor;

        if (i === 0) ctx.moveTo(px, py);

        else ctx.lineTo(px, py);

      }

      for (const hole of group.holes) {

        for (let i = 0; i < hole.length; i++) {

          const px = pad + ox + hole[i][0] * factor;

          const py = pad + oy + hole[i][1] * factor;

          if (i === 0) ctx.moveTo(px, py);

          else ctx.lineTo(px, py);

        }

      }

      ctx.closePath();

      ctx.fill("evenodd");

    }

    return;

  }

  if (traceResult.polygons?.length) {

    for (const poly of traceResult.polygons) {

      ctx.beginPath();

      for (let i = 0; i < poly.length; i++) {

        const px = pad + ox + poly[i][0] * factor;

        const py = pad + oy + poly[i][1] * factor;

        if (i === 0) ctx.moveTo(px, py);

        else ctx.lineTo(px, py);

      }

      ctx.closePath();

      ctx.fill();

    }

    return;

  }

  if (!traceResult?.rects?.length) return;

  for (const r of traceResult.rects) {

    ctx.fillRect(pad + ox + r.x * factor, pad + oy + r.y * factor, r.w * factor, r.h * factor);

  }

}


