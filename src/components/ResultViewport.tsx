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
import { fitPerspectiveCameraToBounds } from '../engine/camera-framing';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec, ViewMode } from '../types';

export type CameraView = 'front' | 'iso' | 'top' | 'rear';

export interface ViewportHandle {
  exportGlb: () => Promise<void>;
  capturePng: () => Promise<void>;
  setView: (view: CameraView) => void;
}

interface ResultViewportProps {
  assetKind: AssetKind;
  pack: HumanPack;
  spec: CharacterSpec;
  productSpec: ProductSpec;
  assemblyIR?: AssemblyIR;
  mode: ViewMode;
  onBuilt?: (build: CharacterBuild | ProductBuild) => void;
  onPartSelected?: (part?: ProductPartInfo) => void;
}

interface Runtime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  root: THREE.Group;
  measurement: THREE.Group;
  floor: THREE.Mesh;
  frame: number;
  observer: ResizeObserver;
  environment: THREE.Texture;
  view: CameraView;
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

function viewDirection(view: CameraView, exteriorOnly: boolean): THREE.Vector3 {
  if (view === 'front' || view === 'top') return new THREE.Vector3(0, 0, 1);
  if (view === 'rear') return new THREE.Vector3(0, 0, -1);
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
  const fov = referenceFront ? 40 : 31;
  const padding = exteriorOnly
    ? runtime.view === 'iso' ? 1.4 : 1.52
    : 1.24;
  const fit = fitPerspectiveCameraToBounds({
    bounds: build.metrics.bounds,
    direction: viewDirection(runtime.view, exteriorOnly),
    up: new THREE.Vector3(0, 1, 0),
    verticalFovDegrees: fov,
    aspect: runtime.camera.aspect,
    padding,
  });

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
  function ResultViewport({ assetKind, pack, spec, productSpec, assemblyIR, mode, onBuilt, onPartSelected }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const runtimeRef = useRef<Runtime | undefined>(undefined);
    const buildRef = useRef<CharacterBuild | ProductBuild | undefined>(undefined);
    const configRef = useRef({ assetKind, assemblyIR, spec });
    configRef.current = { assetKind, assemblyIR, spec };

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
      scene.fog = new THREE.FogExp2('#d8d9d5', 0.055);
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
      scene.add(root, measurement);

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
        scene, camera, renderer, controls, root, measurement, floor,
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
      const selectPart = (event: PointerEvent) => {
        if (configRef.current.assetKind !== 'product') return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(root, true).find((item) => item.object.userData.part);
        onPartSelected?.(hit?.object.userData.part as ProductPartInfo | undefined);
      };
      canvas.addEventListener('pointerup', selectPart);

      return () => {
        cancelAnimationFrame(runtime.frame);
        observer.disconnect();
        controls.dispose();
        disposeObject(scene);
        environment.dispose();
        renderer.dispose();
        canvas.removeEventListener('pointerup', selectPart);
        runtimeRef.current = undefined;
      };
    }, [onPartSelected]);

    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      disposeObject(runtime.root);
      disposeObject(runtime.measurement);
      runtime.root.clear();
      runtime.measurement.clear();

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

    useImperativeHandle(ref, () => ({
      setView(view) {
        const runtime = runtimeRef.current;
        const build = buildRef.current;
        if (!runtime || !build) return;
        runtime.view = view;
        frameBuild(runtime, build, assetKind, assemblyIR, spec);
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

    return <canvas ref={canvasRef} className="character-canvas" aria-label="3D 결과 미리보기" />;
  },
);
