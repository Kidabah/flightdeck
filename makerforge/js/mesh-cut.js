/**
 * MakerDeck — plane-based mesh cutting, backed by manifold-3d.
 *
 * The previous implementation was a from-scratch triangle-clip + earcut-cap
 * algorithm (no CSG engine existed anywhere in this repo). It produced open
 * edges on complex or thin geometry — confirmed on both a synthetic
 * adversarial cube (bisected on 3 different axes) and a real 71k-triangle
 * model, where thin/densely-packed cross-sections left dozens of stray open
 * edges even though the source mesh was solid. manifold-3d
 * (github.com/elalish/manifold) is a battle-tested WASM geometry library
 * built specifically to guarantee manifold (watertight) output from
 * boolean/half-space operations, so every cut now goes through
 * Manifold.splitByPlane instead of hand-rolled clipping. Verified against
 * both failure cases above with zero open edges; see chop-manifold.mjs.
 */
import Module from "https://cdn.jsdelivr.net/npm/manifold-3d@3.5.1/manifold.js";
import { countOpenEdges } from "./stl.js?v=372";

let modulePromise = null;
function getManifoldModule() {
  if (!modulePromise) {
    modulePromise = Module().then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return modulePromise;
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function computeBounds(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

function withOpenEdgeCount(m) {
  return m.openEdgeCount === undefined
    ? { ...m, openEdgeCount: countOpenEdges(m.positions, m.indices) }
    : m;
}

/** Build a manifold-3d Manifold from our {positions,indices} mesh, validating it. */
function toManifold(Manifold, MeshCtor, mesh) {
  const vertProperties = mesh.positions instanceof Float32Array ? mesh.positions : Float32Array.from(mesh.positions);
  const triVerts = mesh.indices instanceof Uint32Array ? mesh.indices : Uint32Array.from(mesh.indices);
  let manifold;
  try {
    manifold = new Manifold(new MeshCtor({ numProp: 3, vertProperties, triVerts }));
  } catch (e) {
    throw new Error(`Not a valid manifold mesh (${e.message || e}) — repair it in Mesh Prep first.`);
  }
  const status = manifold.status();
  if (status !== "NoError") {
    manifold.delete();
    throw new Error(`Not a valid manifold mesh (${status}) — repair it in Mesh Prep first.`);
  }
  return manifold;
}

/** Pull a manifold-3d Manifold back into our {positions,indices,openEdgeCount} shape. */
function fromManifold(manifold) {
  const raw = manifold.getMesh();
  const positions = Array.from(raw.vertProperties);
  const indices = Array.from(raw.triVerts);
  return { positions, indices, openEdgeCount: countOpenEdges(positions, indices) };
}

/**
 * Split `mesh` into its separate connected components (islands), if it has
 * more than one. A single flat cutting plane can produce a "half" that's
 * naturally disconnected for complex organic geometry (e.g. slicing
 * through the gap between two legs, or a strap sitting close against a
 * body) — Manifold.splitByPlane has no concept of this and just returns
 * everything on that side as one mesh, silently bundling a smaller
 * detached fragment in with a larger piece instead of surfacing it as its
 * own piece. Manifold's own output already has real shared-vertex
 * topology (that's what "manifold" means), so plain union-find over the
 * index graph is enough — no position-based re-welding needed. Returns
 * [mesh-with-openEdgeCount] unchanged (as a 1-element array) if already a
 * single connected piece.
 */
export function splitIntoIslands(mesh) {
  const { positions, indices } = mesh;
  const numVerts = positions.length / 3;
  const numTri = indices.length / 3;
  const parent = new Int32Array(numVerts);
  for (let i = 0; i < numVerts; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < numTri; t++) {
    union(indices[t * 3], indices[t * 3 + 1]);
    union(indices[t * 3 + 1], indices[t * 3 + 2]);
  }
  const roots = new Set();
  for (let t = 0; t < numTri; t++) roots.add(find(indices[t * 3]));
  if (roots.size <= 1) return [{ positions, indices, openEdgeCount: countOpenEdges(positions, indices) }];

  const islands = [];
  for (const root of roots) {
    const vertMap = new Map();
    const newPositions = [];
    const newIndices = [];
    for (let t = 0; t < numTri; t++) {
      const v0 = indices[t * 3];
      if (find(v0) !== root) continue;
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k];
        let idx = vertMap.get(v);
        if (idx === undefined) {
          idx = newPositions.length / 3;
          newPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
          vertMap.set(v, idx);
        }
        newIndices.push(idx);
      }
    }
    islands.push({ positions: newPositions, indices: newIndices, openEdgeCount: countOpenEdges(newPositions, newIndices) });
  }
  islands.sort((a, b) => b.indices.length - a.indices.length); // largest first, cosmetic ordering
  return islands;
}

/**
 * Slice `mesh` by the plane through `planePoint` with unit `planeNormal`.
 * Returns { above, below }. `above`/`below` are each either a watertight
 * {positions,indices,openEdgeCount} piece or null if the plane didn't
 * intersect that side (e.g. the plane misses the mesh entirely).
 */
export async function sliceMeshByPlane(mesh, planePoint, planeNormal) {
  const { Manifold, Mesh } = await getManifoldModule();
  const normal = normalize(planeNormal);
  const offset = dot(normal, planePoint);
  const manifold = toManifold(Manifold, Mesh, mesh);
  let aboveM, belowM;
  try {
    [aboveM, belowM] = manifold.splitByPlane(normal, offset);
  } finally {
    manifold.delete();
  }
  const above = aboveM.numTri() > 0 ? fromManifold(aboveM) : null;
  const below = belowM.numTri() > 0 ? fromManifold(belowM) : null;
  aboveM.delete();
  belowM.delete();
  return { above, below };
}

/**
 * Round off the low-poly "faceted" look a small cut piece can have once
 * scaled up in a slicer. Real cause: a source scan's triangle budget is
 * fixed and gets divided by surface area across however many pieces a cut
 * produces, so a small piece can end up with very few triangles for its
 * physical size — each one highly visible once magnified, even though the
 * mesh itself is perfectly watertight (confirmed on a real 27-piece cut:
 * every piece 0 open/non-manifold edges, this is a resolution problem, not
 * a correctness one). Uses manifold-3d's own smoothing pipeline rather
 * than a hand-rolled subdivision — `smoothOut` auto-detects which edges
 * are real corners (kept sharp) vs. genuinely curved surface (smoothed to
 * G1 continuity), critically leaving flat faces of 3+ triangles — e.g. the
 * planar cross-section every planar cut produces — untouched, then
 * `refineToLength` subdivides until triangles are below `targetLength`,
 * moving new vertices onto the interpolated smooth surface rather than
 * just flat-splitting.
 *
 * `targetLength` is not required — computed automatically as this piece's
 * own bounding-box diagonal / 80, clamped to [0.1, 3]. That means it's a
 * near no-op on the large pieces from an original dense scan (already
 * finer than that), and meaningfully refines the tiny sparse ones without
 * needing per-piece tuning — same "scale-relative, not a fixed constant"
 * approach as the weld epsilon fixes elsewhere in this pipeline.
 */
export async function smoothMesh(mesh, { targetLength, minSharpAngle = 52.5, minSmoothness = 0 } = {}) {
  const { Manifold, Mesh } = await getManifoldModule();
  const b = computeBounds(mesh.positions);
  const diagonal = Math.hypot(...b.size) || 1;
  const length = targetLength ?? Math.min(3, Math.max(0.1, diagonal / 80));
  let manifold = toManifold(Manifold, Mesh, mesh);
  // manifold-3d's smoothOut has a real edge case on meshes with very few
  // triangles per flat face (confirmed directly: a bare 12-triangle box, 2
  // triangles/face, silently collapses every refined vertex back onto the
  // original 8 corners -- status() still reports NoError throughout, so
  // this can't be caught any other way than knowing to avoid it). Sparse
  // input is exactly what this feature targets (small under-triangulated
  // pieces), so pre-refine first to guarantee every face has enough
  // triangles to dodge it; skip for anything already dense enough that
  // it's very unlikely to be a simple few-triangle shape, so an
  // already-detailed piece doesn't get its triangle count needlessly
  // multiplied before refineToLength even runs.
  if (manifold.numTri() < 2000) {
    const denser = manifold.refine(4);
    manifold.delete();
    manifold = denser;
  }
  let smoothed, refined;
  try {
    smoothed = manifold.smoothOut(minSharpAngle, minSmoothness);
    refined = smoothed.refineToLength(length);
  } finally {
    manifold.delete();
  }
  if (refined.numTri() > 2_000_000) {
    smoothed.delete();
    refined.delete();
    throw new Error(`Smoothing would produce ${refined.numTri()} triangles — aborted to avoid freezing the browser.`);
  }
  const result = fromManifold(refined);
  smoothed.delete();
  refined.delete();
  return result;
}

/**
 * Compute `planeCount` default evenly-spaced planes across `mesh`'s full
 * extent along `normal`, anchored at `planePoint`. Returns
 * [{t, point, normal}] ordered low-to-high, where `t` is signed distance
 * from `planePoint` along `normal` — the same coordinate space `flexiCut`
 * sorts by. This is LuBan's Flexi cut starting point: build the default
 * list here, optionally move any individual plane's `t`/`point`, then cut
 * with `flexiCut`. Planar cut (`parallelPlaneCut`) is just this with zero
 * overrides, so fixing bugs here fixes both.
 */
export function computeDefaultFlexiPlanes(mesh, planePoint, planeNormal, planeCount) {
  const normal = normalize(planeNormal);
  const { min, max } = computeBounds(mesh.positions);
  const corners = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);
  const projections = corners.map((c) => dot(sub(c, planePoint), normal));
  const tMin = Math.min(...projections);
  const tMax = Math.max(...projections);
  const planes = [];
  for (let i = 1; i <= planeCount; i++) {
    const t = tMin + ((tMax - tMin) * i) / (planeCount + 1);
    planes.push({ t, tMin, tMax, normal, point: [planePoint[0] + normal[0] * t, planePoint[1] + normal[1] * t, planePoint[2] + normal[2] * t] });
  }
  return planes;
}

/**
 * LuBan-style "Flexi cut": sequentially slice `mesh` through an explicit
 * list of `{point, normal, t}` planes (each independently positioned/
 * oriented — unlike parallelPlaneCut's shared normal), always processed
 * low-to-high by `t` regardless of the order given, since the sequential
 * peel-off algorithm below needs ascending order to behave predictably.
 *
 * Each step peels off the "below" side as a finished piece and keeps
 * "above" as the remainder for the next plane. Returns an array of
 * {positions,indices,openEdgeCount} pieces, ordered low-to-high.
 */
export async function flexiCut(mesh, planes) {
  const sorted = [...planes].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const pieces = [];
  let remaining = mesh;
  for (const { point, normal } of sorted) {
    if (!remaining) break;
    const cut = await sliceMeshByPlane(remaining, point, normal);
    if (!cut.below && !cut.above) continue; // plane missed this remainder — try the next one
    if (cut.below) pieces.push(cut.below);
    remaining = cut.above;
  }
  if (remaining) pieces.push(withOpenEdgeCount(remaining));
  return pieces;
}

/**
 * LuBan-style "Number of planes" cut (Planar cut): lay `planeCount`
 * evenly-spaced parallel planes (all sharing `normal`) across the full
 * extent of `mesh` along that normal, splitting it into up to
 * planeCount+1 pieces in one pass. `planeCount` is a literal plane count
 * (matching LuBan's own field of the same name and its multi-plane
 * preview) — 10 planes -> up to 11 pieces, not 10. Just
 * computeDefaultFlexiPlanes + flexiCut with no overrides; see those for
 * the actual cutting logic.
 *
 * By default the span always covers the piece's full extent (tMin to
 * tMax). Pass `startAtPlane: true` to instead treat `planePoint` itself as
 * where the evenly-spaced span begins: everything on the near side of
 * that plane is peeled off once, unsplit, as its own piece (so nothing is
 * lost), and only the far side gets divided into planeCount+1 pieces.
 * Useful when the model's bounding box includes a disconnected low-lying
 * feature (e.g. a tail dipping to the same height as the paws) that would
 * otherwise land in the very first slice.
 */
export async function parallelPlaneCut(mesh, planePoint, planeNormal, planeCount, { startAtPlane = false } = {}) {
  if (planeCount <= 0) return [withOpenEdgeCount(mesh)];
  const normal = normalize(planeNormal);

  const pieces = [];
  let workingMesh = mesh;
  if (startAtPlane) {
    const cut0 = await sliceMeshByPlane(mesh, planePoint, normal);
    if (cut0.below) pieces.push(cut0.below);
    if (!cut0.above) return pieces.length ? pieces : [withOpenEdgeCount(mesh)];
    workingMesh = cut0.above;
  }

  const planes = computeDefaultFlexiPlanes(workingMesh, planePoint, normal, planeCount);
  const rest = await flexiCut(workingMesh, planes);
  return [...pieces, ...rest];
}

/**
 * LuBan-style "Grid cut": divides `mesh` into a waffle-like 3D grid of
 * (xCount+1) x (yCount+1) x (zCount+1) pieces by laying evenly-spaced
 * planes across all three axes independently (LuBan's own "Number of
 * sections in X, Y, Z" — confirmed via reference screenshot showing all
 * three axes cut simultaneously, not just X/Y). Built from the same
 * `parallelPlaneCut` primitive as Straight cut, applied axis by axis to
 * every piece from the previous axis, so it inherits the same watertight
 * guarantees. A count of 0 on any axis skips that axis's split entirely
 * (e.g. xCount=2, yCount=0, zCount=0 behaves like a plain Straight cut
 * along X). Order of pieces is X-major, then Y, then Z within each cell.
 */
export async function gridCut(mesh, xCount, yCount, zCount) {
  const splitAxis = async (pieces, count, normal) => {
    if (count <= 0) return pieces;
    const out = [];
    for (const piece of pieces) out.push(...(await parallelPlaneCut(piece, [0, 0, 0], normal, count)));
    return out;
  };
  let cells = [withOpenEdgeCount(mesh)];
  cells = await splitAxis(cells, xCount, [1, 0, 0]);
  cells = await splitAxis(cells, yCount, [0, 1, 0]);
  cells = await splitAxis(cells, zCount, [0, 0, 1]);
  return cells;
}

/**
 * Auto-fit-to-bed cutting (LuBan's "Modular cut"): recursively bisect
 * `mesh` along whichever axis exceeds `bedSize`, at the midpoint of its
 * current bounds, until every resulting piece fits — no manual plane
 * placement per piece. Each bisection roughly halves the piece's size on
 * the cut axis, so this converges without needing a depth limit, though
 * `maxPieces` still caps runaway cases (e.g. a bed dimension of 0).
 *
 * A raw midpoint split can land squarely on a thin protruding feature
 * (e.g. a toe sticking out from a paw) — and since each recursive halving
 * re-centers on whatever's left, that same thin feature can get sliced
 * through several times in a row before the surrounding chunk finally
 * shrinks below bed size, stranding it as multiple paper-thin slivers
 * instead of one sensible piece. To avoid that, each split first tries the
 * midpoint, and if either resulting half comes out pathologically thin
 * relative to the piece being split, nearby offsets are tried instead,
 * keeping whichever avoids stranding a sliver. The midpoint is always the
 * fallback if no offset does better, so this still terminates exactly as
 * before.
 *
 * Returns { pieces, capped }. `pieces` are watertight
 * {positions,indices,openEdgeCount} meshes. If a plane fails to intersect a
 * still-oversized piece (degenerate geometry), that piece is kept as-is
 * rather than dropped. `capped` is true if maxPieces was hit before every
 * piece fit.
 */
export async function modularCut(mesh, bedSize, { maxPieces = 128, minPieceFraction = 0.15 } = {}) {
  const eps = 1e-6;
  const SPLIT_FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
  const queue = [mesh];
  const pieces = [];
  let capped = false;

  while (queue.length) {
    if (pieces.length + queue.length >= maxPieces) { capped = true; break; }
    const m = queue.pop();
    const b = computeBounds(m.positions);
    let axis = -1, worst = eps;
    for (let i = 0; i < 3; i++) {
      const over = b.size[i] - bedSize[i];
      if (over > worst) { worst = over; axis = i; }
    }
    if (axis === -1) { pieces.push(withOpenEdgeCount(m)); continue; }

    const parentDiagonal = Math.hypot(...b.size);
    const minDiagonal = parentDiagonal * minPieceFraction;
    const normal = [0, 0, 0];
    normal[axis] = 1;

    let fallback = null;
    let chosen = null;
    for (const frac of SPLIT_FRACTIONS) {
      const point = [
        axis === 0 ? b.min[0] + b.size[0] * frac : (b.min[0] + b.max[0]) / 2,
        axis === 1 ? b.min[1] + b.size[1] * frac : (b.min[1] + b.max[1]) / 2,
        axis === 2 ? b.min[2] + b.size[2] * frac : (b.min[2] + b.max[2]) / 2,
      ];
      const cut = await sliceMeshByPlane(m, point, normal);
      if (!cut.above || !cut.below) continue;
      if (frac === 0.5) fallback = cut;
      const da = Math.hypot(...computeBounds(cut.above.positions).size);
      const db = Math.hypot(...computeBounds(cut.below.positions).size);
      if (Math.min(da, db) >= minDiagonal) { chosen = cut; break; }
    }
    const result = chosen || fallback;
    if (!result) { pieces.push(withOpenEdgeCount(m)); continue; }
    queue.push(result.above, result.below);
  }
  if (capped) {
    for (const m of queue) pieces.push(withOpenEdgeCount(m));
  }
  return { pieces, capped };
}
