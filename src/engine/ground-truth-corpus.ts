import { auditCameraPoseEvidence, type CameraPoseEvidenceContract } from './camera-pose-evidence';

export const GROUND_TRUTH_DOMAINS = [
  'architecture',
  'industrial-design',
  'electronics-assembly',
  'animation',
  'game',
  '3d-print',
  'surface',
] as const;

export type GroundTruthDomain = typeof GROUND_TRUTH_DOMAINS[number];
export type GroundTruthAssetKind = 'input-image' | 'ground-truth-model';
export type GroundTruthImageRole = 'primary' | 'front' | 'right' | 'rear' | 'left' | 'top' | 'bottom' | 'detail' | 'material';

export interface GroundTruthAsset {
  id: string;
  kind: GroundTruthAssetKind;
  relativePath: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
  mimeType: 'image/jpeg' | 'image/png' | 'model/gltf-binary';
  role?: GroundTruthImageRole;
  /** Index from the source capture sequence; not an absolute object-frame camera pose. */
  sequenceIndex?: number;
  /** Rotation relative to the first selected view; absolute alignment remains a separate receipt. */
  relativeAzimuthDegrees?: number;
  width?: number;
  height?: number;
}

export interface GroundTruthModelExpectation {
  nodes: number;
  meshes: number;
  materials: number;
  textures: number;
  vertices: number;
  triangles: number;
  boundsMeters: [number, number, number];
}

export interface GroundTruthCase {
  id: string;
  domains: GroundTruthDomain[];
  sourceItemId: string;
  title: string;
  license: {
    spdx: 'CC-BY-4.0';
    url: string;
    attribution: string[];
  };
  evidenceMode: 'multi-view+metric+reference-3d';
  cameraPoseEvidence: CameraPoseEvidenceContract;
  inputAssetIds: string[];
  contextAssetIds?: string[];
  groundTruthAssetId: string;
  listingDimensionsMm: {
    width: number;
    height: number;
    depth: number;
    confidence: number;
  };
  expectedModel: GroundTruthModelExpectation;
  assets: GroundTruthAsset[];
}

export interface GroundTruthCorpusManifest {
  schema: 'morphloom.ground-truth-corpus/0.2';
  id: string;
  revision: string;
  sourceDataset: string;
  sourceDatasetUrl: string;
  purpose: string;
  cases: GroundTruthCase[];
}

export interface GroundTruthAssetReceipt {
  caseId: string;
  assetId: string;
  sha256: string;
  bytes: number;
  width?: number;
  height?: number;
  model?: GroundTruthModelExpectation & {
    validatorStatus: 'pass' | 'warn' | 'blocked';
    validatorErrors: number;
    validatorWarnings: number;
    issueCodes: string[];
    independentRead: boolean;
  };
}

export interface GroundTruthCorpusCaseAudit {
  id: string;
  pass: boolean;
  verifiedAssets: number;
  distinctRelativeViewAzimuths: number;
  relativeCameraPoseVerified: boolean;
  sameCameraVisualClaimAllowed: boolean;
  maximumBoundsErrorMm: number | null;
  blockers: string[];
  warnings: string[];
}

export interface GroundTruthCorpusAudit {
  schema: 'morphloom.ground-truth-corpus-audit/0.1';
  pass: boolean;
  manifestSha256: string;
  cases: GroundTruthCorpusCaseAudit[];
  verifiedCases: number;
  verifiedAssets: number;
  blockers: string[];
  limitation: string;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$/;
const SAFE_REVISION = /^[a-zA-Z0-9][a-zA-Z0-9+_.\/-]{0,95}$/;
const MAX_CASES = 64;
const MAX_ASSETS_PER_CASE = 32;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const REQUIRED_VIEW_COUNT = 4;
const BOUNDS_TOLERANCE_MM = 0.01;
const ALLOWED_SOURCE_HOSTS = new Set([
  'amazon-berkeley-objects.s3.amazonaws.com',
  'amazon-berkeley-objects.s3.us-east-1.amazonaws.com',
]);

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function safeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sourceUrlIsAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_SOURCE_HOSTS.has(url.hostname) && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function validateModelExpectation(value: GroundTruthModelExpectation): boolean {
  return safeInteger(value.nodes) && value.nodes > 0
    && safeInteger(value.meshes) && value.meshes > 0
    && safeInteger(value.materials) && value.materials > 0
    && safeInteger(value.textures)
    && safeInteger(value.vertices) && value.vertices > 2
    && safeInteger(value.triangles) && value.triangles > 0
    && Array.isArray(value.boundsMeters) && value.boundsMeters.length === 3
    && value.boundsMeters.every(finitePositive);
}

function validateAsset(asset: GroundTruthAsset): void {
  if (!SAFE_ID.test(asset.id) || !SAFE_RELATIVE_PATH.test(asset.relativePath) || !sourceUrlIsAllowed(asset.sourceUrl)
    || !SHA256.test(asset.sha256) || !safeInteger(asset.bytes) || asset.bytes < 20 || asset.bytes > MAX_ASSET_BYTES) {
    throw new Error(`Ground-truth asset ${asset.id} has unsafe identity, path, URL, hash, or size.`);
  }
  if (asset.kind === 'ground-truth-model') {
    if (asset.mimeType !== 'model/gltf-binary' || asset.role !== undefined || asset.sequenceIndex !== undefined
      || asset.relativeAzimuthDegrees !== undefined
      || asset.width !== undefined || asset.height !== undefined) {
      throw new Error(`Ground-truth model ${asset.id} has incompatible media metadata.`);
    }
    return;
  }
  if ((asset.mimeType !== 'image/jpeg' && asset.mimeType !== 'image/png') || !asset.role
    || !safeInteger(asset.width ?? -1) || !safeInteger(asset.height ?? -1)
    || (asset.width ?? 0) < 64 || (asset.height ?? 0) < 64 || (asset.width ?? 0) > 16_384 || (asset.height ?? 0) > 16_384) {
    throw new Error(`Ground-truth input image ${asset.id} has incompatible media metadata.`);
  }
  if ((asset.sequenceIndex === undefined) !== (asset.relativeAzimuthDegrees === undefined)
    || (asset.sequenceIndex !== undefined && (!safeInteger(asset.sequenceIndex)
      || !Number.isFinite(asset.relativeAzimuthDegrees) || asset.relativeAzimuthDegrees! < 0
      || asset.relativeAzimuthDegrees! >= 360))) {
    throw new Error(`Ground-truth input image ${asset.id} has invalid relative capture metadata.`);
  }
}

export function validateGroundTruthCorpusManifest(manifest: GroundTruthCorpusManifest): void {
  if (manifest?.schema !== 'morphloom.ground-truth-corpus/0.2' || !SAFE_ID.test(manifest.id)
    || !SAFE_REVISION.test(manifest.revision) || manifest.sourceDataset.trim().length < 3
    || !sourceUrlIsAllowed(manifest.sourceDatasetUrl) || manifest.purpose.trim().length < 20
    || !Array.isArray(manifest.cases) || manifest.cases.length < 1 || manifest.cases.length > MAX_CASES) {
    throw new Error('Ground-truth corpus manifest is unsafe or incomplete.');
  }
  const caseIds = new Set<string>();
  const corpusAssetHashes = new Set<string>();
  for (const item of manifest.cases) {
    if (!SAFE_ID.test(item.id) || caseIds.has(item.id) || item.title.trim().length < 3
      || !SAFE_ID.test(item.sourceItemId) || item.evidenceMode !== 'multi-view+metric+reference-3d') {
      throw new Error(`Ground-truth case ${item.id} has an unsafe or duplicate identity.`);
    }
    caseIds.add(item.id);
    if (!Array.isArray(item.domains) || item.domains.length < 1
      || item.domains.some((domain) => !GROUND_TRUTH_DOMAINS.includes(domain))
      || new Set(item.domains).size !== item.domains.length) {
      throw new Error(`Ground-truth case ${item.id} has invalid domains.`);
    }
    if (item.license.spdx !== 'CC-BY-4.0' || item.license.url !== 'https://creativecommons.org/licenses/by/4.0/'
      || !Array.isArray(item.license.attribution) || item.license.attribution.length < 2
      || item.license.attribution.some((entry) => entry.trim().length < 3 || entry.length > 240)) {
      throw new Error(`Ground-truth case ${item.id} is missing enforceable attribution metadata.`);
    }
    const dimensions = item.listingDimensionsMm;
    if (![dimensions.width, dimensions.height, dimensions.depth].every(finitePositive)
      || !Number.isFinite(dimensions.confidence) || dimensions.confidence <= 0 || dimensions.confidence > 1) {
      throw new Error(`Ground-truth case ${item.id} has invalid listing dimensions.`);
    }
    if (!validateModelExpectation(item.expectedModel) || !Array.isArray(item.assets)
      || item.assets.length < REQUIRED_VIEW_COUNT + 1 || item.assets.length > MAX_ASSETS_PER_CASE) {
      throw new Error(`Ground-truth case ${item.id} has invalid model expectations or asset volume.`);
    }
    const assetIds = new Set<string>();
    for (const asset of item.assets) {
      validateAsset(asset);
      if (assetIds.has(asset.id)) throw new Error(`Ground-truth case ${item.id} repeats asset id ${asset.id}.`);
      if (corpusAssetHashes.has(asset.sha256)) throw new Error(`Ground-truth corpus reuses asset bytes in ${item.id}.`);
      assetIds.add(asset.id);
      corpusAssetHashes.add(asset.sha256);
    }
    const selectedInputIds = new Set(item.inputAssetIds);
    if (item.inputAssetIds.length < REQUIRED_VIEW_COUNT || selectedInputIds.size !== item.inputAssetIds.length
      || item.inputAssetIds.some((id) => !assetIds.has(id))) {
      throw new Error(`Ground-truth case ${item.id} does not bind four distinct input assets.`);
    }
    const selectedInputs = item.assets.filter((asset) => selectedInputIds.has(asset.id));
    const sourceFingerprints = Object.fromEntries(selectedInputs.map((asset) => [asset.id, asset.sha256]));
    const cameraPoseAudit = auditCameraPoseEvidence(item.cameraPoseEvidence, sourceFingerprints);
    const poseViews = new Map(item.cameraPoseEvidence.views.map((view) => [view.id, view]));
    if (!cameraPoseAudit.pass || (!cameraPoseAudit.relativePoseVerified && !cameraPoseAudit.absolutePoseVerified)
      || selectedInputs.some((asset) => asset.kind !== 'input-image' || asset.sequenceIndex === undefined
        || asset.relativeAzimuthDegrees === undefined || !poseViews.has(asset.id)
        || poseViews.get(asset.id)!.sequenceIndex !== asset.sequenceIndex
        || poseViews.get(asset.id)!.relativeAzimuthDegrees !== asset.relativeAzimuthDegrees)
      || new Set(selectedInputs.map((asset) => asset.relativeAzimuthDegrees)).size < REQUIRED_VIEW_COUNT) {
      throw new Error(`Ground-truth case ${item.id} does not contain four verified relative or absolute camera poses.`);
    }
    const contextIds = new Set(item.contextAssetIds ?? []);
    if (contextIds.size !== (item.contextAssetIds?.length ?? 0)
      || [...contextIds].some((id) => !assetIds.has(id) || selectedInputIds.has(id))) {
      throw new Error(`Ground-truth case ${item.id} has invalid context assets.`);
    }
    const model = item.assets.find((asset) => asset.id === item.groundTruthAssetId);
    if (!model || model.kind !== 'ground-truth-model') {
      throw new Error(`Ground-truth case ${item.id} does not bind a model asset.`);
    }
  }
}

function boundsErrorMm(expected: number[], observed: number[]): number {
  return Math.max(...expected.map((value, index) => Math.abs(value - (observed[index] ?? Number.NaN)) * 1_000));
}

export function auditGroundTruthCorpus(
  manifest: GroundTruthCorpusManifest,
  receipts: GroundTruthAssetReceipt[],
  manifestSha256: string,
): GroundTruthCorpusAudit {
  validateGroundTruthCorpusManifest(manifest);
  if (!SHA256.test(manifestSha256) || !Array.isArray(receipts) || receipts.length > MAX_CASES * MAX_ASSETS_PER_CASE) {
    throw new Error('Ground-truth corpus receipts or manifest hash are unsafe.');
  }
  const expectedReceiptKeys = new Set(manifest.cases.flatMap((item) => item.assets.map((asset) => `${item.id}/${asset.id}`)));
  const receivedKeys = new Set<string>();
  for (const receipt of receipts) {
    const key = `${receipt.caseId}/${receipt.assetId}`;
    if (!SAFE_ID.test(receipt.caseId) || !SAFE_ID.test(receipt.assetId) || receivedKeys.has(key)
      || !expectedReceiptKeys.has(key) || !SHA256.test(receipt.sha256) || !safeInteger(receipt.bytes)) {
      throw new Error(`Ground-truth receipt ${key} is unsafe, duplicate, or unexpected.`);
    }
    receivedKeys.add(key);
  }

  const cases = manifest.cases.map((item): GroundTruthCorpusCaseAudit => {
    const blockers: string[] = [];
    const warnings: string[] = [];
    let verifiedAssets = 0;
    let maximumBoundsErrorMm: number | null = null;
    for (const asset of item.assets) {
      const receipt = receipts.find((entry) => entry.caseId === item.id && entry.assetId === asset.id);
      if (!receipt) {
        blockers.push(`${asset.id}: local verification receipt is missing`);
        continue;
      }
      if (receipt.sha256 !== asset.sha256) blockers.push(`${asset.id}: SHA-256 mismatch`);
      if (receipt.bytes !== asset.bytes) blockers.push(`${asset.id}: byte-size mismatch`);
      if (asset.kind === 'input-image') {
        if (receipt.width !== asset.width || receipt.height !== asset.height) blockers.push(`${asset.id}: decoded image dimensions mismatch`);
      } else {
        const model = receipt.model;
        if (!model || !validateModelExpectation(model) || !model.independentRead || model.validatorStatus === 'blocked'
          || model.validatorErrors !== 0 || !safeInteger(model.validatorWarnings)
          || !Array.isArray(model.issueCodes) || model.issueCodes.length > 128) {
          blockers.push(`${asset.id}: GLB validation or independent parse failed`);
        } else {
          const exact: Array<keyof Pick<GroundTruthModelExpectation, 'nodes' | 'meshes' | 'materials' | 'textures' | 'vertices' | 'triangles'>> = [
            'nodes', 'meshes', 'materials', 'textures', 'vertices', 'triangles',
          ];
          for (const key of exact) if (model[key] !== item.expectedModel[key]) blockers.push(`${asset.id}: ${key} drift`);
          const error = boundsErrorMm(item.expectedModel.boundsMeters, model.boundsMeters);
          maximumBoundsErrorMm = Number.isFinite(error) ? error : Number.POSITIVE_INFINITY;
          if (!Number.isFinite(error) || error > BOUNDS_TOLERANCE_MM) blockers.push(`${asset.id}: bounds drift ${error.toFixed(3)} mm`);
          if (model.validatorWarnings > 0) warnings.push(`${asset.id}: reference GLB warning ${model.issueCodes.join(', ') || 'unspecified'}`);
        }
      }
      if (!blockers.some((blocker) => blocker.startsWith(`${asset.id}:`))) verifiedAssets += 1;
    }
    const selectedInputs = item.assets.filter((asset) => item.inputAssetIds.includes(asset.id));
    const cameraPoseAudit = auditCameraPoseEvidence(item.cameraPoseEvidence,
      Object.fromEntries(selectedInputs.map((asset) => [asset.id, asset.sha256])));
    const distinctRelativeViewAzimuths = new Set(selectedInputs
      .filter((asset) => item.inputAssetIds.includes(asset.id))
      .map((asset) => asset.relativeAzimuthDegrees)).size;
    if (distinctRelativeViewAzimuths < REQUIRED_VIEW_COUNT || !cameraPoseAudit.relativePoseVerified) {
      blockers.push('fewer than four independently verified relative input orientations survived verification');
    }
    warnings.push(...cameraPoseAudit.claimBlockers.map((blocker) => `camera claim: ${blocker}`));
    return {
      id: item.id, pass: blockers.length === 0, verifiedAssets, distinctRelativeViewAzimuths,
      relativeCameraPoseVerified: cameraPoseAudit.relativePoseVerified,
      sameCameraVisualClaimAllowed: cameraPoseAudit.sameCameraVisualClaimAllowed,
      maximumBoundsErrorMm, blockers, warnings,
    };
  });
  const blockers = cases.flatMap((item) => item.blockers.map((blocker) => `${item.id}: ${blocker}`));
  return {
    schema: 'morphloom.ground-truth-corpus-audit/0.1',
    pass: blockers.length === 0,
    manifestSha256,
    cases,
    verifiedCases: cases.filter((item) => item.pass).length,
    verifiedAssets: cases.reduce((sum, item) => sum + item.verifiedAssets, 0),
    blockers,
    limitation: 'A passing corpus audit proves licensed source identity, byte integrity, decoded views, and independent ground-truth GLB structure. It does not score either reconstruction engine until separately generated candidates are bound to the same inputs.',
  };
}
