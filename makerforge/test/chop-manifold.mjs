/**
 * Chop tool regression tests — plane-cutting must always yield watertight
 * pieces (0 open edges, 0 non-manifold edges) on both sides of a cut.
 * Run via ./run.sh. Exit code 0 = all pass, 1 = a regression.
 */
import { sliceMeshByPlane, modularCut } from "./_staged/mesh-cut.js";
import { countOpenEdges } from "./_staged/stl.js";

let failures = 0;
const results = [];

function nonManifold(positions, indices, eps = 1e-4) {
  const map = new Map();
  const remap = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const k = `${Math.round(positions[i * 3] / eps)}|${Math.round(positions[i * 3 + 1] / eps)}|${Math.round(positions[i * 3 + 2] / eps)}`;
    if (!map.has(k)) map.set(k, map.size);
    remap.push(map.get(k));
  }
  const ec = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [remap[indices[t]], remap[indices[t + 1]], remap[indices[t + 2]]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      ec.set(key, (ec.get(key) || 0) + 1);
    }
  }
  let bad = 0;
  for (const n of ec.values()) if (n !== 2) bad++;
  return bad;
}

function checkSide(name, side) {
  if (!side) { results.push(`FAIL ${name}: side missing`); failures++; return; }
  const open = side.openEdgeCount ?? countOpenEdges(side.positions, side.indices);
  const nm = nonManifold(side.positions, side.indices);
  const tris = side.indices.length / 3;
  const ok = open === 0 && nm === 0 && tris > 0;
  results.push(`${ok ? "PASS" : "FAIL"} ${name}: tris ${tris}, open ${open}, nonManifold ${nm}`);
  if (!ok) failures++;
}

// -- Test mesh builders ------------------------------------------------

/** Axis-aligned box, correctly wound, already watertight. */
function buildBox(cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const positions = [
    cx - hx, cy - hy, cz - hz, // 0
    cx + hx, cy - hy, cz - hz, // 1
    cx + hx, cy + hy, cz - hz, // 2
    cx - hx, cy + hy, cz - hz, // 3
    cx - hx, cy - hy, cz + hz, // 4
    cx + hx, cy - hy, cz + hz, // 5
    cx + hx, cy + hy, cz + hz, // 6
    cx - hx, cy + hy, cz + hz, // 7
  ];
  const indices = [
    0, 3, 2, 0, 2, 1, // bottom (-z)
    4, 5, 6, 4, 6, 7, // top (+z)
    0, 1, 5, 0, 5, 4, // front (-y)
    2, 3, 7, 2, 7, 6, // back (+y)
    0, 4, 7, 0, 7, 3, // left (-x)
    1, 2, 6, 1, 6, 5, // right (+x)
  ];
  return { positions, indices };
}

function mergeMeshes(meshes) {
  const positions = [];
  const indices = [];
  let base = 0;
  for (const m of meshes) {
    positions.push(...m.positions);
    for (const i of m.indices) indices.push(i + base);
    base += m.positions.length / 3;
  }
  return { positions, indices };
}

// -- Cases ---------------------------------------------------------------

{
  // Axis-aligned cut through the center of a single box.
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const { above, below, loopCount } = sliceMeshByPlane(box, [0, 0, 0], [0, 0, 1]);
  results.push(`INFO axis-aligned: loopCount ${loopCount}`);
  checkSide("axis-aligned above", above);
  checkSide("axis-aligned below", below);
}

{
  // Angled cut (arbitrary normal) through the center of a single box.
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const normal = [1, 1, 1];
  const { above, below, loopCount } = sliceMeshByPlane(box, [0, 0, 0], normal);
  results.push(`INFO angled: loopCount ${loopCount}`);
  checkSide("angled above", above);
  checkSide("angled below", below);
}

{
  // Cut plane passing exactly through one box vertex (non-axis-aligned normal
  // so it doesn't coincide with a whole face).
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const vertex = [5, 5, -5]; // a corner of the box
  const normal = [1, 0.31, 0.17];
  const { above, below } = sliceMeshByPlane(box, vertex, normal);
  checkSide("vertex-through above", above);
  checkSide("vertex-through below", below);
}

{
  // Two disjoint boxes cut by one plane → two separate loops, each side
  // still made of two disjoint watertight shells.
  const boxA = buildBox(-15, 0, 0, 10, 10, 10);
  const boxB = buildBox(15, 0, 0, 10, 10, 10);
  const dumbbell = mergeMeshes([boxA, boxB]);
  const { above, below, loopCount } = sliceMeshByPlane(dumbbell, [0, 0, 0], [0, 0, 1]);
  results.push(`INFO multi-loop: loopCount ${loopCount} (expect 2)`);
  if (loopCount !== 2) { results.push("FAIL multi-loop: expected 2 loops"); failures++; }
  checkSide("multi-loop above", above);
  checkSide("multi-loop below", below);
}

{
  // Chained cut: cut a box, then cut one of the resulting pieces again.
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const first = sliceMeshByPlane(box, [0, 0, 0], [0, 0, 1]);
  checkSide("chained first-cut above", first.above);
  const second = sliceMeshByPlane(first.above, [0, 0, 2], [1, 0, 0]);
  checkSide("chained second-cut above", second.above);
  checkSide("chained second-cut below", second.below);
}

{
  // Modular cut: oversized on Z only should keep bisecting along Z until every piece fits.
  const box = buildBox(0, 0, 0, 8, 8, 40);
  const { pieces, capped } = modularCut(box, [10, 10, 10]);
  results.push(`INFO modular single-axis: ${pieces.length} pieces, capped ${capped}`);
  if (capped) { results.push("FAIL modular single-axis: hit piece cap unexpectedly"); failures++; }
  for (let i = 0; i < pieces.length; i++) checkSide(`modular single-axis piece ${i}`, pieces[i]);
  const allFit = pieces.every((p) => {
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < p.positions.length; i += 3) { minZ = Math.min(minZ, p.positions[i]); maxZ = Math.max(maxZ, p.positions[i]); }
    return maxZ - minZ <= 10 + 1e-6;
  });
  if (!allFit) { results.push("FAIL modular single-axis: a piece still exceeds bed Z"); failures++; }
}

{
  // Modular cut: oversized on all three axes.
  const box = buildBox(0, 0, 0, 25, 25, 25);
  const { pieces, capped } = modularCut(box, [10, 10, 10]);
  results.push(`INFO modular multi-axis: ${pieces.length} pieces, capped ${capped}`);
  if (pieces.length <= 1) { results.push("FAIL modular multi-axis: expected multiple pieces"); failures++; }
  for (let i = 0; i < pieces.length; i++) checkSide(`modular multi-axis piece ${i}`, pieces[i]);
}

{
  // Modular cut: a piece that already fits the bed should be returned unchanged.
  const box = buildBox(0, 0, 0, 8, 8, 8);
  const { pieces } = modularCut(box, [10, 10, 10]);
  if (pieces.length !== 1) { results.push(`FAIL modular already-fits: expected 1 piece, got ${pieces.length}`); failures++; }
  else checkSide("modular already-fits", pieces[0]);
}

for (const r of results) console.log(r);
console.log(failures === 0 ? `\nAll checks passed (${results.length}).` : `\n${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
