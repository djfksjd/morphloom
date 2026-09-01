import * as THREE from 'three';
import type { AssemblyMaterialIR, SurfaceFinishIR } from './assembly-ir';
import type { ViewMode } from '../types';

interface SurfaceRecipe {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  ior: number;
  transmission: number;
  iridescence: number;
  anisotropy: number;
  anisotropyRotation: number;
  sheen: number;
  sheenRoughness: number;
  specularIntensity: number;
  microNormalStrength: number;
  textureScale: [number, number];
  pattern: 'none' | 'directional' | 'grain' | 'orange-peel' | 'fibrous' | 'hex-weave';
}

export interface SurfaceReport {
  physicalMaterials: number;
  authoredMaterials: number;
  microNormalMaterials: number;
  roughnessMappedMaterials: number;
  anisotropicMaterials: number;
  clearcoatMaterials: number;
  transmissionMaterials: number;
  /** Materials whose color comes from a successfully loaded local reference projection. */
  referenceProjectedMaterials: number;
  referenceReliefMaterials: number;
  referenceProjectionFingerprints: string[];
  distinctFinishes: number;
  finishes: string[];
}

const recipe = (value: Partial<SurfaceRecipe>): SurfaceRecipe => ({
  roughness: 0.5,
  metalness: 0.05,
  clearcoat: 0.12,
  clearcoatRoughness: 0.42,
  ior: 1.5,
  transmission: 0,
  iridescence: 0,
  anisotropy: 0,
  anisotropyRotation: 0,
  sheen: 0,
  sheenRoughness: 0.7,
  specularIntensity: 1,
  microNormalStrength: 0.12,
  textureScale: [7, 7],
  pattern: 'grain',
  ...value,
});

export const SURFACE_LIBRARY: Readonly<Record<SurfaceFinishIR, SurfaceRecipe>> = {
  raw: recipe({ pattern: 'none', microNormalStrength: 0 }),
  concrete: recipe({ roughness: 0.88, metalness: 0, clearcoat: 0.01, microNormalStrength: 0.46, textureScale: [34, 34], pattern: 'grain' }),
  plaster: recipe({ roughness: 0.82, metalness: 0, clearcoat: 0.025, microNormalStrength: 0.3, textureScale: [28, 28], pattern: 'orange-peel' }),
  stone: recipe({ roughness: 0.56, metalness: 0, clearcoat: 0.14, microNormalStrength: 0.32, textureScale: [18, 18], pattern: 'grain' }),
  'coated-metal': recipe({ roughness: 0.5, metalness: 0.42, clearcoat: 0.18, anisotropy: 0.42, microNormalStrength: 0.24, textureScale: [12, 48], pattern: 'directional' }),
  'brushed-metal': recipe({ roughness: 0.24, metalness: 0.94, clearcoat: 0.22, clearcoatRoughness: 0.26, anisotropy: 0.78, microNormalStrength: 0.2, textureScale: [4, 38], pattern: 'directional' }),
  'bead-blasted-metal': recipe({ roughness: 0.42, metalness: 0.9, clearcoat: 0.16, clearcoatRoughness: 0.42, microNormalStrength: 0.28, textureScale: [18, 18], pattern: 'grain' }),
  'anodized-metal': recipe({ roughness: 0.3, metalness: 0.82, clearcoat: 0.38, clearcoatRoughness: 0.3, anisotropy: 0.28, microNormalStrength: 0.18, textureScale: [14, 14], pattern: 'grain' }),
  'polished-metal': recipe({ roughness: 0.09, metalness: 0.97, clearcoat: 0.52, clearcoatRoughness: 0.1, anisotropy: 0.18, microNormalStrength: 0.045, textureScale: [7, 24], pattern: 'directional' }),
  'machined-copper': recipe({ roughness: 0.28, metalness: 0.95, clearcoat: 0.18, clearcoatRoughness: 0.24, anisotropy: 0.66, microNormalStrength: 0.23, textureScale: [5, 34], pattern: 'directional' }),
  'ceramic-glass': recipe({ roughness: 0.12, metalness: 0.04, clearcoat: 0.88, clearcoatRoughness: 0.1, ior: 1.52, transmission: 0.05, iridescence: 0.06, microNormalStrength: 0.055, textureScale: [9, 9], pattern: 'grain' }),
  'optical-glass': recipe({ roughness: 0.035, metalness: 0, clearcoat: 0.92, clearcoatRoughness: 0.045, ior: 1.52, transmission: 0.7, iridescence: 0.16, microNormalStrength: 0.025, textureScale: [5, 5], pattern: 'grain' }),
  sapphire: recipe({ roughness: 0.022, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.025, ior: 1.76, transmission: 0.52, iridescence: 0.22, microNormalStrength: 0.015, textureScale: [4, 4], pattern: 'grain' }),
  'pcb-soldermask': recipe({ roughness: 0.38, metalness: 0.08, clearcoat: 0.32, clearcoatRoughness: 0.34, microNormalStrength: 0.15, textureScale: [22, 22], pattern: 'orange-peel' }),
  'molded-polymer': recipe({ roughness: 0.58, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.62, microNormalStrength: 0.24, textureScale: [18, 18], pattern: 'orange-peel' }),
  'soft-touch-polymer': recipe({ roughness: 0.76, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.78, sheen: 0.12, sheenRoughness: 0.82, microNormalStrength: 0.3, textureScale: [20, 20], pattern: 'grain' }),
  rubber: recipe({ roughness: 0.9, metalness: 0, clearcoat: 0, sheen: 0.26, sheenRoughness: 0.9, microNormalStrength: 0.42, textureScale: [24, 24], pattern: 'orange-peel' }),
  leather: recipe({ roughness: 0.84, metalness: 0, clearcoat: 0.04, sheen: 0.34, sheenRoughness: 0.74, microNormalStrength: 0.52, textureScale: [11, 18], pattern: 'fibrous' }),
  wood: recipe({ roughness: 0.7, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.58, sheen: 0.08, microNormalStrength: 0.34, textureScale: [7, 22], pattern: 'fibrous' }),
  skin: recipe({ roughness: 0.46, metalness: 0, clearcoat: 0.07, clearcoatRoughness: 0.66, ior: 1.4, sheen: 0.24, sheenRoughness: 0.72, specularIntensity: 0.58, microNormalStrength: 0.2, textureScale: [32, 32], pattern: 'orange-peel' }),
  fabric: recipe({ roughness: 0.86, metalness: 0, clearcoat: 0, sheen: 0.44, sheenRoughness: 0.82, specularIntensity: 0.48, microNormalStrength: 0.48, textureScale: [18, 28], pattern: 'fibrous' }),
  'hex-knit': recipe({ roughness: 0.72, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.58, sheen: 0.5, sheenRoughness: 0.72, specularIntensity: 0.62, microNormalStrength: 0.68, textureScale: [34, 42], pattern: 'hex-weave' }),
  hair: recipe({ roughness: 0.62, metalness: 0, clearcoat: 0.06, clearcoatRoughness: 0.5, anisotropy: 0.82, sheen: 0.52, sheenRoughness: 0.68, specularIntensity: 0.72, microNormalStrength: 0.34, textureScale: [22, 5], pattern: 'directional' }),
  semiconductor: recipe({ roughness: 0.26, metalness: 0.16, clearcoat: 0.3, clearcoatRoughness: 0.25, iridescence: 0.08, microNormalStrength: 0.1, textureScale: [16, 16], pattern: 'grain' }),
};

function normalizedLabel(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/g, ' ');
}

export function inferSurfaceFinish(materialName: string, explicit?: SurfaceFinishIR): SurfaceFinishIR {
  if (explicit) return explicit;
  const name = normalizedLabel(materialName);
  if (/피부|skin/.test(name)) return 'skin';
  if (/머리카락|hair/.test(name)) return 'hair';
  if (/직물|fabric|cloth|슈트|suit/.test(name)) return 'fabric';
  if (/사파이어|sapphire/.test(name)) return 'sapphire';
  if (/가죽|leather/.test(name)) return 'leather';
  if (/월넛|wood|목재/.test(name)) return 'wood';
  if (/콘크리트|concrete|시멘트|cement/.test(name)) return 'concrete';
  if (/스터코|stucco|플라스터|plaster|석고|gypsum|도장 벽/.test(name)) return 'plaster';
  if (/석재|stone|화강암|granite|대리석|marble/.test(name)) return 'stone';
  if (/도장.*금속|coated.*metal|powder.?coat|standing.?seam/.test(name)) return 'coated-metal';
  if (/cmos|bga|반도체|vcsel|mems|sensor/.test(name)) return 'semiconductor';
  if (/고무|rubber|실리콘|silicone|pfa|불소수지/.test(name)) return 'rubber';
  if (/fr-?4|pcb|솔더|solder/.test(name)) return 'pcb-soldermask';
  if (/구리|copper|c1100/.test(name)) return 'machined-copper';
  if (/광학|glass|유리|ito|편광|polar/.test(name)) return /강화|ceramic|세라믹/.test(name) ? 'ceramic-glass' : 'optical-glass';
  if (/세라믹|ceramic|알루미나/.test(name)) return 'ceramic-glass';
  if (/티타늄|titanium|스테인리스|steel|강철|알루미늄|aluminium|aluminum|금도금|gold|니켈|청동|bronze/.test(name)) {
    return /pvd|광택|polish|금도금|gold/.test(name) ? 'polished-metal' : 'brushed-metal';
  }
  if (/silicon/.test(name)) return 'semiconductor';
  if (/soft|파우치|graphite|흑연/.test(name)) return 'soft-touch-polymer';
  if (/pbt|lcp|asa|폴리머|polymer|에폭시|epoxy|수지/.test(name)) return 'molded-polymer';
  return 'raw';
}

function hash(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 71.9) * 43758.5453123;
  return value - Math.floor(value);
}

function heightAt(x: number, y: number, seed: number, pattern: SurfaceRecipe['pattern']): number {
  const noise = hash(x, y, seed) * 2 - 1;
  const broad = hash(Math.floor(x / 4), Math.floor(y / 4), seed + 17) * 2 - 1;
  if (pattern === 'directional') return Math.sin(x * 2.3 + broad * 0.8) * 0.68 + noise * 0.18;
  if (pattern === 'orange-peel') return noise * 0.52 + Math.sin((x + broad) * 0.82) * Math.sin((y - broad) * 0.77) * 0.3;
  if (pattern === 'fibrous') return Math.sin(x * 0.95 + Math.sin(y * 0.19) * 1.5) * 0.42 + noise * 0.28 + broad * 0.18;
  if (pattern === 'hex-weave') {
    const cell = (Math.cos(x * 0.72) + Math.cos(x * 0.36 + y * 0.624) + Math.cos(x * 0.36 - y * 0.624)) / 3;
    return Math.pow(Math.max(-1, Math.min(1, cell)) * 0.5 + 0.5, 1.7) * 1.35 - 0.55 + noise * 0.1;
  }
  if (pattern === 'grain') return noise * 0.58 + broad * 0.26;
  return 0;
}

const textureCache = new Map<string, { albedo: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture }>();
const MAX_SHARED_SURFACE_MAPS = 96;

function exportSafeTexture(data: Uint8Array, size: number): THREE.Texture {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Surface texture canvas is unavailable.');
    context.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
    return new THREE.CanvasTexture(canvas);
  }
  return new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
}

function createMicroSurfaceMaps(finish: SurfaceFinishIR, scale: [number, number]) {
  const key = `${finish}:${scale[0]}:${scale[1]}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const size = 64;
  const albedoData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);
  // glTF stores roughness in G and metalness in B of one shared texture.
  // Keeping those channels in one texture avoids GLTFExporter merging one
  // texture per material and preserves each material's scalar metalness.
  const metallicRoughnessData = new Uint8Array(size * size * 4);
  const seed = [...finish].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const pattern = SURFACE_LIBRARY[finish].pattern;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heightAt((x - 1 + size) % size, y, seed, pattern);
      const right = heightAt((x + 1) % size, y, seed, pattern);
      const down = heightAt(x, (y - 1 + size) % size, seed, pattern);
      const up = heightAt(x, (y + 1) % size, seed, pattern);
      const normal = new THREE.Vector3((left - right) * 0.46, (down - up) * 0.46, 1).normalize();
      const offset = (y * size + x) * 4;
      normalData[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      normalData[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      normalData[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      normalData[offset + 3] = 255;
      const variation = heightAt(x, y, seed + 31, pattern);
      const value = Math.round(THREE.MathUtils.clamp(0.9 + variation * 0.095, 0.76, 1) * 255);
      metallicRoughnessData.set([255, value, 255, 255], offset);
      const fibreContrast = pattern === 'hex-weave' ? 0.19 : 0.055;
      const albedo = Math.round(THREE.MathUtils.clamp(0.86 + variation * fibreContrast, 0.58, 1) * 255);
      albedoData.set([albedo, albedo, albedo, 255], offset);
    }
  }
  const shared = textureCache.size < MAX_SHARED_SURFACE_MAPS;
  const setup = (texture: THREE.Texture, suffix: string) => {
    texture.name = `morphloom_${finish}_${suffix}`;
    texture.userData.morphloomShared = shared;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(scale[0], scale[1]);
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  };
  const normal = exportSafeTexture(normalData, size);
  const roughness = exportSafeTexture(metallicRoughnessData, size);
  const albedo = exportSafeTexture(albedoData, size);
  setup(normal, 'micro_normal');
  setup(roughness, 'metallic_roughness');
  setup(albedo, 'albedo');
  albedo.colorSpace = THREE.SRGBColorSpace;
  const maps = { albedo, normal, roughness };
  if (shared) textureCache.set(key, maps);
  return maps;
}

interface SurfaceMaterialContext {
  mode: ViewMode;
  category: string;
  materialName: string;
}

export function createSurfaceMaterial(source: AssemblyMaterialIR, context: SurfaceMaterialContext): THREE.MeshPhysicalMaterial {
  const finish = inferSurfaceFinish(context.materialName, source.surface);
  const preset = SURFACE_LIBRARY[finish];
  const clay = context.mode === 'clay';
  const ghost = context.mode === 'rig' && (context.category === 'enclosure' || context.category === 'display');
  const transmission = context.mode === 'beauty' ? (source.transmission ?? preset.transmission) : 0;
  const microNormalStrength = source.microNormalStrength ?? preset.microNormalStrength;
  const material = new THREE.MeshPhysicalMaterial({
    color: clay ? '#c5c6c3' : source.color,
    roughness: clay ? 0.82 : (source.roughness ?? preset.roughness),
    metalness: clay ? 0 : (source.metalness ?? preset.metalness),
    transmission,
    transparent: ghost || transmission > 0,
    opacity: ghost ? 0.1 : 1,
    depthWrite: !ghost,
    thickness: transmission > 0 ? (source.thicknessMm ?? 1) / 1000 : 0,
    ior: source.ior ?? preset.ior,
    clearcoat: context.mode === 'beauty' ? (source.clearcoat ?? preset.clearcoat) : 0,
    clearcoatRoughness: source.clearcoatRoughness ?? preset.clearcoatRoughness,
    iridescence: context.mode === 'beauty' ? (source.iridescence ?? preset.iridescence) : 0,
    iridescenceIOR: finish === 'sapphire' ? 1.76 : 1.3,
    iridescenceThicknessRange: finish === 'sapphire' || finish === 'optical-glass' ? [80, 260] : [100, 180],
    anisotropy: context.mode === 'beauty' ? (source.anisotropy ?? preset.anisotropy) : 0,
    anisotropyRotation: source.anisotropyRotation ?? preset.anisotropyRotation,
    sheen: context.mode === 'beauty' ? (source.sheen ?? preset.sheen) : 0,
    sheenRoughness: source.sheenRoughness ?? preset.sheenRoughness,
    sheenColor: new THREE.Color(source.color),
    specularIntensity: source.specularIntensity ?? preset.specularIntensity,
    emissive: source.emissive ?? '#000000',
    emissiveIntensity: source.emissive ? 0.35 : 0,
    wireframe: context.mode === 'wireframe',
    envMapIntensity: context.mode === 'beauty' ? 1.18 : 0.82,
  });
  if (context.mode === 'beauty' && preset.pattern !== 'none' && microNormalStrength > 0) {
    const scale = source.textureScale ?? preset.textureScale;
    const maps = createMicroSurfaceMaps(finish, scale);
    material.normalMap = maps.normal;
    material.normalScale.set(microNormalStrength, microNormalStrength);
    material.roughnessMap = maps.roughness;
    material.metalnessMap = maps.roughness;
    if (finish === 'hex-knit') material.map = maps.albedo;
  }
  material.name = `${context.materialName} [${finish}]`;
  material.userData.morphloomSurface = {
    finish,
    roughness: material.roughness,
    metalness: material.metalness,
    clearcoat: material.clearcoat,
    ior: material.ior,
    transmission: material.transmission,
    anisotropy: material.anisotropy,
    microNormalStrength: context.mode === 'beauty' ? microNormalStrength : 0,
    textureScale: source.textureScale ?? preset.textureScale,
    procedural: preset.pattern !== 'none',
  };
  return material;
}

export function inspectSurfaceSystem(root: THREE.Object3D): SurfaceReport {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    source.forEach((material) => materials.add(material));
  });
  const finishes = new Set<string>();
  let physicalMaterials = 0;
  let authoredMaterials = 0;
  let microNormalMaterials = 0;
  let roughnessMappedMaterials = 0;
  let anisotropicMaterials = 0;
  let clearcoatMaterials = 0;
  let transmissionMaterials = 0;
  let referenceProjectedMaterials = 0;
  let referenceReliefMaterials = 0;
  const referenceProjectionFingerprints = new Set<string>();
  for (const material of materials) {
    if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
    physicalMaterials += 1;
    const metadata = material.userData.morphloomSurface as { finish?: string } | undefined;
    if (metadata?.finish) {
      authoredMaterials += 1;
      finishes.add(metadata.finish);
    }
    if (material.normalMap) microNormalMaterials += 1;
    if (material.roughnessMap) roughnessMappedMaterials += 1;
    if (material.anisotropy > 0) anisotropicMaterials += 1;
    if (material.clearcoat > 0) clearcoatMaterials += 1;
    if (material.transmission > 0) transmissionMaterials += 1;
    const projectedTexture = material.map?.userData.morphloomProjectionOwned === true;
    const referenceFingerprint = material.userData.morphloomSurface?.referenceFingerprint;
    if (projectedTexture) {
      referenceProjectedMaterials += 1;
      if (material.normalMap?.userData.morphloomReferenceDerived === 'normal'
        && material.roughnessMap?.userData.morphloomReferenceDerived === 'roughness') {
        referenceReliefMaterials += 1;
      }
      if (typeof referenceFingerprint === 'string' && referenceFingerprint.length > 0) {
        referenceProjectionFingerprints.add(referenceFingerprint);
      }
    }
  }
  return {
    physicalMaterials,
    authoredMaterials,
    microNormalMaterials,
    roughnessMappedMaterials,
    anisotropicMaterials,
    clearcoatMaterials,
    transmissionMaterials,
    referenceProjectedMaterials,
    referenceReliefMaterials,
    referenceProjectionFingerprints: [...referenceProjectionFingerprints].sort(),
    distinctFinishes: finishes.size,
    finishes: [...finishes].sort(),
  };
}
