import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { strToU8, zipSync } from 'fflate';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { CharacterBuild } from '../engine/character';
import { buildCharacter } from '../engine/character';
import { buildProduct, type ProductBuild, type ProductPartInfo } from '../engine/product';
import type { AssemblyIR } from '../engine/assembly-ir';
import { compileAssemblyIR, waitForReferenceProjections } from '../engine/assembly-compiler';
import { inspectSurfaceSystem } from '../engine/surface-system';
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
  DELIVERY_PIPELINE_REVISION,
  SCENE_FINGERPRINT_REVISION,
  deliveryInputFingerprint,
  snapshotScene,
  withDeliveryAudit,
  type DeliveryAudit,
  type LocalBuildTelemetry,
} from '../engine/delivery-validation';
import { validateGlbStandard } from '../engine/gltf-standard-validation';
import { createPortableGltfExportInput, preparePortableGltfGeometry } from '../engine/gltf-export-preparation';
import { canonicalizeGlbBufferViews } from '../engine/glb-canonicalization';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec, ViewMode } from '../types';
import { SerializedTaskQueue } from '../engine/serialized-task-queue';
import {
  assertStaticMeshPayloadBytes,
  compareStaticMeshRoundTrip,
  exportMillimetreStlBytes,
  STATIC_DELIVERY_REVISION,
  type StaticMeshFormat,
  type StaticMeshRoundTripAudit,
} from '../engine/static-mesh-roundtrip';
import { repairThreeUsdz } from '../engine/usdz-conformance';
import { bridgeDataTexturesForUsdz } from '../engine/usdz-texture-bridge';

export type CameraView = 'front' | 'iso' | 'top' | 'rear';
export type BuildingLevel = 'all' | 'L1' | 'L2';
export type LightingMode = 'day' | 'night';

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
  setBuildingLevel: (level: BuildingLevel) => void;
  setLighting: (mode: LightingMode) => void;
  focusPart: (partId: string) => boolean;
  fitAsset: () => void;
  zoomBy: (factor: number) => void;
  clearMeasurement: () => void;
}

export interface AssetPackContext {
  assetId: string;
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
  dimensionOverviewEnabled?: boolean;
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
  dimensionOverview: THREE.Group;
  floor: THREE.Mesh;
  frame: number;
  observer: ResizeObserver;
  environment: THREE.Texture;
  view: CameraView;
  buildingLevel: BuildingLevel;
  lighting: LightingMode;
  key: THREE.DirectionalLight;
  edge: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  reflectionStrip: THREE.RectAreaLight;
  warmStrip: THREE.RectAreaLight;
  syncDiagnostics: () => void;
}

function clearGroup(group: THREE.Group): void {
  disposeObject(group);
  group.clear();
}

function applyLighting(runtime: Runtime, build?: CharacterBuild | ProductBuild): void {
  const night = runtime.lighting === 'night';
  runtime.renderer.toneMappingExposure = night ? 1 : 1;
  runtime.scene.background = new THREE.Color(night ? '#182535' : '#d9dad5');
  runtime.scene.fog = new THREE.FogExp2(night ? '#1a2938' : '#c9ceca', night ? 0.026 : 0.055);
  runtime.key.intensity = night ? 1.35 : 2.65;
  runtime.edge.intensity = night ? 1.5 : 1.35;
  runtime.hemisphere.intensity = night ? 0.75 : 1.05;
  runtime.reflectionStrip.intensity = night ? 1.8 : 4.4;
  runtime.warmStrip.intensity = night ? 1.65 : 2.45;
  build?.root.traverse((object) => {
    if (!(object instanceof THREE.PointLight) || !object.userData.morphloomFixture) return;
    object.intensity = night ? Number(object.userData.nightIntensity ?? 1) : Number(object.userData.dayIntensity ?? 0.08);
  });
  runtime.syncDiagnostics();
}

function zoomOptically(runtime: Runtime, factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return;
  runtime.camera.zoom = THREE.MathUtils.clamp(runtime.camera.zoom * factor, 0.65, 12);
  runtime.camera.updateProjectionMatrix();
  runtime.syncDiagnostics();
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

function drawDimensionOverview(
  runtime: Runtime,
  build: CharacterBuild | ProductBuild,
  unit: MeasurementUnit,
): void {
  clearGroup(runtime.dimensionOverview);
  build.root.updateMatrixWorld(true);
  const assetSize = build.metrics.bounds.getSize(new THREE.Vector3());
  const assetDiagonal = Math.max(assetSize.length(), 0.1);
  const architecturalScale = assetDiagonal > 4;
  const tick = architecturalScale
    ? Math.max(assetDiagonal * 0.006, 0.018)
    : THREE.MathUtils.clamp(assetDiagonal * 0.012, 0.0015, 0.02);
  const labelWidth = architecturalScale
    ? THREE.MathUtils.clamp(assetDiagonal * 0.092, 0.48, 1.72)
    : THREE.MathUtils.clamp(assetDiagonal * 0.24, 0.03, 0.22);
  const repeatedDetail = /(slat|seam|mullion|post|step|chair|light|screw|port|ring|aperture|connector|nightstand|ridge cap)/i;
  const candidates: Array<{
    bounds: THREE.Box3;
    size: THREE.Vector3;
    part: ProductPartInfo;
    priority: number;
  }> = [];
  const seenPartIds = new Set<string>();
  build.root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.part) return;
    const part = object.userData.part as ProductPartInfo;
    if (seenPartIds.has(part.id) || repeatedDetail.test(`${part.id} ${part.name}`)) return;
    const bounds = new THREE.Box3().setFromObject(object, true);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest < assetDiagonal * 0.012) return;
    seenPartIds.add(part.id);
    const architecturalWeight = part.category === 'enclosure' ? assetDiagonal * 0.2 : part.category === 'display' ? assetDiagonal * 0.08 : 0;
    candidates.push({ bounds, size, part, priority: longest + Math.cbrt(Math.max(size.x * size.y * size.z, 0)) * 0.25 + architecturalWeight });
  });

  const maximumDimensions = architecturalScale ? 20 : 4;
  const selected = candidates.sort((left, right) => right.priority - left.priority).slice(0, maximumDimensions);
  selected.forEach(({ bounds, size, part }, index) => {
    const lane = index % 4;
    const laneStep = architecturalScale ? 0.6 : 3.8;
    const offset = Math.max(tick * (2.1 + lane * laneStep), Math.min(size.y, assetDiagonal * 0.03) * 0.18);
    const y = bounds.max.y + offset;
    const z = bounds.max.z + offset * 0.35;
    const widthStart = new THREE.Vector3(bounds.min.x, y, z);
    const widthEnd = new THREE.Vector3(bounds.max.x, y, z);
    runtime.dimensionOverview.add(annotationLine([widthStart, widthEnd], '#04b7d6'));
    runtime.dimensionOverview.add(annotationLine([
      widthStart.clone().add(new THREE.Vector3(0, -tick, 0)),
      widthStart.clone().add(new THREE.Vector3(0, tick, 0)),
    ], '#04b7d6'));
    runtime.dimensionOverview.add(annotationLine([
      widthEnd.clone().add(new THREE.Vector3(0, -tick, 0)),
      widthEnd.clone().add(new THREE.Vector3(0, tick, 0)),
    ], '#04b7d6'));
    const widthLabel = annotationLabel(
      `W ${formatMeasurement(size.x, unit)}  ·  D ${formatMeasurement(size.z, unit)}`,
      labelWidth,
      '#10191b',
      '#ffffff',
    );
    widthLabel.position.copy(widthStart).lerp(widthEnd, 0.5).add(new THREE.Vector3(0, tick * 1.55, 0));
    widthLabel.userData.partId = part.id;
    runtime.dimensionOverview.add(widthLabel);

    const heightX = bounds.max.x + offset * 0.9;
    const heightStart = new THREE.Vector3(heightX, bounds.min.y, z);
    const heightEnd = new THREE.Vector3(heightX, bounds.max.y, z);
    runtime.dimensionOverview.add(annotationLine([heightStart, heightEnd], '#ffb454'));
    runtime.dimensionOverview.add(annotationLine([
      heightStart.clone().add(new THREE.Vector3(-tick, 0, 0)),
      heightStart.clone().add(new THREE.Vector3(tick, 0, 0)),
    ], '#ffb454'));
    runtime.dimensionOverview.add(annotationLine([
      heightEnd.clone().add(new THREE.Vector3(-tick, 0, 0)),
      heightEnd.clone().add(new THREE.Vector3(tick, 0, 0)),
    ], '#ffb454'));
    const heightLabel = annotationLabel(
      `H ${formatMeasurement(size.y, unit)}`,
      labelWidth * 0.72,
      '#261b0d',
      '#fff7e8',
      '#ffb454',
    );
    heightLabel.position.copy(heightStart).lerp(heightEnd, 0.5).add(new THREE.Vector3(
      offset * 0.85,
      architecturalScale ? 0 : (lane - 1.5) * labelWidth * 0.38,
      0,
    ));
    heightLabel.userData.partId = part.id;
    runtime.dimensionOverview.add(heightLabel);
  });
  runtime.dimensionOverview.userData.dimensionCount = selected.length;
  runtime.dimensionOverview.userData.dimensionCandidateCount = candidates.length;
  runtime.dimensionOverview.userData.dimensionLimit = maximumDimensions;
  runtime.dimensionOverview.userData.dimensionLabelWidth = labelWidth;
  runtime.dimensionOverview.userData.dimensionMode = 'decluttered-width-depth-height';
  runtime.dimensionOverview.visible = true;
  runtime.syncDiagnostics();
}

function annotationLabel(
  text: string,
  width: number,
  background: string,
  foreground: string,
  border = '#70d6e8',
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Measurement label canvas is unavailable.');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = border;
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  context.fillStyle = foreground;
  let fontSize = 54;
  do {
    context.font = `600 ${fontSize}px IBM Plex Mono, monospace`;
    if (context.measureText(text).width <= canvas.width - 48 || fontSize <= 24) break;
    fontSize -= 2;
  } while (fontSize > 24);
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
  const disposedTextures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (child.userData.morphloomProjectionActive === true) child.userData.morphloomProjectionActive = false;
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.userData.morphloomShared && !disposedTextures.has(value)) {
          disposedTextures.add(value);
          value.dispose();
        }
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

function visibleInHierarchy(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
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
  await waitForReferenceProjections(root);
  const preparation = preparePortableGltfGeometry(root);
  if (preparation.unresolvedNormalMappedMeshes.length > 0) {
    throw new Error(`Normal-mapped meshes lack portable tangent inputs: ${preparation.unresolvedNormalMappedMeshes.join(', ')}`);
  }
  const exportInput = createPortableGltfExportInput(root);
  const exporter = new GLTFExporter();
  // Three.js logs one warning per PBR material whenever it packs roughness G
  // and metalness B into glTF's required shared texture. This is expected
  // exporter behavior, not data loss; suppress only that exact noisy message.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args[0] === 'THREE.GLTFExporter: Merged metalnessMap and roughnessMap textures.') return;
    originalWarn(...args);
  };
  let result: ArrayBuffer | Record<string, unknown>;
  try {
    result = await exporter.parseAsync(exportInput, {
      binary: true,
      onlyVisible: true,
      includeCustomExtensions: true,
      animations: root.animations,
    });
  } finally {
    console.warn = originalWarn;
  }
  if (!(result instanceof ArrayBuffer)) throw new Error('GLB exporter returned text output.');
  if (result.byteLength > 256 * 1024 * 1024) throw new Error('GLB exceeds the 256MB local safety limit.');
  return canonicalizeGlbBufferViews(result);
}

async function verifyGlbRoundTrip(root: THREE.Object3D, bytes: ArrayBuffer, inputFingerprint: string, buildFingerprint: string): Promise<DeliveryAudit> {
  const started = performance.now();
  // The Khronos validator reads the buffer; avoid duplicating up to 256 MB
  // before the loader's isolated round-trip copy is created.
  const standardValidation = await validateGlbStandard(bytes);
  const source = snapshotScene(root);
  const loader = new GLTFLoader();
  const reopened = await loader.parseAsync(bytes.slice(0), '');
  try {
    reopened.scene.animations = reopened.animations;
    const reopenedSnapshot = snapshotScene(reopened.scene);
    return compareGlbRoundTrip(
      source,
      reopenedSnapshot,
      bytes.byteLength,
      performance.now() - started,
      inputFingerprint,
      buildFingerprint,
      standardValidation,
    );
  } finally {
    disposeObject(reopened.scene);
  }
}

function staticMeshRoundTrip(
  root: THREE.Object3D,
  format: StaticMeshFormat,
  payload: string | ArrayBuffer | Uint8Array,
): StaticMeshRoundTripAudit {
  const source = snapshotScene(root);
  let reopened: THREE.Object3D;
  let bytes: number;
  if (format === 'obj') {
    if (typeof payload !== 'string') throw new Error('OBJ round-trip requires text payload.');
    bytes = new TextEncoder().encode(payload).byteLength;
    assertStaticMeshPayloadBytes(bytes);
    reopened = new OBJLoader().parse(payload);
  } else {
    if (typeof payload === 'string') throw new Error(`${format.toUpperCase()} round-trip requires binary payload.`);
    const buffer = payload instanceof Uint8Array
      ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer
      : payload;
    bytes = buffer.byteLength;
    assertStaticMeshPayloadBytes(bytes);
    const geometry = format === 'stl' ? new STLLoader().parse(buffer) : new PLYLoader().parse(buffer);
    reopened = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  }
  try {
    const audit = compareStaticMeshRoundTrip(
      source,
      snapshotScene(reopened),
      format,
      bytes,
      0.1,
      format === 'stl' ? 1_000 : 1,
    );
    if (audit.status !== 'pass') throw new Error(`${format.toUpperCase()} round-trip blocked: ${audit.blockers.join('; ')}`);
    return audit;
  } finally {
    disposeObject(reopened);
  }
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

function viewDirection(
  view: CameraView,
  exteriorOnly: boolean,
  architectural: boolean,
  horizontalSurface: boolean,
): THREE.Vector3 {
  if (view === 'top' && (architectural || horizontalSurface)) return new THREE.Vector3(0, 1, 0);
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
  // Imported IR can be replaced without recreating the imperative viewer
  // handle. Detect the compiled geometry itself so TOP remains stable across
  // repeated local imports and hot reloads instead of depending on stale props.
  let horizontalSurface = false;
  if (assetKind === 'product') build.root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry.userData.morphloomSurfaceRelief) horizontalSurface = true;
  });
  const fov = referenceFront ? 40 : 31;
  const padding = exteriorOnly
    ? runtime.view === 'iso' ? 1.4 : 1.52
    : 1.24;
  const fit = fitPerspectiveCameraToBounds({
    bounds: build.metrics.bounds,
    direction: viewDirection(runtime.view, exteriorOnly, architectural, horizontalSurface),
    up: (architectural || horizontalSurface) && runtime.view === 'top'
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3(0, 1, 0),
    verticalFovDegrees: fov,
    aspect: runtime.camera.aspect,
    padding,
  });

  const sceneFog = runtime.scene.fog;
  if (sceneFog instanceof THREE.FogExp2) sceneFog.density = fogDensityForAssetRadius(fit.radius);
  runtime.renderer.toneMappingExposure = architectural ? 0.78 : 1;

  runtime.camera.fov = fov;
  runtime.camera.zoom = 1;
  runtime.camera.up.copy(fit.up);
  runtime.camera.position.copy(fit.center).addScaledVector(fit.direction, fit.distance);
  runtime.camera.near = Math.max(0.001, fit.distance - fit.radius * 1.8);
  runtime.camera.far = fit.distance + fit.radius * 6;
  runtime.camera.updateProjectionMatrix();
  runtime.camera.lookAt(fit.center);
  runtime.controls.target.copy(fit.center);
  // Keep the camera outside the asset's bounding sphere. Allowing the dolly
  // inside a building made the model appear to vanish as near faces clipped.
  runtime.controls.minDistance = Math.max(fit.radius * 0.72, 0.035);
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
  // Screen reset remains a one-click exact return to the asset framing.
  const focusedDistance = Math.min(fit.distance, currentDistance * 0.72);
  runtime.camera.zoom = 1;
  runtime.camera.position.copy(fit.center).addScaledVector(fit.direction, focusedDistance);
  runtime.camera.near = Math.max(0.0001, focusedDistance - fit.radius * 2.2);
  runtime.camera.far = Math.max(runtime.camera.near + 1, focusedDistance + fit.radius * 8);
  runtime.camera.updateProjectionMatrix();
  runtime.camera.lookAt(fit.center);
  runtime.controls.target.copy(fit.center);
  runtime.controls.minDistance = Math.max(fit.radius * 0.72, 0.001);
  runtime.controls.maxDistance = Math.max(focusedDistance * 8, fit.radius * 10);
  runtime.controls.update();
  runtime.syncDiagnostics();
}

function applyArchitecturalViewVisibility(
  root: THREE.Object3D,
  view: CameraView,
  assemblyIR: AssemblyIR | undefined,
  buildingLevel: BuildingLevel,
): void {
  if (assemblyIR?.metadata?.assetKind !== 'building') return;
  const planReveal = view === 'top';
  root.traverse((object) => {
    const part = object.userData.part as ProductPartInfo | undefined;
    const partId = part?.id ?? object.name;
    const isRoof = partId.startsWith('roof_') || partId.includes('_roof_') || part?.level === 'ROOF';
    const levelVisible = buildingLevel === 'all' || part?.level === undefined || part.level === buildingLevel;
    object.visible = levelVisible && !(planReveal && isRoof);
    object.userData.planViewHidden = planReveal && isRoof;
    object.userData.levelViewHidden = !levelVisible;
  });
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
    dimensionOverviewEnabled = false,
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
    const interactionRef = useRef({ measurementEnabled, measurementMode, measurementUnit, dimensionOverviewEnabled, onMeasurementChange, onMeasurementMiss, onPartSelected });
    interactionRef.current = { measurementEnabled, measurementMode, measurementUnit, dimensionOverviewEnabled, onMeasurementChange, onMeasurementMiss, onPartSelected };
    const measurementPointsRef = useRef<THREE.Vector3[]>([]);
    const markerRadiusRef = useRef(0.01);
    const assetIdentityRef = useRef<{ assetKind: AssetKind; assemblyIR?: AssemblyIR; productSpec: ProductSpec; spec: CharacterSpec } | undefined>(undefined);
    const validationSequenceRef = useRef(0);
    const exportSequenceRef = useRef(0);
    const validatedGlbRef = useRef<{ sourceKey: string; bytes: ArrayBuffer; audit: DeliveryAudit } | undefined>(undefined);
    const glbQueueRef = useRef<SerializedTaskQueue | undefined>(undefined);
    const glbQueue = glbQueueRef.current ??= new SerializedTaskQueue(4);
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
      return glbQueue.run(sourceKey, async () => {
        const deliveryBuild = createBeautyBuild();
        try {
          const buildFingerprint = snapshotScene(deliveryBuild.root).fingerprint;
          const bytes = await generateGlb(deliveryBuild.root);
          const audit = await verifyGlbRoundTrip(deliveryBuild.root, bytes, sourceKey, buildFingerprint);
          if (audit.status === 'blocked') throw new Error(audit.blockers.join(' · '));
          validatedGlbRef.current = { sourceKey, bytes, audit };
          return { bytes, audit };
        } finally {
          disposeObject(deliveryBuild.root);
        }
      });
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
      controls.zoomToCursor = true;
      controls.screenSpacePanning = true;

      // Perspective dolly can move the camera through walls and make a model
      // look sliced. Morphloom uses optical zoom instead: the camera stays
      // outside the asset while the view magnifies like a design canvas.
      const handleOpticalZoom = (event: WheelEvent) => {
        if (event.deltaY === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const runtime = runtimeRef.current;
        if (runtime) zoomOptically(runtime, Math.exp(-event.deltaY * 0.0015));
      };
      canvas.addEventListener('wheel', handleOpticalZoom, { capture: true, passive: false });

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
      const hemisphere = new THREE.HemisphereLight('#f1f4ff', '#4d4f4c', 1.05);
      scene.add(hemisphere);
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
      const dimensionOverview = new THREE.Group();
      dimensionOverview.name = 'architectural_dimension_overview';
      scene.add(root, measurement, annotation, dimensionOverview);

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
        diagnostic.__MORPHLOOM__.buildingLevel = runtimeRef.current?.buildingLevel;
        diagnostic.__MORPHLOOM__.cameraPosition = camera.position.toArray();
        diagnostic.__MORPHLOOM__.cameraTarget = controls.target.toArray();
        diagnostic.__MORPHLOOM__.cameraDistance = camera.position.distanceTo(controls.target);
        diagnostic.__MORPHLOOM__.cameraZoom = camera.zoom;
      };
      controls.addEventListener('change', syncDiagnostics);
      const runtime: Runtime = {
        scene, camera, renderer, controls, root, measurement, annotation, dimensionOverview, floor,
        frame: 0, observer, environment, view: 'iso', buildingLevel: 'all', lighting: 'day',
        key, edge, hemisphere, reflectionStrip, warmStrip, syncDiagnostics,
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
      let spacePanActive = false;
      const setSpacePan = (active: boolean) => {
        spacePanActive = active;
        controls.mouseButtons.LEFT = active ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
        canvas.classList.toggle('is-pan-ready', active);
        if (!active) canvas.classList.remove('is-panning');
      };
      const editableTarget = (target: EventTarget | null) => target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
      const handlePanKeyDown = (event: KeyboardEvent) => {
        if (event.code !== 'Space' || editableTarget(event.target)) return;
        event.preventDefault();
        if (!spacePanActive) setSpacePan(true);
      };
      const handlePanKeyUp = (event: KeyboardEvent) => {
        if (event.code !== 'Space') return;
        event.preventDefault();
        setSpacePan(false);
      };
      const releasePan = () => setSpacePan(false);
      const rememberPointer = (event: PointerEvent) => {
        if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
        activePointerId = event.pointerId;
        pointerDown = new THREE.Vector2(event.clientX, event.clientY);
        if (spacePanActive) canvas.classList.add('is-panning');
      };
      const selectPart = (event: PointerEvent) => {
        if (!event.isPrimary || activePointerId !== event.pointerId) return;
        activePointerId = undefined;
        canvas.classList.remove('is-panning');
        if (spacePanActive) return;
        const clickTolerance = event.pointerType === 'touch' ? 14 : 6;
        if (pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > clickTolerance) return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObject(root, true);
        const interaction = interactionRef.current;
        if (interaction.measurementEnabled) {
          const surfaceHit = intersections.find((item) => item.object instanceof THREE.Mesh && visibleInHierarchy(item.object));
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
        const partHit = intersections.find((item) => visibleInHierarchy(item.object)
          && (item.object.userData.part || item.object.userData.characterPart));
        interaction.onPartSelected?.(inspectablePartFromObject(partHit?.object ?? null));
      };
      const cancelPointer = (event: PointerEvent) => {
        if (activePointerId === event.pointerId) activePointerId = undefined;
        canvas.classList.remove('is-panning');
      };
      canvas.addEventListener('pointerdown', rememberPointer);
      canvas.addEventListener('pointerup', selectPart);
      canvas.addEventListener('pointercancel', cancelPointer);
      window.addEventListener('keydown', handlePanKeyDown);
      window.addEventListener('keyup', handlePanKeyUp);
      window.addEventListener('blur', releasePan);

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
        canvas.removeEventListener('wheel', handleOpticalZoom, { capture: true });
        window.removeEventListener('keydown', handlePanKeyDown);
        window.removeEventListener('keyup', handlePanKeyUp);
        window.removeEventListener('blur', releasePan);
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
      applyLighting(runtime, build);
      applyArchitecturalViewVisibility(build.root, runtime.view, assemblyIR, runtime.buildingLevel);
      if (dimensionOverviewEnabled) drawDimensionOverview(runtime, build, measurementUnit);
      else clearGroup(runtime.dimensionOverview);
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
      const sourceSnapshot = snapshotScene(build.root);
      const telemetry = createLocalBuildTelemetry(sourceSnapshot, compileMs);
      telemetryRef.current = telemetry;
      onTelemetry?.(telemetry);
      onBuilt?.(build);
      const handleReferenceProjectionReady = () => {
        if (!('surfaces' in build.metrics)) return;
        const surfaces = inspectSurfaceSystem(build.root);
        build.metrics.surfaces = surfaces;
        validatedGlbRef.current = undefined;
        onBuilt?.({
          ...build,
          metrics: { ...build.metrics, surfaces },
        } as ProductBuild);
        runtime.syncDiagnostics();
      };
      build.root.addEventListener('morphloom-reference-projection-ready' as never, handleReferenceProjectionReady as never);
      frameBuild(runtime, build, assetKind, assemblyIR, spec);
      if (dimensionOverviewEnabled) zoomOptically(runtime, 0.72);
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
          sourceSkeletons: sourceSnapshot.skeletons,
          sourceBones: sourceSnapshot.bones,
          sourceAnimationClips: sourceSnapshot.animationClips,
          sourceAnimationTracks: sourceSnapshot.animationTracks,
          sourceAnimationClipNames: sourceSnapshot.animationClipNames,
          sourceAnimationTrackNames: sourceSnapshot.animationTrackNames,
          sourceAnimationManifestEntries: sourceSnapshot.animationManifestEntries,
          sourceAnimationManifestFingerprint: sourceSnapshot.animationManifestFingerprint,
          sourceMorphTargets: sourceSnapshot.morphTargets,
          sourceGameLods: sourceSnapshot.gameLods,
          sourceCollisionPrimitives: sourceSnapshot.collisionPrimitives,
          compilerRevision: DELIVERY_PIPELINE_REVISION,
          sceneFingerprintRevision: SCENE_FINGERPRINT_REVISION,
          sourceTexturePayloads: sourceSnapshot.texturePayloads.length,
          sourceTexturePayloadCoverage: sourceSnapshot.texturePayloadCoverage,
          sourceMaterialPayloads: sourceSnapshot.materialPayloads.length,
          sourceMaterialPayloadCoverage: sourceSnapshot.materialPayloadCoverage,
        },
      });
      runtime.syncDiagnostics();
      return () => {
        build.root.removeEventListener('morphloom-reference-projection-ready' as never, handleReferenceProjectionReady as never);
      };
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
              diagnostic.__MORPHLOOM__.sceneFingerprintRevision = SCENE_FINGERPRINT_REVISION;
              diagnostic.__MORPHLOOM__.deliveryStatus = audit.status;
              diagnostic.__MORPHLOOM__.deliveryScore = audit.score;
              diagnostic.__MORPHLOOM__.buildFingerprint = audit.buildFingerprint;
              diagnostic.__MORPHLOOM__.glbBytes = audit.glbBytes;
              diagnostic.__MORPHLOOM__.boundsErrorMm = audit.boundsErrorMm;
              diagnostic.__MORPHLOOM__.namedNodeCoverage = audit.namedNodeCoverage;
              diagnostic.__MORPHLOOM__.morphTargetPayloadParity = audit.morphTargetPayloadParity;
              diagnostic.__MORPHLOOM__.texturePayloadParity = audit.texturePayloadParity;
              diagnostic.__MORPHLOOM__.materialPayloadParity = audit.materialPayloadParity;
              diagnostic.__MORPHLOOM__.gltfValidator = audit.standardValidation?.validator;
              diagnostic.__MORPHLOOM__.gltfValidatorVersion = audit.standardValidation?.validatorVersion;
              diagnostic.__MORPHLOOM__.gltfValidationStatus = audit.standardValidation?.status;
              diagnostic.__MORPHLOOM__.gltfValidationErrors = audit.standardValidation?.errors;
              diagnostic.__MORPHLOOM__.gltfValidationWarnings = audit.standardValidation?.warnings;
              diagnostic.__MORPHLOOM__.gltfValidationIssueCodes = audit.standardValidation?.issueCodes;
              diagnostic.__MORPHLOOM__.gltfIndependentParser = audit.standardValidation?.independentRead.parser;
              diagnostic.__MORPHLOOM__.gltfIndependentReadStatus = audit.standardValidation?.independentRead.status;
              diagnostic.__MORPHLOOM__.reopenedSkeletons = audit.reopened?.skeletons;
              diagnostic.__MORPHLOOM__.reopenedBones = audit.reopened?.bones;
              diagnostic.__MORPHLOOM__.reopenedAnimationClips = audit.reopened?.animationClips;
              diagnostic.__MORPHLOOM__.reopenedAnimationTracks = audit.reopened?.animationTracks;
              diagnostic.__MORPHLOOM__.reopenedAnimationClipNames = audit.reopened?.animationClipNames;
              diagnostic.__MORPHLOOM__.reopenedAnimationTrackNames = audit.reopened?.animationTrackNames;
              diagnostic.__MORPHLOOM__.reopenedAnimationManifestEntries = audit.reopened?.animationManifestEntries;
              diagnostic.__MORPHLOOM__.reopenedAnimationManifestFingerprint = audit.reopened?.animationManifestFingerprint;
              diagnostic.__MORPHLOOM__.reopenedMorphTargets = audit.reopened?.morphTargets;
              diagnostic.__MORPHLOOM__.reopenedTexturePayloads = audit.reopened?.texturePayloads.length;
              diagnostic.__MORPHLOOM__.reopenedTexturePayloadCoverage = audit.reopened?.texturePayloadCoverage;
              diagnostic.__MORPHLOOM__.reopenedMaterialPayloads = audit.reopened?.materialPayloads.length;
              diagnostic.__MORPHLOOM__.reopenedMaterialPayloadCoverage = audit.reopened?.materialPayloadCoverage;
              diagnostic.__MORPHLOOM__.reopenedGameLods = audit.reopened?.gameLods;
              diagnostic.__MORPHLOOM__.reopenedCollisionPrimitives = audit.reopened?.collisionPrimitives;
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
      // Keep the first interaction responsive. GLB export, validator startup
      // and browser round-trip remain automatic, but begin after the viewer is
      // usable instead of monopolizing the main thread immediately after mount.
      }, 10_000);
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

    useEffect(() => {
      const runtime = runtimeRef.current;
      const build = buildRef.current;
      if (!runtime || !build) return;
      const wasVisible = runtime.dimensionOverview.visible && runtime.dimensionOverview.children.length > 0;
      if (dimensionOverviewEnabled) {
        drawDimensionOverview(runtime, build, measurementUnit);
        if (!wasVisible) zoomOptically(runtime, 0.72);
      } else {
        clearGroup(runtime.dimensionOverview);
        runtime.dimensionOverview.visible = false;
      }
    }, [dimensionOverviewEnabled, measurementUnit]);

    useImperativeHandle(ref, () => ({
      setView(view) {
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (!runtime || !build) return;
        runtime.view = view;
        applyArchitecturalViewVisibility(build.root, view, assemblyIR, runtime.buildingLevel);
        if (interactionRef.current.dimensionOverviewEnabled) {
          drawDimensionOverview(runtime, build, interactionRef.current.measurementUnit);
        }
        frameBuild(runtime, build, assetKind, assemblyIR, spec);
        runtime.syncDiagnostics();
      },
      setBuildingLevel(level) {
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (!runtime || !build) return;
        runtime.buildingLevel = level;
        applyArchitecturalViewVisibility(build.root, runtime.view, assemblyIR, level);
        if (interactionRef.current.dimensionOverviewEnabled) {
          drawDimensionOverview(runtime, build, interactionRef.current.measurementUnit);
        }
        runtime.syncDiagnostics();
      },
      setLighting(mode) {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        runtime.lighting = mode;
        applyLighting(runtime, buildRef.current);
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
      zoomBy(factor) {
        const runtime = runtimeRef.current;
        if (runtime) zoomOptically(runtime, factor);
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
          staticMeshRoundTrip(deliveryBuild.root, 'obj', result);
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
          const result = exportMillimetreStlBytes(deliveryBuild.root);
          staticMeshRoundTrip(deliveryBuild.root, 'stl', result);
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
          staticMeshRoundTrip(deliveryBuild.root, 'ply', result);
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
          bridgeDataTexturesForUsdz(deliveryBuild.root);
          const result = await new USDZExporter().parseAsync(deliveryBuild.root, {
            onlyVisible: true,
            quickLookCompatible: true,
            maxTextureSize: 1024,
          });
          if (token !== exportSequenceRef.current) throw new Error('내보내기가 취소되었습니다.');
          const repaired = repairThreeUsdz(result);
          if (repaired.audit.status !== 'pass') throw new Error(`USDZ conformance blocked: ${repaired.audit.blockers.join('; ')}`);
          return downloadBlob(new Blob([repaired.bytes.buffer as ArrayBuffer], { type: 'model/vnd.usdz+zip' }), 'morphloom-apple-ar.usdz');
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
        let staticMeshAudits: StaticMeshRoundTripAudit[];
        try {
          obj = new OBJExporter().parse(deliveryBuild.root);
          stl = exportMillimetreStlBytes(deliveryBuild.root);
          const plyResult = new PLYExporter().parse(deliveryBuild.root, () => undefined, { binary: true });
          if (!(plyResult instanceof ArrayBuffer)) throw new Error('Asset pack PLY exporter returned an empty payload.');
          ply = plyResult;
          staticMeshAudits = [
            staticMeshRoundTrip(deliveryBuild.root, 'obj', obj),
            staticMeshRoundTrip(deliveryBuild.root, 'stl', stl),
            staticMeshRoundTrip(deliveryBuild.root, 'ply', ply),
          ];
          svg = buildFigmaReferenceSvg(deliveryBuild.root, context.assetName);
        } finally {
          disposeObject(deliveryBuild.root);
        }
        if (token !== exportSequenceRef.current) throw new Error('에셋 팩 저장이 취소되었습니다.');
        const manifest = {
          schema: 'morphloom.asset-pack/0.1',
          compilerRevision: DELIVERY_PIPELINE_REVISION,
          staticDeliveryRevision: STATIC_DELIVERY_REVISION,
          assetId: context.assetId,
          generatedAt: new Date().toISOString(),
          assetName: context.assetName,
          evidenceBoundary: context.evidenceBoundary,
          sourceIr: context.sourceIr,
          qualityReport: context.qualityReport,
          deliveryAudit: audit,
          staticMeshAudits,
          localTelemetry: telemetryRef.current,
          privacy: {
            uploadedToServer: false,
            browserPersistence: false,
            importedResultRetention: 'memory-only, cleared on reload or explicit clear',
          },
          formatScope: {
            glb: 'authoritative editable mesh for Blender, Unity and Unreal glTF importers',
            obj: 'geometry-only CAD/DCC mesh interchange; no PBR material guarantee',
            stl: 'millimetre-valued static mesh for CAD/printing; unit contract is recorded here because STL has no native unit metadata',
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
        const previousBackground = runtime.scene.background;
        const previousFog = runtime.scene.fog;
        const previousClearAlpha = runtime.renderer.getClearAlpha();
        const previousFloorVisibility = runtime.floor.visible;
        const previousMeasurementVisibility = runtime.measurement.visible;
        const previousAnnotationVisibility = runtime.annotation.visible;
        const previousDimensionVisibility = runtime.dimensionOverview.visible;
        let blob: Blob | null = null;
        try {
          runtime.scene.background = null;
          runtime.scene.fog = null;
          runtime.floor.visible = false;
          runtime.measurement.visible = false;
          runtime.annotation.visible = false;
          runtime.dimensionOverview.visible = false;
          runtime.renderer.setClearAlpha(0);
          runtime.renderer.render(runtime.scene, runtime.camera);
          blob = await new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob(resolve, 'image/png', 1));
        } finally {
          runtime.scene.background = previousBackground;
          runtime.scene.fog = previousFog;
          runtime.floor.visible = previousFloorVisibility;
          runtime.measurement.visible = previousMeasurementVisibility;
          runtime.annotation.visible = previousAnnotationVisibility;
          runtime.dimensionOverview.visible = previousDimensionVisibility;
          runtime.renderer.setClearAlpha(previousClearAlpha);
          runtime.renderer.render(runtime.scene, runtime.camera);
        }
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
