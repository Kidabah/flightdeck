/**
 * STL Painter — SVG artwork stamp.
 * Rasterize an SVG, then project it onto a mesh as face paint.
 */

export const ART_ALPHA_MIN = 48;
export const ART_MATCH_DIST2 = 32 * 32;
export const ART_MAX_RASTER = 768;

function hypot3(x, y, z) {
  return Math.hypot(x, y, z) || 1;
}

function normalize(v) {
  const L = hypot3(v[0], v[1], v[2]);
  return [v[0] / L, v[1] / L, v[2] / L];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function parseHexColor(hex) {
  const h = String(hex || "").trim();
  const m = h.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const byte = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function parseCssColor(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t || t === "none" || t === "transparent") return null;
  const hex = parseHexColor(t);
  if (hex) return hex;
  const rgb = t.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}

export function colorDist2(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function nearestSlot(rgb, slotRgbs) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < slotRgbs.length; i++) {
    const d = colorDist2(rgb, slotRgbs[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { slot: best, dist2: bestD };
}

export function isSvgArtFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".svg") || type === "image/svg+xml";
}

export function isRasterArtFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif)$/i.test(name) || /^image\/(png|jpeg|webp|gif)$/.test(type);
}

export function clonePixelData(imageData) {
  return {
    data: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
  };
}

export function rasterHasAlpha(data, { alphaCut = 250 } = {}) {
  if (!data?.length) return false;
  let transparent = 0;
  const n = data.length / 4;
  for (let i = 3; i < data.length; i += 4) if (data[i] < alphaCut) transparent++;
  return transparent / n > 0.04;
}

/** Punch near-white paper out of JPGs / flattened PNGs. Mutates `data`. */
export function knockOutPaperBackground(data, { lumaMax = 242 } = {}) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (luma >= lumaMax) {
      data[i + 3] = 0;
      n++;
    }
  }
  return n;
}

export function extractRasterPalette(data, { maxColors = 6, alphaMin = ART_ALPHA_MIN } = {}) {
  const counts = new Map();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaMin) continue;
    opaque++;
    const qr = Math.max(0, Math.min(255, (data[i] / 16 + 0.5 | 0) * 16));
    const qg = Math.max(0, Math.min(255, (data[i + 1] / 16 + 0.5 | 0) * 16));
    const qb = Math.max(0, Math.min(255, (data[i + 2] / 16 + 0.5 | 0) * 16));
    const hex = rgbToHex(qr, qg, qb);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const min = Math.max(8, opaque * 0.008);
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([hex]) => hex);
}

export function extractSvgFillHexes(svgText) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const rgb = parseCssColor(raw);
    if (!rgb) return;
    const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (seen.has(hex)) return;
    seen.add(hex);
    out.push(hex);
  };
  const src = String(svgText || "");
  for (const m of src.matchAll(/fill\s*=\s*["']\s*([^"']+)["']/gi)) add(m[1]);
  for (const m of src.matchAll(/fill\s*:\s*([^;"']+)/gi)) add(m[1]);
  return out;
}

export function parseSvgViewBox(svgText) {
  const src = String(svgText || "");
  const m = src.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/i);
  if (m) return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  const wm = src.match(/\bwidth\s*=\s*["']\s*([\d.]+)/i);
  const hm = src.match(/\bheight\s*=\s*["']\s*([\d.]+)/i);
  return { x: 0, y: 0, w: +(wm?.[1] || 100), h: +(hm?.[1] || 100) };
}

/** Drop full-canvas background rects so logos don't stamp a white plate. */
export function prepareSvgStripBg(svgText) {
  if (!svgText?.trim() || typeof DOMParser === "undefined") return svgText;
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() === "parsererror") return svgText;
  const vb = parseSvgViewBox(svgText);
  const viewArea = Math.max(1, vb.w * vb.h);
  for (const el of [...svg.querySelectorAll("rect")]) {
    const x = parseFloat(el.getAttribute("x") || "0");
    const y = parseFloat(el.getAttribute("y") || "0");
    const w = parseFloat(el.getAttribute("width") || "0");
    const h = parseFloat(el.getAttribute("height") || "0");
    if (w * h > viewArea * 0.88 && Math.abs(x - vb.x) < vb.w * 0.05 && Math.abs(y - vb.y) < vb.h * 0.05) {
      el.remove();
    }
  }
  return new XMLSerializer().serializeToString(svg);
}

export function ensureSvgSized(svgText) {
  const textIn = String(svgText || "").trim();
  if (!/<svg[\s>]/i.test(textIn)) throw new Error("Not an SVG file");
  const viewBox = parseSvgViewBox(textIn);
  const aspect = viewBox.w / Math.max(viewBox.h, 1e-6);
  let text = textIn;
  if (!/\swidth\s*=/i.test(text)) {
    text = text.replace(/<svg\b/i, `<svg width="${viewBox.w}"`);
  }
  if (!/\sheight\s*=/i.test(text)) {
    text = text.replace(/<svg\b/i, `<svg height="${viewBox.h}"`);
  }
  return { text, viewBox, aspect };
}

export async function rasterizeSvgText(svgText, maxDim = ART_MAX_RASTER) {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    throw new Error("SVG rasterize needs a browser");
  }
  const stripped = prepareSvgStripBg(svgText);
  const { text, viewBox, aspect } = ensureSvgSized(stripped);
  const w = aspect >= 1 ? maxDim : Math.max(32, Math.round(maxDim * aspect));
  const h = aspect >= 1 ? Math.max(32, Math.round(maxDim / aspect)) : maxDim;
  return new Promise((resolve, reject) => {
    const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ imageData, width: w, height: h, aspect, canvas, viewBox });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read SVG"));
    };
    img.src = url;
  });
}

function canvasFromImage(img, maxDim) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const aspect = iw / Math.max(ih, 1e-6);
  const w = aspect >= 1 ? maxDim : Math.max(32, Math.round(maxDim * aspect));
  const h = aspect >= 1 ? Math.max(32, Math.round(maxDim / aspect)) : maxDim;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { imageData, width: w, height: h, aspect, canvas, viewBox: null };
}

export async function rasterizeImageFile(file, maxDim = ART_MAX_RASTER) {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    throw new Error("Image rasterize needs a browser");
  }
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const result = canvasFromImage(img, maxDim);
        URL.revokeObjectURL(url);
        resolve(result);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

/** Tangent frame at a hit: right / up / normal, with in-plane rotation. */
export function makeStampFrame(origin, normal, rotationDeg = 0) {
  const n = normalize(normal);
  const upGuess = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  let right = cross(upGuess, n);
  if (hypot3(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  let up = normalize(cross(n, right));
  const rad = (rotationDeg || 0) * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const rightR = [
    right[0] * c + up[0] * s,
    right[1] * c + up[1] * s,
    right[2] * c + up[2] * s,
  ];
  const upR = [
    -right[0] * s + up[0] * c,
    -right[1] * s + up[1] * c,
    -right[2] * s + up[2] * c,
  ];
  return {
    origin: [origin[0], origin[1], origin[2]],
    normal: n,
    right: normalize(rightR),
    up: normalize(upR),
  };
}

export function mirrorStampFrameX(frame, centerX = 0) {
  return {
    origin: [2 * centerX - frame.origin[0], frame.origin[1], frame.origin[2]],
    right: [-frame.right[0], frame.right[1], frame.right[2]],
    up: [-frame.up[0], frame.up[1], frame.up[2]],
    normal: [-frame.normal[0], frame.normal[1], frame.normal[2]],
  };
}

function sampleStamp(pixels, imgW, imgH, u, v, widthMm, heightMm, alphaMin) {
  const halfW = widthMm / 2, halfH = heightMm / 2;
  if (u < -halfW || u > halfW || v < -halfH || v > halfH) return null;
  const px = ((u + halfW) / widthMm) * (imgW - 1);
  const py = (1 - (v + halfH) / heightMm) * (imgH - 1);
  const ix = Math.max(0, Math.min(imgW - 1, (px + 0.5) | 0));
  const iy = Math.max(0, Math.min(imgH - 1, (py + 0.5) | 0));
  const o = (iy * imgW + ix) * 4;
  const a = pixels[o + 3];
  if (a < alphaMin) return null;
  return [pixels[o], pixels[o + 1], pixels[o + 2], a];
}

/**
 * Project a raster stamp onto mesh faces. Returns { face, r, g, b } hits.
 */
export function collectStampHits({
  verts,
  faces,
  nTri,
  origin,
  right,
  up,
  normal,
  widthMm,
  heightMm,
  pixels,
  imgW,
  imgH,
  alphaMin = ART_ALPHA_MIN,
  maxAngleDot = Math.cos(70 * Math.PI / 180),
  maxBehindMm = 18,
  maxFrontMm = 14,
}) {
  const hits = [];
  if (!verts || !faces || !pixels || !nTri || widthMm <= 0 || heightMm <= 0) return hits;
  const ox = origin[0], oy = origin[1], oz = origin[2];
  const rx = right[0], ry = right[1], rz = right[2];
  const ux = up[0], uy = up[1], uz = up[2];
  const nx = normal[0], ny = normal[1], nz = normal[2];

  const project = (x, y, z) => {
    const dx = x - ox, dy = y - oy, dz = z - oz;
    return [dx * rx + dy * ry + dz * rz, dx * ux + dy * uy + dz * uz, dx * nx + dy * ny + dz * nz];
  };

  for (let i = 0; i < nTri; i++) {
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = verts[i0 * 3], ay = verts[i0 * 3 + 1], az = verts[i0 * 3 + 2];
    const bx = verts[i1 * 3], by = verts[i1 * 3 + 1], bz = verts[i1 * 3 + 2];
    const cx = verts[i2 * 3], cy = verts[i2 * 3 + 1], cz = verts[i2 * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let fnx = e1y * e2z - e1z * e2y;
    let fny = e1z * e2x - e1x * e2z;
    let fnz = e1x * e2y - e1y * e2x;
    const fl = hypot3(fnx, fny, fnz);
    fnx /= fl; fny /= fl; fnz /= fl;
    if (fnx * nx + fny * ny + fnz * nz < maxAngleDot) continue;

    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    const pc = project(mx, my, mz);
    if (pc[2] < -maxBehindMm || pc[2] > maxFrontMm) continue;

    let samp = sampleStamp(pixels, imgW, imgH, pc[0], pc[1], widthMm, heightMm, alphaMin);
    if (!samp) {
      const pa = project(ax, ay, az);
      const pb = project(bx, by, bz);
      const pcc = project(cx, cy, cz);
      samp = sampleStamp(pixels, imgW, imgH, pa[0], pa[1], widthMm, heightMm, alphaMin)
        || sampleStamp(pixels, imgW, imgH, pb[0], pb[1], widthMm, heightMm, alphaMin)
        || sampleStamp(pixels, imgW, imgH, pcc[0], pcc[1], widthMm, heightMm, alphaMin);
    }
    if (!samp) continue;
    hits.push({ face: i, r: samp[0], g: samp[1], b: samp[2] });
  }
  return hits;
}

export function stampSizeMm(widthMm, aspect) {
  const w = Math.max(4, widthMm);
  const a = aspect > 0 ? aspect : 1;
  return { widthMm: w, heightMm: w / a };
}
