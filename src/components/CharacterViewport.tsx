import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { CharacterBuild } from '../engine/character';
import { buildCharacter } from '../engine/character';
import { buildProduct, type ProductBuild, type ProductPartInfo } from '../engine/product';
import type { AssemblyIR } from '../engine/assembly-ir';
import { compileAssemblyIR } from '../engine/assembly-compiler';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec, ViewMode } from '../types';

export interface ViewportHandle {
  exportGlb: () => Promise<void>;
  capturePng: () => Promise<void>;
}

interface CharacterViewportProps {
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
  frame: number;
  observer: ResizeObserver;
  environment: THREE.Texture;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
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
  const ringMaterial = new THREE.LineBasicMaterial({ color: '#335cff', transparent: true, opacity: 0.42 });
  for (const [index, y] of [0.14, 0.51, 0.72, 0.9].entries()) {
    const curve = new THREE.EllipseCurve(0, 0, height * (0.15 - index * 0.018), height * 0.055);
    const points = curve.getPoints(80).map((point) => new THREE.Vector3(point.x, y * height, point.y));
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), ringMaterial.clone());
    ring.name = `measurement_ring_${index}`;
    group.add(ring);
  }
  const verticalGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-height * 0.34, 0, 0),
    new THREE.Vector3(-height * 0.34, height, 0),
  ]);
  const vertical = new THREE.Line(verticalGeometry, ringMaterial.clone());
  vertical.name = 'height_rule';
  group.add(vertical);
  return group;
}

export const CharacterViewport = forwardRef<ViewportHandle, CharacterViewportProps>(
  function CharacterViewport({ assetKind, pack, spec, productSpec, assemblyIR, mode, onBuilt, onPartSelected }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const runtimeRef = useRef<Runtime | undefined>(undefined);
    const buildRef = useRef<CharacterBuild | ProductBuild | undefined>(undefined);

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
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2('#d8d9d5', 0.055);
      const camera = new THREE.PerspectiveCamera(31, 1, 0.01, 30);
      camera.position.set(2.7, 1.18, 3.8);

      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.065;
      controls.target.set(0, 0.91, 0);
      controls.minDistance = 0.08;
      controls.maxDistance = 7;

      const pmrem = new THREE.PMREMGenerator(renderer);
      const environmentScene = new RoomEnvironment();
      const environment = pmrem.fromScene(environmentScene, 0.04).texture;
      environmentScene.dispose();
      pmrem.dispose();
      scene.environment = environment;

      const key = new THREE.DirectionalLight('#fff5e8', 4.2);
      key.position.set(2.6, 4.4, 3.2);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -2;
      key.shadow.camera.right = 2;
      key.shadow.camera.top = 3;
      key.shadow.camera.bottom = -1;
      scene.add(key);
      const edge = new THREE.DirectionalLight('#6d86ff', 2.4);
      edge.position.set(-3.5, 2.2, -2.4);
      scene.add(edge);
      const fill = new THREE.HemisphereLight('#f1f4ff', '#4d4f4c', 1.9);
      scene.add(fill);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(2.55, 96),
        new THREE.MeshStandardMaterial({ color: '#c8c9c4', roughness: 0.92, metalness: 0.03 }),
      );
      floor.name = 'studio_floor';
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
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();

      const animate = () => {
        controls.update();
        measurement.rotation.y += 0.0007;
        renderer.render(scene, camera);
        const runtime = runtimeRef.current;
        if (runtime) runtime.frame = requestAnimationFrame(animate);
      };

      runtimeRef.current = {
        scene,
        camera,
        renderer,
        controls,
        root,
        measurement,
        frame: requestAnimationFrame(animate),
        observer,
        environment,
      };

      const pointer = new THREE.Vector2();
      const raycaster = new THREE.Raycaster();
      const selectPart = (event: PointerEvent) => {
        if (assetKind !== 'product') return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(root, true).find((item) => item.object.userData.part);
        onPartSelected?.(hit?.object.userData.part as ProductPartInfo | undefined);
      };
      canvas.addEventListener('pointerup', selectPart);

      return () => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        cancelAnimationFrame(runtime.frame);
        runtime.observer.disconnect();
        runtime.controls.dispose();
        disposeObject(runtime.scene);
        runtime.environment.dispose();
        runtime.renderer.dispose();
        canvas.removeEventListener('pointerup', selectPart);
        runtimeRef.current = undefined;
      };
    }, [assetKind, onPartSelected]);

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
        const measurement = createMeasurementField(build.metrics.heightMeters);
        runtime.measurement.add(measurement);
      } else {
        const frame = new THREE.Box3Helper(build.metrics.bounds, '#335cff');
        frame.name = 'assembly_bounds';
        runtime.measurement.add(frame);
      }
      buildRef.current = build;
      onBuilt?.(build);

      if (assetKind === 'human') {
        runtime.controls.target.set(0, build.metrics.heightMeters * 0.52, 0);
        runtime.camera.position.set(
          build.metrics.heightMeters * 1.22,
          build.metrics.heightMeters * 0.66,
          build.metrics.heightMeters * 2.05,
        );
      } else {
        const center = build.metrics.bounds.getCenter(new THREE.Vector3());
        const size = build.metrics.bounds.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z);
        runtime.controls.target.copy(center);
        runtime.camera.position.copy(center).add(new THREE.Vector3(extent * 1.92, extent * 0.44, extent * 1.24));
      }
      runtime.controls.update();

      Object.assign(window, {
        __MORPHLOOM__: {
          version: '0.1.0',
          vertices: build.metrics.vertices,
          triangles: build.metrics.triangles,
          heightMeters: build.metrics.heightMeters,
          mode,
          assetKind,
          parts: 'parts' in build.metrics ? build.metrics.parts : undefined,
        },
      });
    }, [assemblyIR, assetKind, mode, onBuilt, pack, productSpec, spec]);

    useImperativeHandle(ref, () => ({
      async exportGlb() {
        const build = buildRef.current;
        if (!build) throw new Error('Character is not ready.');
        const exporter = new GLTFExporter();
        const result = await exporter.parseAsync(build.root, {
          binary: true,
          onlyVisible: true,
          includeCustomExtensions: true,
        });
        if (!(result instanceof ArrayBuffer)) throw new Error('GLB exporter returned text output.');
        downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), 'morphloom-character.glb');
      },
      async capturePng() {
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error('Viewport is not ready.');
        runtime.renderer.render(runtime.scene, runtime.camera);
        const blob = await new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob(resolve, 'image/png', 1));
        if (!blob) throw new Error('PNG capture failed.');
        downloadBlob(blob, 'morphloom-character.png');
      },
    }));

    return <canvas ref={canvasRef} className="character-canvas" aria-label="3D 캐릭터 미리보기" />;
  },
);
