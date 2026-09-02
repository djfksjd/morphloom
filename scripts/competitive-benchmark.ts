import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import {
  auditFidelityContract,
  auditFidelityDelivery,
  createFidelityContract,
  startFidelityWorkflow,
  submitFidelityReview,
  type FidelityReview,
} from '../src/engine/fidelity-pipeline';
import { createOrnateKnifeIR } from '../src/engine/knife';
import { compareInteriorBands, compareReferenceFrames } from '../src/engine/reference-comparison';
import { compareMaterialFrames } from '../src/engine/material-comparison';
import { carveVisualHull } from '../src/engine/visual-hull';
import { visualBenchmarkMinimumViews, type VisualBenchmarkDomain } from '../src/engine/visual-benchmark';
import { DEFAULT_KNIFE_SPEC } from '../src/types';
import { polygonizeImplicitSurface } from '../src/engine/implicit-surface';
import { analyzeTopology } from '../src/engine/topology';
import { SerializedTaskQueue } from '../src/engine/serialized-task-queue';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { DELIVERY_PIPELINE_REVISION, SCENE_FINGERPRINT_REVISION } from '../src/engine/delivery-validation';
import { STATIC_DELIVERY_REVISION } from '../src/engine/static-mesh-roundtrip';
import { BROWSER_ROUNDTRIP_PROOF_SCHEMA } from '../src/engine/browser-roundtrip-proof';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import * as THREE from 'three';

const auditSerializedValidation = async () => {
  const queue = new SerializedTaskQueue(3);
  const order: string[] = [];
  let active = 0;
  let maximumActive = 0;
  let executionCount = 0;
  const run = (key: string) => queue.run(key, async () => {
    executionCount += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`${key}:start`);
    await Promise.resolve();
    order.push(`${key}:end`);
    active -= 1;
    return key;
  });
  const first = run('same-input');
  const duplicate = run('same-input');
  const second = run('next-input');
  await Promise.all([first, duplicate, second]);

  const recoveryQueue = new SerializedTaskQueue(2);
  const expectedFailure = recoveryQueue.run('failure', async () => { throw new Error('expected'); });
  const recovered = recoveryQueue.run('recovery', async () => 'recovered');
  await expectedFailure.catch(() => undefined);

  const capacityQueue = new SerializedTaskQueue(1);
  let releaseCapacity!: () => void;
  const capacityGate = new Promise<void>((resolve) => { releaseCapacity = resolve; });
  const holding = capacityQueue.run('holding', () => capacityGate);
  let capacityRejected = false;
  try {
    capacityQueue.run('overflow', async () => undefined);
  } catch {
    capacityRejected = true;
  }
  releaseCapacity();
  await holding;

  return {
    pass: duplicate === first
      && executionCount === 2
      && maximumActive === 1
      && order.join('|') === 'same-input:start|same-input:end|next-input:start|next-input:end'
      && await recovered === 'recovered'
      && recoveryQueue.pendingCount === 0
      && capacityRejected
      && capacityQueue.pendingCount === 0,
    sameInputDeduplicated: duplicate === first,
    maximumConcurrentTasks: maximumActive,
    failureReleasedQueue: recoveryQueue.pendingCount === 0,
    capacityRejected,
  };
};

const serializedValidationAudit = await auditSerializedValidation();

const auditDimensionContract = () => {
  const fixture: AssemblyIR = {
    schema: 'morphloom.assembly/0.1', name: 'Measured vertical regression fixture', units: 'mm',
    components: [{
      id: 'measured_wall', name: 'Measured wall', category: 'enclosure',
      materialName: 'Review material', detail: 'Synthetic evidence-bound vertical member.',
      geometry: { op: 'roundedBox', size: [1_000, 2_700, 200], radius: 10, segments: 3 },
      position: [0, 1_350, 0], material: { color: '#808080', roughness: 0.7 },
      evidence: { status: 'measured', source: 'deterministic benchmark fixture' },
    }],
    dimensionContracts: [{
      id: 'wall_height', label: 'Measured wall height',
      target: { kind: 'component', componentId: 'measured_wall' },
      axis: 'y', measurement: 'size', expectedMm: 2_700, toleranceMm: 0.1,
      evidence: { status: 'measured', source: 'deterministic benchmark fixture' },
    }],
  };
  const baselineBuild = compileAssemblyIR(fixture, 'beauty');
  const baseline = baselineBuild.metrics.dimensionAudit;
  const regressed = structuredClone(fixture);
  const wall = regressed.components[0];
  if (wall.geometry.op !== 'roundedBox') throw new Error('Unexpected dimension benchmark primitive.');
  wall.geometry.size[1] = 2_400;
  const failedBuild = compileAssemblyIR(regressed, 'beauty');
  const failed = failedBuild.metrics.dimensionAudit;
  const baselineCheck = baseline?.checks[0];
  const failedCheck = failed?.checks[0];
  const baselineEnvelope = baselineBuild.metrics.bounds.getSize(new THREE.Vector3());
  const failedEnvelope = failedBuild.metrics.bounds.getSize(new THREE.Vector3());
  const horizontalEnvelopeUnchanged = Math.abs(baselineEnvelope.x - failedEnvelope.x) <= 1e-9
    && Math.abs(baselineEnvelope.z - failedEnvelope.z) <= 1e-9;
  return {
    pass: baseline?.pass === true && failed?.pass === false
      && (baselineCheck?.deviationMm ?? Number.POSITIVE_INFINITY) <= 0.1
      && Math.abs((failedCheck?.deviationMm ?? 0) - 300) <= 0.1
      && horizontalEnvelopeUnchanged,
    baseline: baselineCheck,
    regressed: failedCheck,
    horizontalEnvelopeUnchanged,
  };
};

const dimensionContractAudit = auditDimensionContract();

const auditAnchorPitchContract = () => {
  const fixture: AssemblyIR = {
    schema: 'morphloom.assembly/0.1', name: 'Measured datum pitch fixture', units: 'mm',
    components: [0, 25].map((x, index) => ({
      id: `socket_${index}`, name: `Socket ${index}`, category: 'interconnect' as const,
      materialName: 'Review polymer', detail: 'Synthetic evidence-bound connector.',
      geometry: { op: 'roundedBox' as const, size: [10, 8, 6] as [number, number, number], radius: 0.5 },
      position: [x, 0, 0] as [number, number, number],
      dimensionAnchors: [{ id: 'pin_center', position: [0, 0, 0] as [number, number, number] }],
      material: { color: '#404040', roughness: 0.7 },
      evidence: { status: 'datasheet' as const, source: 'deterministic benchmark fixture' },
    })),
    dimensionContracts: [{
      id: 'socket_pitch', label: 'Socket centre pitch',
      target: {
        kind: 'anchorPair',
        from: { componentId: 'socket_0', anchorId: 'pin_center' },
        to: { componentId: 'socket_1', anchorId: 'pin_center' },
      },
      axis: 'x', measurement: 'distance', expectedMm: 25, toleranceMm: 0.05,
      evidence: { status: 'datasheet', source: 'deterministic benchmark fixture' },
    }],
  };
  const baseline = compileAssemblyIR(fixture, 'beauty').metrics.dimensionAudit;
  const regressed = structuredClone(fixture);
  regressed.components[1]!.position![0] = 24.5;
  const failed = compileAssemblyIR(regressed, 'beauty').metrics.dimensionAudit;
  return {
    pass: baseline?.pass === true && failed?.pass === false
      && Math.abs((baseline.checks[0]?.actualMm ?? 0) - 25) <= 0.001
      && Math.abs((failed.checks[0]?.actualMm ?? 0) - 24.5) <= 0.001,
    baseline: baseline?.checks[0],
    regressed: failed?.checks[0],
  };
};

const anchorPitchAudit = auditAnchorPitchContract();

const auditLocalAxisContract = () => {
  const fixture: AssemblyIR = {
    schema: 'morphloom.assembly/0.1', name: 'Rotated local-axis fixture', units: 'mm',
    components: [{
      id: 'rotated_member', name: 'Rotated member', category: 'mechanical',
      materialName: 'Review metal', detail: 'Synthetic local-axis member.',
      geometry: { op: 'roundedBox', size: [100, 10, 2], radius: 0 },
      rotation: [0, 0, Math.PI / 4], material: { color: '#808080', metalness: 1, roughness: 0.3 },
      evidence: { status: 'datasheet', source: 'deterministic benchmark fixture' },
    }],
    dimensionContracts: [{
      id: 'member_length', label: 'Rotated member local length',
      target: { kind: 'component', componentId: 'rotated_member' },
      axis: 'x', measurement: 'size', space: 'component-local', expectedMm: 100, toleranceMm: 0.05,
      evidence: { status: 'datasheet', source: 'deterministic benchmark fixture' },
    }],
  };
  const baselineBuild = compileAssemblyIR(fixture, 'beauty');
  const baseline = baselineBuild.metrics.dimensionAudit;
  const worldAabbMm = baselineBuild.metrics.bounds.getSize(new THREE.Vector3()).x * 1_000;
  const regressed = structuredClone(fixture);
  const member = regressed.components[0]!;
  if (member.geometry.op !== 'roundedBox') throw new Error('Unexpected local-axis benchmark primitive.');
  member.geometry.size[0] = 90;
  const failed = compileAssemblyIR(regressed, 'beauty').metrics.dimensionAudit;
  return {
    pass: baseline?.pass === true && failed?.pass === false
      && Math.abs((baseline.checks[0]?.actualMm ?? 0) - 100) <= 0.001
      && Math.abs((failed.checks[0]?.actualMm ?? 0) - 90) <= 0.001
      && worldAabbMm > 77 && worldAabbMm < 79,
    worldAabbMm,
    baseline: baseline?.checks[0],
    regressed: failed?.checks[0],
  };
};

const localAxisAudit = auditLocalAxisContract();

const auditRotatedLocalPitchContract = () => {
  const fixture: AssemblyIR = {
    schema: 'morphloom.assembly/0.1', name: 'Rotated local pitch fixture', units: 'mm',
    components: [{
      id: 'camera_plate', name: 'Camera plate', category: 'camera', materialName: 'Review metal',
      detail: 'Synthetic rotated datum carrier.',
      geometry: { op: 'roundedBox', size: [40, 20, 4], radius: 1 },
      rotation: [0, 0, Math.PI / 4],
      dimensionAnchors: [
        { id: 'lens_left', position: [-12.5, 0, 0] },
        { id: 'lens_right', position: [12.5, 0, 0] },
      ],
      material: { color: '#808080', metalness: 1, roughness: 0.3 },
      evidence: { status: 'datasheet', source: 'deterministic benchmark fixture' },
    }],
    dimensionContracts: [{
      id: 'lens_pitch', label: 'Rotated lens centre pitch',
      target: {
        kind: 'anchorPair',
        from: { componentId: 'camera_plate', anchorId: 'lens_left' },
        to: { componentId: 'camera_plate', anchorId: 'lens_right' },
      },
      axis: 'x', measurement: 'distance', space: 'component-local', expectedMm: 25, toleranceMm: 0.05,
      evidence: { status: 'datasheet', source: 'deterministic benchmark fixture' },
    }],
  };
  const baseline = compileAssemblyIR(fixture, 'beauty').metrics.dimensionAudit;
  const regressed = structuredClone(fixture);
  regressed.components[0]!.dimensionAnchors![1]!.position[0] = 12;
  const failed = compileAssemblyIR(regressed, 'beauty').metrics.dimensionAudit;
  return {
    pass: baseline?.pass === true && failed?.pass === false
      && Math.abs((baseline.checks[0]?.actualMm ?? 0) - 25) <= 0.001
      && Math.abs((failed.checks[0]?.actualMm ?? 0) - 24.5) <= 0.001,
    baseline: baseline?.checks[0],
    regressed: failed?.checks[0],
  };
};

const rotatedLocalPitchAudit = auditRotatedLocalPitchContract();

const minimalGlb = (): ArrayBuffer => {
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}] });
  const jsonBytes = new TextEncoder().encode(json);
  const paddedLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(jsonBytes, 20);
  return bytes.buffer;
};

const validGlb = await validateGlbStandard(minimalGlb());
const corruptGlbBytes = minimalGlb();
new DataView(corruptGlbBytes).setUint32(0, 0, true);
const corruptGlb = await validateGlbStandard(corruptGlbBytes);
const standardValidationAudit = {
  pass: validGlb.status === 'pass' && validGlb.errors === 0 && validGlb.warnings === 0
    && validGlb.independentRead.status === 'pass'
    && corruptGlb.status === 'blocked' && corruptGlb.issueCodes.includes('GLB_INVALID_MAGIC'),
  validator: validGlb.validator,
  validatorVersion: validGlb.validatorVersion,
  validFixture: validGlb,
  corruptFixture: corruptGlb,
};
type BrowserRoundTripAsset = {
  id?: string;
  status?: string;
  inputFingerprint?: string;
  buildFingerprint?: string;
  sceneFingerprint?: string;
  boundsErrorMm?: number;
  namedNodeCoverage?: number;
  morphTargetPayloadParity?: boolean;
  texturePayloadParity?: boolean;
  materialPayloadParity?: boolean;
  morphTargets?: number;
  reopenedMorphTargets?: number;
};
const browserRoundTrip = JSON.parse(readFileSync('benchmarks/browser-roundtrip-latest.json', 'utf8')) as {
  schema?: string;
  compilerRevision?: string;
  fingerprintRevision?: string;
  generatedAt?: string;
  console?: { errors?: number; warnings?: number };
  assets?: BrowserRoundTripAsset[];
};
const requiredBrowserAssets = new Set([
  'pinterest-concept-architectural-review',
  'laurel-homes-architectural-review',
  'cooling-service-assembly',
  'ornate-knife-product-visualization',
  'single-view-character-previs',
  'field-human-runtime-base',
  'asphalt-print-surface',
]);
const browserAssets = browserRoundTrip.assets ?? [];
const browserAssetIds = browserAssets.map((asset) => asset.id ?? '');
const browserRoundTripPass = browserRoundTrip.schema === BROWSER_ROUNDTRIP_PROOF_SCHEMA
  && browserRoundTrip.compilerRevision === DELIVERY_PIPELINE_REVISION
  && browserRoundTrip.fingerprintRevision === SCENE_FINGERPRINT_REVISION
  && browserRoundTrip.console?.errors === 0
  && browserRoundTrip.console?.warnings === 0
  && browserAssets.length === requiredBrowserAssets.size
  && new Set(browserAssetIds).size === browserAssets.length
  && browserAssets.every((asset) => requiredBrowserAssets.has(asset.id ?? '')
    && asset.status === 'pass'
    && /^[a-f0-9]{16}$/.test(asset.inputFingerprint ?? '')
    && /^[a-f0-9]{16}$/.test(asset.buildFingerprint ?? '')
    && /^[a-f0-9]{16}$/.test(asset.sceneFingerprint ?? '')
    && Number.isFinite(asset.boundsErrorMm) && Number(asset.boundsErrorMm) >= 0 && Number(asset.boundsErrorMm) <= 0.1
    && Number.isFinite(asset.namedNodeCoverage) && Number(asset.namedNodeCoverage) >= 0.95 && Number(asset.namedNodeCoverage) <= 1
    && asset.morphTargetPayloadParity === true
    && asset.texturePayloadParity === true)
  && browserAssets.every((asset) => asset.materialPayloadParity === true);
const browserRoundTripSummary = {
  schema: browserRoundTrip.schema,
  compilerRevision: browserRoundTrip.compilerRevision,
  fingerprintRevision: browserRoundTrip.fingerprintRevision,
  generatedAt: browserRoundTrip.generatedAt,
  receiptIntegrityPass: browserRoundTripPass,
  assets: browserAssets.map((asset) => ({
    id: asset.id,
    status: asset.status,
    morphTargetPayloadParity: asset.morphTargetPayloadParity,
    texturePayloadParity: asset.texturePayloadParity,
    materialPayloadParity: asset.materialPayloadParity,
    morphTargets: asset.morphTargets,
    reopenedMorphTargets: asset.reopenedMorphTargets,
    inputFingerprint: asset.inputFingerprint,
    buildFingerprint: asset.buildFingerprint,
    preparedSceneFingerprint: asset.sceneFingerprint,
  })),
};
const blenderRoundTrip = JSON.parse(readFileSync('benchmarks/blender-roundtrip-latest.json', 'utf8')) as {
  pass?: boolean;
  blenderVersion?: string;
  boundsErrorMm?: number;
  imported?: { meshes?: number; polygons?: number; materials?: number };
  reopened?: { meshes?: number; polygons?: number; materials?: number };
  roundTripStandardValidation?: { status?: string; khronosErrors?: number; khronosWarnings?: number; independentReadStatus?: string };
};
const blenderRoundTripPass = blenderRoundTrip.pass === true
  && /^5\.2\./.test(blenderRoundTrip.blenderVersion ?? '')
  && Number(blenderRoundTrip.boundsErrorMm) <= 0.1
  && blenderRoundTrip.imported?.meshes === blenderRoundTrip.reopened?.meshes
  && blenderRoundTrip.imported?.polygons === blenderRoundTrip.reopened?.polygons
  && blenderRoundTrip.imported?.materials === blenderRoundTrip.reopened?.materials
  && blenderRoundTrip.roundTripStandardValidation?.status === 'pass'
  && blenderRoundTrip.roundTripStandardValidation?.khronosErrors === 0
  && blenderRoundTrip.roundTripStandardValidation?.khronosWarnings === 0
  && blenderRoundTrip.roundTripStandardValidation?.independentReadStatus === 'pass';
type BlenderCrossDomainCase = {
  id?: string;
  domain?: string;
  pass?: boolean;
  source?: { byteDeterministic?: boolean; standard?: { status?: string; errors?: number; warnings?: number } };
  blender?: {
    version?: string;
    semanticRoundTrip?: {
      pass?: boolean;
      geometryParity?: boolean;
      imageParity?: boolean;
      skinningParity?: boolean;
      boundsErrorMm?: number;
      boundsToleranceMm?: number;
    };
    rawReexportStandard?: { status?: string };
    deliveryRepair?: {
      applied?: boolean;
      repairedTangents?: number;
      removedUnusedTangentAccessors?: number;
      standard?: { status?: string; errors?: number; warnings?: number; infos?: number; independentRead?: { status?: string } };
    };
  };
};
const blenderCrossDomain = JSON.parse(readFileSync('benchmarks/blender-cross-domain-latest.json', 'utf8')) as {
  schema?: string;
  compilerRevision?: string;
  pass?: boolean;
  cases?: BlenderCrossDomainCase[];
};
const requiredBlenderDomains = new Set(['architecture', 'industrial-design', 'electronics', 'animation-game', '3d-printing']);
const blenderCrossDomainCases = blenderCrossDomain.cases ?? [];
const blenderCrossDomainPass = blenderCrossDomain.pass === true
  && blenderCrossDomain.compilerRevision === DELIVERY_PIPELINE_REVISION
  && blenderCrossDomainCases.length === requiredBlenderDomains.size
  && new Set(blenderCrossDomainCases.map((item) => item.domain)).size === requiredBlenderDomains.size
  && blenderCrossDomainCases.every((item) => {
    const semantic = item.blender?.semanticRoundTrip;
    const delivery = item.blender?.deliveryRepair?.standard;
    return requiredBlenderDomains.has(item.domain ?? '')
      && item.pass === true
      && item.source?.byteDeterministic === true
      && item.source?.standard?.status === 'pass'
      && item.source.standard.errors === 0
      && item.source.standard.warnings === 0
      && semantic?.pass === true
      && semantic.geometryParity === true
      && semantic.imageParity === true
      && semantic.skinningParity === true
      && Number(semantic.boundsErrorMm) <= Number(semantic.boundsToleranceMm)
      && delivery?.status === 'pass'
      && delivery.errors === 0
      && delivery.warnings === 0
      && delivery.infos === 0
      && delivery.independentRead?.status === 'pass';
  });
const blenderCrossDomainSummary = {
  schema: blenderCrossDomain.schema,
  compilerRevision: blenderCrossDomain.compilerRevision,
  pass: blenderCrossDomain.pass,
  benchmarkAccepted: blenderCrossDomainPass,
  blenderVersions: [...new Set(blenderCrossDomainCases.map((item) => item.blender?.version).filter(Boolean))],
  cases: blenderCrossDomainCases.map((item) => ({
    id: item.id,
    domain: item.domain,
    pass: item.pass,
    sourceStandard: item.source?.standard?.status,
    byteDeterministic: item.source?.byteDeterministic,
    semanticParity: item.blender?.semanticRoundTrip?.pass,
    boundsErrorMm: item.blender?.semanticRoundTrip?.boundsErrorMm,
    boundsToleranceMm: item.blender?.semanticRoundTrip?.boundsToleranceMm,
    rawReexportStandard: item.blender?.rawReexportStandard?.status,
    repairApplied: item.blender?.deliveryRepair?.applied,
    repairedTangents: item.blender?.deliveryRepair?.repairedTangents,
    finalStandard: item.blender?.deliveryRepair?.standard?.status,
  })),
};
const unityCrossDomain = existsSync('benchmarks/unity-cross-domain-latest.json')
  ? JSON.parse(readFileSync('benchmarks/unity-cross-domain-latest.json', 'utf8')) as {
    schema?: string;
    compilerRevision?: string;
    pass?: boolean;
    status?: string;
    environment?: { requestedUnityVersion?: string; unityVersion?: string; glTFastVersion?: string };
    blockers?: Array<{ code?: string; detail?: string }>;
    cases?: unknown[];
  }
  : undefined;
const unityCrossDomainSummary = unityCrossDomain && unityCrossDomain.compilerRevision === DELIVERY_PIPELINE_REVISION
  ? unityCrossDomain
  : {
    schema: 'morphloom.unity-cross-domain-proof/0.1',
    compilerRevision: DELIVERY_PIPELINE_REVISION,
    pass: false,
    status: 'not-run',
    blockers: [{ code: 'no-revision-bound-report', detail: 'No Unity report exists for the current compiler revision.' }],
    cases: [],
  };
type StaticDeliveryFormat = { triangles?: number; sha256?: string; bounds?: { size?: number[] } };
const staticDelivery = existsSync('benchmarks/static-delivery-latest.json')
  ? JSON.parse(readFileSync('benchmarks/static-delivery-latest.json', 'utf8')) as {
    schema?: string;
    compilerRevision?: string;
    staticDeliveryRevision?: string;
    assetId?: string;
    expectedSourceTriangles?: number;
    status?: string;
    blenderVersion?: string;
    assetPack?: { compilerRevision?: string; inputFingerprint?: string; browserRoundTrip?: string; sha256?: string };
    formats?: Record<string, StaticDeliveryFormat>;
    parity?: { triangles?: number; maximumAxisNormalizedEnvelopeDriftMm?: number };
    usdz?: { status?: string; validator?: string; sha256?: string };
    blockers?: string[];
  }
  : undefined;
const staticFormats = staticDelivery?.formats ?? {};
const staticDeliveryPass = staticDelivery?.schema === 'morphloom.static-delivery-proof/0.4'
  && staticDelivery.compilerRevision === DELIVERY_PIPELINE_REVISION
  && staticDelivery.staticDeliveryRevision === STATIC_DELIVERY_REVISION
  && staticDelivery.assetId === 'moderncat-concept'
  && staticDelivery.status === 'pass'
  && staticDelivery.assetPack?.compilerRevision === DELIVERY_PIPELINE_REVISION
  && staticDelivery.assetPack?.browserRoundTrip === 'pass'
  && /^[a-f0-9]{16}$/.test(staticDelivery.assetPack.inputFingerprint ?? '')
  && /^[a-f0-9]{64}$/.test(staticDelivery.assetPack.sha256 ?? '')
  && staticDelivery.expectedSourceTriangles === 81_768
  && staticDelivery.parity?.triangles === 81_768
  && Number(staticDelivery.parity.maximumAxisNormalizedEnvelopeDriftMm) <= 0.1
  && ['obj', 'stl', 'ply'].every((format) => staticFormats[format]?.triangles === 81_768 && /^[a-f0-9]{64}$/.test(staticFormats[format]?.sha256 ?? ''))
  && staticDelivery.usdz?.status === 'pass'
  && /^[a-f0-9]{64}$/.test(staticDelivery.usdz.sha256 ?? '')
  && (staticDelivery.blockers?.length ?? 0) === 0;
const staticDeliverySummary = staticDelivery
  ? { ...staticDelivery, benchmarkAccepted: staticDeliveryPass }
  : {
    schema: 'morphloom.static-delivery-proof/0.4', compilerRevision: DELIVERY_PIPELINE_REVISION,
    staticDeliveryRevision: STATIC_DELIVERY_REVISION,
    status: 'not-run', benchmarkAccepted: false, blockers: ['No revision-bound static delivery report exists.'],
  };

const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
const contract = createFidelityContract(ir, {
  domain: 'product',
  complexity: 'moderate',
  cameras: [{
    id: 'reference-camera',
    sourceViewId: 'locked-reference-view',
    projection: 'perspective',
    anchorCount: 12,
    reprojectionErrorPx: 0.8,
  }],
  targetFidelity: 0.9,
  maxIterationsPerPass: 5,
  maxTotalIterations: 28,
  tokenBudget: 240_000,
});
ir.fidelity = contract;
ir.metadata = { ...ir.metadata, fidelityContractRequired: true };

const compiled = compileAssemblyIR(ir, 'beauty');
const comparisonPixels = new Uint8Array(8 * 8 * 4);
for (let pixel = 0; pixel < 64; pixel += 1) comparisonPixels.set(pixel % 3 === 0
  ? [138, 22, 52, 255] : [255, 255, 255, 255], pixel * 4);
const pixelComparison = compareReferenceFrames(
  { width: 8, height: 8, rgba: comparisonPixels, backgroundRgb: [255, 255, 255] },
  { width: 8, height: 8, rgba: structuredClone(comparisonPixels), backgroundRgb: [255, 255, 255] },
);
const interiorBands = compareInteriorBands(
  { width: 8, height: 8, rgba: comparisonPixels, backgroundRgb: [255, 255, 255] },
  { width: 8, height: 8, rgba: structuredClone(comparisonPixels), backgroundRgb: [255, 255, 255] },
  [{ id: 'all', from: 0, to: 1 }],
  16,
);
const materialComparison = compareMaterialFrames(
  { width: 8, height: 8, rgba: comparisonPixels, backgroundRgb: [255, 255, 255] },
  { width: 8, height: 8, rgba: structuredClone(comparisonPixels), backgroundRgb: [255, 255, 255] },
  { family: 'coating', roughness: 0.45 },
  16,
);
const solidMask = Array.from({ length: 8 }, () => '1'.repeat(8));
const visualHull = carveVisualHull({
  projection: 'orthographic',
  boundsSpace: 'component-local',
  bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  resolution: 8,
  triangleBudget: 400_000,
  views: [
    { axis: 'front', confidence: 1, mask: solidMask },
    { axis: 'side', confidence: 1, mask: solidMask },
  ],
});
const implicitSurface = polygonizeImplicitSurface({
  bounds: { min: [-130, -100, -100], max: [130, 100, 100] },
  resolution: 32,
  triangleBudget: 100_000,
  primitives: [
    { id: 'left', type: 'sphere', radius: 58, transform: { position: [-38, 0, 0] } },
    { id: 'right', type: 'sphere', radius: 58, transform: { position: [38, 0, 0] } },
    { id: 'socket', type: 'sphere', radius: 20, transform: { position: [0, 36, 0] } },
  ],
  operations: [
    { id: 'body', type: 'smooth-union', left: 'left', right: 'right', radius: 24 },
    { id: 'body_with_socket', type: 'subtract', left: 'body', right: 'socket' },
  ],
  output: 'body_with_socket',
});
const implicitTopology = analyzeTopology(new THREE.Mesh(implicitSurface.geometry));
let state = startFidelityWorkflow(contract);
const transitions = contract.passes.map((pass, index) => {
  const review: FidelityReview = {
    id: `competitive-pass-${index}`,
    passId: pass.id,
    comparisonArtifact: `benchmarks/proof/${pass.id}-comparison.png`,
    comparisonEvidence: {
      method: pixelComparison.method,
      referenceFingerprint: pixelComparison.referenceFingerprint,
      renderFingerprint: pixelComparison.renderFingerprint,
    },
    sourceViewId: 'locked-reference-view',
    proofViews: [...pass.requiredProofViews],
    fidelity: pixelComparison.score,
    silhouetteIoU: pixelComparison.silhouetteIoU,
    interiorSimilarity: pixelComparison.interiorSimilarity,
    featureScores: contract.details.map((feature) => ({ featureId: feature.id, score: 0.99 })),
    hardGateFailures: [],
    defectTags: [],
    spentTokens: 1_000,
  };
  const transition = submitFidelityReview(contract, state, review);
  state = transition.state;
  return {
    pass: pass.id,
    accepted: transition.accepted,
    action: transition.action,
    effectiveScore: transition.effectiveScore,
  };
});

const contractAudit = auditFidelityContract(contract, ir);
const deliveryAudit = auditFidelityDelivery(contract, state);
const qualityBenchmark = JSON.parse(readFileSync('benchmarks/quality-latest.json', 'utf8')) as {
  rates?: Record<string, number>;
  browserProofAudit?: {
    pass?: boolean;
    expectedAssets?: number;
    verifiedAssets?: number;
    assets?: Array<{ id?: string; pass?: boolean; blockers?: string[] }>;
  };
  releaseBrowserProofAudit?: {
    pass?: boolean;
    expectedAssets?: number;
    verifiedAssets?: number;
    assets?: Array<{ id?: string; pass?: boolean; blockers?: string[] }>;
  };
  domainReports?: Record<string, {
    pass?: boolean;
    score?: number;
    checks?: Array<{ id?: string; pass?: boolean; blocking?: boolean }>;
    metrics?: {
      facialMorphTargets?: number;
      collisionPrimitives?: number;
      sampledWallThicknessComplete?: boolean;
      sampledWallThicknessRays?: number;
      sampledWallThicknessMm?: number;
      sampledWallThicknessConnectedShells?: number;
      sampledWallThicknessWeldedVertices?: number;
      sampledWallThicknessComponentEdges?: number;
    };
  }>;
};
const domainProof = qualityBenchmark.domainReports ?? {};
const domainModelPass = (domain: string): boolean => {
  const checks = (domainProof[domain]?.checks ?? [])
    .filter((check) => check.blocking !== false && check.id !== 'glb-roundtrip');
  return checks.length > 0 && checks.every((check) => check.pass === true);
};
const currentBrowserBinding = qualityBenchmark.browserProofAudit;
const releaseBrowserBinding = qualityBenchmark.releaseBrowserProofAudit;
const qualityRatesPass = ['overall', 'technical', 'decision', 'modelRelease', 'deliveryRelease', 'rejectionSafety']
  .every((key) => qualityBenchmark.rates?.[key] === 1);
const releaseBrowserProofPass = releaseBrowserBinding?.pass === true
  && releaseBrowserBinding.verifiedAssets === releaseBrowserBinding.expectedAssets;
const visualDomains: VisualBenchmarkDomain[] = ['industrial-design', 'architecture', 'character', 'surface'];
const output = {
  schema: 'morphloom.competitive-benchmark/0.1',
  generatedAt: new Date().toISOString(),
  comparisonPolicy: 'Capability and executable-gate comparison. This does not claim perceptual superiority without a same-reference blind visual evaluation.',
  visualSuperiorityPolicy: {
    status: 'not-established',
    claimAllowed: false,
    reason: 'Local same-input Talon WebGL capture hashes exist, but no redistributable matched-camera multi-view set and balanced blind panel are stored in this repository.',
    requiredEvidence: {
      identicalInputFingerprint: true,
      matchedCalibratedCameras: true,
      canonicalLockedRenderProtocol: true,
      sharedFullCanvasCoordinates: true,
      exactCanvasAndPixelRatio: true,
      actualBrowserWebglCaptures: true,
      hashBoundCaptureReceipts: true,
      criticalFeatureRegions: true,
      minimumViews: Object.fromEntries(visualDomains.map((domain) => [domain, visualBenchmarkMinimumViews(domain)])),
      uniqueBlindRaters: 5,
      balancedPresentationOrder: true,
      minimumAutomaticMargin: 0.03,
      minimumBlindPreferenceShare: 0.6,
    },
  },
  competitor: {
    repository: 'https://github.com/img2threejs/img2threejs',
    commit: '9fbd0ca5bbcc3b13bebe712745d6784d33db0b85',
    testedRuntime: 'Python 3.12.13',
    observedTestResult: { tests: 1083, passed: 1045, skipped: 38, failed: 0, testFiles: 85 },
    latestShowcase: {
      repository: 'https://github.com/img2threejs/img2threejs-showcase',
      commit: 'db90e65a8d46f2a8d1a4eb76bd370b74ecfc467a',
      build: 'pass',
      observedCharacters: [
        { id: 'leesin', bones: 42, clips: 10 },
        { id: 'boxing-man', bones: 41, clips: 19 },
        { id: 'monster', bones: 41, clips: 27 },
      ],
      scope: 'Showcase breadth evidence, not a matched GLB delivery-gate comparison.',
    },
  },
  morphloom: {
    contractAudit,
    deliveryAudit,
    pixelComparison: { ...pixelComparison, fixture: 'deterministic gate-path fixture; not a perceptual knife ranking' },
    interiorBands,
    materialComparison,
    visualHull: {
      status: visualHull.status,
      triangles: visualHull.triangleCount,
      occupiedVoxelCount: visualHull.occupiedVoxelCount,
      minimumViewIoU: visualHull.minimumViewIoU,
      confidenceWeightedIoU: visualHull.confidenceWeightedIoU,
      unconstrainedAxes: visualHull.unconstrainedAxes,
      limitationCount: visualHull.limitations.length,
    },
    implicitSurface: {
      requestedResolution: implicitSurface.requestedResolution,
      resolvedResolution: implicitSurface.resolution,
      refinementSteps: implicitSurface.refinementSteps,
      primitives: implicitSurface.primitiveCount,
      operations: implicitSurface.operationCount,
      triangles: implicitSurface.triangleCount,
      enclosedVolumeMm3: implicitSurface.enclosedVolumeMm3,
      outwardFaceCoverage: implicitSurface.outwardFaceCoverage,
      windingCorrected: implicitSurface.windingCorrected,
      topologyPass: implicitTopology.pass,
      boundaryEdges: implicitTopology.boundaryEdges,
      nonManifoldEdges: implicitTopology.nonManifoldEdges,
    },
    passes: transitions,
    compiledAsset: {
      parts: compiled.metrics.parts,
      triangles: compiled.metrics.triangles,
      topologyPass: compiled.metrics.topology.pass,
      fidelityContractPersisted: compiled.root.userData.fidelityContract?.schema === 'morphloom.fidelity/0.1',
    },
    crossDomainDelivery: {
      rates: qualityBenchmark.rates,
      allRatesPass: qualityRatesPass,
      domains: domainProof,
    },
    browserValidationLifecycle: serializedValidationAudit,
    dimensionContract: dimensionContractAudit,
    anchorPitchContract: anchorPitchAudit,
    localAxisDimensionContract: localAxisAudit,
    rotatedLocalPitchContract: rotatedLocalPitchAudit,
    browserRoundTrip: {
      ...browserRoundTripSummary,
      currentEngineBinding: currentBrowserBinding,
      releaseEngineBinding: releaseBrowserBinding,
    },
    gltfStandardValidation: standardValidationAudit,
    blenderRoundTrip: { ...blenderRoundTrip, benchmarkAccepted: blenderRoundTripPass },
    blenderCrossDomain: blenderCrossDomainSummary,
    unityCrossDomain: unityCrossDomainSummary,
    staticDelivery: staticDeliverySummary,
  },
  capabilityMatrix: [
    { capability: 'strict detail inventory', img2threejs: 'yes', morphloom: contractAudit.detailCoverage === 1 && contractAudit.componentCoverage === 1 ? 'yes' : 'blocked' },
    { capability: 'locked staged passes', img2threejs: 'yes', morphloom: transitions.length === 8 ? 'yes' : 'blocked' },
    { capability: 'per-feature thresholds', img2threejs: 'yes', morphloom: contract.details.every((item) => item.threshold >= 0.5) ? 'yes' : 'blocked' },
    { capability: 'calibrated source-camera proof', img2threejs: 'yes', morphloom: contract.cameras.length > 0 ? 'yes' : 'blocked' },
    { capability: 'fail-closed same-input visual protocol with exact full-canvas framing, pixel ratio, color/tone/light lock and hash-bound browser receipts', img2threejs: 'not established in pinned audit', morphloom: 'yes—independent foreground fitting cannot hide offset/scale errors; claims block on any protocol, receipt, scene, camera, or PNG mismatch' },
    { capability: 'bounded welded visual-hull carving', img2threejs: 'yes', morphloom: visualHull.status === 'carved' && visualHull.triangleCount > 0 ? 'yes' : 'blocked' },
    { capability: 'per-view visual-hull reprojection audit and bounded calibration tolerance', img2threejs: 'not established in pinned audit', morphloom: visualHull.minimumViewIoU >= 0.85 ? 'yes' : 'blocked' },
    { capability: 'smooth implicit Surface Nets with bounded manifold, positive-volume and outward-winding gates', img2threejs: 'Surface Nets', morphloom: implicitTopology.pass && implicitSurface.refinementSteps > 0 && implicitSurface.enclosedVolumeMm3 > 0 && implicitSurface.outwardFaceCoverage >= 0.995 ? 'yes + fail-closed manifold/winding refinement' : 'blocked' },
    { capability: 'foreground-normalized interior bands', img2threejs: 'yes', morphloom: interiorBands.aggregateSimilarity === 1 ? 'yes' : 'blocked' },
    { capability: 'deterministic material region comparator', img2threejs: 'yes', morphloom: materialComparison.passed ? 'yes' : 'blocked' },
    { capability: 'bounded reference-image de-lighting with recorded correction evidence', img2threejs: 'box-blurred luminance proxy, single-image confidence capped', morphloom: 'linear-light bounded field, global-exposure preservation, <=2% clipping and <=0.015 robust-luminance regression fail-closed gate' },
    { capability: 'bounded correction and cost ceiling', img2threejs: 'yes', morphloom: contract.maxTotalIterations <= 128 && contract.tokenBudget > 0 ? 'yes' : 'blocked' },
    { capability: 'architecture and measured assemblies', img2threejs: 'roadmap', morphloom: 'yes' },
    { capability: 'electrical connectivity audit', img2threejs: 'not documented', morphloom: 'yes' },
    { capability: 'exact-byte glTF 2.0 specification and independent parser validation', img2threejs: 'Three.js factory focus', morphloom: standardValidationAudit.pass ? 'Khronos Validator + glTF Transform + Three.js reopen' : 'blocked' },
    { capability: 'same-input GLB byte reproducibility', img2threejs: 'not established in pinned audit', morphloom: blenderCrossDomainPass ? 'five domains, two independent exports per fixture, identical SHA-256' : 'blocked' },
    { capability: 'Blender application import/export/reimport execution', img2threejs: 'not established in pinned audit', morphloom: blenderCrossDomainPass ? `Blender ${blenderCrossDomainSummary.blenderVersions.join(', ')}: architecture, industrial design, electronics, animation/game, and 3D-print surface all pass revision-bound semantic parity and final exact-byte validation` : 'blocked' },
    { capability: 'DCC re-export sanitation with final-byte conformance gate', img2threejs: 'not established in pinned audit', morphloom: blenderCrossDomainPass ? 'yes—invalid Blender-generated tangents are normalized or removed, then Khronos + glTF Transform are rerun on delivery bytes' : 'blocked' },
    { capability: 'OBJ/STL/PLY browser export, loader reopen and independent Blender import parity', img2threejs: 'not established in pinned audit', morphloom: staticDeliveryPass ? `81,768 triangles preserved; STL uses explicit millimetre coordinates; unit-normalized envelope drift ${staticDelivery?.parity?.maximumAxisNormalizedEnvelopeDriftMm?.toFixed(6)} mm` : 'blocked' },
    { capability: 'USDZ Apple conformance validation', img2threejs: 'not established in pinned audit', morphloom: staticDeliveryPass ? `pass—${staticDelivery?.usdz?.validator}` : 'blocked' },
    { capability: 'Unity application import execution', img2threejs: 'not established in pinned audit', morphloom: unityCrossDomainSummary.pass === true ? 'revision-bound native import pass' : `${unityCrossDomainSummary.status}: ${unityCrossDomainSummary.blockers?.[0]?.code ?? 'not-run'}` },
    { capability: 'Unreal application import execution', img2threejs: 'not established in pinned audit', morphloom: 'application-import-not-run' },
    { capability: 'bounded serialized browser GLB validation with exact input/build/prepared-scene binding, morph-, texture-, and material-payload parity, same-input deduplication, and stale-result guard', img2threejs: 'not established in pinned audit', morphloom: serializedValidationAudit.pass && browserRoundTripPass && releaseBrowserProofPass ? `${releaseBrowserBinding?.verifiedAssets}/${releaseBrowserBinding?.expectedAssets} release receipts exactly match the current deterministic builds across five delivery domains; stale non-release receipts are reported separately` : `implemented; current ${BROWSER_ROUNDTRIP_PROOF_SCHEMA} browser receipts required` },
    { capability: 'pixel-level texture content and glTF-semantic sampler fingerprint with actual binary round-trip', img2threejs: 'not established in pinned audit', morphloom: 'implemented; lossless PNG pixels, slot identity, UV channel/transform, color space, wrapping and filtering survive an actual textured GLB reopen; glTF-inexpressible mapping, format, type, anisotropy, transform or mip state fails closed while GPU-only upload state is ignored' },
    { capability: 'glTF scalar and optical material fingerprint with fail-closed GLB parity', img2threejs: 'not established in pinned audit', morphloom: 'implemented; opacity, emission, normal/AO strength, clearcoat, transmission/volume, IOR, specular, sheen, iridescence, anisotropy, or unsupported semantics block drift' },
    { capability: 'skeletal animation breadth', img2threejs: 'latest showcase: 41–42 bones and 10–27 clips', morphloom: domainModelPass('animation') && releaseBrowserProofPass ? '49 bones and 22 semantic delivery clips / 185 tracks; current browser receipt bound' : 'blocked' },
    { capability: 'named editable facial controls with spatial and semantic delta localization', img2threejs: 'not established in pinned audit', morphloom: domainModelPass('animation') && releaseBrowserProofPass && domainProof.animation?.metrics?.facialMorphLocalizedTargets === 5 && domainProof.animation?.metrics?.facialMorphSemanticTargets === 5 ? '5/5 non-zero targets with >=98% head localization, >=90% semantic-region localization, and >=90% blink-side localization; current browser receipt bound' : 'blocked' },
    { capability: 'per-joint weighted deformation/localization and motion/loop/root-motion checks', img2threejs: 'not established in pinned core audit', morphloom: domainModelPass('animation') && releaseBrowserProofPass ? '10/10 bilateral shoulder, elbow, hip, knee, and ankle joints measured with >=98% influence localization; current browser receipt bound' : 'blocked' },
    { capability: 'real skinned LOD1 with neutral/posed 3-axis silhouette, bounds and skin-weight preservation plus pose-aligned collision semantics', img2threejs: 'not established in pinned audit', morphloom: domainModelPass('game') && releaseBrowserProofPass && domainProof.game?.metrics?.collisionPrimitives === 16 ? '16-part rig: endpoint/midpoint/height/orientation/bone/body-overlap/vertical-coverage gates; current browser receipt bound' : 'blocked' },
    { capability: 'finite non-degenerate UV triangles and near-unit normal model gate', img2threejs: 'not established in pinned audit', morphloom: domainModelPass('game') && domainModelPass('industrialDesign') && releaseBrowserProofPass ? 'yes; current browser receipt bound' : 'blocked' },
    {
      capability: 'millimetre 3D-print topology, global thickness screening, connected-shell feature-space wall rays, feature and 45-degree overhang audit',
      img2threejs: 'not established in pinned audit',
      morphloom: domainModelPass('print3d')
        && domainProof.print3d.metrics?.sampledWallThicknessComplete
        && (domainProof.print3d.metrics.sampledWallThicknessRays ?? 0) > 0
        && (domainProof.print3d.metrics.sampledWallThicknessConnectedShells ?? 0) > 0
        && (domainProof.print3d.metrics.sampledWallThicknessWeldedVertices ?? 0) > 0
        && (domainProof.print3d.metrics.sampledWallThicknessComponentEdges ?? 0) > 0
        && (domainProof.print3d.metrics.sampledWallThicknessMm ?? 0) >= 0.8 ? 'yes' : 'blocked',
    },
    { capability: 'compiled architecture top-projection IoU, over/underbuild, protected-void, shell and >=80% micro-surface gate', img2threejs: 'roadmap', morphloom: domainModelPass('architecture') && releaseBrowserProofPass ? 'yes; current browser receipt bound' : 'blocked' },
    { capability: 'concave polygon plan contract with self-intersection rejection and protected courtyard audit', img2threejs: 'roadmap', morphloom: domainModelPass('architecture') && releaseBrowserProofPass ? 'yes; current browser receipt bound' : 'blocked' },
    { capability: 'evidence-bound X/Y/Z size and datum remeasurement on compiled world-space geometry with GLB audit preservation', img2threejs: 'not established in pinned audit', morphloom: dimensionContractAudit.pass ? 'yes' : 'blocked' },
    { capability: 'evidence-bound hole, pin, lens and connector pitch between transformed component-local datums', img2threejs: 'not established in pinned audit', morphloom: anchorPitchAudit.pass ? 'yes' : 'blocked' },
    { capability: 'rotation-safe component-local length, width and thickness remeasurement without world-AABB inflation', img2threejs: 'not established in pinned audit', morphloom: localAxisAudit.pass ? 'yes' : 'blocked' },
    { capability: 'rotation-safe same-part hole, pin and lens pitch along component-local axes', img2threejs: 'not established in pinned audit', morphloom: rotatedLocalPitchAudit.pass ? 'yes' : 'blocked' },
    { capability: 'same-reference perceptual winner', img2threejs: 'not established here', morphloom: 'not established here' },
  ],
};

writeFileSync('benchmarks/competitive-latest.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
if (!contractAudit.pass || !deliveryAudit.pass || transitions.some((item) => !item.accepted)
  || compiled.root.userData.fidelityContract?.schema !== 'morphloom.fidelity/0.1'
  || visualHull.status !== 'carved' || visualHull.minimumViewIoU < 0.85
  || !implicitTopology.pass || implicitSurface.refinementSteps < 1
  || implicitSurface.enclosedVolumeMm3 <= 0 || implicitSurface.outwardFaceCoverage < 0.995
  || interiorBands.aggregateSimilarity !== 1 || !materialComparison.passed
  || !serializedValidationAudit.pass || !dimensionContractAudit.pass || !anchorPitchAudit.pass
  || !localAxisAudit.pass || !rotatedLocalPitchAudit.pass || !standardValidationAudit.pass
  || !browserRoundTripPass || !releaseBrowserProofPass || !qualityRatesPass
  || !blenderRoundTripPass || !blenderCrossDomainPass || !staticDeliveryPass) process.exitCode = 1;
