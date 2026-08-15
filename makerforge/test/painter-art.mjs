/**
 * Painter SVG stamp — planar projection must paint the facing patch and skip the back.
 */
import { collectStampHits, makeStampFrame, mirrorStampFrameX, nearestSlot, parseHexColor, extractSvgFillHexes, stampSizeMm } from "./_staged/painter-art.js";

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
]);
const faces = new Uint32Array([0, 1, 2, 3, 4, 5]);

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
  verts, faces, nTri: 2,
  ...frame,
  widthMm: 20, heightMm: 20,
  pixels, imgW, imgH,
});

check("left triangle paints", hits.some((h) => h.face === 0), `hits=${hits.map((h) => h.face).join(",")}`);
check("right triangle skipped", !hits.some((h) => h.face === 1), `hits=${hits.map((h) => h.face).join(",")}`);
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

for (const line of results) console.log(line);
if (failures) {
  console.error(`\n${failures} painter-art check(s) failed`);
  process.exit(1);
}
console.log("\nAll painter-art checks passed");
