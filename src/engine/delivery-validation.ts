import * as THREE from 'three';
import type { AssemblyIR } from './assembly-ir';
import type { AssetKind, CharacterSpec, HumanPack, ProductSpec } from '../types';
import type { GltfStandardValidation } from './gltf-standard-validation';

export const DELIVERY_PIPELINE_REVISION = 'morphloom-compiler/0.14.0';

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
  gameLods: number;
  collisionPrimitives: number;
  collisionManifestFingerprint: string;
  planFootprintAudits: number;
  planFootprintAuditFingerprint: string;
  materials: number;
  triangles: number;
  geometryBytes: number;
  textureBytes: number;
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

  digest(): string {
    return `${this.a.toString(16).padStart(8, '0')}${this.b.toString(16).padStart(8, '0')}`;
  }
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
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
  const materials = new Set<string>();
  const textures = new Set<THREE.Texture>();
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
  let animationManifestEntries = 0;
  let animationManifestFingerprint = 'none';
  let morphTargets = 0;
  const morphTargetNames: string[] = [];
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
    const position = geometry.getAttribute('position');
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
      const physical = material as THREE.MeshPhysicalMaterial;
      const materialKey = [
        material.type, material.name, physical.color?.getHexString(), physical.roughness,
        physical.metalness, physical.transmission, physical.ior, physical.clearcoat,
        physical.anisotropy, material.userData?.morphloomSurface?.finish,
      ].join('|');
      materials.add(materialKey);
      hasher.text(materialKey);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });

  if (visibleBounds.isEmpty()) visibleBounds.set(new THREE.Vector3(), new THREE.Vector3());
  const size = visibleBounds.getSize(new THREE.Vector3());
  const textureBytes = [...textures].reduce((sum, texture) => sum + textureEstimate(texture), 0);
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
    gameLods,
    collisionPrimitives,
    collisionManifestFingerprint,
    planFootprintAudits,
    planFootprintAuditFingerprint,
    materials: materials.size,
    triangles: Math.round(triangles),
    geometryBytes,
    textureBytes,
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
    && source.gameLods === reopened.gameLods && source.collisionPrimitives === reopened.collisionPrimitives
    && source.collisionManifestFingerprint === reopened.collisionManifestFingerprint
    && source.planFootprintAudits === reopened.planFootprintAudits
    && source.planFootprintAuditFingerprint === reopened.planFootprintAuditFingerprint
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
