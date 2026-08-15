/**
 * Painter SVG stamp — planar projection must paint the facing patch and skip the back.
 */
import { collectStampHits, makeStampFrame, mirrorStampFrameX, nearestSlot, parseHexColor, extractSvgFillHexes, stampSizeMm, knockOutPaperBackground, rasterHasAlpha, extractRasterPalette, isSvgArtFile, isRasterArtFile, buildStampSlabs, stampLayersFromTrace, buildStampSlabsFromMasks } from "./_staged/painter-art.js";

let failures = 0;
const results = [];

function check(name, cond, detail = "") {
  if (cond) results.push(`ok   ${name}`);
  else { results.push(`FAIL ${name}${detail ? " — " + detail : ""}`); failures++; }
}

// Two disjoint triangles on z=0, facing +Z — left patch vs right patch
const verts = new Float32Array([
  -8, -4, 0,  -2, -4, 0,  -5, 4, 0,
   2, -4, 0,   8, -4, 0,   5, 4, 0,
  -1, 0, 0,    9, -3, 0,   9, 3, 0,
]);
const faces = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);

// 4×4 raster: left half red opaque, right half transparent
const imgW = 4, imgH = 4;
const pixels = new Uint8ClampedArray(imgW * imgH * 4);
for (let y = 0; y < imgH; y++) {
  for (let x = 0; x < imgW; x++) {
    const o = (y * imgW + x) * 4;
    if (x < 2) { pixels[o] = 200; pixels[o + 3] = 255; }
  }
}

const frame = makeStampFrame([0, 0, 0], [0, 0, 1], 0);
const hits = collectStampHits({
  verts, faces, nTri: 3,
  ...frame,
  widthMm: 20, heightMm: 20,
  pixels, imgW, imgH,
});

check("left triangle paints", hits.some((h) => h.face === 0), `hits=${hits.map((h) => h.face).join(",")}`);
check("right triangle skipped", !hits.some((h) => h.face === 1), `hits=${hits.map((h) => h.face).join(",")}`);
check("grazing vertex does not paint", !hits.some((h) => h.face === 2), `hits=${hits.map((h) => h.face).join(",")}`);
check("painted pixel is red", hits[0]?.r === 200, `r=${hits[0]?.r}`);

const back = makeStampFrame([0, 0, 0], [0, 0, -1], 0);
const backHits = collectStampHits({
  verts, faces, nTri: 2,
  ...back,
  widthMm: 20, heightMm: 20,
  pixels, imgW, imgH,
});
check("back-facing stamp paints nothing", backHits.length === 0, `n=${backHits.length}`);

const far = makeStampFrame([80, 0, 0], [0, 0, 1], 0);
const farHits = collectStampHits({
  verts, faces, nTri: 2,
  ...far,
  widthMm: 20, heightMm: 20,
  pixels, imgW, imgH,
});
check("stamp far from mesh paints nothing", farHits.length === 0, `n=${farHits.length}`);

const mir = mirrorStampFrameX(makeStampFrame([5, 0, 0], [0, 0, 1], 0), 0);
check("mirror X flips origin", Math.abs(mir.origin[0] - (-5)) < 1e-9, `ox=${mir.origin[0]}`);
check("mirror X flips right.x", mir.right[0] < 0);

const slot = nearestSlot([200, 0, 0], [[176, 176, 176], [12, 12, 12], [200, 0, 0]]);
check("nearest slot picks red", slot.slot === 2);

const fills = extractSvgFillHexes('<svg><path fill="#C20820"/><path fill="#131211"/></svg>');
check("extract two fills", fills.length === 2 && fills[0] === "#c20820", fills.join(","));

const size = stampSizeMm(40, 2);
check("aspect keeps height", Math.abs(size.heightMm - 20) < 1e-9, `h=${size.heightMm}`);

check("svg file detect", isSvgArtFile({ name: "logo.SVG", type: "" }));
check("png file detect", isRasterArtFile({ name: "nrl.png", type: "image/png" }));
check("jpg file detect", isRasterArtFile({ name: "panthers.jpg", type: "image/jpeg" }));
check("stl is not art", !isRasterArtFile({ name: "hoodie.stl", type: "" }) && !isSvgArtFile({ name: "hoodie.stl", type: "" }));

const paper = new Uint8ClampedArray(8);
paper[0] = 255; paper[1] = 255; paper[2] = 255; paper[3] = 255;
paper[4] = 192; paper[5] = 0; paper[6] = 0; paper[7] = 255;
check("jpg has no alpha", !rasterHasAlpha(paper));
knockOutPaperBackground(paper);
check("knockout clears white", paper[3] === 0, `a=${paper[3]}`);
check("knockout keeps red", paper[7] === 255 && paper[4] === 192, `r=${paper[4]} a=${paper[7]}`);

const pal = new Uint8ClampedArray(16 * 4);
for (let i = 0; i < 12; i++) { pal[i * 4] = 192; pal[i * 4 + 3] = 255; }
for (let i = 12; i < 16; i++) pal[i * 4 + 3] = 0;
const hexes = extractRasterPalette(pal, { maxColors: 3, alphaMin: 48 });
check("palette from opaque red", hexes[0] === "#c00000", hexes.join(","));

const slabPix = new Uint8ClampedArray(8 * 8 * 4);
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    const o = (y * 8 + x) * 4;
    if (x < 4) { slabPix[o] = 20; slabPix[o + 3] = 255; }
  }
}
const slab = buildStampSlabs({
  pixels: slabPix, imgW: 8, imgH: 8,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, stepMm: 5, singleSlot: 2,
});
check("slab builds triangles", slab.indices.length >= 12, `n=${slab.indices.length}`);
check("slab slot is 2", slab.faceSlots.every((s) => s === 2));
let maxX = -Infinity;
for (let i = 0; i < slab.positions.length; i += 3) maxX = Math.max(maxX, slab.positions[i]);
check("slab stays on left half", maxX <= 0.05, `maxX=${maxX}`);

const redMask = new Uint8Array(16);
const blackMask = new Uint8Array(16);
for (let i = 0; i < 8; i++) redMask[i] = 1;
for (let i = 8; i < 16; i++) blackMask[i] = 1;
const traced = stampLayersFromTrace({
  width: 4, height: 4,
  colorLayers: [
    { rgb: [200, 0, 0], mask: redMask },
    { rgb: [10, 10, 10], mask: blackMask },
  ],
}, { slotForRgb: (rgb) => nearestSlot(rgb, [[176, 176, 176], [12, 12, 12], [200, 0, 0]]).slot });
check("trace layers keep two colours", traced.layers.length === 2, `n=${traced.layers.length}`);
check("trace red maps to slot 2", traced.layers[0].slot === 2, `slot=${traced.layers[0].slot}`);
check("trace black maps to slot 1", traced.layers[1].slot === 1, `slot=${traced.layers[1].slot}`);
const fromMasks = buildStampSlabsFromMasks({
  layers: traced.layers, imgW: 4, imgH: 4,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, stepMm: 5,
});
check("multi-colour slabs build", fromMasks.indices.length >= 24, `n=${fromMasks.indices.length}`);
check("multi-colour uses both slots", new Set(fromMasks.faceSlots).size === 2, [...new Set(fromMasks.faceSlots)].join(","));
const sil = stampLayersFromTrace({ width: 4, height: 4, silhouetteMask: redMask }, { singleSlot: 3 });
check("active slot uses silhouette", sil.layers.length === 1 && sil.layers[0].slot === 3);

for (const line of results) console.log(line);
if (failures) {
  console.error(`\n${failures} painter-art check(s) failed`);
  process.exit(1);
}
console.log("\nAll painter-art checks passed");
