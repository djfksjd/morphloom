import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { CharacterBuild } from '../engine/character';
import { buildCharacter } from '../engine/character';
import { buildProduct, type ProductBuild, type ProductPartInfo } from '../engine/product';
import type { AssemblyIR } from '../engine/assembly-ir';
import { compileAssemblyIR } from '../engine/assembly-compiler';
import { fitPerspectiveCameraToBounds, fogDensityForAssetRadius } from '../engine/camera-framing';
import {
  calculateMeasurement,
  type MeasurementMode,
  type MeasurementResult,
} from '../engine/measurement';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec, ViewMode } from '../types';

export type CameraView = 'front' | 'iso' | 'top' | 'rear';

export interface ViewportHandle {
  exportGlb: () => Promise<void>;
  capturePng: () => Promise<void>;
  setView: (view: CameraView) => void;
  clearMeasurement: () => void;
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
  onBuilt?: (build: CharacterBuild | ProductBuild) => void;
  onPartSelected?: (part?: ProductPartInfo) => void;
  onMeasurementChange?: (result: MeasurementResult | undefined, points: 0 | 1 | 2) => void;
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
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
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

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    onBuilt,
    onPartSelected,
    onMeasurementChange,
  }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const runtimeRef = useRef<Runtime | undefined>(undefined);
    const buildRef = useRef<CharacterBuild | ProductBuild | undefined>(undefined);
    const configRef = useRef({ assetKind, assemblyIR, spec });
    configRef.current = { assetKind, assemblyIR, spec };
    const interactionRef = useRef({ measurementEnabled, measurementMode, onMeasurementChange, onPartSelected });
    interactionRef.current = { measurementEnabled, measurementMode, onMeasurementChange, onPartSelected };
    const measurementPointsRef = useRef<THREE.Vector3[]>([]);
    const markerRadiusRef = useRef(0.01);

    const resetMeasurement = (): void => {
      measurementPointsRef.current = [];
      const runtime = runtimeRef.current;
      if (runtime) clearGroup(runtime.annotation);
      interactionRef.current.onMeasurementChange?.(undefined, 0);
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

      const runtime: Runtime = {
        scene, camera, renderer, controls, root, measurement, annotation, floor,
        frame: 0, observer, environment, view: 'iso',
      };
      runtimeRef.current = runtime;
      resize();

      const animate = () => {
        controls.update();
        measurement.rotation.y += 0.0007;
        const harnessUpdater = buildRef.current?.root.userData.updateElectricalHarness;
        if (typeof harnessUpdater === 'function') harnessUpdater();
        renderer.render(scene, camera);
        runtime.frame = requestAnimationFrame(animate);
      };
      runtime.frame = requestAnimationFrame(animate);

      const pointer = new THREE.Vector2();
      const raycaster = new THREE.Raycaster();
      let pointerDown = new THREE.Vector2();
      const rememberPointer = (event: PointerEvent) => {
        pointerDown = new THREE.Vector2(event.clientX, event.clientY);
      };
      const selectPart = (event: PointerEvent) => {
        if (pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 4) return;
        if (configRef.current.assetKind !== 'product') return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObject(root, true);
        const interaction = interactionRef.current;
        if (interaction.measurementEnabled) {
          const surfaceHit = intersections.find((item) => item.object instanceof THREE.Mesh);
          if (!surfaceHit) return;
          if (measurementPointsRef.current.length >= 2) measurementPointsRef.current = [];
          measurementPointsRef.current.push(surfaceHit.point.clone());
          const points = measurementPointsRef.current;
          drawMeasurementAnnotation(runtime, points, interaction.measurementMode, markerRadiusRef.current);
          if (points.length === 2) {
            interaction.onMeasurementChange?.(calculateMeasurement(points[0], points[1]), 2);
          } else {
            interaction.onMeasurementChange?.(undefined, 1);
          }
          return;
        }
        const partHit = intersections.find((item) => item.object.userData.part);
        interaction.onPartSelected?.(partHit?.object.userData.part as ProductPartInfo | undefined);
      };
      canvas.addEventListener('pointerdown', rememberPointer);
      canvas.addEventListener('pointerup', selectPart);

      return () => {
        cancelAnimationFrame(runtime.frame);
        observer.disconnect();
        controls.dispose();
        disposeObject(scene);
        environment.dispose();
        renderer.dispose();
        canvas.removeEventListener('pointerdown', rememberPointer);
        canvas.removeEventListener('pointerup', selectPart);
        runtimeRef.current = undefined;
      };
    }, []);

    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      clearGroup(runtime.root);
      clearGroup(runtime.measurement);
      clearGroup(runtime.annotation);
      measurementPointsRef.current = [];
      interactionRef.current.onMeasurementChange?.(undefined, 0);

      const build = assetKind === 'human'
        ? buildCharacter(pack, spec, mode)
        : assemblyIR ? compileAssemblyIR(assemblyIR, mode) : buildProduct(productSpec, mode);
      runtime.root.add(build.root);
      if (assetKind === 'human') {
        runtime.measurement.add(createMeasurementField(build.metrics.heightMeters));
      } else {
        const frame = new THREE.Box3Helper(build.metrics.bounds, '#335cff');
        frame.name = 'assembly_bounds';
        runtime.measurement.add(frame);
      }
      buildRef.current = build;
      const size = build.metrics.bounds.getSize(new THREE.Vector3());
      markerRadiusRef.current = Math.max(0.004, Math.min(0.12, size.length() * 0.004));
      onBuilt?.(build);
      frameBuild(runtime, build, assetKind, assemblyIR, spec);

      Object.assign(window, {
        __MORPHLOOM__: {
          version: '0.3.0',
          vertices: build.metrics.vertices,
          triangles: build.metrics.triangles,
          heightMeters: build.metrics.heightMeters,
          mode,
          assetKind,
          parts: 'parts' in build.metrics ? build.metrics.parts : undefined,
          view: runtime.view,
        },
      });
    }, [assemblyIR, assetKind, mode, onBuilt, pack, productSpec, spec]);

    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (!measurementEnabled) {
        resetMeasurement();
        return;
      }
      drawMeasurementAnnotation(runtime, measurementPointsRef.current, measurementMode, markerRadiusRef.current);
      const points = measurementPointsRef.current;
      if (points.length === 2) onMeasurementChange?.(calculateMeasurement(points[0], points[1]), 2);
    }, [measurementEnabled, measurementMode, onMeasurementChange]);

    useImperativeHandle(ref, () => ({
      setView(view) {
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (!runtime || !build) return;
        runtime.view = view;
        frameBuild(runtime, build, assetKind, assemblyIR, spec);
      },
      clearMeasurement() {
        resetMeasurement();
      },
      async exportGlb() {
        const build = buildRef.current;
        if (!build) throw new Error('Asset is not ready.');
        const exporter = new GLTFExporter();
        const result = await exporter.parseAsync(build.root, {
          binary: true,
          onlyVisible: true,
          includeCustomExtensions: true,
        });
        if (!(result instanceof ArrayBuffer)) throw new Error('GLB exporter returned text output.');
        downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), 'morphloom-result.glb');
      },
      async capturePng() {
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error('Viewport is not ready.');
        runtime.renderer.render(runtime.scene, runtime.camera);
        const blob = await new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob(resolve, 'image/png', 1));
        if (!blob) throw new Error('PNG capture failed.');
        downloadBlob(blob, 'morphloom-result.png');
      },
    }), [assemblyIR, assetKind, spec]);

    return <canvas ref={canvasRef} className={`character-canvas${measurementEnabled ? ' is-measuring' : ''}`} aria-label="3D 결과 미리보기" />;
  },
);
