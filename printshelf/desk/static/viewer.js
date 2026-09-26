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

function fitCamera(camera, controls, radius) {
  const span = Math.max(radius, 0.1);
  controls.target.set(0, span * 0.15, 0);
  camera.position.set(span * 1.8, span * 1.35, span * 1.8);
  camera.near = span / 200;
  camera.far = span * 80;
  camera.updateProjectionMatrix();
  controls.update();
}

function addMesh(scene, geometry) {
  geometry.computeVertexNormals();
  geometry.center();
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd5dde6,
    metalness: 0.08,
    roughness: 0.46,
  });
  scene.add(new THREE.Mesh(geometry, material));
  geometry.computeBoundingSphere();
  return geometry.boundingSphere?.radius || 1;
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

  const grid = new THREE.GridHelper(10, 10, 0x3d4c63, 0x2a3544);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
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
  active = { renderer, scene, controls, raf: 0, resizeObs, objectUrl: null };

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
    let radius = 1;
    if (kind === "obj") {
      const group = await new OBJLoader().loadAsync(objectUrl);
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      group.position.sub(center);
      group.rotation.x = -Math.PI / 2;
      group.traverse((obj) => {
        if (obj.isMesh) {
          obj.material = new THREE.MeshStandardMaterial({ color: 0xd5dde6, metalness: 0.08, roughness: 0.46 });
        }
      });
      scene.add(group);
      const size = box.getSize(new THREE.Vector3());
      radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    } else {
      const geometry = await new STLLoader().loadAsync(objectUrl);
      radius = addMesh(scene, geometry);
    }
    const span = Math.max(radius * 2.4, 1);
    grid.scale.setScalar(span / 10);
    fitCamera(camera, controls, radius);
    status.remove();
    tick();
  } catch (err) {
    status.textContent = `Could not open this model: ${err?.message || err}`;
    status.classList.add("error");
  }
}

export function unmountViewer() {
  disposeActive();
}

window.MeshFinderViewer = { mountViewer, unmountViewer };
