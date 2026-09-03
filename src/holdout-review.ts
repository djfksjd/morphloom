import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

declare global {
  interface Window { __MORPHLOOM_HOLDOUT_REVIEW__?: { ready: boolean; meshes: number; source: string; error?: string } }
}

const host = document.querySelector<HTMLDivElement>('#review');
const status = document.querySelector<HTMLDivElement>('#status');
const source = new URLSearchParams(location.search).get('src') ?? '';
if (!host || !status || !source.startsWith('/') || source.startsWith('//') || source.includes('\0') || source.includes('..')) {
  throw new Error('A same-origin local GLB source is required.');
}
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
host.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7e6e1');
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.001, 10_000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight('#fff8e9', '#334052', 2.2));
for (const [color, intensity, position] of [
  ['#fff4dd', 5.5, [-3, 5, -4]], ['#dcecff', 3.2, [4, 2, -2]], ['#ffffff', 4.1, [1, 4, 5]],
] as const) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(position[0], position[1], position[2]);
  scene.add(light);
}

try {
  const gltf = await new GLTFLoader().loadAsync(source);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  if (bounds.isEmpty()) throw new Error('GLB contains no visible bounds.');
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = size.length() * 0.5;
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = Math.max(radius * 30, 100);
  camera.position.copy(center).add(new THREE.Vector3(radius * 1.35, radius * 0.88, -radius * 1.65));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  scene.add(gltf.scene);
  let meshes = 0;
  gltf.scene.traverse((object) => { if (object instanceof THREE.Mesh) meshes += 1; });
  window.__MORPHLOOM_HOLDOUT_REVIEW__ = { ready: true, meshes, source };
  status.textContent = `SEALED GLB · ${meshes} MESHES · DRAG / WHEEL`;
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown review error';
  window.__MORPHLOOM_HOLDOUT_REVIEW__ = { ready: false, meshes: 0, source, error: message };
  status.textContent = `BLOCKED · ${message}`;
  throw error;
}

function frame(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
