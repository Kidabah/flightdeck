/**

 * Bitmap → mask polygons for smooth emboss + preview rects.

 */



import {
  groupPolygonsWithHoles,
  maskToPolygons,
  polygonsToSvg,
  prepareShapeGroups,
  prepareStrokePaths,
  shapeGroupsToStrokePaths,
  strokePathsToSvg,
} from "./contour.js";



const MAX_TRACE_PX = 960;

export const MAX_TRACE_RECTS = 2500;

export const MAX_TRACE_POLYGONS = 240;



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



function outlineFromMask(mask, width, height) {

  const eroded = erodeMask(mask, width, height);

  const out = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {

    out[i] = mask[i] && !eroded[i] ? 1 : 0;

  }

  return out;

}



function blurAlphaMask(data, width, height) {
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



function scaleCanvasToFit(source, maxPx) {

  const w = source.width;

  const h = source.height;

  const scale = Math.min(1, maxPx / Math.max(w, h));

  const tw = Math.max(1, Math.round(w * scale));

  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");

  canvas.width = tw;

  canvas.height = th;

  const ctx = canvas.getContext("2d");

  ctx.drawImage(source, 0, 0, tw, th);

  return canvas;

}

/** Ensure SVG has explicit dimensions, then rasterize for reliable tracing. */
export function rasterizeSvgToCanvas(svgText, maxPx = MAX_TRACE_PX) {
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
      const scale = Math.min(1, maxPx / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize SVG"));
    };
    img.src = url;
  });
}

/** Pick outline for thin line art, silhouette for solid fills. */
export function detectSvgTraceMode(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (lum < 200) dark += 1;
  }
  const ratio = dark / (width * height);
  return ratio < 0.14 ? "outline" : "silhouette";
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
      const scaled = scaleCanvasToFit(img, MAX_TRACE_PX);
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

      const scaled = scaleCanvasToFit(img, MAX_TRACE_PX);

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

export function traceCanvas(canvas, options = {}) {

  const threshold = clamp(options.threshold ?? 128, 1, 254);

  const invert = !!options.invert;

  const mode = options.mode === "outline" ? "outline" : "silhouette";



  const ctx = canvas.getContext("2d");

  const { width, height } = canvas;

  const { data } = ctx.getImageData(0, 0, width, height);

  const blur = blurAlphaMask(data, width, height);



  let ink = binarizeImageData(data, width, height, threshold, invert, "silhouette", blur);
  // Both modes start from a clean ink mask; outline traces boundaries as strokes, not 1px rings.
  const mask = openMask(ink, width, height);



  const cropped = cropMask(mask, width, height);

  if (!cropped) {

    return { rects: [], width: 0, height: 0, svg: "", rectCount: 0, simplified: false, simplifyFactor: 1 };

  }



  let { mask: workMask, width: tw, height: th, ox, oy } = cropped;

  let simplifyFactor = 1;

  let rects = maskToRuns(workMask, tw, th);



  while (rects.length > MAX_TRACE_RECTS && simplifyFactor < 16) {

    const ds = downsampleMask(workMask, tw, th);

    workMask = ds.mask;

    tw = ds.width;

    th = ds.height;

    simplifyFactor *= 2;

    rects = maskToRuns(workMask, tw, th);

  }



  if (mode === "outline") {
    const simplifyTol = Math.max(0.22, tw / 520);
    const smoothPasses = 4;
    let polygons = maskToPolygons(workMask, tw, th);
    let grouped = groupPolygonsWithHoles(polygons);
    let strokePaths = prepareStrokePaths(shapeGroupsToStrokePaths(grouped), simplifyTol, smoothPasses);

    while (strokePaths.length > MAX_TRACE_POLYGONS && simplifyFactor < 16) {
      const ds = downsampleMask(workMask, tw, th);
      workMask = ds.mask;
      tw = ds.width;
      th = ds.height;
      simplifyFactor *= 2;
      rects = maskToRuns(workMask, tw, th);
      polygons = maskToPolygons(workMask, tw, th);
      grouped = groupPolygonsWithHoles(polygons);
      strokePaths = prepareStrokePaths(
        shapeGroupsToStrokePaths(grouped),
        simplifyTol * 1.1,
        Math.max(3, smoothPasses - 1),
      );
    }

    const strokeWidth = Math.max(1.35, tw / 88);
    const svg = strokePathsToSvg(strokePaths, tw, th, strokeWidth);

    return {
      rects,
      mask: workMask.slice(),
      polygons,
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
      mode,
    };
  }

  const simplifyTol = Math.max(0.65, tw / 200);
  let polygons = maskToPolygons(workMask, tw, th);
  let shapeGroups = prepareShapeGroups(groupPolygonsWithHoles(polygons), simplifyTol);

  if (shapeGroups.length > MAX_TRACE_POLYGONS) {
    const ds = downsampleMask(workMask, tw, th);
    workMask = ds.mask;
    tw = ds.width;
    th = ds.height;
    simplifyFactor *= 2;
    rects = maskToRuns(workMask, tw, th);
    polygons = maskToPolygons(workMask, tw, th);
    shapeGroups = prepareShapeGroups(groupPolygonsWithHoles(polygons), simplifyTol * 1.2);
  }

  const svg = polygonsToSvg(shapeGroups, tw, th);

  return {
    rects,
    mask: workMask.slice(),
    polygons,
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
    mode,
  };

}



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
      ctx.closePath();
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


