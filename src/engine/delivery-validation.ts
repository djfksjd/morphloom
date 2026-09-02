import * as THREE from 'three';
import type { AssemblyIR } from './assembly-ir';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec } from '../types';
import type { GltfStandardValidation } from './gltf-standard-validation';

export const DELIVERY_PIPELINE_REVISION = 'morphloom-compiler/0.28.0';
export const SCENE_FINGERPRINT_REVISION = 'morphloom-scene-fingerprint/0.5.0';

export type DeliveryAuditStatus = 'running' | 'pass' | 'warn' | 'blocked';

export interface SceneSnapshot {
  fingerprint: string;
  nodes: number;
  namedNodes: number;
  meshes: number;
  namedMeshes: number;
  /** Render primitives expected after glTF splits a mesh by material group. */
  primitives: number;
  skeletons: number;
  bones: number;
  animationClips: number;
  animationTracks: number;
  /** Sorted semantic identities, used to reject a GLB that preserves only counts. */
  animationClipNames: string[];
  animationTrackNames: string[];
  animationManifestEntries: number;
  animationManifestFingerprint: string;
  morphTargets: number;
  morphTargetNames: string[];
  morphTargetPayloads: Array<{
    id: string;
    affectedVertices: number;
    displacementSumMm: number;
    displacementSquaredSumMm2: number;
    maximumDisplacementMm: number;
  }>;
  /** Per-mesh diagnostics for locating cross-runtime drift without storing raw geometry. */
  meshPayloads: Array<{
    id: string;
    geometryFingerprint: string;
    transformFingerprint: string;
    materialFingerprint: string;
  }>;
  gameLods: number;
  collisionPrimitives: number;
  collisionManifestFingerprint: string;
  planFootprintAudits: number;
  planFootprintAuditFingerprint: string;
  dimensionAudits: number;
  dimensionAuditFingerprint: string;
  materials: number;
  materialPayloads: Array<{
    id: string;
    fingerprint: string;
    serializable: boolean;
    unsupportedSemantics: string[];
  }>;
  materialPayloadCoverage: number;
  triangles: number;
  geometryBytes: number;
  textureBytes: number;
  texturePayloads: Array<{
    id: string;
    width: number;
    height: number;
    contentFingerprint: string;
    samplerFingerprint: string;
    inspectable: boolean;
    samplerSerializable: boolean;
    unsupportedSemantics: string[];
  }>;
  texturePayloadCoverage: number;
  finiteTransforms: boolean;
  duplicatePartIds: string[];
  boundsMeters: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
}

export interface DeliveryAudit {
  status: DeliveryAuditStatus;
  score: number;
  /** Deterministic scene fingerprint before exporter normalization/mutation. */
  buildFingerprint: string;
  /** Fingerprint of the exact source scene passed into the round-trip comparator. */
  fingerprint: string;
  inputFingerprint: string;
  glbBytes: number;
  durationMs: number;
  meshParity: boolean;
  triangleParity: boolean;
  morphTargetPayloadParity: boolean;
  texturePayloadParity: boolean;
  materialPayloadParity: boolean;
  namedNodeCoverage: number;
  boundsErrorMm: number;
  source?: SceneSnapshot;
  reopened?: SceneSnapshot;
  standardValidation?: GltfStandardValidation;
  blockers: string[];
  warnings: string[];
  platformNotes: {
    gltf20: 'khronos-validator-pass' | 'khronos-validator-warn' | 'khronos-validator-blocked' | 'not-run';
    blender: 'application-import-not-run';
    unity: 'application-import-not-run';
    unreal: 'application-import-not-run';
    fusion360: 'mesh-import-only';
    figma: 'svg-reference-only';
  };
}

export interface LocalBuildTelemetry {
  compileMs: number;
  auditMs: number;
  glbBytes: number;
  geometryBytes: number;
  textureBytes: number;
  estimatedRenderBytes: number;
  storageLocation: 'browser-memory';
  uploadedToServer: false;
  llmCost: {
    status: 'not-observed';
    detail: string;
  };
}

const FNV_PRIME = 0x01000193;

class StableHasher {
  private a = 0x811c9dc5;
  private b = 0x9e3779b9;

  text(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      this.a = Math.imul(this.a ^ code, FNV_PRIME) >>> 0;
      this.b = Math.imul(this.b ^ (code + index), 0x85ebca6b) >>> 0;
    }
  }

  number(value: number): void {
    this.text(Number.isFinite(value) ? value.toPrecision(12) : String(value));
  }

  array(value: ArrayLike<number> | undefined): void {
    if (!value) {
      this.text('none');
      return;
    }
    this.number(value.length);
    for (let index = 0; index < value.length; index += 1) this.number(value[index]);
  }

  bytes(value: Uint8Array, width = 0, height = 0, flipRows = false): void {
    this.number(value.byteLength);
    const rowBytes = height > 0 && value.byteLength % height === 0 ? value.byteLength / height : 0;
    const normalizeRows = flipRows && width > 0 && height > 1 && rowBytes > 0;
    for (let index = 0; index < value.byteLength; index += 1) {
      const sourceIndex = normalizeRows
        ? (height - 1 - Math.floor(index / rowBytes)) * rowBytes + (index % rowBytes)
        : index;
      const byte = value[sourceIndex]!;
      this.a = Math.imul(this.a ^ byte, FNV_PRIME) >>> 0;
      this.b = Math.imul(this.b ^ (byte + index), 0x85ebca6b) >>> 0;
    }
  }

  digest(): string {
    return `${this.a.toString(16).padStart(8, '0')}${this.b.toString(16).padStart(8, '0')}`;
  }
}

const MAX_INSPECTABLE_TEXTURE_BYTES = 64 * 1024 * 1024;

/** Locale collation differs between a Korean browser and Node. Fingerprints
 * must use Unicode code-point order so mixed Korean/Latin part names remain
 * byte-identical in every runtime. */
function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface TextureContent {
  width: number;
  height: number;
  bytes?: Uint8Array;
}

function textureDimensions(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  const width = Number(candidate.naturalWidth ?? candidate.videoWidth ?? candidate.width ?? 0);
  const height = Number(candidate.naturalHeight ?? candidate.videoHeight ?? candidate.height ?? 0);
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : undefined;
}

function textureContent(texture: THREE.Texture): TextureContent {
  const source = texture.source?.data ?? texture.image;
  const dimensions = textureDimensions(source) ?? { width: 0, height: 0 };
  if (!source || typeof source !== 'object') return dimensions;
  const direct = (source as { data?: unknown }).data;
  if (ArrayBuffer.isView(direct)) {
    if (direct.byteLength > MAX_INSPECTABLE_TEXTURE_BYTES) return dimensions;
    return {
      ...dimensions,
      bytes: new Uint8Array(direct.buffer, direct.byteOffset, direct.byteLength),
    };
  }
  const pixelBytes = dimensions.width * dimensions.height * 4;
  if (!Number.isSafeInteger(pixelBytes) || pixelBytes > MAX_INSPECTABLE_TEXTURE_BYTES) return dimensions;
  const canvasLike = source as { getContext?: (type: string, options?: { willReadFrequently?: boolean }) => unknown };
  if (typeof canvasLike.getContext === 'function') {
    try {
      const context = canvasLike.getContext('2d', { willReadFrequently: true }) as { getImageData?: (x: number, y: number, width: number, height: number) => { data: Uint8ClampedArray } } | null;
      const pixels = context?.getImageData?.(0, 0, dimensions.width, dimensions.height).data;
      if (pixels) return { ...dimensions, bytes: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) };
    } catch {
      return dimensions;
    }
  }
  if (typeof document !== 'undefined' && dimensions.width > 0 && dimensions.height > 0) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return dimensions;
      context.drawImage(source as CanvasImageSource, 0, 0, dimensions.width, dimensions.height);
      const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height).data;
      return { ...dimensions, bytes: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) };
    } catch {
      return dimensions;
    }
  }
  return dimensions;
}

function texturePayload(
  material: THREE.Material,
  slot: string,
  texture: THREE.Texture,
  cache: Map<THREE.Texture, Omit<SceneSnapshot['texturePayloads'][number], 'id'>>,
): SceneSnapshot['texturePayloads'][number] {
  let core = cache.get(texture);
  if (!core) {
    const content = textureContent(texture);
    const contentHasher = new StableHasher();
    contentHasher.text('texture-content');
    contentHasher.number(content.width);
    contentHasher.number(content.height);
    // glTF stores image rows in its own orientation and GLTFLoader reopens
    // those textures with flipY=false. Hash logical sampled pixels so a
    // CanvasTexture flip during export is not mistaken for visual damage.
    if (content.bytes) contentHasher.bytes(content.bytes, content.width, content.height, texture.flipY);
    else contentHasher.text('uninspectable');
    const samplerHasher = new StableHasher();
    samplerHasher.text('texture-sampler-gltf/0.2');
    const unsupportedSemantics: string[] = [];
    const supportedWrap = new Set<number>([THREE.RepeatWrapping, THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping]);
    const supportedMagFilter = new Set<number>([THREE.NearestFilter, THREE.LinearFilter]);
    const supportedMinFilter = new Set<number>([
      THREE.NearestFilter, THREE.LinearFilter, THREE.NearestMipmapNearestFilter,
      THREE.LinearMipmapNearestFilter, THREE.NearestMipmapLinearFilter, THREE.LinearMipmapLinearFilter,
    ]);
    const mipmappedFilters = new Set<number>([
      THREE.NearestMipmapNearestFilter, THREE.LinearMipmapNearestFilter,
      THREE.NearestMipmapLinearFilter, THREE.LinearMipmapLinearFilter,
    ]);
    if (texture.mapping !== THREE.UVMapping) unsupportedSemantics.push('non-UV texture mapping is not representable in glTF');
    if (!Number.isInteger(texture.channel) || texture.channel < 0 || texture.channel > 3) {
      unsupportedSemantics.push('texture coordinate channel must be an integer from 0 to 3');
    }
    if (texture.format !== THREE.RGBAFormat) unsupportedSemantics.push('non-RGBA texture payload is not losslessly exported');
    if (texture.type !== THREE.UnsignedByteType) unsupportedSemantics.push('non-8-bit texture payload is not losslessly exported');
    if (!supportedWrap.has(texture.wrapS) || !supportedWrap.has(texture.wrapT)) unsupportedSemantics.push('texture wrapping mode is not representable in glTF');
    if (!supportedMagFilter.has(texture.magFilter) || !supportedMinFilter.has(texture.minFilter)) unsupportedSemantics.push('texture filter is not representable in glTF');
    if (texture.anisotropy !== 1) unsupportedSemantics.push('texture anisotropy is not serialized by the glTF exporter');
    if (texture.premultiplyAlpha) unsupportedSemantics.push('premultiplied texture alpha is not serialized by the glTF exporter');
    if (texture.center.x !== 0 || texture.center.y !== 0) unsupportedSemantics.push('texture transform center is not serialized by KHR_texture_transform');
    if (!texture.matrixAutoUpdate) unsupportedSemantics.push('manual texture matrices are not serialized by KHR_texture_transform');
    if (texture.internalFormat !== null) unsupportedSemantics.push('custom GPU internal texture format is not serialized by glTF');
    if (!texture.generateMipmaps && mipmappedFilters.has(texture.minFilter)) {
      unsupportedSemantics.push('mipmapped minification filter requires generated mipmaps');
    }
    for (const value of [
      texture.mapping, texture.channel, texture.format, texture.type,
      texture.wrapS, texture.wrapT,
      texture.magFilter, texture.minFilter,
      texture.rotation,
      mipmappedFilters.has(texture.minFilter) ? 1 : 0,
    ]) samplerHasher.number(Number(value));
    samplerHasher.text(texture.colorSpace);
    samplerHasher.array(texture.offset.toArray());
    samplerHasher.array(texture.repeat.toArray());
    core = {
      width: content.width,
      height: content.height,
      contentFingerprint: contentHasher.digest(),
      samplerFingerprint: samplerHasher.digest(),
      inspectable: content.bytes !== undefined,
      samplerSerializable: unsupportedSemantics.length === 0,
      unsupportedSemantics,
    };
    cache.set(texture, core);
  }
  const id = `${material.name || material.type}:${slot}:${texture.name || texture.type}`;
  return { id, ...core };
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function colorTuple(color: THREE.Color | undefined, fallback: THREE.ColorRepresentation): [number, number, number] {
  const value = color ?? new THREE.Color(fallback);
  return [value.r, value.g, value.b];
}

/**
 * Canonicalizes the render semantics that Three's GLTFExporter is expected to
 * preserve. It deliberately ignores the runtime material class: a default
 * MeshPhysicalMaterial may reopen as MeshStandardMaterial while retaining the
 * same glTF appearance. Unsupported source semantics are reported separately
 * instead of being silently accepted.
 */
function materialPayload(material: THREE.Material): SceneSnapshot['materialPayloads'][number] {
  const candidate = material as THREE.MeshPhysicalMaterial & THREE.MeshBasicMaterial;
  const standard = candidate.isMeshStandardMaterial === true;
  const physical = candidate.isMeshPhysicalMaterial === true;
  const unlit = candidate.isMeshBasicMaterial === true;
  const unsupportedSemantics: string[] = [];
  if (!standard && !unlit) unsupportedSemantics.push(`unsupported material class ${material.type}`);
  if (material.side === THREE.BackSide) unsupportedSemantics.push('back-side-only rendering is not representable in glTF');
  if (material.blending !== THREE.NormalBlending) unsupportedSemantics.push('custom blending is not representable in glTF');
  if (candidate.normalMap && candidate.normalScale
    && Math.abs(Math.abs(candidate.normalScale.x) - Math.abs(candidate.normalScale.y)) > 1e-9) {
    unsupportedSemantics.push('asymmetric normal-map scale is not representable in glTF');
  }

  const alphaMode = material.transparent ? 'BLEND' : material.alphaTest > 0 ? 'MASK' : 'OPAQUE';
  const clearcoat = physical ? candidate.clearcoat : 0;
  const iridescence = physical ? candidate.iridescence : 0;
  const transmission = physical ? candidate.transmission : 0;
  const sheen = physical ? candidate.sheen : 0;
  const anisotropy = physical ? candidate.anisotropy : 0;
  const dispersion = physical ? candidate.dispersion : 0;
  const semantics = {
    schema: 'morphloom.gltf-material-semantics/0.1',
    name: material.name,
    unlit,
    pbrMetallicRoughness: {
      baseColorFactor: [...colorTuple(candidate.color, 0xffffff), material.opacity],
      metallicFactor: standard ? candidate.metalness : 0,
      roughnessFactor: standard ? candidate.roughness : 1,
    },
    alphaMode,
    alphaCutoff: alphaMode === 'MASK' ? material.alphaTest : null,
    doubleSided: material.side === THREE.DoubleSide,
    emissiveFactor: standard ? colorTuple(candidate.emissive, 0x000000) : [0, 0, 0],
    emissiveStrength: standard ? candidate.emissiveIntensity : 1,
    normalScale: candidate.normalMap ? candidate.normalScale?.x ?? 1 : null,
    occlusionStrength: candidate.aoMap ? candidate.aoMapIntensity : null,
    clearcoat: clearcoat > 0 ? {
      factor: clearcoat,
      roughnessFactor: candidate.clearcoatRoughness,
      normalScale: candidate.clearcoatNormalMap ? candidate.clearcoatNormalScale.x : null,
    } : null,
    iridescence: iridescence > 0 ? {
      factor: iridescence,
      ior: candidate.iridescenceIOR,
      thicknessMinimum: candidate.iridescenceThicknessRange[0],
      thicknessMaximum: candidate.iridescenceThicknessRange[1],
    } : null,
    transmission: transmission > 0 ? {
      factor: transmission,
      thicknessFactor: candidate.thickness,
      attenuationDistance: Number.isFinite(candidate.attenuationDistance) ? candidate.attenuationDistance : 'infinite',
      attenuationColor: colorTuple(candidate.attenuationColor, 0xffffff),
    } : null,
    ior: physical ? candidate.ior : 1.5,
    specular: physical ? {
      factor: candidate.specularIntensity,
      colorFactor: colorTuple(candidate.specularColor, 0xffffff),
    } : { factor: 1, colorFactor: [1, 1, 1] },
    sheen: sheen > 0 ? {
      activation: sheen,
      roughnessFactor: candidate.sheenRoughness,
      colorFactor: colorTuple(candidate.sheenColor, 0x000000),
    } : null,
    anisotropy: anisotropy !== 0 ? { strength: anisotropy, rotation: candidate.anisotropyRotation } : null,
    dispersion: dispersion !== 0 ? dispersion : null,
    surfaceMetadata: material.userData?.morphloomSurface ?? null,
  };
  return {
    id: material.name || 'unnamed-material',
    fingerprint: fingerprintJson(semantics),
    serializable: unsupportedSemantics.length === 0,
    unsupportedSemantics,
  };
}

function textureEstimate(texture: THREE.Texture): number {
  const source = texture.source?.data as { width?: number; height?: number } | undefined;
  const width = Number(source?.width ?? 0);
  const height = Number(source?.height ?? 0);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? Math.round(width * height * 4 * 1.333)
    : 0;
}

function boxTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

export function snapshotScene(root: THREE.Object3D): SceneSnapshot {
  root.updateMatrixWorld(true);
  const hasher = new StableHasher();
  hasher.text(SCENE_FINGERPRINT_REVISION);
  const materialPayloadMap = new Map<string, SceneSnapshot['materialPayloads'][number]>();
  const textures = new Set<THREE.Texture>();
  const texturePayloadCache = new Map<THREE.Texture, Omit<SceneSnapshot['texturePayloads'][number], 'id'>>();
  const texturePayloadMap = new Map<string, SceneSnapshot['texturePayloads'][number]>();
  const partIds = new Set<string>();
  const duplicatePartIds = new Set<string>();
  const visibleBounds = new THREE.Box3();
  let nodes = 0;
  let namedNodes = 0;
  let meshes = 0;
  let namedMeshes = 0;
  let primitives = 0;
  let skeletons = 0;
  let bones = 0;
  let gameLods = 0;
  let collisionPrimitives = 0;
  let collisionManifestFingerprint = 'none';
  let planFootprintAudits = 0;
  let planFootprintAuditFingerprint = 'none';
  let dimensionAudits = 0;
  let dimensionAuditFingerprint = 'none';
  let animationManifestEntries = 0;
  let animationManifestFingerprint = 'none';
  let morphTargets = 0;
  const morphTargetNames: string[] = [];
  const morphTargetPayloads: SceneSnapshot['morphTargetPayloads'] = [];
  const meshPayloads: SceneSnapshot['meshPayloads'] = [];
  let triangles = 0;
  let geometryBytes = 0;
  let finiteTransforms = true;

  // GLTFExporter runs with onlyVisible=true. Audit the exact delivery scope so
  // hidden rig/debug helpers are not misreported as lost production meshes.
  root.traverseVisible((object) => {
    nodes += 1;
    if (object.name.trim()) namedNodes += 1;
    hasher.text(object.type);
    hasher.text(object.name);
    hasher.array(object.matrixWorld.elements);
    finiteTransforms = finiteTransforms && object.matrixWorld.elements.every(Number.isFinite);
    const gameDelivery = object.userData.gameDelivery as {
      lods?: unknown[];
      collisionPrimitives?: unknown[];
      animationSet?: unknown[];
    } | undefined;
    if (gameDelivery) {
      gameLods = Math.max(gameLods, Array.isArray(gameDelivery.lods) ? gameDelivery.lods.length : 0);
      if (Array.isArray(gameDelivery.collisionPrimitives) && gameDelivery.collisionPrimitives.length >= collisionPrimitives) {
        collisionPrimitives = gameDelivery.collisionPrimitives.length;
        collisionManifestFingerprint = fingerprintJson(gameDelivery.collisionPrimitives);
        hasher.text(collisionManifestFingerprint);
      }
      if (Array.isArray(gameDelivery.animationSet) && gameDelivery.animationSet.length >= animationManifestEntries) {
        animationManifestEntries = gameDelivery.animationSet.length;
        animationManifestFingerprint = fingerprintJson(gameDelivery.animationSet);
        hasher.text(animationManifestFingerprint);
      }
    }
    const planFootprintAudit = object.userData.planFootprintAudit as { schema?: string } | undefined;
    if (planFootprintAudit?.schema === 'morphloom.plan-footprint-audit/0.1') {
      planFootprintAudits += 1;
      planFootprintAuditFingerprint = fingerprintJson(planFootprintAudit);
      hasher.text(planFootprintAuditFingerprint);
    }
    const dimensionAudit = object.userData.dimensionAudit as { schema?: string } | undefined;
    if (dimensionAudit?.schema === 'morphloom.dimension-audit/0.1'
      || dimensionAudit?.schema === 'morphloom.dimension-audit/0.2') {
      dimensionAudits += 1;
      dimensionAuditFingerprint = fingerprintJson(dimensionAudit);
      hasher.text(dimensionAuditFingerprint);
    }
    if (object instanceof THREE.Bone) bones += 1;
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) skeletons += 1;
    meshes += 1;
    if (object.name.trim()) namedMeshes += 1;
    const partId = typeof object.userData.part?.id === 'string' ? object.userData.part.id : '';
    if (partId) {
      if (partIds.has(partId)) duplicatePartIds.add(partId);
      partIds.add(partId);
    }
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const targetEntries = Object.entries(object.morphTargetDictionary ?? {})
      .sort((left, right) => left[1] - right[1]);
    morphTargets += targetEntries.length;
    for (const [name, targetIndex] of targetEntries) {
      morphTargetNames.push(`${object.name}:${name}`);
      hasher.text(name);
      hasher.number(targetIndex);
      const target = geometry.morphAttributes.position?.[targetIndex];
      hasher.array(target?.array);
      geometryBytes += target?.array.byteLength ?? 0;
      let affectedVertices = 0;
      let displacementSumMm = 0;
      let displacementSquaredSumMm2 = 0;
      let maximumDisplacementMm = 0;
      if (target && target.itemSize === 3 && position && target.count === position.count) {
        for (let vertex = 0; vertex < target.count; vertex += 1) {
          const baseX = geometry.morphTargetsRelative ? 0 : position.getX(vertex);
          const baseY = geometry.morphTargetsRelative ? 0 : position.getY(vertex);
          const baseZ = geometry.morphTargetsRelative ? 0 : position.getZ(vertex);
          const displacementMm = Math.hypot(
            target.getX(vertex) - baseX,
            target.getY(vertex) - baseY,
            target.getZ(vertex) - baseZ,
          ) * 1_000;
          if (displacementMm <= 0.0001) continue;
          affectedVertices += 1;
          displacementSumMm += displacementMm;
          displacementSquaredSumMm2 += displacementMm * displacementMm;
          maximumDisplacementMm = Math.max(maximumDisplacementMm, displacementMm);
        }
      }
      morphTargetPayloads.push({
        id: `${object.name}:${name}`,
        affectedVertices,
        displacementSumMm,
        displacementSquaredSumMm2,
        maximumDisplacementMm,
      });
    }
    const groups = geometry.groups;
    const materialCount = materialList(object.material).length;
    const deliveryGroups = materialCount > 1 && groups.length > 0 ? groups : [{ start: 0, count: 0, materialIndex: 0 }];
    primitives += deliveryGroups.length;
    hasher.number(deliveryGroups.length);
    for (const group of deliveryGroups) {
      hasher.number(group.start);
      hasher.number(group.count);
      hasher.number(group.materialIndex ?? 0);
    }
    // GLTFLoader expands BufferGeometry.boundingBox to include morph extrema.
    // Delivery dimensions are compared in the neutral/base pose; morph ranges
    // are audited independently by identity and payload below.
    if (position) visibleBounds.union(new THREE.Box3().setFromBufferAttribute(position).applyMatrix4(object.matrixWorld));
    const index = geometry.getIndex();
    triangles += index ? index.count / 3 : (position?.count ?? 0) / 3;
    for (const attribute of Object.values(geometry.attributes) as THREE.BufferAttribute[]) {
      geometryBytes += attribute.array.byteLength;
      hasher.text(attribute.name);
      hasher.array(attribute.array);
    }
    if (index) {
      geometryBytes += index.array.byteLength;
      hasher.array(index.array);
    }
    for (const material of materialList(object.material)) {
      const payload = materialPayload(material);
      materialPayloadMap.set([
        payload.id,
        payload.fingerprint,
        payload.serializable ? 'serializable' : 'unsupported',
        ...payload.unsupportedSemantics,
      ].join('|'), payload);
      hasher.text(payload.id);
      hasher.text(payload.fingerprint);
      hasher.text(payload.serializable ? 'serializable' : 'unsupported');
      for (const [slot, value] of Object.entries(material).sort(([left], [right]) => compareStableText(left, right))) {
        if (!(value instanceof THREE.Texture)) continue;
        textures.add(value);
        const payload = texturePayload(material, slot, value, texturePayloadCache);
        texturePayloadMap.set([
          payload.id,
          payload.contentFingerprint,
          payload.samplerFingerprint,
          payload.samplerSerializable ? 'serializable' : 'unsupported',
          ...payload.unsupportedSemantics,
        ].join('|'), payload);
      }
    }
    const geometryHasher = new StableHasher();
    geometryHasher.text('morphloom.mesh-geometry/0.1');
    for (const [attributeName, attribute] of (Object.entries(geometry.attributes) as Array<[
      string,
      THREE.BufferAttribute,
    ]>).sort(([left], [right]) => compareStableText(left, right))) {
      geometryHasher.text(attributeName);
      geometryHasher.number(attribute.itemSize);
      geometryHasher.text(attribute.normalized ? 'normalized' : 'raw');
      geometryHasher.array(attribute.array);
    }
    geometryHasher.array(index?.array);
    for (const group of deliveryGroups) {
      geometryHasher.number(group.start);
      geometryHasher.number(group.count);
      geometryHasher.number(group.materialIndex ?? 0);
    }
    const transformHasher = new StableHasher();
    transformHasher.text('morphloom.mesh-transform/0.1');
    transformHasher.array(object.matrixWorld.elements);
    const materialHasher = new StableHasher();
    materialHasher.text('morphloom.mesh-materials/0.1');
    for (const material of materialList(object.material)) {
      const payload = materialPayload(material);
      materialHasher.text(payload.id);
      materialHasher.text(payload.fingerprint);
    }
    meshPayloads.push({
      id: object.name || `unnamed-mesh-${meshes}`,
      geometryFingerprint: geometryHasher.digest(),
      transformFingerprint: transformHasher.digest(),
      materialFingerprint: materialHasher.digest(),
    });
  });

  if (visibleBounds.isEmpty()) visibleBounds.set(new THREE.Vector3(), new THREE.Vector3());
  const size = visibleBounds.getSize(new THREE.Vector3());
  const textureBytes = [...textures].reduce((sum, texture) => sum + textureEstimate(texture), 0);
  const materialPayloads = [...materialPayloadMap.values()].sort((left, right) => (
    compareStableText(left.id, right.id)
    || compareStableText(left.fingerprint, right.fingerprint)
    || Number(left.serializable) - Number(right.serializable)
    || compareStableText(left.unsupportedSemantics.join('|'), right.unsupportedSemantics.join('|'))
  ));
  for (const payload of materialPayloads) {
    hasher.text(payload.id);
    hasher.text(payload.fingerprint);
    hasher.text(payload.serializable ? 'serializable' : 'unsupported');
    for (const issue of payload.unsupportedSemantics) hasher.text(issue);
  }
  const serializableMaterialPayloads = materialPayloads.filter((payload) => payload.serializable).length;
  const texturePayloads = [...texturePayloadMap.values()].sort((left, right) => (
    compareStableText(left.id, right.id)
    || compareStableText(left.contentFingerprint, right.contentFingerprint)
    || compareStableText(left.samplerFingerprint, right.samplerFingerprint)
    || Number(left.samplerSerializable) - Number(right.samplerSerializable)
    || compareStableText(left.unsupportedSemantics.join('|'), right.unsupportedSemantics.join('|'))
  ));
  for (const payload of texturePayloads) {
    hasher.text(payload.id);
    hasher.number(payload.width);
    hasher.number(payload.height);
    hasher.text(payload.contentFingerprint);
    hasher.text(payload.samplerFingerprint);
    hasher.text(payload.inspectable ? 'inspectable' : 'uninspectable');
    hasher.text(payload.samplerSerializable ? 'sampler-serializable' : 'sampler-unsupported');
    for (const issue of payload.unsupportedSemantics) hasher.text(issue);
  }
  const inspectableTexturePayloads = texturePayloads.filter((payload) => payload.inspectable && payload.samplerSerializable).length;
  const animations = root.animations ?? [];
  let animationTracks = 0;
  const animationClipNames: string[] = [];
  const animationTrackNames: string[] = [];
  for (const clip of animations) {
    animationClipNames.push(clip.name);
    hasher.text(clip.name);
    hasher.number(clip.duration);
    animationTracks += clip.tracks.length;
    for (const track of clip.tracks) {
      animationTrackNames.push(`${clip.name}:${track.name}`);
      hasher.text(track.name);
      hasher.array(track.times);
      hasher.array(track.values);
    }
  }
  return {
    fingerprint: hasher.digest(),
    nodes,
    namedNodes,
    meshes,
    namedMeshes,
    primitives,
    skeletons,
    bones,
    animationClips: animations.length,
    animationTracks,
    animationClipNames: animationClipNames.sort(),
    animationTrackNames: animationTrackNames.sort(),
    animationManifestEntries,
    animationManifestFingerprint,
    morphTargets,
    morphTargetNames: morphTargetNames.sort(),
    morphTargetPayloads: morphTargetPayloads.sort((left, right) => compareStableText(left.id, right.id)),
    meshPayloads: meshPayloads.sort((left, right) => compareStableText(left.id, right.id)),
    gameLods,
    collisionPrimitives,
    collisionManifestFingerprint,
    planFootprintAudits,
    planFootprintAuditFingerprint,
    dimensionAudits,
    dimensionAuditFingerprint,
    materials: materialPayloads.length,
    materialPayloads,
    materialPayloadCoverage: materialPayloads.length > 0 ? serializableMaterialPayloads / materialPayloads.length : 1,
    triangles: Math.round(triangles),
    geometryBytes,
    textureBytes,
    texturePayloads,
    texturePayloadCoverage: texturePayloads.length > 0 ? inspectableTexturePayloads / texturePayloads.length : 1,
    finiteTransforms,
    duplicatePartIds: [...duplicatePartIds].sort(),
    boundsMeters: { min: boxTuple(visibleBounds.min), max: boxTuple(visibleBounds.max), size: boxTuple(size) },
  };
}

export function fingerprintJson(value: unknown): string {
  const hasher = new StableHasher();
  const visit = (node: unknown): void => {
    if (typeof node === 'number') {
      hasher.text('number');
      hasher.number(node);
      return;
    }
    if (node === null || typeof node !== 'object') {
      hasher.text(`${typeof node}:${String(node)}`);
      return;
    }
    if (Array.isArray(node)) {
      hasher.text('array');
      hasher.number(node.length);
      for (const item of node) visit(item);
      return;
    }
    hasher.text('object');
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      hasher.text(key);
      visit((node as Record<string, unknown>)[key]);
    }
  };
  visit(value);
  return hasher.digest();
}

/**
 * Stable identity for the inputs that can affect a delivery build. Product
 * proofs deliberately ignore the currently selected human controls and human
 * proofs ignore product controls, so navigation order cannot invalidate or
 * accidentally reuse a browser proof.
 */
export function deliveryInputFingerprint(input: {
  assetKind: AssetKind;
  assemblyIR?: AssemblyIR;
  productSpec: ProductSpec;
  spec: CharacterSpec;
  pack: HumanPack;
}): string {
  if (input.assetKind === 'human') {
    return fingerprintJson({
      pipelineRevision: DELIVERY_PIPELINE_REVISION,
      assetKind: input.assetKind,
      spec: input.spec,
      pack: {
        name: input.pack.manifest.name,
        version: input.pack.manifest.version,
        quantizationError: input.pack.quantizationError,
        positions: input.pack.positions.length,
        indices: input.pack.indices.length,
        targets: input.pack.targets.map((target) => target.name),
      },
    });
  }
  if (input.assemblyIR) {
    return fingerprintJson({
      pipelineRevision: DELIVERY_PIPELINE_REVISION,
      assetKind: input.assetKind,
      assemblyIR: input.assemblyIR,
    });
  }
  return fingerprintJson({
    pipelineRevision: DELIVERY_PIPELINE_REVISION,
    assetKind: input.assetKind,
    productSpec: input.productSpec,
  });
}

function maximumBoundsErrorMm(source: SceneSnapshot, reopened: SceneSnapshot): number {
  let maximum = 0;
  for (const key of ['min', 'max'] as const) {
    for (let axis = 0; axis < 3; axis += 1) {
      maximum = Math.max(maximum, Math.abs(source.boundsMeters[key][axis] - reopened.boundsMeters[key][axis]) * 1000);
    }
  }
  return maximum;
}

function morphTargetPayloadsMatch(source: SceneSnapshot, reopened: SceneSnapshot): boolean {
  if (source.morphTargetPayloads.length !== reopened.morphTargetPayloads.length) return false;
  const close = (left: number, right: number): boolean => (
    Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= Math.max(1e-4, Math.abs(left) * 1e-5, Math.abs(right) * 1e-5)
  );
  return source.morphTargetPayloads.every((left, index) => {
    const right = reopened.morphTargetPayloads[index];
    return right !== undefined
      && left.id === right.id
      && left.affectedVertices === right.affectedVertices
      && close(left.displacementSumMm, right.displacementSumMm)
      && close(left.displacementSquaredSumMm2, right.displacementSquaredSumMm2)
      && close(left.maximumDisplacementMm, right.maximumDisplacementMm);
  });
}

function texturePayloadsMatch(source: SceneSnapshot, reopened: SceneSnapshot): boolean {
  if (source.texturePayloadCoverage !== 1 || reopened.texturePayloadCoverage !== 1
    || source.texturePayloads.length !== reopened.texturePayloads.length) return false;
  return source.texturePayloads.every((left, index) => {
    const right = reopened.texturePayloads[index];
    return right !== undefined
      && left.id === right.id
      && left.width === right.width
      && left.height === right.height
      && left.contentFingerprint === right.contentFingerprint
      && left.samplerFingerprint === right.samplerFingerprint
      && left.inspectable === right.inspectable
      && left.samplerSerializable === right.samplerSerializable
      && left.unsupportedSemantics.join('|') === right.unsupportedSemantics.join('|');
  });
}

function materialPayloadsMatch(source: SceneSnapshot, reopened: SceneSnapshot): boolean {
  if (source.materialPayloadCoverage !== 1 || reopened.materialPayloadCoverage !== 1
    || source.materialPayloads.length !== reopened.materialPayloads.length) return false;
  return source.materialPayloads.every((left, index) => {
    const right = reopened.materialPayloads[index];
    return right !== undefined
      && left.id === right.id
      && left.fingerprint === right.fingerprint
      && left.serializable === right.serializable
      && left.unsupportedSemantics.join('|') === right.unsupportedSemantics.join('|');
  });
}

export function compareGlbRoundTrip(
  source: SceneSnapshot,
  reopened: SceneSnapshot,
  glbBytes: number,
  durationMs: number,
  inputFingerprint = source.fingerprint,
  buildFingerprint = source.fingerprint,
  standardValidation?: GltfStandardValidation,
): DeliveryAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  // GLTFExporter stores each material group as a primitive. GLTFLoader may
  // reopen those primitives as sibling Mesh nodes, so source mesh-node count
  // is not the correct parity target for multi-material geometry.
  const meshParity = source.primitives === reopened.meshes;
  const triangleParity = source.triangles === reopened.triangles;
  const namedNodeCoverage = source.namedNodes > 0 ? Math.min(1, reopened.namedNodes / source.namedNodes) : 1;
  const boundsErrorMm = maximumBoundsErrorMm(source, reopened);
  const morphTargetPayloadParity = morphTargetPayloadsMatch(source, reopened);
  const texturePayloadParity = texturePayloadsMatch(source, reopened);
  const materialPayloadParity = materialPayloadsMatch(source, reopened);
  if (!source.finiteTransforms || !reopened.finiteTransforms) blockers.push('non-finite transform detected');
  if (!meshParity) blockers.push(`delivery primitive count changed ${source.primitives}→${reopened.meshes}`);
  if (!triangleParity) blockers.push(`triangle count changed ${source.triangles}→${reopened.triangles}`);
  if (source.skeletons !== reopened.skeletons) blockers.push(`skeleton count changed ${source.skeletons}→${reopened.skeletons}`);
  if (source.bones !== reopened.bones) blockers.push(`bone count changed ${source.bones}→${reopened.bones}`);
  if (source.animationClips !== reopened.animationClips) {
    blockers.push(`animation clip count changed ${source.animationClips}→${reopened.animationClips}`);
  }
  if (source.animationTracks !== reopened.animationTracks) {
    blockers.push(`animation track count changed ${source.animationTracks}→${reopened.animationTracks}`);
  }
  if (source.animationClipNames.join('|') !== reopened.animationClipNames.join('|')) {
    blockers.push('animation clip identities changed during GLB round-trip');
  }
  if (source.animationTrackNames.join('|') !== reopened.animationTrackNames.join('|')) {
    blockers.push('animation binding identities changed during GLB round-trip');
  }
  if (source.animationManifestEntries !== reopened.animationManifestEntries
    || source.animationManifestFingerprint !== reopened.animationManifestFingerprint) {
    blockers.push('animation delivery metadata changed during GLB round-trip');
  }
  if (source.morphTargets !== reopened.morphTargets) blockers.push(`morph target count changed ${source.morphTargets}→${reopened.morphTargets}`);
  if (source.morphTargetNames.join('|') !== reopened.morphTargetNames.join('|')) {
    blockers.push('morph target identities changed during GLB round-trip');
  }
  if (!morphTargetPayloadParity) blockers.push('morph target deformation payload changed during GLB round-trip');
  if (source.texturePayloadCoverage < 1) blockers.push('source texture payload is not fully inspectable or glTF-serializable');
  if (reopened.texturePayloadCoverage < 1) blockers.push('reopened GLB texture payload is not fully inspectable or supported');
  if (!texturePayloadParity) blockers.push('texture content or sampling semantics changed during GLB round-trip');
  if (source.materialPayloadCoverage < 1) blockers.push('source material contains glTF-incompatible render semantics');
  if (reopened.materialPayloadCoverage < 1) blockers.push('reopened GLB material contains unsupported render semantics');
  if (!materialPayloadParity) blockers.push('material scalar or optical semantics changed during GLB round-trip');
  if (source.gameLods !== reopened.gameLods) blockers.push(`game LOD manifest changed ${source.gameLods}→${reopened.gameLods}`);
  if (source.collisionPrimitives !== reopened.collisionPrimitives) {
    blockers.push(`collision primitive manifest changed ${source.collisionPrimitives}→${reopened.collisionPrimitives}`);
  }
  if (source.collisionManifestFingerprint !== reopened.collisionManifestFingerprint) {
    blockers.push('collision primitive semantics changed during GLB round-trip');
  }
  if (source.planFootprintAudits !== reopened.planFootprintAudits
    || source.planFootprintAuditFingerprint !== reopened.planFootprintAuditFingerprint) {
    blockers.push('plan-footprint audit metadata changed during GLB round-trip');
  }
  if (source.dimensionAudits !== reopened.dimensionAudits
    || source.dimensionAuditFingerprint !== reopened.dimensionAuditFingerprint) {
    blockers.push('dimension audit metadata changed during GLB round-trip');
  }
  if (boundsErrorMm > 0.1) blockers.push(`round-trip bounds drift ${boundsErrorMm.toFixed(3)} mm`);
  if (namedNodeCoverage < 0.95) blockers.push(`named node coverage ${Math.round(namedNodeCoverage * 100)}%`);
  if (source.duplicatePartIds.length > 0) blockers.push(`duplicate source part ids: ${source.duplicatePartIds.join(', ')}`);
  if (reopened.materials < source.materials * 0.8) warnings.push(`material families changed ${source.materials}→${reopened.materials}`);
  if (glbBytes <= 20) blockers.push('GLB payload is empty');
  if (standardValidation?.errors) {
    blockers.push(`Khronos glTF validation errors ${standardValidation.errors}: ${standardValidation.issueCodes.join(', ') || 'unspecified'}`);
  }
  if (standardValidation?.warnings) {
    warnings.push(`Khronos glTF validation warnings ${standardValidation.warnings}: ${standardValidation.issueCodes.join(', ') || 'unspecified'}`);
  }
  if (standardValidation?.truncated) warnings.push('Khronos glTF validation issue list was truncated');
  const status: DeliveryAuditStatus = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warn' : 'pass';
  const exactParity = status === 'pass' && meshParity && triangleParity
    && source.skeletons === reopened.skeletons && source.bones === reopened.bones
    && source.animationClips === reopened.animationClips && source.animationTracks === reopened.animationTracks
    && source.animationClipNames.join('|') === reopened.animationClipNames.join('|')
    && source.animationTrackNames.join('|') === reopened.animationTrackNames.join('|')
    && source.animationManifestEntries === reopened.animationManifestEntries
    && source.animationManifestFingerprint === reopened.animationManifestFingerprint
    && source.morphTargets === reopened.morphTargets
    && source.morphTargetNames.join('|') === reopened.morphTargetNames.join('|')
    && morphTargetPayloadParity
    && texturePayloadParity
    && materialPayloadParity
    && source.gameLods === reopened.gameLods && source.collisionPrimitives === reopened.collisionPrimitives
    && source.collisionManifestFingerprint === reopened.collisionManifestFingerprint
    && source.planFootprintAudits === reopened.planFootprintAudits
    && source.planFootprintAuditFingerprint === reopened.planFootprintAuditFingerprint
    && source.dimensionAudits === reopened.dimensionAudits
    && source.dimensionAuditFingerprint === reopened.dimensionAuditFingerprint
    && namedNodeCoverage === 1 && boundsErrorMm <= 0.01 && warnings.length === 0;
  const score = status === 'blocked'
    ? Math.max(0, 58 - blockers.length * 8)
    : exactParity
      ? 100
      : Math.round(Math.max(70, Math.min(99, 92 + namedNodeCoverage * 6 - boundsErrorMm * 4 - warnings.length * 5)));
  return {
    status,
    score,
    buildFingerprint,
    fingerprint: source.fingerprint,
    inputFingerprint,
    glbBytes,
    durationMs,
    meshParity,
    triangleParity,
    morphTargetPayloadParity,
    texturePayloadParity,
    materialPayloadParity,
    namedNodeCoverage,
    boundsErrorMm,
    source,
    reopened,
    standardValidation,
    blockers,
    warnings,
    platformNotes: {
      gltf20: standardValidation
        ? standardValidation.status === 'pass' ? 'khronos-validator-pass'
          : standardValidation.status === 'warn' ? 'khronos-validator-warn' : 'khronos-validator-blocked'
        : 'not-run',
      blender: 'application-import-not-run',
      unity: 'application-import-not-run',
      unreal: 'application-import-not-run',
      fusion360: 'mesh-import-only',
      figma: 'svg-reference-only',
    },
  };
}

export function blockedDeliveryAudit(error: unknown, fingerprint = 'unavailable'): DeliveryAudit {
  const detail = error instanceof Error ? error.message : 'Unknown GLB round-trip failure.';
  return {
    status: 'blocked',
    score: 0,
    buildFingerprint: fingerprint,
    fingerprint,
    inputFingerprint: fingerprint,
    glbBytes: 0,
    durationMs: 0,
    meshParity: false,
    triangleParity: false,
    morphTargetPayloadParity: false,
    texturePayloadParity: false,
    materialPayloadParity: false,
    namedNodeCoverage: 0,
    boundsErrorMm: Number.POSITIVE_INFINITY,
    blockers: [detail.slice(0, 240)],
    warnings: [],
    platformNotes: {
      gltf20: 'not-run',
      blender: 'application-import-not-run', unity: 'application-import-not-run', unreal: 'application-import-not-run',
      fusion360: 'mesh-import-only', figma: 'svg-reference-only',
    },
  };
}

export function createLocalBuildTelemetry(snapshot: SceneSnapshot, compileMs: number): LocalBuildTelemetry {
  return {
    compileMs,
    auditMs: 0,
    glbBytes: 0,
    geometryBytes: snapshot.geometryBytes,
    textureBytes: snapshot.textureBytes,
    estimatedRenderBytes: snapshot.geometryBytes + snapshot.textureBytes,
    storageLocation: 'browser-memory',
    uploadedToServer: false,
    llmCost: {
      status: 'not-observed',
      detail: 'The local viewer does not receive provider token usage. Add measured provider usage to the saved IR metadata when available.',
    },
  };
}

export function withDeliveryAudit(
  telemetry: LocalBuildTelemetry,
  audit: DeliveryAudit,
): LocalBuildTelemetry {
  return { ...telemetry, auditMs: audit.durationMs, glbBytes: audit.glbBytes };
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character] ?? character);
}

function projectedRect(
  bounds: THREE.Box3,
  full: THREE.Box3,
  view: 'front' | 'top',
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const horizontal = view === 'front' ? 'x' : 'x';
  const vertical = view === 'front' ? 'y' : 'z';
  const fullWidth = Math.max(1e-9, full.max[horizontal] - full.min[horizontal]);
  const fullHeight = Math.max(1e-9, full.max[vertical] - full.min[vertical]);
  return {
    x: x + ((bounds.min[horizontal] - full.min[horizontal]) / fullWidth) * width,
    y: y + (1 - (bounds.max[vertical] - full.min[vertical]) / fullHeight) * height,
    width: Math.max(0.45, ((bounds.max[horizontal] - bounds.min[horizontal]) / fullWidth) * width),
    height: Math.max(0.45, ((bounds.max[vertical] - bounds.min[vertical]) / fullHeight) * height),
  };
}

export function buildFigmaReferenceSvg(root: THREE.Object3D, title: string): string {
  root.updateMatrixWorld(true);
  const full = new THREE.Box3().setFromObject(root);
  const snapshot = snapshotScene(root);
  const parts: Array<{ id: string; category: string; bounds: THREE.Box3 }> = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const id = String(object.userData.part?.id ?? object.name ?? '').trim();
    if (!id) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    parts.push({ id, category: String(object.userData.part?.category ?? 'mechanical'), bounds });
  });
  const colors: Record<string, string> = {
    enclosure: '#3158ff', display: '#0aa6b8', logic: '#198754', power: '#d99000', camera: '#7c3aed',
    audio: '#db2777', radio: '#0891b2', mechanical: '#5b6670', interconnect: '#e85d3f',
  };
  const viewSvg = (view: 'front' | 'top', x: number, label: string) => parts.map((part) => {
    const rect = projectedRect(part.bounds, full, view, x, 180, 680, 620);
    return `<rect data-part-id="${xml(part.id)}" x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${rect.width.toFixed(2)}" height="${rect.height.toFixed(2)}" fill="${colors[part.category] ?? '#5b6670'}" fill-opacity="0.10" stroke="${colors[part.category] ?? '#5b6670'}" stroke-width="0.7"/>`;
  }).join('') + `<text x="${x}" y="835" class="view-label">${label}</text>`;
  const size = snapshot.boundsMeters.size.map((value) => `${(value * 1000).toFixed(2)} mm`).join(' × ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <style>.title{font:600 34px Inter,Arial,sans-serif;fill:#151713}.meta,.view-label{font:14px ui-monospace,SFMono-Regular,monospace;fill:#5b6670}.view-label{font-weight:600;fill:#151713}</style>
  <rect width="1600" height="1000" fill="#f4f4ef"/>
  <text x="80" y="82" class="title">${xml(title)} · Morphloom Figma Reference</text>
  <text x="80" y="118" class="meta">Envelope ${xml(size)} · ${snapshot.meshes} meshes · ${snapshot.triangles.toLocaleString()} tris · fingerprint ${snapshot.fingerprint}</text>
  <g id="front-view">${viewSvg('front', 80, 'FRONT · VECTOR PART ENVELOPES')}</g>
  <g id="top-view">${viewSvg('top', 840, 'TOP · VECTOR PART ENVELOPES')}</g>
  <text x="80" y="935" class="meta">Figma handoff is a 2D inspection/reference sheet. The GLB remains the authoritative 3D asset; CAD exports are mesh references, not STEP/BREP manufacturing geometry.</text>
</svg>`;
}

export function bytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}
