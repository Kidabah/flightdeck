/**
 * MakerDeck STL Painter Engine — b401
 * Pure computation module: STL parsing, feature detection, 3MF export.
 */

/* ------------------------------------------------------------------ */
/*  STL Parsing                                                       */
/* ------------------------------------------------------------------ */

export function parseSTLBinary(buffer) {
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  const vertices = new Float32Array(nTri * 9);
  const normals = new Float32Array(nTri * 3);
  let off = 84;
  for (let i = 0; i < nTri; i++) {
    normals[i * 3]     = dv.getFloat32(off, true);
    normals[i * 3 + 1] = dv.getFloat32(off + 4, true);
    normals[i * 3 + 2] = dv.getFloat32(off + 8, true);
    off += 12;
    for (let v = 0; v < 9; v++) {
      vertices[i * 9 + v] = dv.getFloat32(off, true);
      off += 4;
    }
    off += 2; // attribute byte count
  }
  return { vertices, normals, nTri };
}

/* ------------------------------------------------------------------ */
/*  Vertex Deduplication                                              */
/* ------------------------------------------------------------------ */

export function deduplicateVertices(vertices, nTri) {
  const EPS = 1e-6;
  const map = new Map();
  const faces = new Uint32Array(nTri * 3);
  const tempVerts = [];
  let nVerts = 0;

  function key(x, y, z) {
    const sx = (Math.round(x / EPS) * EPS).toFixed(5);
    const sy = (Math.round(y / EPS) * EPS).toFixed(5);
    const sz = (Math.round(z / EPS) * EPS).toFixed(5);
    return `${sx},${sy},${sz}`;
  }

  for (let i = 0; i < nTri; i++) {
    for (let v = 0; v < 3; v++) {
      const off = i * 9 + v * 3;
      const x = vertices[off], y = vertices[off + 1], z = vertices[off + 2];
      const k = key(x, y, z);
      let idx = map.get(k);
      if (idx === undefined) {
        idx = nVerts++;
        map.set(k, idx);
        tempVerts.push(x, y, z);
      }
      faces[i * 3 + v] = idx;
    }
  }

  const verts = new Float32Array(tempVerts);
  return { verts, faces, nVerts };
}

/* ------------------------------------------------------------------ */
/*  Feature Detection — Laplacian Smoothing Method                    */
/* ------------------------------------------------------------------ */

export function detectFeatures(verts, faces, nVerts, nTri, opts = {}) {
  const {
    iterations = 60,
    weight = 0.5,
    threshold = 0.35,
    mode = 'both' // 'emboss', 'deboss', 'both'
  } = opts;

  // 1. Build adjacency
  const adjOffsets = new Uint32Array(nVerts + 1);
  const edgeSet = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) edgeSet[i] = new Set();
  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    edgeSet[a].add(b); edgeSet[a].add(c);
    edgeSet[b].add(a); edgeSet[b].add(c);
    edgeSet[c].add(a); edgeSet[c].add(b);
  }
  let totalAdj = 0;
  for (let i = 0; i < nVerts; i++) {
    adjOffsets[i] = totalAdj;
    totalAdj += edgeSet[i].size;
  }
  adjOffsets[nVerts] = totalAdj;
  const adjList = new Uint32Array(totalAdj);
  for (let i = 0; i < nVerts; i++) {
    let off = adjOffsets[i];
    for (const nb of edgeSet[i]) adjList[off++] = nb;
  }

  // 2. Compute vertex normals (area-weighted)
  const vertNormals = new Float32Array(nVerts * 3);
  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    vertNormals[a * 3] += nx; vertNormals[a * 3 + 1] += ny; vertNormals[a * 3 + 2] += nz;
    vertNormals[b * 3] += nx; vertNormals[b * 3 + 1] += ny; vertNormals[b * 3 + 2] += nz;
    vertNormals[c * 3] += nx; vertNormals[c * 3 + 1] += ny; vertNormals[c * 3 + 2] += nz;
  }
  for (let i = 0; i < nVerts; i++) {
    const off = i * 3;
    const len = Math.sqrt(vertNormals[off] ** 2 + vertNormals[off + 1] ** 2 + vertNormals[off + 2] ** 2);
    if (len > 1e-10) {
      vertNormals[off] /= len;
      vertNormals[off + 1] /= len;
      vertNormals[off + 2] /= len;
    }
  }

  // 3. Laplacian smoothing
  let smooth = new Float32Array(verts);
  let tmp = new Float32Array(nVerts * 3);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nVerts; i++) {
      const start = adjOffsets[i], end = adjOffsets[i + 1];
      const count = end - start;
      if (count === 0) {
        tmp[i * 3] = smooth[i * 3];
        tmp[i * 3 + 1] = smooth[i * 3 + 1];
        tmp[i * 3 + 2] = smooth[i * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (let j = start; j < end; j++) {
        const nb = adjList[j];
        sx += smooth[nb * 3];
        sy += smooth[nb * 3 + 1];
        sz += smooth[nb * 3 + 2];
      }
      sx /= count; sy /= count; sz /= count;
      tmp[i * 3]     = weight * smooth[i * 3]     + (1 - weight) * sx;
      tmp[i * 3 + 1] = weight * smooth[i * 3 + 1] + (1 - weight) * sy;
      tmp[i * 3 + 2] = weight * smooth[i * 3 + 2] + (1 - weight) * sz;
    }
    [smooth, tmp] = [tmp, smooth];
  }

  // 4. Signed displacement per vertex
  const displacement = new Float32Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const dx = verts[i * 3]     - smooth[i * 3];
    const dy = verts[i * 3 + 1] - smooth[i * 3 + 1];
    const dz = verts[i * 3 + 2] - smooth[i * 3 + 2];
    displacement[i] = dx * vertNormals[i * 3] + dy * vertNormals[i * 3 + 1] + dz * vertNormals[i * 3 + 2];
  }

  // 5. Classify faces
  const embossMask = new Uint8Array(nTri);
  const debossMask = new Uint8Array(nTri);
  let embossCount = 0, debossCount = 0;

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const avg = (displacement[a] + displacement[b] + displacement[c]) / 3;
    if ((mode === 'emboss' || mode === 'both') && avg > threshold) {
      embossMask[i] = 1;
      embossCount++;
    }
    if ((mode === 'deboss' || mode === 'both') && avg < -threshold) {
      debossMask[i] = 1;
      debossCount++;
    }
  }

  return { embossMask, debossMask, embossCount, debossCount };
}

/* ------------------------------------------------------------------ */
/*  Cluster Cleaning — BFS Connected Components                       */
/* ------------------------------------------------------------------ */

export function cleanClusters(mask, faces, nTri, verts, minArea) {
  // Build face adjacency (shared edge)
  const edgeToFace = new Map();
  function edgeKey(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }

  const faceAdj = new Array(nTri);
  for (let i = 0; i < nTri; i++) faceAdj[i] = [];

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const edges = [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)];
    for (const ek of edges) {
      const prev = edgeToFace.get(ek);
      if (prev !== undefined) {
        faceAdj[prev].push(i);
        faceAdj[i].push(prev);
      }
      edgeToFace.set(ek, i);
    }
  }

  // Triangle area helper
  function triArea(fi) {
    const a = faces[fi * 3], b = faces[fi * 3 + 1], c = faces[fi * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    return 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
  }

  // BFS connected components
  const visited = new Uint8Array(nTri);
  let removed = 0;

  for (let i = 0; i < nTri; i++) {
    if (!mask[i] || visited[i]) continue;
    const cluster = [];
    const queue = [i];
    visited[i] = 1;
    let area = 0;
    while (queue.length > 0) {
      const fi = queue.pop();
      cluster.push(fi);
      area += triArea(fi);
      for (const nb of faceAdj[fi]) {
        if (!visited[nb] && mask[nb]) {
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
    if (area < minArea) {
      for (const fi of cluster) {
        mask[fi] = 0;
        removed++;
      }
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/*  Minimal Store-Only ZIP Creator                                    */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const enc = new TextEncoder();
  const entries = files.map(f => ({
    name: enc.encode(f.name),
    data: f.data instanceof Uint8Array ? f.data : enc.encode(f.data)
  }));

  let localSize = 0;
  for (const e of entries) localSize += 30 + e.name.length + e.data.length;
  let centralSize = 0;
  for (const e of entries) centralSize += 46 + e.name.length;
  const totalSize = localSize + centralSize + 22;

  const buf = new Uint8Array(totalSize);
  const dv = new DataView(buf.buffer);
  let localOff = 0;
  const offsets = [];

  for (const e of entries) {
    offsets.push(localOff);
    const crc = crc32(e.data);
    dv.setUint32(localOff, 0x04034b50, true); localOff += 4;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0x0021, true); localOff += 2;
    dv.setUint32(localOff, crc, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint16(localOff, e.name.length, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    buf.set(e.name, localOff); localOff += e.name.length;
    buf.set(e.data, localOff); localOff += e.data.length;
  }

  const centralStart = localOff;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const crc = crc32(e.data);
    dv.setUint32(localOff, 0x02014b50, true); localOff += 4;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0x0021, true); localOff += 2;
    dv.setUint32(localOff, crc, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint16(localOff, e.name.length, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint32(localOff, 0, true); localOff += 4;
    dv.setUint32(localOff, offsets[i], true); localOff += 4;
    buf.set(e.name, localOff); localOff += e.name.length;
  }
  const centralEnd = localOff;

  dv.setUint32(localOff, 0x06054b50, true); localOff += 4;
  dv.setUint16(localOff, 0, true); localOff += 2;
  dv.setUint16(localOff, 0, true); localOff += 2;
  dv.setUint16(localOff, entries.length, true); localOff += 2;
  dv.setUint16(localOff, entries.length, true); localOff += 2;
  dv.setUint32(localOff, centralEnd - centralStart, true); localOff += 4;
  dv.setUint32(localOff, centralStart, true); localOff += 4;
  dv.setUint16(localOff, 0, true); localOff += 2;

  return buf;
}

/* ------------------------------------------------------------------ */
/*  3MF Export (OrcaSlicer / BambuStudio Compatible)                  */
/* ------------------------------------------------------------------ */

export function export3MF(verts, faces, nVerts, nTri, embossMask, debossMask, options = {}) {
  const {
    bodyColor = '#BBBBBB',
    embossColor = '#FF6600',
    debossColor = '#0066FF',
    filamentType = ['PLA', 'PLA', 'PLA'],
    filamentSettingsId = ['Generic PLA', 'Generic PLA', 'Generic PLA'],
    filamentProfile = 'Generic PLA'
  } = options;

  // Build object_1.model (with painted faces)
  let objVertices = '';
  for (let i = 0; i < nVerts; i++) {
    objVertices += `        <vertex x="${verts[i * 3]}" y="${verts[i * 3 + 1]}" z="${verts[i * 3 + 2]}" />\n`;
  }

  let objTriangles = '';
  for (let i = 0; i < nTri; i++) {
    const v1 = faces[i * 3], v2 = faces[i * 3 + 1], v3 = faces[i * 3 + 2];
    let attrs = '';
    if (embossMask[i]) {
      attrs = ' paint_color="8"';
    } else if (debossMask[i]) {
      attrs = ' paint_color="4"';
    }
    objTriangles += `        <triangle v1="${v1}" v2="${v2}" v3="${v3}"${attrs} />\n`;
  }

  const objectModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
  xmlns:b="http://schemas.bambulab.com/package/2021">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${objVertices}        </vertices>
        <triangles>
${objTriangles}        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const mainModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="1" type="model" p:path="/3D/Objects/object_1.model">
      <components>
        <component objectid="1" p:path="/3D/Objects/object_1.model" />
      </components>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="application/vnd.ms-printing.printticket+xml" />
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/Objects/object_1.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="painted_object" />
    <part id="1" subtype="normal_part">
      <metadata key="name" value="part_1" />
      <metadata key="extruder" value="1" />
    </part>
  </object>
</config>`;

  const colorsArr = [bodyColor.toUpperCase(), embossColor.toUpperCase(), debossColor.toUpperCase()];
  const projectSettings = JSON.stringify({
    filament_colour: colorsArr,
    filament_settings_id: filamentSettingsId,
    filament_type: filamentType
  }, null, 2);

  const zipFiles = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: '3D/3dmodel.model', data: mainModel },
    { name: '3D/_rels/3dmodel.model.rels', data: modelRels },
    { name: '3D/Objects/object_1.model', data: objectModel },
    { name: 'Metadata/model_settings.config', data: modelSettings },
    { name: 'Metadata/project_settings.config', data: projectSettings }
  ];

  const enc = new TextEncoder();
  const prepared = zipFiles.map(f => ({
    name: f.name,
    data: typeof f.data === 'string' ? enc.encode(f.data) : f.data
  }));

  return createZip(prepared);
}
