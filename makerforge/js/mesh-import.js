/**
 * MakerDeck — mesh import (STL + OBJ → indexed {positions, indices})
 */
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { weldMeshVertices } from './stl.js?v=372';

function isLikelyBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  return 84 + nTri * 50 === buffer.byteLength;
}

function parseSTLBinaryPositions(buffer) {
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  const positions = new Float32Array(nTri * 9);
  let off = 84;
  for (let i = 0; i < nTri; i++) {
    off += 12; // skip stored facet normal, we recompute on export
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = dv.getFloat32(off, true);
      off += 4;
    }
    off += 2; // attribute byte count
  }
  return positions;
}

function parseSTLAsciiPositions(text) {
  const verts = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while ((m = re.exec(text))) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  const usable = Math.floor(verts.length / 9) * 9;
  return new Float32Array(verts.slice(0, usable));
}

/** Weld an unindexed flat triangle soup into the repo's {positions,indices} shape. */
function toIndexedMesh(flatPositions) {
  const nVerts = flatPositions.length / 3;
  const naiveIndices = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) naiveIndices[i] = i;
  const welded = weldMeshVertices(Array.from(flatPositions), naiveIndices);
  return { positions: welded.positions, indices: welded.indices };
}

export function loadSTL(buffer) {
  const flat = isLikelyBinarySTL(buffer)
    ? parseSTLBinaryPositions(buffer)
    : parseSTLAsciiPositions(new TextDecoder().decode(buffer));
  if (!flat.length) throw new Error('No triangles found in STL file');
  return toIndexedMesh(flat);
}

function appendTypedArray(dest, arr) {
  for (let i = 0; i < arr.length; i++) dest.push(arr[i]);
}

export function loadOBJ(text) {
  const group = new OBJLoader().parse(text);
  const flat = [];
  group.traverse((child) => {
    if (!child.isMesh) return;
    const geom = child.geometry;
    const posAttr = geom.getAttribute('position');
    if (!posAttr) return;
    if (geom.index) {
      const idx = geom.index.array;
      for (let i = 0; i < idx.length; i++) {
        const vi = idx[i] * 3;
        flat.push(posAttr.array[vi], posAttr.array[vi + 1], posAttr.array[vi + 2]);
      }
    } else {
      appendTypedArray(flat, posAttr.array);
    }
  });
  if (!flat.length) throw new Error('No triangles found in OBJ file');
  return toIndexedMesh(new Float32Array(flat));
}

export async function loadMeshFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.obj')) return loadOBJ(await file.text());
  if (name.endsWith('.stl')) return loadSTL(await file.arrayBuffer());
  throw new Error('Unsupported file type — use .stl or .obj');
}
