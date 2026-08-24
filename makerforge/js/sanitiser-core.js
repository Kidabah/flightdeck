/**
 * MakerForge Sanitiser Core 0.1 — reconstructed Stage 2A core (v3)
 *
 * Recovery basis:
 *   - surviving Stage 1 v2 core
 *   - surviving Stage 2A Boundary Inspector consumer
 *   - SESSION_NEXT_codex.md Stage 2A contract/calibration
 *
 * Stage 2A is diagnostic only. It does not modify geometry.
 */

function buildBoundaryDiagnostics(edgeMap, vertexPositions, modelMaxDim) {
  const openEdges = [];

  for (const edge of edgeMap.values()) {
    if (edge.count === 1) openEdges.push(edge);
  }

  if (!openEdges.length) return [];

  const vertexEdges = new Map();

  const addVertexEdge = (vertexId, edgeIndex) => {
    if (!vertexEdges.has(vertexId)) vertexEdges.set(vertexId, []);
    vertexEdges.get(vertexId).push(edgeIndex);
  };

  openEdges.forEach((edge, edgeIndex) => {
    addVertexEdge(edge.a, edgeIndex);
    addVertexEdge(edge.b, edgeIndex);
  });

  const visited = new Uint8Array(openEdges.length);
  const boundaryLoops = [];

  for (let start = 0; start < openEdges.length; start++) {
    if (visited[start]) continue;

    const stack = [start];
    const componentEdges = [];
    const componentVertices = new Set();
    const degree = new Map();
    visited[start] = 1;

    while (stack.length) {
      const edgeIndex = stack.pop();
      const edge = openEdges[edgeIndex];
      componentEdges.push(edge);
      componentVertices.add(edge.a);
      componentVertices.add(edge.b);
      degree.set(edge.a, (degree.get(edge.a) || 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) || 0) + 1);

      for (const vertexId of [edge.a, edge.b]) {
        for (const neighbour of vertexEdges.get(vertexId) || []) {
          if (!visited[neighbour]) {
            visited[neighbour] = 1;
            stack.push(neighbour);
          }
        }
      }
    }

    const vertexIds = [...componentVertices];
    const points = vertexIds.map(vertexId => vertexPositions[vertexId]);
    const closed =
      componentEdges.length >= 3 &&
      vertexIds.every(vertexId => degree.get(vertexId) === 2);
    const complex = !closed;

    let perimeter = 0;
    const segments = componentEdges.map(edge => {
      const a = vertexPositions[edge.a];
      const b = vertexPositions[edge.b];
      perimeter += Math.hypot(
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2]
      );
      return [[...a], [...b]];
    });

    const centroid = [0, 0, 0];
    for (const point of points) {
      centroid[0] += point[0];
      centroid[1] += point[1];
      centroid[2] += point[2];
    }
    const centroidDivisor = Math.max(points.length, 1);
    centroid[0] /= centroidDivisor;
    centroid[1] /= centroidDivisor;
    centroid[2] /= centroidDivisor;

    // Exact boundary diameter. Stage 2A is diagnostic and intentionally
    // prioritises an explainable measurement over repair-oriented heuristics.
    let maxSpan = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        maxSpan = Math.max(
          maxSpan,
          Math.hypot(
            points[i][0] - points[j][0],
            points[i][1] - points[j][1],
            points[i][2] - points[j][2]
          )
        );
      }
    }

    // The original v3 thresholds were not recovered. These conservative,
    // diagnostic-only thresholds satisfy the documented categories without
    // authorising any repair. Large or ambiguous openings remain review-only.
    const spanRatio = maxSpan / Math.max(modelMaxDim, 1e-9);
    let classification;
    let recommendation;

    if (complex) {
      classification = 'COMPLEX';
      recommendation =
        'Branched or non-loop boundary — manual inspection only; never auto-fill.';
    } else if (
      maxSpan <= 2 &&
      perimeter <= 8 &&
      spanRatio <= 0.05
    ) {
      classification = 'SMALL';
      recommendation =
        'Small closed boundary — inspect before considering any later repair.';
    } else if (
      maxSpan <= 10 &&
      perimeter <= 40 &&
      spanRatio <= 0.25
    ) {
      classification = 'REVIEW';
      recommendation =
        'Closed boundary needs review; it may be intentional geometry.';
    } else {
      classification = 'MAJOR';
      recommendation =
        'Large opening — treat as intentional until reviewed.';
    }

    boundaryLoops.push({
      edgeCount: componentEdges.length,
      perimeter,
      maxSpan,
      centroid,
      segments,
      closed,
      complex,
      topology: closed ? 'CLOSED_LOOP' : 'BRANCHED_OR_OPEN',
      classification,
      recommendation,
    });
  }

  return boundaryLoops;
}

export function analyseSanitiserMesh(positions, nTri) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let surfaceArea = 0;
  let degenerateTriangles = 0;
  let duplicateTriangles = 0;
  let edgeSum = 0;
  let edgeCount = 0;

  const edgeMap = new Map();
  const vertexMap = new Map();
  const vertexPositions = [];
  const faceVerts = new Array(nTri);
  const faceKeyMap = new Map();

  const rawVertexKey = (x, y, z, eps) =>
    `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;

  // First pass: bounds
  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    for (let v = 0; v < 3; v++) {
      const p = o + v * 3;
      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  const maxDim = Math.max(sizeX, sizeY, sizeZ);
  const eps = Math.max(maxDim * 1e-7, 1e-7);

  // Second pass: triangle metrics + topology
  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    const pts = [
      [positions[o], positions[o + 1], positions[o + 2]],
      [positions[o + 3], positions[o + 4], positions[o + 5]],
      [positions[o + 6], positions[o + 7], positions[o + 8]],
    ];

    const ux = pts[1][0] - pts[0][0];
    const uy = pts[1][1] - pts[0][1];
    const uz = pts[1][2] - pts[0][2];

    const vx = pts[2][0] - pts[0][0];
    const vy = pts[2][1] - pts[0][1];
    const vz = pts[2][2] - pts[0][2];

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const area2 = Math.hypot(nx, ny, nz);
    const area = area2 * 0.5;

    if (area <= eps * eps) {
      degenerateTriangles++;
    } else {
      surfaceArea += area;
    }

    const keys = pts.map(([x, y, z]) => {
      const key = rawVertexKey(x, y, z, eps);
      if (!vertexMap.has(key)) {
        const vertexId = vertexMap.size;
        vertexMap.set(key, vertexId);
        vertexPositions[vertexId] = [x, y, z];
      }
      return vertexMap.get(key);
    });

    faceVerts[i] = keys;

    // Canonical face identity ignores winding, so an exact duplicate and
    // the same triangle with reversed winding are both counted safely.
    // Degenerate faces are tracked separately and are not double-counted here.
    if (area > eps * eps) {
      const faceKey = [...keys].sort((a, b) => a - b).join('|');
      if (faceKeyMap.has(faceKey)) duplicateTriangles++;
      else faceKeyMap.set(faceKey, i);
    }

    for (let e = 0; e < 3; e++) {
      const a = pts[e];
      const b = pts[(e + 1) % 3];

      edgeSum += Math.hypot(
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2]
      );
      edgeCount++;

      const ia = keys[e];
      const ib = keys[(e + 1) % 3];
      if (ia === ib) continue;

      const edgeKey = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
      const existing = edgeMap.get(edgeKey);
      if (existing) existing.count++;
      else edgeMap.set(edgeKey, { count: 1, a: ia, b: ib });
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;

  for (const edge of edgeMap.values()) {
    if (edge.count === 1) openEdges++;
    else if (edge.count > 2) nonManifoldEdges++;
  }

  // Connected shells/components
  const vertexFaces = Array.from(
    { length: vertexMap.size },
    () => []
  );

  for (let fi = 0; fi < nTri; fi++) {
    for (const vi of faceVerts[fi]) {
      vertexFaces[vi].push(fi);
    }
  }

  const visited = new Uint8Array(nTri);
  let shells = 0;

  for (let start = 0; start < nTri; start++) {
    if (visited[start]) continue;

    shells++;
    const stack = [start];
    visited[start] = 1;

    while (stack.length) {
      const fi = stack.pop();

      for (const vi of faceVerts[fi]) {
        for (const nb of vertexFaces[vi]) {
          if (!visited[nb]) {
            visited[nb] = 1;
            stack.push(nb);
          }
        }
      }
    }
  }

  const watertight =
    openEdges === 0 &&
    nonManifoldEdges === 0 &&
    degenerateTriangles === 0;

  const avgEdge = edgeSum / Math.max(edgeCount, 1);

  // ------------------------------------------------------------
  // Base / bed-contact analysis
  // ------------------------------------------------------------

  const baseTolerance = Math.max(sizeZ * 0.001, 0.05);
  const normalThreshold = 0.985;

  let baseArea = 0;
  let baseTriangles = 0;

  let baseMinX = Infinity;
  let baseMinY = Infinity;
  let baseMaxX = -Infinity;
  let baseMaxY = -Infinity;

  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    const ax = positions[o];
    const ay = positions[o + 1];
    const az = positions[o + 2];

    const bx = positions[o + 3];
    const by = positions[o + 4];
    const bz = positions[o + 5];

    const cx = positions[o + 6];
    const cy = positions[o + 7];
    const cz = positions[o + 8];

    const triMinZ = Math.min(az, bz, cz);
    const triMaxZ = Math.max(az, bz, cz);

    if (triMinZ > minZ + baseTolerance) continue;
    if (triMaxZ > minZ + baseTolerance) continue;

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;

    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength <= 1e-12) continue;

    const absNormalZ = Math.abs(nz / normalLength);

    if (absNormalZ < normalThreshold) continue;

    const projectedArea = Math.abs(nz) * 0.5;

    if (projectedArea <= 0) continue;

    baseArea += projectedArea;
    baseTriangles++;

    baseMinX = Math.min(baseMinX, ax, bx, cx);
    baseMaxX = Math.max(baseMaxX, ax, bx, cx);
    baseMinY = Math.min(baseMinY, ay, by, cy);
    baseMaxY = Math.max(baseMaxY, ay, by, cy);
  }

  const baseWidth =
    baseTriangles > 0 ? baseMaxX - baseMinX : 0;

  const baseDepth =
    baseTriangles > 0 ? baseMaxY - baseMinY : 0;

  const footprintArea = Math.max(sizeX * sizeY, 1e-9);

  const baseCoverage = baseArea / footprintArea;

  let baseRating = 'POOR';

  if (baseCoverage >= 0.50) {
    baseRating = 'EXCELLENT';
  } else if (baseCoverage >= 0.25) {
    baseRating = 'GOOD';
  } else if (baseCoverage >= 0.08) {
    baseRating = 'MARGINAL';
  }

  // ------------------------------------------------------------
  // Scale sanity
  // ------------------------------------------------------------

  const largestDimension = Math.max(sizeX, sizeY, sizeZ);
  const smallestDimension = Math.min(sizeX, sizeY, sizeZ);

  let scaleStatus = 'OK';
  let scaleReason = '';
  let scaleSuspicious = false;

  if (largestDimension < 5) {
    scaleStatus = 'REVIEW';
    scaleSuspicious = true;
    scaleReason =
      'Model dimensions are unusually small and may need scaling.';
  }

  const scale = {
    suspicious: scaleSuspicious,
    status: scaleStatus,
    reason: scaleReason,
    sizeX,
    sizeY,
    sizeZ,
    largestDimension,
    smallestDimension
  };

  const boundaryLoops = buildBoundaryDiagnostics(
    edgeMap,
    vertexPositions,
    maxDim
  );

  return {
    nTri,
    uniqueVertices: vertexMap.size,

    sizeX,
    sizeY,
    sizeZ,
    maxDim,

    surfaceArea,
    avgEdge,

    openEdges,
    nonManifoldEdges,
    degenerateTriangles,
    duplicateTriangles,
    shells,
    watertight,
    scale,
    boundaryLoops,

    base: {
      detected: baseTriangles > 0,
      area: baseArea,
      triangles: baseTriangles,
      width: baseWidth,
      depth: baseDepth,
      coverage: baseCoverage,
      rating: baseRating,
      tolerance: baseTolerance,
    },

    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  };
}

/**
 * Stage 1 safe repair.
 *
 * Removes only objectively invalid/redundant triangles:
 *   - zero/near-zero area triangles
 *   - duplicate triangles, including reversed winding
 *
 * Surviving triangle coordinates are copied unchanged.
 *
 * No welding, hole filling, shell joining, normal re-orientation,
 * or topology reconstruction is performed.
 */
export function repairSanitiserMeshStage1(positions, nTri) {
  if (!positions || !Number.isFinite(nTri) || nTri < 0) {
    throw new Error('Invalid mesh supplied to Stage 1 repair.');
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    for (let v = 0; v < 3; v++) {
      const p = o + v * 3;

      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;

      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const sizeX = Number.isFinite(minX) ? maxX - minX : 0;
  const sizeY = Number.isFinite(minY) ? maxY - minY : 0;
  const sizeZ = Number.isFinite(minZ) ? maxZ - minZ : 0;

  const maxDim = Math.max(sizeX, sizeY, sizeZ, 0);
  const eps = Math.max(maxDim * 1e-7, 1e-7);

  const vertexIds = new Map();
  const keptFaceKeys = new Set();

  let nextVertexId = 0;
  let removedDegenerate = 0;
  let removedDuplicates = 0;

  const kept = [];

  const vertexId = (x, y, z) => {
    const key =
      `${Math.round(x / eps)},` +
      `${Math.round(y / eps)},` +
      `${Math.round(z / eps)}`;

    if (!vertexIds.has(key)) {
      vertexIds.set(key, nextVertexId++);
    }

    return vertexIds.get(key);
  };

  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    const ax = positions[o];
    const ay = positions[o + 1];
    const az = positions[o + 2];

    const bx = positions[o + 3];
    const by = positions[o + 4];
    const bz = positions[o + 5];

    const cx = positions[o + 6];
    const cy = positions[o + 7];
    const cz = positions[o + 8];

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;

    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const area = Math.hypot(nx, ny, nz) * 0.5;

    if (area <= eps * eps) {
      removedDegenerate++;
      continue;
    }

    const ids = [
      vertexId(ax, ay, az),
      vertexId(bx, by, bz),
      vertexId(cx, cy, cz),
    ].sort((a, b) => a - b);

    const faceKey = ids.join('|');

    if (keptFaceKeys.has(faceKey)) {
      removedDuplicates++;
      continue;
    }

    keptFaceKeys.add(faceKey);

    for (let v = 0; v < 9; v++) {
      kept.push(positions[o + v]);
    }
  }

  return {
    positions: new Float32Array(kept),
    nTri: kept.length / 9,

    beforeFaces: nTri,
    afterFaces: kept.length / 9,

    removedDegenerate,
    removedDuplicates,

    removedTotal:
      removedDegenerate +
      removedDuplicates,
  };
}
