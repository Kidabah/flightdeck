import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

let active = null;

function disposeActive() {
  if (!active) return;
  const { renderer, scene, controls, raf, resizeObs, objectUrl } = active;
  if (raf) cancelAnimationFrame(raf);
  if (resizeObs) resizeObs.disconnect();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  controls?.dispose();
  scene?.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose());
    }
  });
  renderer?.dispose();
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  active = null;
}

function meshMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xd5dde6,
    metalness: 0.08,
    roughness: 0.46,
  });
}

function fitCamera(camera, controls, sphere) {
  const center = sphere?.center || new THREE.Vector3();
  const radius = Math.max(sphere?.radius || 1, 0.1);
  controls.target.copy(center);
  camera.position.set(center.x + radius * 1.8, center.y + radius * 0.85, center.z + radius * 1.8);
  camera.near = radius / 200;
  camera.far = radius * 80;
  camera.updateProjectionMatrix();
  controls.update();
  return radius;
}

// STL is Z-up, like a printer. OBJ is usually Y-up already. Sitting a Y-up
// dog on Z rolls him onto his side.
function seatMatrix(box, up) {
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  if (up === "y") {
    return new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz);
  }
  const shift = new THREE.Matrix4().makeTranslation(-cx, -cy, -box.min.z);
  const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  return rot.multiply(shift);
}

function addMesh(parent, geometry) {
  geometry.computeBoundingBox();
  geometry.applyMatrix4(seatMatrix(geometry.boundingBox, "z"));
  geometry.computeVertexNormals();
  const material = meshMaterial();
  parent.add(new THREE.Mesh(geometry, material));
  geometry.computeBoundingSphere();
  return geometry.boundingSphere;
}

function seatGroup(group) {
  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    obj.geometry = obj.geometry.clone();
    obj.geometry.applyMatrix4(obj.matrixWorld);
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.quaternion.identity();
    obj.scale.set(1, 1, 1);
    obj.updateMatrix();
  });
  const box = new THREE.Box3();
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    obj.geometry.computeBoundingBox();
    box.union(obj.geometry.boundingBox);
  });
  if (box.isEmpty()) return new THREE.Sphere(new THREE.Vector3(), 1);
  const mat = seatMatrix(box, "y");
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    obj.geometry.applyMatrix4(mat);
    obj.geometry.computeVertexNormals();
    obj.material = meshMaterial();
  });
  return new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
}

export async function mountViewer(container, { url, kind } = {}) {
  disposeActive();
  if (!container || !url) return;
  container.innerHTML = "";
  const status = document.createElement("div");
  status.className = "viewer-status";
  status.textContent = "Opening model…";
  container.appendChild(status);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1f27);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 5000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "viewer-canvas";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x243044, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 5, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9eb6d4, 0.35);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  const grid = new THREE.GridHelper(10, 10, 0x6d8299, 0x3d4c63);
  const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
  mats.forEach((mat) => {
    mat.transparent = true;
    mat.opacity = 0.85;
  });
  scene.add(grid);

  const resize = () => {
    const w = Math.max(200, container.clientWidth);
    const h = Math.max(200, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();
  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(container);

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (active) active.raf = raf;
    controls.update();
    renderer.render(scene, camera);
  };
  const model = new THREE.Group();
  scene.add(model);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const highlightMat = new THREE.MeshBasicMaterial({
    color: 0xf0a040,
    side: THREE.DoubleSide,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  let highlight = null;
  let press = null;

  function modelMeshes() {
    const meshes = [];
    model.traverse((obj) => {
      if (obj.isMesh) meshes.push(obj);
    });
    return meshes;
  }

  function hitAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(modelMeshes(), false);
    return hits[0] || null;
  }

  function clearHighlight() {
    if (!highlight) return;
    scene.remove(highlight);
    highlight.geometry.dispose();
    highlight = null;
  }

  function showFace(hit) {
    clearHighlight();
    if (!hit?.face) return;
    const pos = hit.object.geometry.attributes.position;
    const verts = [hit.face.a, hit.face.b, hit.face.c].map((index) => (
      new THREE.Vector3().fromBufferAttribute(pos, index).applyMatrix4(hit.object.matrixWorld)
    ));
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const lift = normal.multiplyScalar(Math.max(hit.distance, 1) * 0.002);
    const geometry = new THREE.BufferGeometry();
    const flat = new Float32Array(9);
    verts.forEach((vert, i) => {
      vert.add(lift);
      flat[i * 3] = vert.x;
      flat[i * 3 + 1] = vert.y;
      flat[i * 3 + 2] = vert.z;
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    highlight = new THREE.Mesh(geometry, highlightMat);
    scene.add(highlight);
  }

  function layOnFace(worldNormal) {
    const down = new THREE.Vector3(0, -1, 0);
    const turn = new THREE.Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), down);
    model.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.applyQuaternion(turn);
    model.position.add(center);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const mid = box.getCenter(new THREE.Vector3());
    model.position.x -= mid.x;
    model.position.z -= mid.z;
    model.position.y -= box.min.y;
    model.updateMatrixWorld(true);
    controls.target.copy(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1) * 1.6;
    grid.scale.setScalar(span / 10);
    clearHighlight();
  }

  const onPointerDown = (event) => {
    press = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event) => {
    if (press) return;
    const hit = hitAt(event);
    if (hit) showFace(hit);
    else clearHighlight();
  };
  const onPointerUp = (event) => {
    if (!press) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    press = null;
    if (moved > 6) return;
    const hit = hitAt(event);
    if (!hit?.face) return;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.lengthSq() < 1e-8) return;
    layOnFace(normal);
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  active = {
    renderer, scene, controls, raf: 0, resizeObs, objectUrl: null, model,
  };
  tick();

  try {
    const res = await fetch(url);
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error || "";
      } catch {
        detail = "";
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      throw new Error("This file is a picture named like a model");
    }
    const objectUrl = URL.createObjectURL(new Blob([buf]));
    active.objectUrl = objectUrl;
    let sphere;
    if (kind === "obj") {
      const group = await new OBJLoader().loadAsync(objectUrl);
      model.add(group);
      sphere = seatGroup(group);
    } else {
      const geometry = await new STLLoader().loadAsync(objectUrl);
      sphere = addMesh(model, geometry);
    }
    const radius = fitCamera(camera, controls, sphere);
    const span = Math.max(radius * 2.4, 1);
    grid.scale.setScalar(span / 10);
    status.remove();
    const tip = document.createElement("div");
    tip.className = "viewer-tip";
    tip.textContent = "Click a face to lay it on the bed";
    container.appendChild(tip);
  } catch (err) {
    status.textContent = `Could not open this model: ${err?.message || err}`;
    status.classList.add("error");
  }
}

export function unmountViewer() {
  disposeActive();
}

export async function renderThumb(url, kind) {
  const width = 480;
  const height = 360;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3038);
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 5000);
  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x243044, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 5, 2);
  scene.add(key);
  let objectUrl = "";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("preview failed");
    const buf = await res.arrayBuffer();
    objectUrl = URL.createObjectURL(new Blob([buf]));
    let sphere;
    if (kind === "obj") {
      const group = await new OBJLoader().loadAsync(objectUrl);
      scene.add(group);
      sphere = seatGroup(group);
    } else {
      const geometry = await new STLLoader().loadAsync(objectUrl);
      sphere = addMesh(scene, geometry);
    }
    const center = sphere?.center || new THREE.Vector3();
    const radius = Math.max(sphere?.radius || 1, 0.1);
    camera.position.set(center.x + radius * 1.55, center.y + radius * 0.95, center.z + radius * 1.7);
    camera.lookAt(center);
    camera.near = radius / 100;
    camera.far = radius * 40;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/jpeg", 0.8);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => mat.dispose());
      }
    });
    renderer.dispose();
  }
}

window.MeshFinderViewer = { mountViewer, unmountViewer, renderThumb };
