import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CharacterBuild } from '../engine/character';
import { buildCharacter } from '../engine/character';
import { buildProduct, type ProductBuild, type ProductPartInfo } from '../engine/product';
import type { AssemblyIR } from '../engine/assembly-ir';
import { compileAssemblyIR } from '../engine/assembly-compiler';
import { fitPerspectiveCameraToBounds, fogDensityForAssetRadius } from '../engine/camera-framing';
import {
  calculateMeasurement,
  formatMeasurement,
  type MeasurementMode,
  type MeasurementResult,
  type MeasurementUnit,
} from '../engine/measurement';
import {
  blockedDeliveryAudit,
  buildFigmaReferenceSvg,
  compareGlbRoundTrip,
  createLocalBuildTelemetry,
  deliveryInputFingerprint,
  snapshotScene,
  withDeliveryAudit,
  type DeliveryAudit,
  type LocalBuildTelemetry,
} from '../engine/delivery-validation';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec, ViewMode } from '../types';

export type CameraView = 'front' | 'iso' | 'top' | 'rear';

export interface ExportReceipt {
  fileName: string;
  bytes: number;
}

export interface InspectablePart {
  id: string;
  name: string;
  category: string;
  material: string;
  surface: string;
  detail: string;
}

export interface ViewportHandle {
  exportGlb: () => Promise<ExportReceipt>;
  exportObj: () => Promise<ExportReceipt>;
  exportStl: () => Promise<ExportReceipt>;
  exportPly: () => Promise<ExportReceipt>;
  exportUsdz: () => Promise<ExportReceipt>;
  exportFigmaSvg: () => Promise<ExportReceipt>;
  exportAssetPack: (context: AssetPackContext) => Promise<ExportReceipt>;
  capturePng: () => Promise<ExportReceipt>;
  cancelExport: () => void;
  setView: (view: CameraView) => void;
  focusPart: (partId: string) => boolean;
  fitAsset: () => void;
  clearMeasurement: () => void;
}

export interface AssetPackContext {
  assetName: string;
  sourceIr: unknown;
  qualityReport: unknown;
  evidenceBoundary: string;
}

interface ResultViewportProps {
  assetKind: AssetKind;
  pack: HumanPack;
  spec: CharacterSpec;
  productSpec: ProductSpec;
  assemblyIR?: AssemblyIR;
  mode: ViewMode;
  measurementEnabled?: boolean;
  measurementMode?: MeasurementMode;
  measurementUnit?: MeasurementUnit;
  onBuilt?: (build: CharacterBuild | ProductBuild) => void;
  onPartSelected?: (part?: InspectablePart) => void;
  onMeasurementChange?: (result: MeasurementResult | undefined, points: 0 | 1 | 2) => void;
  onMeasurementMiss?: () => void;
  onDeliveryAudit?: (audit: DeliveryAudit | undefined) => void;
  onTelemetry?: (telemetry: LocalBuildTelemetry | undefined) => void;
}

interface Runtime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  root: THREE.Group;
  measurement: THREE.Group;
  annotation: THREE.Group;
  floor: THREE.Mesh;
  frame: number;
  observer: ResizeObserver;
  environment: THREE.Texture;
  view: CameraView;
  syncDiagnostics: () => void;
}

function clearGroup(group: THREE.Group): void {
  disposeObject(group);
  group.clear();
}

function annotationLine(
  points: THREE.Vector3[],
  color: THREE.ColorRepresentation,
  dashed = false,
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.12, depthTest: false })
    : new THREE.LineBasicMaterial({ color, depthTest: false });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  line.renderOrder = 1_002;
  return line;
}

function drawMeasurementAnnotation(
  runtime: Runtime,
  points: THREE.Vector3[],
  mode: MeasurementMode,
  unit: MeasurementUnit,
  markerRadius: number,
): void {
  clearGroup(runtime.annotation);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: '#04b7d6', depthTest: false });
  for (const [index, point] of points.entries()) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(markerRadius, 18, 12), markerMaterial.clone());
    marker.name = `measure_point_${index + 1}`;
    marker.position.copy(point);
    marker.renderOrder = 1_003;
    runtime.annotation.add(marker);
    const pointLabel = annotationLabel(index === 0 ? 'A' : 'B', markerRadius * 4.2, '#081416', '#70d6e8');
    pointLabel.position.copy(point).add(new THREE.Vector3(0, markerRadius * 2.2, 0));
    runtime.annotation.add(pointLabel);
  }
  markerMaterial.dispose();
  if (points.length !== 2) return;

  if (mode === 'height') {
    const verticalEnd = new THREE.Vector3(points[0].x, points[1].y, points[0].z);
    runtime.annotation.add(annotationLine([points[0], verticalEnd], '#ff6b35'));
    runtime.annotation.add(annotationLine([verticalEnd, points[1]], '#3158ff', true));
    const corner = new THREE.Mesh(
      new THREE.SphereGeometry(markerRadius * 0.72, 14, 10),
      new THREE.MeshBasicMaterial({ color: '#ff6b35', depthTest: false }),
    );
    corner.position.copy(verticalEnd);
    corner.renderOrder = 1_003;
    runtime.annotation.add(corner);
  } else {
    runtime.annotation.add(annotationLine(points, '#04b7d6'));
  }

  const result = calculateMeasurement(points[0], points[1]);
  const primary = mode === 'height' ? result.heightMeters : result.distanceMeters;
  const labelPosition = mode === 'height'
    ? new THREE.Vector3(points[0].x, (points[0].y + points[1].y) / 2, points[0].z)
    : points[0].clone().lerp(points[1], 0.5);
  const valueLabel = annotationLabel(formatMeasurement(primary, unit), markerRadius * 10.5, '#081416', '#ffffff');
  valueLabel.position.copy(labelPosition).add(new THREE.Vector3(0, markerRadius * 2.1, 0));
  runtime.annotation.add(valueLabel);
}

function annotationLabel(
  text: string,
  width: number,
  background: string,
  foreground: string,
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Measurement label canvas is unavailable.');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#70d6e8';
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  context.fillStyle = foreground;
  context.font = '600 54px IBM Plex Mono, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(width, width / 4, 1);
  sprite.renderOrder = 1_004;
  return sprite;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.userData.morphloomShared) value.dispose();
      }
      material.dispose();
    }
  });
}

function safeFileName(value: string, fallback = 'morphloom-result'): string {
  const normalized = value.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function downloadBlob(blob: Blob, name: string): ExportReceipt {
  const fileName = safeFileName(name);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { fileName, bytes: blob.size };
}

function normalizeVisibleNormals(root: THREE.Object3D): void {
  const normal = new THREE.Vector3();
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const attribute = object.geometry.getAttribute('normal');
    if (!(attribute instanceof THREE.BufferAttribute)) return;
    let changed = false;
    for (let index = 0; index < attribute.count; index += 1) {
      normal.fromBufferAttribute(attribute, index);
      const length = normal.length();
      if (Math.abs(length - 1) <= 0.0005) continue;
      if (length <= 1e-12) normal.set(1, 0, 0);
      else normal.multiplyScalar(1 / length);
      attribute.setXYZ(index, normal.x, normal.y, normal.z);
      changed = true;
    }
    if (changed) attribute.needsUpdate = true;
  });
}

/**
 * Geometry-only exporters do not consistently honour Object3D.visible.
 * Export builds are disposable, so remove every hidden branch before handing
 * them to OBJ/STL/PLY. This prevents the hidden character rig and inspection
 * helpers from becoming unexpected meshes in downstream DCC applications.
 */
function removeInvisibleBranches(root: THREE.Object3D): void {
  for (const child of [...root.children]) {
    if (!child.visible) {
      root.remove(child);
      continue;
    }
    removeInvisibleBranches(child);
  }
  root.updateMatrixWorld(true);
}

function inspectablePartFromObject(object: THREE.Object3D | null): InspectablePart | undefined {
  if (!object) return undefined;
  const productPart = object.userData.part as ProductPartInfo | undefined;
  if (productPart) return productPart;
  const characterPart = object.userData.characterPart as {
    id?: unknown;
    name?: unknown;
    detail?: unknown;
    evidence?: unknown;
  } | undefined;
  if (!characterPart || typeof characterPart.id !== 'string' || typeof characterPart.name !== 'string') return undefined;
  return {
    id: characterPart.id,
    name: characterPart.name,
    category: 'character-detail',
    material: 'procedural garment surface',
    surface: typeof characterPart.evidence === 'string' ? characterPart.evidence : 'inferred',
    detail: typeof characterPart.detail === 'string' ? characterPart.detail : '이름 있는 캐릭터 편집 단위',
  };
}

async function generateGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  normalizeVisibleNormals(root);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: true,
    includeCustomExtensions: true,
  });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLB exporter returned text output.');
  if (result.byteLength > 256 * 1024 * 1024) throw new Error('GLB exceeds the 256MB local safety limit.');
  return result;
}

async function verifyGlbRoundTrip(root: THREE.Object3D, bytes: ArrayBuffer, inputFingerprint: string): Promise<DeliveryAudit> {
  const started = performance.now();
  const source = snapshotScene(root);
  const loader = new GLTFLoader();
  const reopened = await loader.parseAsync(bytes.slice(0), '');
  try {
    const reopenedSnapshot = snapshotScene(reopened.scene);
    return compareGlbRoundTrip(source, reopenedSnapshot, bytes.byteLength, performance.now() - started, inputFingerprint);
  } finally {
    disposeObject(reopened.scene);
  }
}

function stlBytes(root: THREE.Object3D): Uint8Array {
  const view = new STLExporter().parse(root, { binary: true });
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function textBlob(text: string, type: string): Blob {
  return new Blob([text], { type });
}

function createMeasurementField(height: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'measurement_field';
  const material = new THREE.LineBasicMaterial({ color: '#335cff', transparent: true, opacity: 0.42 });
  for (const [index, y] of [0.14, 0.51, 0.72, 0.9].entries()) {
    const curve = new THREE.EllipseCurve(0, 0, height * (0.15 - index * 0.018), height * 0.055);
    const points = curve.getPoints(80).map((point) => new THREE.Vector3(point.x, y * height, point.y));
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material.clone());
    ring.name = `measurement_ring_${index}`;
    group.add(ring);
  }
  return group;
}

function viewDirection(view: CameraView, exteriorOnly: boolean, architectural: boolean): THREE.Vector3 {
  if (view === 'top' && architectural) return new THREE.Vector3(0, 1, 0);
  if (view === 'front' || view === 'top') return new THREE.Vector3(0, 0, 1);
  if (view === 'rear') return new THREE.Vector3(0, 0, -1);
  if (architectural) return new THREE.Vector3(1.35, 0.9, 1.3);
  return exteriorOnly
    ? new THREE.Vector3(-0.58, 0.28, -1.72)
    : new THREE.Vector3(1.5, 0.4, 1.05);
}

function frameBuild(
  runtime: Runtime,
  build: CharacterBuild | ProductBuild,
  assetKind: AssetKind,
  assemblyIR: AssemblyIR | undefined,
  spec: CharacterSpec,
): void {
  const referenceFront = assetKind === 'human' && spec.pose === 'reference-action' && runtime.view === 'front';
  const exteriorOnly = assetKind === 'product' && assemblyIR?.metadata?.scope === 'exterior-only';
  const architectural = assetKind === 'product' && assemblyIR?.metadata?.assetKind === 'building';
  const fov = referenceFront ? 40 : 31;
  const padding = exteriorOnly
    ? runtime.view === 'iso' ? 1.4 : 1.52
    : 1.24;
  const fit = fitPerspectiveCameraToBounds({
    bounds: build.metrics.bounds,
    direction: viewDirection(runtime.view, exteriorOnly, architectural),
    up: architectural && runtime.view === 'top'
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0),
    verticalFovDegrees: fov,
    aspect: runtime.camera.aspect,
    padding,
  });

  const sceneFog = runtime.scene.fog;
  if (sceneFog instanceof THREE.FogExp2) sceneFog.density = fogDensityForAssetRadius(fit.radius);
  runtime.renderer.toneMappingExposure = architectural ? 0.78 : 1;

  runtime.camera.fov = fov;
  runtime.camera.up.copy(fit.up);
  runtime.camera.position.copy(fit.center).addScaledVector(fit.direction, fit.distance);
  runtime.camera.near = Math.max(0.001, fit.distance - fit.radius * 1.8);
  runtime.camera.far = fit.distance + fit.radius * 6;
  runtime.camera.updateProjectionMatrix();
  runtime.camera.lookAt(fit.center);
  runtime.controls.target.copy(fit.center);
  runtime.controls.minDistance = Math.max(fit.radius * 0.55, 0.035);
  runtime.controls.maxDistance = Math.max(fit.distance * 4, fit.radius * 5);
  runtime.controls.update();

  // The former fixed Y=0 floor intersected product assets and appeared as a
  // white plate from elevated views. Keep it safely below every asset.
  const size = build.metrics.bounds.getSize(new THREE.Vector3());
  runtime.floor.position.y = build.metrics.bounds.min.y - Math.max(size.y * 0.08, 0.008);
  runtime.floor.visible = runtime.view === 'iso';
}

function focusBounds(runtime: Runtime, bounds: THREE.Box3): void {
  if (bounds.isEmpty()) return;
  const direction = runtime.camera.position.clone().sub(runtime.controls.target);
  const currentDistance = Math.max(direction.length(), 0.001);
  if (direction.lengthSq() < 1e-8) direction.set(1, 0.45, 1);
  const fit = fitPerspectiveCameraToBounds({
    bounds,
    direction,
    up: runtime.camera.up,
    verticalFovDegrees: runtime.camera.fov,
    aspect: runtime.camera.aspect,
    padding: 1.7,
  });
  // “Focus” must be visibly different from a mere target pan, including for
  // large but thin panels whose projected fit distance can exceed the full
  // assembly's isometric fit. A deliberate crop is acceptable here because
  // FIT ASSET remains a one-click, exact reset.
  const focusedDistance = Math.min(fit.distance, currentDistance * 0.72);
  runtime.camera.position.copy(fit.center).addScaledVector(fit.direction, focusedDistance);
  runtime.camera.near = Math.max(0.0001, focusedDistance - fit.radius * 2.2);
  runtime.camera.far = Math.max(runtime.camera.near + 1, focusedDistance + fit.radius * 8);
  runtime.camera.updateProjectionMatrix();
  runtime.camera.lookAt(fit.center);
  runtime.controls.target.copy(fit.center);
  runtime.controls.minDistance = Math.max(fit.radius * 0.18, 0.001);
  runtime.controls.maxDistance = Math.max(focusedDistance * 8, fit.radius * 10);
  runtime.controls.update();
  runtime.syncDiagnostics();
}

export const ResultViewport = forwardRef<ViewportHandle, ResultViewportProps>(
  function ResultViewport({
    assetKind,
    pack,
    spec,
    productSpec,
    assemblyIR,
    mode,
    measurementEnabled = false,
    measurementMode = 'distance',
    measurementUnit = 'mm',
    onBuilt,
    onPartSelected,
    onMeasurementChange,
    onMeasurementMiss,
    onDeliveryAudit,
    onTelemetry,
  }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const runtimeRef = useRef<Runtime | undefined>(undefined);
    const buildRef = useRef<CharacterBuild | ProductBuild | undefined>(undefined);
    const configRef = useRef({ assetKind, assemblyIR, spec });
    configRef.current = { assetKind, assemblyIR, spec };
    const interactionRef = useRef({ measurementEnabled, measurementMode, measurementUnit, onMeasurementChange, onMeasurementMiss, onPartSelected });
    interactionRef.current = { measurementEnabled, measurementMode, measurementUnit, onMeasurementChange, onMeasurementMiss, onPartSelected };
    const measurementPointsRef = useRef<THREE.Vector3[]>([]);
    const markerRadiusRef = useRef(0.01);
    const assetIdentityRef = useRef<{ assetKind: AssetKind; assemblyIR?: AssemblyIR; productSpec: ProductSpec; spec: CharacterSpec } | undefined>(undefined);
    const validationSequenceRef = useRef(0);
    const exportSequenceRef = useRef(0);
    const validatedGlbRef = useRef<{ sourceKey: string; bytes: ArrayBuffer; audit: DeliveryAudit } | undefined>(undefined);
    const glbPromiseRef = useRef<{ sourceKey: string; promise: Promise<{ bytes: ArrayBuffer; audit: DeliveryAudit }> } | undefined>(undefined);
    const telemetryRef = useRef<LocalBuildTelemetry | undefined>(undefined);

    const resetMeasurement = (): void => {
      measurementPointsRef.current = [];
      const runtime = runtimeRef.current;
      if (runtime) clearGroup(runtime.annotation);
      interactionRef.current.onMeasurementChange?.(undefined, 0);
    };

    const createBeautyBuild = (): CharacterBuild | ProductBuild => assetKind === 'human'
      ? buildCharacter(pack, spec, 'beauty')
      : assemblyIR ? compileAssemblyIR(assemblyIR, 'beauty') : buildProduct(productSpec, 'beauty');

    const ensureValidatedGlb = async (): Promise<{ bytes: ArrayBuffer; audit: DeliveryAudit }> => {
      const sourceKey = deliveryInputFingerprint({ assetKind, assemblyIR, productSpec, spec, pack });
      const cached = validatedGlbRef.current;
      if (cached?.sourceKey === sourceKey && cached.audit.status !== 'blocked') {
        return { bytes: cached.bytes, audit: cached.audit };
      }
      if (glbPromiseRef.current?.sourceKey === sourceKey) return glbPromiseRef.current.promise;
      const promise = (async () => {
        const deliveryBuild = createBeautyBuild();
        try {
          const bytes = await generateGlb(deliveryBuild.root);
          const audit = await verifyGlbRoundTrip(deliveryBuild.root, bytes, sourceKey);
          if (audit.status === 'blocked') throw new Error(audit.blockers.join(' · '));
          validatedGlbRef.current = { sourceKey, bytes, audit };
          return { bytes, audit };
        } finally {
          disposeObject(deliveryBuild.root);
        }
      })();
      glbPromiseRef.current = { sourceKey, promise };
      try {
        return await promise;
      } finally {
        if (glbPromiseRef.current?.promise === promise) glbPromiseRef.current = undefined;
      }
    };

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2('#c9ceca', 0.055);
      const camera = new THREE.PerspectiveCamera(31, 1, 0.001, 30);
      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.065;

      const pmrem = new THREE.PMREMGenerator(renderer);
      const environmentScene = new RoomEnvironment();
      const environment = pmrem.fromScene(environmentScene, 0.04).texture;
      environmentScene.dispose();
      pmrem.dispose();
      scene.environment = environment;

      const key = new THREE.DirectionalLight('#fff5e8', 2.65);
      key.position.set(2.6, 4.4, 3.2);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      scene.add(key);
      const edge = new THREE.DirectionalLight('#6d86ff', 1.35);
      edge.position.set(-3.5, 2.2, -2.4);
      scene.add(edge);
      scene.add(new THREE.HemisphereLight('#f1f4ff', '#4d4f4c', 1.05));
      const reflectionStrip = new THREE.RectAreaLight('#eef4ff', 4.4, 0.24, 2.4);
      reflectionStrip.position.set(1.5, 1.9, 2.2);
      reflectionStrip.lookAt(0, 0.8, 0);
      scene.add(reflectionStrip);
      const warmStrip = new THREE.RectAreaLight('#ffd8b5', 2.45, 0.18, 1.6);
      warmStrip.position.set(-1.4, 1.1, -1.7);
      warmStrip.lookAt(0, 0.75, 0);
      scene.add(warmStrip);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(2.55, 96),
        new THREE.MeshStandardMaterial({ color: '#c8c9c4', roughness: 0.92, metalness: 0.03 }),
      );
      floor.name = 'studio_floor_below_asset';
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const root = new THREE.Group();
      const measurement = new THREE.Group();
      const annotation = new THREE.Group();
      annotation.name = 'interactive_measurement_annotation';
      scene.add(root, measurement, annotation);

      const resize = () => {
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (runtime && build) {
          const config = configRef.current;
          frameBuild(runtime, build, config.assetKind, config.assemblyIR, config.spec);
        }
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);

      const syncDiagnostics = () => {
        const diagnostic = window as Window & { __MORPHLOOM__?: Record<string, unknown> };
        if (!diagnostic.__MORPHLOOM__) return;
        diagnostic.__MORPHLOOM__.view = runtimeRef.current?.view;
        diagnostic.__MORPHLOOM__.cameraPosition = camera.position.toArray();
        diagnostic.__MORPHLOOM__.cameraTarget = controls.target.toArray();
        diagnostic.__MORPHLOOM__.cameraDistance = camera.position.distanceTo(controls.target);
      };
      controls.addEventListener('change', syncDiagnostics);
      const runtime: Runtime = {
        scene, camera, renderer, controls, root, measurement, annotation, floor,
        frame: 0, observer, environment, view: 'iso', syncDiagnostics,
      };
      runtimeRef.current = runtime;
      resize();

      const animate = () => {
        controls.update();
        if (configRef.current.assetKind === 'human') measurement.rotation.y += 0.0007;
        const harnessUpdater = buildRef.current?.root.userData.updateElectricalHarness;
        if (typeof harnessUpdater === 'function') harnessUpdater();
        renderer.render(scene, camera);
        runtime.frame = requestAnimationFrame(animate);
      };
      runtime.frame = requestAnimationFrame(animate);

      const pointer = new THREE.Vector2();
      const raycaster = new THREE.Raycaster();
      let pointerDown = new THREE.Vector2();
      let activePointerId: number | undefined;
      const rememberPointer = (event: PointerEvent) => {
        if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
        activePointerId = event.pointerId;
        pointerDown = new THREE.Vector2(event.clientX, event.clientY);
      };
      const selectPart = (event: PointerEvent) => {
        if (!event.isPrimary || activePointerId !== event.pointerId) return;
        activePointerId = undefined;
        const clickTolerance = event.pointerType === 'touch' ? 14 : 6;
        if (pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > clickTolerance) return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObject(root, true);
        const interaction = interactionRef.current;
        if (interaction.measurementEnabled) {
          const surfaceHit = intersections.find((item) => item.object instanceof THREE.Mesh);
          if (!surfaceHit) {
            interaction.onMeasurementMiss?.();
            return;
          }
          let partObject: THREE.Object3D | null = surfaceHit.object;
          while (partObject && !partObject.userData.part && !partObject.userData.characterPart) partObject = partObject.parent;
          interaction.onPartSelected?.(inspectablePartFromObject(partObject));
          if (measurementPointsRef.current.length >= 2) measurementPointsRef.current = [];
          measurementPointsRef.current.push(surfaceHit.point.clone());
          const points = measurementPointsRef.current;
          drawMeasurementAnnotation(runtime, points, interaction.measurementMode, interaction.measurementUnit, markerRadiusRef.current);
          if (points.length === 2) {
            interaction.onMeasurementChange?.(calculateMeasurement(points[0], points[1]), 2);
          } else {
            interaction.onMeasurementChange?.(undefined, 1);
          }
          return;
        }
        const partHit = intersections.find((item) => item.object.userData.part || item.object.userData.characterPart);
        interaction.onPartSelected?.(inspectablePartFromObject(partHit?.object ?? null));
      };
      const cancelPointer = (event: PointerEvent) => {
        if (activePointerId === event.pointerId) activePointerId = undefined;
      };
      canvas.addEventListener('pointerdown', rememberPointer);
      canvas.addEventListener('pointerup', selectPart);
      canvas.addEventListener('pointercancel', cancelPointer);

      return () => {
        cancelAnimationFrame(runtime.frame);
        observer.disconnect();
        controls.dispose();
        controls.removeEventListener('change', syncDiagnostics);
        disposeObject(scene);
        environment.dispose();
        renderer.dispose();
        canvas.removeEventListener('pointerdown', rememberPointer);
        canvas.removeEventListener('pointerup', selectPart);
        canvas.removeEventListener('pointercancel', cancelPointer);
        runtimeRef.current = undefined;
      };
    }, []);

    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const previousIdentity = assetIdentityRef.current;
      const preserveMeasurement = previousIdentity !== undefined
        && previousIdentity.assetKind === assetKind
        && previousIdentity.assemblyIR === assemblyIR
        && previousIdentity.productSpec === productSpec
        && previousIdentity.spec === spec;
      assetIdentityRef.current = { assetKind, assemblyIR, productSpec, spec };
      clearGroup(runtime.root);
      clearGroup(runtime.measurement);
      clearGroup(runtime.annotation);
      runtime.measurement.rotation.set(0, 0, 0);
      if (!preserveMeasurement) {
        measurementPointsRef.current = [];
        interactionRef.current.onMeasurementChange?.(undefined, 0);
      }

      const compileStarted = performance.now();
      const build = assetKind === 'human'
        ? buildCharacter(pack, spec, mode)
        : assemblyIR ? compileAssemblyIR(assemblyIR, mode) : buildProduct(productSpec, mode);
      const compileMs = performance.now() - compileStarted;
      runtime.root.add(build.root);
      if (assetKind === 'human') {
        runtime.measurement.add(createMeasurementField(build.metrics.heightMeters));
      } else {
        const frame = new THREE.Box3Helper(build.metrics.bounds, '#657477');
        frame.name = 'assembly_bounds';
        const frameMaterial = frame.material as THREE.LineBasicMaterial;
        frameMaterial.transparent = true;
        frameMaterial.opacity = 0.34;
        runtime.measurement.add(frame);
      }
      runtime.measurement.visible = assetKind === 'human' || measurementEnabled;
      buildRef.current = build;
      const size = build.metrics.bounds.getSize(new THREE.Vector3());
      markerRadiusRef.current = Math.max(0.004, Math.min(0.12, size.length() * 0.004));
      const telemetry = createLocalBuildTelemetry(snapshotScene(build.root), compileMs);
      telemetryRef.current = telemetry;
      onTelemetry?.(telemetry);
      onBuilt?.(build);
      frameBuild(runtime, build, assetKind, assemblyIR, spec);
      if (preserveMeasurement && measurementEnabled && measurementPointsRef.current.length > 0) {
        drawMeasurementAnnotation(runtime, measurementPointsRef.current, measurementMode, measurementUnit, markerRadiusRef.current);
      }

      Object.assign(window, {
        __MORPHLOOM__: {
          version: '0.4.0',
          vertices: build.metrics.vertices,
          triangles: build.metrics.triangles,
          heightMeters: build.metrics.heightMeters,
          mode,
          assetKind,
          parts: 'parts' in build.metrics ? build.metrics.parts : undefined,
          view: runtime.view,
        },
      });
      runtime.syncDiagnostics();
    }, [assemblyIR, assetKind, mode, onBuilt, onTelemetry, pack, productSpec, spec]);

    useEffect(() => {
      const sequence = ++validationSequenceRef.current;
      onDeliveryAudit?.(undefined);
      const timer = window.setTimeout(() => {
        void ensureValidatedGlb()
          .then(({ audit }) => {
            if (sequence !== validationSequenceRef.current) return;
            const diagnostic = window as Window & { __MORPHLOOM__?: Record<string, unknown> };
            if (diagnostic.__MORPHLOOM__) {
              diagnostic.__MORPHLOOM__.inputFingerprint = audit.inputFingerprint;
              diagnostic.__MORPHLOOM__.sceneFingerprint = audit.fingerprint;
              diagnostic.__MORPHLOOM__.deliveryStatus = audit.status;
            }
            onDeliveryAudit?.(audit);
            const telemetry = telemetryRef.current;
            if (telemetry) {
              const updated = withDeliveryAudit(telemetry, audit);
              telemetryRef.current = updated;
              onTelemetry?.(updated);
            }
          })
          .catch((error: unknown) => {
            if (sequence !== validationSequenceRef.current) return;
            onDeliveryAudit?.(blockedDeliveryAudit(error));
          });
      }, 80);
      return () => {
        window.clearTimeout(timer);
        validationSequenceRef.current += 1;
      };
    }, [assemblyIR, assetKind, onDeliveryAudit, onTelemetry, pack, productSpec, spec]);

    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (!measurementEnabled) {
        runtime.measurement.visible = assetKind === 'human';
        resetMeasurement();
        return;
      }
      runtime.measurement.visible = true;
      drawMeasurementAnnotation(runtime, measurementPointsRef.current, measurementMode, measurementUnit, markerRadiusRef.current);
      const points = measurementPointsRef.current;
      if (points.length === 2) onMeasurementChange?.(calculateMeasurement(points[0], points[1]), 2);
    }, [measurementEnabled, measurementMode, measurementUnit, onMeasurementChange]);

    useImperativeHandle(ref, () => ({
      setView(view) {
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (!runtime || !build) return;
        runtime.view = view;
        frameBuild(runtime, build, assetKind, assemblyIR, spec);
        runtime.syncDiagnostics();
      },
      focusPart(partId) {
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (!runtime || !build || !partId.trim()) return false;
        let target = build.root.getObjectByName(partId);
        if (!target) build.root.traverse((object) => {
          if (!target && object.userData.part?.id === partId) target = object;
        });
        if (!target || !target.visible) return false;
        const bounds = new THREE.Box3().setFromObject(target, true);
        if (bounds.isEmpty()) return false;
        focusBounds(runtime, bounds);
        return true;
      },
      fitAsset() {
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (!runtime || !build) return;
        frameBuild(runtime, build, assetKind, assemblyIR, spec);
        runtime.syncDiagnostics();
      },
      clearMeasurement() {
        resetMeasurement();
      },
      cancelExport() {
        exportSequenceRef.current += 1;
      },
      async exportGlb() {
        const token = ++exportSequenceRef.current;
        const { bytes } = await ensureValidatedGlb();
        if (token !== exportSequenceRef.current) throw new Error('내보내기가 취소되었습니다.');
        return downloadBlob(new Blob([bytes], { type: 'model/gltf-binary' }), 'morphloom-result.glb');
      },
      async exportObj() {
        if (!buildRef.current) throw new Error('Asset is not ready.');
        const token = ++exportSequenceRef.current;
        const deliveryBuild = createBeautyBuild();
        try {
          removeInvisibleBranches(deliveryBuild.root);
          const result = new OBJExporter().parse(deliveryBuild.root);
          await Promise.resolve();
          if (token !== exportSequenceRef.current) throw new Error('내보내기가 취소되었습니다.');
          return downloadBlob(textBlob(result, 'text/plain;charset=utf-8'), 'morphloom-cad-mesh.obj');
        } finally {
          disposeObject(deliveryBuild.root);
        }
      },
      async exportStl() {
        if (!buildRef.current) throw new Error('Asset is not ready.');
        const token = ++exportSequenceRef.current;
        const deliveryBuild = createBeautyBuild();
        try {
          removeInvisibleBranches(deliveryBuild.root);
          const result = stlBytes(deliveryBuild.root);
          await Promise.resolve();
          if (token !== exportSequenceRef.current) throw new Error('내보내기가 취소되었습니다.');
          return downloadBlob(new Blob([result.buffer as ArrayBuffer], { type: 'model/stl' }), 'morphloom-cad-mesh.stl');
        } finally {
          disposeObject(deliveryBuild.root);
        }
      },
      async exportPly() {
        if (!buildRef.current) throw new Error('Asset is not ready.');
        const token = ++exportSequenceRef.current;
        const deliveryBuild = createBeautyBuild();
        try {
          removeInvisibleBranches(deliveryBuild.root);
          const result = new PLYExporter().parse(deliveryBuild.root, () => undefined, { binary: true });
          if (!(result instanceof ArrayBuffer)) throw new Error('PLY exporter returned an empty payload.');
          await Promise.resolve();
          if (token !== exportSequenceRef.current) throw new Error('내보내기가 취소되었습니다.');
          return downloadBlob(new Blob([result], { type: 'application/octet-stream' }), 'morphloom-static-mesh.ply');
        } finally {
          disposeObject(deliveryBuild.root);
        }
      },
      async exportUsdz() {
        if (!buildRef.current) throw new Error('Asset is not ready.');
        const token = ++exportSequenceRef.current;
        const deliveryBuild = createBeautyBuild();
        try {
          const result = await new USDZExporter().parseAsync(deliveryBuild.root, {
            onlyVisible: true,
            quickLookCompatible: true,
            maxTextureSize: 1024,
          });
          if (token !== exportSequenceRef.current) throw new Error('내보내기가 취소되었습니다.');
          const bytes = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
          return downloadBlob(new Blob([bytes], { type: 'model/vnd.usdz+zip' }), 'morphloom-apple-ar.usdz');
        } finally {
          disposeObject(deliveryBuild.root);
        }
      },
      async exportFigmaSvg() {
        if (!buildRef.current) throw new Error('Asset is not ready.');
        const token = ++exportSequenceRef.current;
        const deliveryBuild = createBeautyBuild();
        try {
          const result = buildFigmaReferenceSvg(deliveryBuild.root, deliveryBuild.root.name || 'Morphloom Asset');
          await Promise.resolve();
          if (token !== exportSequenceRef.current) throw new Error('내보내기가 취소되었습니다.');
          return downloadBlob(textBlob(result, 'image/svg+xml;charset=utf-8'), 'morphloom-figma-reference.svg');
        } finally {
          disposeObject(deliveryBuild.root);
        }
      },
      async exportAssetPack(context) {
        const build = buildRef.current;
        const canvas = canvasRef.current;
        if (!build || !canvas) throw new Error('Asset is not ready.');
        const token = ++exportSequenceRef.current;
        const { bytes: glb, audit } = await ensureValidatedGlb();
        if (token !== exportSequenceRef.current) throw new Error('에셋 팩 저장이 취소되었습니다.');
        const png = await new Promise<Blob | null>((resolve) => {
          const runtime = runtimeRef.current;
          if (runtime) runtime.renderer.render(runtime.scene, runtime.camera);
          canvas.toBlob(resolve, 'image/png', 1);
        });
        if (!png) throw new Error('Asset pack preview capture failed.');
        const deliveryBuild = createBeautyBuild();
        removeInvisibleBranches(deliveryBuild.root);
        let obj: string;
        let stl: Uint8Array;
        let ply: ArrayBuffer;
        let svg: string;
        try {
          obj = new OBJExporter().parse(deliveryBuild.root);
          stl = stlBytes(deliveryBuild.root);
          const plyResult = new PLYExporter().parse(deliveryBuild.root, () => undefined, { binary: true });
          if (!(plyResult instanceof ArrayBuffer)) throw new Error('Asset pack PLY exporter returned an empty payload.');
          ply = plyResult;
          svg = buildFigmaReferenceSvg(deliveryBuild.root, context.assetName);
        } finally {
          disposeObject(deliveryBuild.root);
        }
        const { strToU8, zipSync } = await import('fflate');
        if (token !== exportSequenceRef.current) throw new Error('에셋 팩 저장이 취소되었습니다.');
        const manifest = {
          schema: 'morphloom.asset-pack/0.1',
          generatedAt: new Date().toISOString(),
          assetName: context.assetName,
          evidenceBoundary: context.evidenceBoundary,
          sourceIr: context.sourceIr,
          qualityReport: context.qualityReport,
          deliveryAudit: audit,
          localTelemetry: telemetryRef.current,
          privacy: {
            uploadedToServer: false,
            browserPersistence: false,
            importedResultRetention: 'memory-only, cleared on reload or explicit clear',
          },
          formatScope: {
            glb: 'authoritative editable mesh for Blender, Unity and Unreal glTF importers',
            obj: 'geometry-only CAD/DCC mesh interchange; no PBR material guarantee',
            stl: 'unit-bearing mesh reference for CAD/printing; not STEP/BREP manufacturing geometry',
            ply: 'static dense-mesh interchange for Blender, MeshLab and CloudCompare; textures/materials are not embedded',
            svg: '2D Figma inspection/reference sheet; not a 3D Figma object',
          },
        };
        const files = {
          'model/morphloom-result.glb': new Uint8Array(glb),
          'model/morphloom-cad-mesh.obj': strToU8(obj),
          'model/morphloom-cad-mesh.stl': stl,
          'model/morphloom-static-mesh.ply': new Uint8Array(ply),
          'handoff/morphloom-figma-reference.svg': strToU8(svg),
          'preview/morphloom-result.png': new Uint8Array(await png.arrayBuffer()),
          'metadata/asset-manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
          'metadata/source-ir.json': strToU8(JSON.stringify(context.sourceIr, null, 2)),
          'metadata/quality-report.json': strToU8(JSON.stringify(context.qualityReport, null, 2)),
          'README.txt': strToU8([
            'MORPHLOOM ASSET PACK 0.1',
            '',
            'GLB is the authoritative 3D result and passed an in-browser export/reopen comparison before packaging.',
            'OBJ/STL/PLY are mesh handoff formats, not parametric STEP/BREP manufacturing CAD.',
            'The SVG file is a Figma-importable 2D part-envelope inspection sheet.',
            'Review metadata/quality-report.json and the evidence boundary before professional use.',
          ].join('\n')),
        };
        const zipped = zipSync(files, { level: 6 });
        if (zipped.byteLength > 300 * 1024 * 1024) throw new Error('Asset pack exceeds the 300MB local safety limit.');
        return downloadBlob(
          new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }),
          `${safeFileName(context.assetName)}-morphloom-asset.zip`,
        );
      },
      async capturePng() {
        const token = ++exportSequenceRef.current;
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error('Viewport is not ready.');
        runtime.renderer.render(runtime.scene, runtime.camera);
        const blob = await new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob(resolve, 'image/png', 1));
        if (!blob) throw new Error('PNG capture failed.');
        if (token !== exportSequenceRef.current) throw new Error('캡처가 취소되었습니다.');
        return downloadBlob(blob, 'morphloom-result.png');
      },
    }), [assemblyIR, assetKind, pack, productSpec, spec]);

    return <canvas
      ref={canvasRef}
      className={`character-canvas${measurementEnabled ? ' is-measuring' : ''}`}
      aria-label={measurementEnabled ? '3D 결과 실측 화면. 모델 표면에서 두 점을 선택하세요.' : '3D 결과 미리보기'}
    />;
  },
);
