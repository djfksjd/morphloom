import type { AssemblyIR, EvidenceStatusIR, SurfaceFinishIR } from './assembly-ir';
import type { AssetDomain, ReviewMode } from './generation-policy';
import { calibrateOrthographicYawCamera, type OrthographicCameraAnchor } from './orthographic-camera-calibration';
import { calibratePerspectiveCamera, type PerspectiveCameraCalibration } from './perspective-camera-calibration';

export type FidelityComplexity = 'simple' | 'moderate' | 'complex' | 'ultra-complex';
export type FidelityFeatureKind =
  | 'silhouette'
  | 'proportion'
  | 'negative-space'
  | 'component'
  | 'interface'
  | 'material'
  | 'micro-surface'
  | 'marking'
  | 'pose'
  | 'topology';
export type FidelityImportance = 'critical' | 'major' | 'minor';
export type FidelityPassId =
  | 'blockout'
  | 'structure'
  | 'form'
  | 'material'
  | 'surface'
  | 'lighting'
  | 'interaction'
  | 'optimization';
export type FidelityAction = 'advance' | 'refine-spec' | 'refine-ir' | 'request-input' | 'complete';

export const FIDELITY_PASS_ORDER: FidelityPassId[] = [
  'blockout', 'structure', 'form', 'material', 'surface', 'lighting', 'interaction', 'optimization',
];

export interface FidelityFeature {
  id: string;
  label: string;
  kind: FidelityFeatureKind;
  importance: FidelityImportance;
  componentIds: string[];
  evidenceRef: string;
  confidence: number;
  threshold: number;
  proofViews: ReviewMode[];
  notes?: string[];
}

export interface FidelityCameraAnchor extends OrthographicCameraAnchor {
  evidenceRef: string;
}

interface FidelityCameraBase {
  id: string;
  sourceViewId: string;
  anchorCount: number;
  reprojectionErrorPx: number;
  anchors: FidelityCameraAnchor[];
}

export interface FidelityOrthographicCamera extends FidelityCameraBase {
  projection: 'orthographic';
  calibrationRevision: 'morphloom-camera-calibration/0.1';
  azimuthDegrees: number;
  pixelsPerWorldUnit: number;
  offsetPixels: [number, number];
}

export interface FidelityPerspectiveCamera extends FidelityCameraBase {
  projection: 'perspective';
  calibrationRevision: 'morphloom-camera-calibration/0.2';
  projectionMatrix: PerspectiveCameraCalibration['projectionMatrix'];
  worldCenter: [number, number, number];
  worldScale: number;
  imageCenter: [number, number];
  imageScale: number;
}

export type FidelityCamera = FidelityOrthographicCamera | FidelityPerspectiveCamera;

export interface FidelityMaterialRegion {
  id: string;
  componentId: string;
  evidenceRef: string;
  expectedSurface: SurfaceFinishIR;
  confidence: number;
}

export interface FidelityPassContract {
  id: FidelityPassId;
  minimumFidelity: number;
  requiredKinds: FidelityFeatureKind[];
  requiredProofViews: ReviewMode[];
}

export interface FidelityContract {
  schema: 'morphloom.fidelity/0.2';
  assetName: string;
  domain: AssetDomain;
  complexity: FidelityComplexity;
  targetFidelity: number;
  maxIterationsPerPass: number;
  maxTotalIterations: number;
  tokenBudget: number;
  details: FidelityFeature[];
  cameras: FidelityCamera[];
  materialRegions: FidelityMaterialRegion[];
  hardGates: string[];
  passes: FidelityPassContract[];
}

export interface FidelityFeatureScore {
  featureId: string;
  score: number;
  defectTags?: string[];
}

export interface FidelityReview {
  id: string;
  passId: FidelityPassId;
  comparisonArtifact: string;
  comparisonEvidence: {
    method: 'pixel-frame-v1' | 'external-vision';
    referenceFingerprint: string;
    renderFingerprint: string;
  };
  sourceViewId: string;
  proofViews: ReviewMode[];
  fidelity: number;
  silhouetteIoU?: number;
  interiorSimilarity?: number;
  featureScores: FidelityFeatureScore[];
  hardGateFailures: string[];
  defectTags: string[];
  spentTokens: number;
}

export interface FidelityWorkflowState {
  schema: 'morphloom.fidelity-state/0.1';
  contractFingerprint: string;
  activePassIndex: number;
  completedPasses: FidelityPassId[];
  reviews: FidelityReview[];
  spentTokens: number;
  bestReviewByPass: Partial<Record<FidelityPassId, { reviewId: string; score: number }>>;
  decisions: FidelityDecision[];
  stopped: boolean;
  stopReason?: string;
}

export interface FidelityDecision {
  reviewId: string;
  reviewFingerprint: string;
  accepted: boolean;
  action: FidelityAction;
  reason: string;
  effectiveScore: number;
  failedFeatureIds: string[];
  revertToReviewId?: string;
}

export interface FidelityContractAudit {
  pass: boolean;
  blockers: string[];
  warnings: string[];
  detailCoverage: number;
  componentCoverage: number;
  materialCoverage: number;
  criticalFeatures: number;
}

export interface FidelityTransition {
  accepted: boolean;
  action: FidelityAction;
  reason: string;
  effectiveScore: number;
  failedFeatureIds: string[];
  revertToReviewId?: string;
  state: FidelityWorkflowState;
}

export interface FidelityContractOptions {
  domain: AssetDomain;
  complexity?: FidelityComplexity;
  details?: FidelityFeature[];
  cameras?: FidelityCamera[];
  materialRegions?: FidelityMaterialRegion[];
  targetFidelity?: number;
  maxIterationsPerPass?: number;
  maxTotalIterations?: number;
  tokenBudget?: number;
}

const MINIMUM_DETAILS: Record<FidelityComplexity, number> = {
  simple: 3,
  moderate: 6,
  complex: 10,
  'ultra-complex': 16,
};
const MAX_DETAILS = 2048;
const MAX_CAMERAS = 24;
const MAX_MATERIAL_REGIONS = 512;
const MAX_REVIEWS = 128;
const MAX_TEXT = 500;
const REQUIRED_HARD_GATES = [
  'evidence-provenance',
  'topology-integrity',
  'component-coverage',
  'attachment-integrity',
  'reference-comparison',
  'export-reopen-parity',
];

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteCameraCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 1e9;
}

function maximumRelativeDelta(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  return left.reduce((maximum, value, index) => Math.max(
    maximum,
    Math.abs(value - right[index]!) / (1 + Math.max(Math.abs(value), Math.abs(right[index]!))),
  ), 0);
}

function validId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function evidenceConfidence(status: EvidenceStatusIR | undefined): number {
  if (status === 'measured') return 0.98;
  if (status === 'datasheet') return 0.96;
  if (status === 'estimated') return 0.68;
  return 0.48;
}

function featureKindForComponent(component: AssemblyIR['components'][number]): FidelityFeatureKind {
  const searchable = `${component.id} ${component.name}`.toLowerCase();
  if (/void|opening|aperture|courtyard|cutout/.test(searchable)) return 'negative-space';
  if (/seam|fastener|screw|connector|hinge|joint|port|socket/.test(searchable)) return 'interface';
  if (/mark|engraving|logo|label|decal|pattern/.test(searchable)) return 'marking';
  if (component.category === 'enclosure' || component.category === 'display') return 'silhouette';
  return 'component';
}

function importanceForComponent(component: AssemblyIR['components'][number]): FidelityImportance {
  if (component.evidence?.status === 'measured' || component.evidence?.status === 'datasheet') return 'critical';
  if (['enclosure', 'display', 'camera', 'interconnect'].includes(component.category)) return 'major';
  return 'minor';
}

function featureThreshold(importance: FidelityImportance): number {
  if (importance === 'critical') return 0.92;
  if (importance === 'major') return 0.86;
  return 0.76;
}

function proofViewsFor(kind: FidelityFeatureKind): ReviewMode[] {
  if (kind === 'material' || kind === 'micro-surface') return ['source-camera', 'grazing-light'];
  if (kind === 'topology' || kind === 'interface') return ['clay', 'wire', 'x-ray'];
  return ['source-camera', 'orthographic'];
}

function defaultDetails(ir: AssemblyIR): FidelityFeature[] {
  const details: FidelityFeature[] = ir.components.slice(0, MAX_DETAILS - 1).map((component) => {
    const importance = importanceForComponent(component);
    const kind = featureKindForComponent(component);
    return {
      id: `detail-${component.id}`,
      label: component.name,
      kind,
      importance,
      componentIds: [component.id],
      evidenceRef: component.evidence?.source ?? `assembly-ir:${component.id}`,
      confidence: evidenceConfidence(component.evidence?.status),
      threshold: featureThreshold(importance),
      proofViews: proofViewsFor(kind),
      notes: component.evidence?.notes?.slice(0, 8),
    };
  });
  for (const component of ir.components) {
    if (details.length >= MAX_DETAILS - 1) break;
    const importance = importanceForComponent(component);
    if (component.material.surface) {
      details.push({
        id: `material-${component.id}`,
        label: `${component.name} material response`,
        kind: 'material',
        importance: importance === 'critical' ? 'critical' : 'major',
        componentIds: [component.id],
        evidenceRef: component.evidence?.source ?? `assembly-ir:${component.id}`,
        confidence: evidenceConfidence(component.evidence?.status),
        threshold: importance === 'critical' ? 0.92 : 0.86,
        proofViews: proofViewsFor('material'),
      });
    }
    if (component.material.surface && details.length < MAX_DETAILS - 1) {
      details.push({
        id: `surface-${component.id}`,
        label: `${component.name} micro-surface`,
        kind: 'micro-surface',
        importance: 'major',
        componentIds: [component.id],
        evidenceRef: component.evidence?.source ?? `assembly-ir:${component.id}`,
        confidence: evidenceConfidence(component.evidence?.status),
        threshold: 0.84,
        proofViews: proofViewsFor('micro-surface'),
      });
    }
  }
  const topologyComponents = ir.components.slice(0, 32).map((component) => component.id);
  if (topologyComponents.length > 0) {
    details.push(
      {
        id: 'overall-silhouette', label: 'Overall source-view silhouette', kind: 'silhouette', importance: 'critical',
        componentIds: topologyComponents, evidenceRef: 'assembly-ir:source-view-envelope', confidence: 0.9, threshold: 0.92,
        proofViews: proofViewsFor('silhouette'),
      },
      {
        id: 'overall-proportions', label: 'Dominant mass and proportion relationships', kind: 'proportion', importance: 'critical',
        componentIds: topologyComponents, evidenceRef: 'assembly-ir:component-bounds', confidence: 0.9, threshold: 0.92,
        proofViews: proofViewsFor('proportion'),
      },
      {
        id: 'attachment-integrity', label: 'Component attachment and interface integrity', kind: 'interface', importance: 'critical',
        componentIds: topologyComponents, evidenceRef: 'assembly-ir:attachment-audit', confidence: 1, threshold: 0.96,
        proofViews: proofViewsFor('interface'),
      },
      {
        id: 'topology-integrity', label: 'Closed editable topology', kind: 'topology', importance: 'critical',
        componentIds: topologyComponents, evidenceRef: 'assembly-ir:compiled-topology-audit', confidence: 1, threshold: 0.98,
        proofViews: proofViewsFor('topology'),
      },
    );
  }
  return details.slice(0, MAX_DETAILS);
}

function defaultMaterialRegions(ir: AssemblyIR): FidelityMaterialRegion[] {
  return ir.components.slice(0, MAX_MATERIAL_REGIONS).flatMap((component) => component.material.surface ? [{
    id: `material-${component.id}`,
    componentId: component.id,
    evidenceRef: component.evidence?.source ?? `assembly-ir:${component.id}`,
    expectedSurface: component.material.surface,
    confidence: evidenceConfidence(component.evidence?.status),
  }] : []);
}

function defaultPasses(targetFidelity: number): FidelityPassContract[] {
  const requirements: Record<FidelityPassId, FidelityFeatureKind[]> = {
    blockout: ['silhouette', 'proportion', 'negative-space'],
    structure: ['component', 'interface', 'topology'],
    form: ['silhouette', 'proportion', 'component'],
    material: ['material'],
    surface: ['micro-surface', 'marking'],
    lighting: ['material'],
    interaction: ['interface', 'pose'],
    optimization: ['topology'],
  };
  return FIDELITY_PASS_ORDER.map((id, index) => ({
    id,
    minimumFidelity: clamp(targetFidelity - (FIDELITY_PASS_ORDER.length - index - 1) * 0.012, 0.72, targetFidelity),
    requiredKinds: requirements[id],
    requiredProofViews: id === 'material' || id === 'surface'
      ? ['source-camera', 'grazing-light']
      : id === 'optimization' ? ['wire', 'x-ray'] : ['source-camera', 'orthographic'],
  }));
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function fidelityContractFingerprint(contract: FidelityContract): string {
  const canonical = JSON.stringify({
    assetName: contract.assetName,
    domain: contract.domain,
    complexity: contract.complexity,
    targetFidelity: contract.targetFidelity,
    maxIterationsPerPass: contract.maxIterationsPerPass,
    maxTotalIterations: contract.maxTotalIterations,
    tokenBudget: contract.tokenBudget,
    details: contract.details.map((detail) => [
      detail.id, detail.label, detail.kind, detail.importance, detail.componentIds,
      detail.evidenceRef, detail.confidence, detail.threshold, detail.proofViews, detail.notes,
    ]),
    cameras: contract.cameras.map((camera) => camera.projection === 'orthographic' ? [
      camera.id, camera.sourceViewId, camera.projection, camera.anchorCount, camera.reprojectionErrorPx,
      camera.calibrationRevision, camera.azimuthDegrees, camera.pixelsPerWorldUnit, camera.offsetPixels,
      camera.anchors.map((anchor) => [anchor.id, anchor.world, anchor.image, anchor.confidence, anchor.evidenceRef]),
    ] : [
      camera.id, camera.sourceViewId, camera.projection, camera.anchorCount, camera.reprojectionErrorPx,
      camera.calibrationRevision, camera.projectionMatrix, camera.worldCenter, camera.worldScale,
      camera.imageCenter, camera.imageScale,
      camera.anchors.map((anchor) => [anchor.id, anchor.world, anchor.image, anchor.confidence, anchor.evidenceRef]),
    ]),
    materials: contract.materialRegions.map((region) => [region.id, region.componentId, region.evidenceRef, region.expectedSurface, region.confidence]),
    hardGates: contract.hardGates,
    passes: contract.passes.map((pass) => [pass.id, pass.minimumFidelity, pass.requiredKinds, pass.requiredProofViews]),
  });
  return stableHash(canonical);
}

export function createFidelityContract(ir: AssemblyIR, options: FidelityContractOptions): FidelityContract {
  const targetFidelity = options.targetFidelity ?? 0.9;
  if (!finiteUnit(targetFidelity) || targetFidelity < 0.7) throw new Error('targetFidelity must be a finite number in [0.7, 1].');
  const complexity = options.complexity ?? (ir.components.length >= 80
    ? 'ultra-complex' : ir.components.length >= 24 ? 'complex' : ir.components.length >= 6 ? 'moderate' : 'simple');
  const contract: FidelityContract = {
    schema: 'morphloom.fidelity/0.2',
    assetName: ir.name,
    domain: options.domain,
    complexity,
    targetFidelity,
    maxIterationsPerPass: options.maxIterationsPerPass ?? 5,
    maxTotalIterations: options.maxTotalIterations ?? 28,
    tokenBudget: options.tokenBudget ?? 240_000,
    details: structuredClone(options.details ?? defaultDetails(ir)),
    cameras: structuredClone(options.cameras ?? []),
    materialRegions: structuredClone(options.materialRegions ?? defaultMaterialRegions(ir)),
    hardGates: [...REQUIRED_HARD_GATES],
    passes: defaultPasses(targetFidelity),
  };
  const audit = auditFidelityContract(contract, ir);
  if (!audit.pass) throw new Error(`Fidelity contract is blocked: ${audit.blockers.join('; ')}`);
  return contract;
}

export function auditFidelityContract(contract: FidelityContract, ir: AssemblyIR): FidelityContractAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const components = new Map(ir.components.map((component) => [component.id, component]));
  const details = Array.isArray(contract.details) ? contract.details : [];
  const cameras = Array.isArray(contract.cameras) ? contract.cameras : [];
  const materialRegions = Array.isArray(contract.materialRegions) ? contract.materialRegions : [];
  const passes = Array.isArray(contract.passes) ? contract.passes : [];
  const hardGates = Array.isArray(contract.hardGates) ? contract.hardGates : [];
  const validComplexities = new Set<FidelityComplexity>(['simple', 'moderate', 'complex', 'ultra-complex']);
  const validDomains = new Set<AssetDomain>([
    'architecture', 'product', 'electronics', 'human', 'animation', 'game', '3d-print', 'surface', 'unknown',
  ]);
  const validKinds = new Set<FidelityFeatureKind>(['silhouette', 'proportion', 'negative-space', 'component', 'interface', 'material', 'micro-surface', 'marking', 'pose', 'topology']);
  const validViews = new Set<ReviewMode>(['source-camera', 'orthographic', 'clay', 'grazing-light', 'wire', 'x-ray']);
  if (contract.schema !== 'morphloom.fidelity/0.2') blockers.push('unsupported fidelity schema');
  if (contract.assetName !== ir.name) blockers.push('fidelity assetName does not match AssemblyIR');
  if (!validDomains.has(contract.domain)) blockers.push('unsupported fidelity domain');
  if (!validComplexities.has(contract.complexity)) blockers.push('unsupported fidelity complexity');
  if (!finiteUnit(contract.targetFidelity) || contract.targetFidelity < 0.7) blockers.push('target fidelity must be 0.7–1.0');
  if (!Number.isInteger(contract.maxIterationsPerPass) || contract.maxIterationsPerPass < 1 || contract.maxIterationsPerPass > 12) blockers.push('maxIterationsPerPass must be 1–12');
  if (!Number.isInteger(contract.maxTotalIterations) || contract.maxTotalIterations < contract.maxIterationsPerPass
    || contract.maxTotalIterations < FIDELITY_PASS_ORDER.length || contract.maxTotalIterations > MAX_REVIEWS) blockers.push('maxTotalIterations is unsafe');
  if (!Number.isInteger(contract.tokenBudget) || contract.tokenBudget < 0 || contract.tokenBudget > 10_000_000) blockers.push('tokenBudget is unsafe');
  const minimumDetails = MINIMUM_DETAILS[contract.complexity] ?? MINIMUM_DETAILS.moderate;
  if (!Array.isArray(contract.details) || details.length < minimumDetails || details.length > MAX_DETAILS) {
    blockers.push(`detail inventory requires ${minimumDetails}–${MAX_DETAILS} entries`);
  }
  const detailIds = new Set<string>();
  const mappedComponentIds = new Set<string>();
  let mappedDetails = 0;
  let criticalFeatures = 0;
  for (const detail of details) {
    if (!validId(detail.id) || detailIds.has(detail.id)) blockers.push(`invalid or duplicate detail id: ${detail.id}`);
    detailIds.add(detail.id);
    if (typeof detail.label !== 'string' || !detail.label.trim() || detail.label.length > 160
      || typeof detail.evidenceRef !== 'string' || !detail.evidenceRef.trim() || detail.evidenceRef.length > MAX_TEXT) blockers.push(`invalid detail evidence metadata: ${detail.id}`);
    if (!finiteUnit(detail.confidence) || !finiteUnit(detail.threshold) || detail.threshold < 0.5) blockers.push(`invalid detail score bounds: ${detail.id}`);
    if (!validKinds.has(detail.kind) || !['critical', 'major', 'minor'].includes(detail.importance)) blockers.push(`invalid detail classification: ${detail.id}`);
    if (!Array.isArray(detail.componentIds) || detail.componentIds.length < 1 || detail.componentIds.length > 32
      || detail.componentIds.some((id) => !components.has(id))) blockers.push(`detail maps to missing component: ${detail.id}`);
    else {
      mappedDetails += 1;
      detail.componentIds.forEach((id) => mappedComponentIds.add(id));
    }
    if (!Array.isArray(detail.proofViews) || detail.proofViews.length < 1 || detail.proofViews.length > validViews.size
      || detail.proofViews.some((view) => !validViews.has(view))) blockers.push(`detail has invalid proof views: ${detail.id}`);
    if (detail.importance === 'critical') {
      criticalFeatures += 1;
      if (detail.confidence < 0.7) warnings.push(`critical detail has low source confidence: ${detail.id}`);
    }
  }
  if (criticalFeatures < 1) blockers.push('at least one critical detail is required');
  if (mappedComponentIds.size < components.size) blockers.push(`detail inventory maps ${mappedComponentIds.size}/${components.size} components`);
  const presentKinds = new Set(details.map((detail) => detail.kind));
  for (const kind of ['silhouette', 'proportion', 'topology'] as const) {
    if (!presentKinds.has(kind)) blockers.push(`detail inventory is missing required ${kind} feature`);
  }
  if (!Array.isArray(contract.cameras) || cameras.length > MAX_CAMERAS) blockers.push('camera contract count is unsafe');
  const cameraIds = new Set<string>();
  for (const camera of cameras) {
    if (!validId(camera.id) || cameraIds.has(camera.id)) blockers.push(`invalid or duplicate camera id: ${camera.id}`);
    cameraIds.add(camera.id);
    if (!['perspective', 'orthographic'].includes(camera.projection)) {
      blockers.push(`invalid camera calibration: ${camera.id}`);
      continue;
    }
    const minimumAnchors = camera.projection === 'perspective' ? 6 : 4;
    if (typeof camera.sourceViewId !== 'string' || !camera.sourceViewId.trim() || camera.sourceViewId.length > 160
      || !Number.isInteger(camera.anchorCount) || camera.anchorCount < minimumAnchors || camera.anchorCount > 512
      || !Number.isFinite(camera.reprojectionErrorPx) || camera.reprojectionErrorPx < 0 || camera.reprojectionErrorPx > 4) {
      blockers.push(`invalid camera calibration: ${camera.id}`);
    }
    if (!Array.isArray(camera.anchors) || camera.anchors.length < minimumAnchors || camera.anchors.length > 512
      || camera.anchors.length !== camera.anchorCount
    ) {
      blockers.push(`missing reproducible camera receipt: ${camera.id}`);
      continue;
    }
    const anchorIds = new Set<string>();
    let anchorsValid = true;
    for (const anchor of camera.anchors) {
      if (!validId(anchor.id) || anchorIds.has(anchor.id)
        || !Array.isArray(anchor.world) || anchor.world.length !== 3 || !anchor.world.every(finiteCameraCoordinate)
        || !Array.isArray(anchor.image) || anchor.image.length !== 2 || !anchor.image.every(finiteCameraCoordinate)
        || typeof anchor.evidenceRef !== 'string' || !anchor.evidenceRef.trim() || anchor.evidenceRef.length > MAX_TEXT
        || (anchor.confidence !== undefined && (!Number.isFinite(anchor.confidence) || anchor.confidence <= 0 || anchor.confidence > 1))) {
        anchorsValid = false;
        break;
      }
      anchorIds.add(anchor.id);
    }
    if (!anchorsValid) {
      blockers.push(`invalid camera anchor evidence: ${camera.id}`);
      continue;
    }
    if (camera.projection === 'orthographic') {
      if (camera.calibrationRevision !== 'morphloom-camera-calibration/0.1'
        || !Number.isFinite(camera.azimuthDegrees) || !Number.isFinite(camera.pixelsPerWorldUnit)
        || camera.pixelsPerWorldUnit <= 0 || !Array.isArray(camera.offsetPixels) || camera.offsetPixels.length !== 2
        || !camera.offsetPixels.every(Number.isFinite)) {
        blockers.push(`missing reproducible camera receipt: ${camera.id}`);
        continue;
      }
      const calibration = calibrateOrthographicYawCamera(camera.anchors, 4);
      const azimuthDelta = Math.abs((((calibration.azimuthDegrees - camera.azimuthDegrees) % 360) + 540) % 360 - 180);
      const offsetDelta = Math.hypot(
        calibration.offsetPixels[0] - camera.offsetPixels[0],
        calibration.offsetPixels[1] - camera.offsetPixels[1],
      );
      if (calibration.status !== 'calibrated'
        || Math.abs(calibration.rmsReprojectionErrorPixels - camera.reprojectionErrorPx) > 0.01
        || azimuthDelta > 0.01
        || Math.abs(calibration.pixelsPerWorldUnit - camera.pixelsPerWorldUnit) > 0.01
        || offsetDelta > 0.01) {
        blockers.push(`camera receipt does not reproduce from anchor coordinates: ${camera.id}`);
      }
    } else {
      if (camera.calibrationRevision !== 'morphloom-camera-calibration/0.2'
        || !Array.isArray(camera.projectionMatrix) || camera.projectionMatrix.length !== 12
        || !camera.projectionMatrix.every(finiteCameraCoordinate)
        || !Array.isArray(camera.worldCenter) || camera.worldCenter.length !== 3 || !camera.worldCenter.every(finiteCameraCoordinate)
        || !Number.isFinite(camera.worldScale) || camera.worldScale <= 0
        || !Array.isArray(camera.imageCenter) || camera.imageCenter.length !== 2 || !camera.imageCenter.every(finiteCameraCoordinate)
        || !Number.isFinite(camera.imageScale) || camera.imageScale <= 0) {
        blockers.push(`missing reproducible camera receipt: ${camera.id}`);
        continue;
      }
      const calibration = calibratePerspectiveCamera(camera.anchors, 4);
      if (calibration.status !== 'calibrated'
        || Math.abs(calibration.rmsReprojectionErrorPixels - camera.reprojectionErrorPx) > 0.01
        || maximumRelativeDelta(calibration.projectionMatrix, camera.projectionMatrix) > 1e-8
        || maximumRelativeDelta(calibration.worldCenter, camera.worldCenter) > 1e-8
        || maximumRelativeDelta([calibration.worldScale], [camera.worldScale]) > 1e-8
        || maximumRelativeDelta(calibration.imageCenter, camera.imageCenter) > 1e-8
        || maximumRelativeDelta([calibration.imageScale], [camera.imageScale]) > 1e-8) {
        blockers.push(`camera receipt does not reproduce from anchor coordinates: ${camera.id}`);
      }
    }
  }
  if (contract.complexity !== 'simple' && cameras.length < 1) blockers.push('moderate or complex assets require a calibrated source camera');
  if (!Array.isArray(contract.materialRegions) || materialRegions.length > MAX_MATERIAL_REGIONS) blockers.push('material region count is unsafe');
  const expectedMaterialComponents = ir.components.filter((component) => component.material.surface).map((component) => component.id);
  const mappedMaterialComponents = new Set<string>();
  const materialIds = new Set<string>();
  for (const region of materialRegions) {
    const component = components.get(region.componentId);
    if (!validId(region.id) || materialIds.has(region.id) || !component || typeof region.evidenceRef !== 'string' || !region.evidenceRef.trim()
      || region.evidenceRef.length > MAX_TEXT || !finiteUnit(region.confidence)) blockers.push(`invalid material region: ${region.id}`);
    else if (component.material.surface !== region.expectedSurface) blockers.push(`material region surface mismatch: ${region.id}`);
    else {
      mappedMaterialComponents.add(region.componentId);
    }
    materialIds.add(region.id);
  }
  if (expectedMaterialComponents.some((id) => !mappedMaterialComponents.has(id))) {
    blockers.push(`material regions map ${mappedMaterialComponents.size}/${expectedMaterialComponents.length} surfaced components`);
  }
  if (expectedMaterialComponents.length > 0 && (!presentKinds.has('material') || !presentKinds.has('micro-surface'))) {
    blockers.push('surfaced assets require material and micro-surface features');
  }
  const expectedPasses = FIDELITY_PASS_ORDER.join(',');
  if (!Array.isArray(contract.passes) || passes.map((pass) => pass.id).join(',') !== expectedPasses) blockers.push('fidelity passes must use the locked canonical order');
  for (const pass of passes) {
    if (!finiteUnit(pass.minimumFidelity) || pass.minimumFidelity < 0.7 || pass.minimumFidelity > contract.targetFidelity) blockers.push(`invalid pass threshold: ${pass.id}`);
    if (!Array.isArray(pass.requiredKinds) || pass.requiredKinds.length < 1 || pass.requiredKinds.some((kind) => !validKinds.has(kind))) blockers.push(`pass has invalid feature requirements: ${pass.id}`);
    if (!Array.isArray(pass.requiredProofViews) || pass.requiredProofViews.length < 1
      || pass.requiredProofViews.some((view) => !validViews.has(view))) blockers.push(`pass has invalid proof views: ${pass.id}`);
  }
  if (hardGates.length > 64 || hardGates.some((gate) => typeof gate !== 'string' || gate.length < 1 || gate.length > 160)) blockers.push('hard gate metadata is invalid');
  for (const gate of REQUIRED_HARD_GATES) if (!hardGates.includes(gate)) blockers.push(`missing hard gate: ${gate}`);
  return {
    pass: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    detailCoverage: details.length === 0 ? 0 : mappedDetails / details.length,
    componentCoverage: components.size === 0 ? 0 : mappedComponentIds.size / components.size,
    materialCoverage: expectedMaterialComponents.length === 0 ? 1 : mappedMaterialComponents.size / expectedMaterialComponents.length,
    criticalFeatures,
  };
}

export function startFidelityWorkflow(contract: FidelityContract): FidelityWorkflowState {
  return {
    schema: 'morphloom.fidelity-state/0.1',
    contractFingerprint: fidelityContractFingerprint(contract),
    activePassIndex: 0,
    completedPasses: [],
    reviews: [],
    spentTokens: 0,
    bestReviewByPass: {},
    decisions: [],
    stopped: false,
  };
}

function validateReview(review: FidelityReview): void {
  if (!validId(review.id)) throw new Error('Review id is invalid.');
  if (!FIDELITY_PASS_ORDER.includes(review.passId)) throw new Error('Review pass id is invalid.');
  if (typeof review.comparisonArtifact !== 'string' || !review.comparisonArtifact.trim() || review.comparisonArtifact.length > MAX_TEXT) throw new Error('Comparison artifact is required.');
  if (!review.comparisonEvidence || !['pixel-frame-v1', 'external-vision'].includes(review.comparisonEvidence.method)
    || !/^[a-f0-9]{8,64}$/i.test(review.comparisonEvidence.referenceFingerprint)
    || !/^[a-f0-9]{8,64}$/i.test(review.comparisonEvidence.renderFingerprint)) throw new Error('Comparison evidence provenance is invalid.');
  if (typeof review.sourceViewId !== 'string' || !review.sourceViewId.trim() || review.sourceViewId.length > 160) throw new Error('Source view id is required.');
  const allowedProofViews = new Set<ReviewMode>(['source-camera', 'orthographic', 'clay', 'grazing-light', 'wire', 'x-ray']);
  if (!Array.isArray(review.proofViews) || review.proofViews.length < 1 || review.proofViews.length > allowedProofViews.size
    || review.proofViews.some((view) => !allowedProofViews.has(view))) throw new Error('Review proof views are invalid.');
  if (!finiteUnit(review.fidelity) || (review.silhouetteIoU !== undefined && !finiteUnit(review.silhouetteIoU))
    || (review.interiorSimilarity !== undefined && !finiteUnit(review.interiorSimilarity))) throw new Error('Review scores must be finite values in [0, 1].');
  if (review.comparisonEvidence.method === 'pixel-frame-v1'
    && (review.silhouetteIoU === undefined || review.interiorSimilarity === undefined)) {
    throw new Error('Pixel-frame comparison must include silhouette and interior scores.');
  }
  if (['blockout', 'form'].includes(review.passId) && review.silhouetteIoU === undefined) {
    throw new Error(`${review.passId} review requires a silhouette score.`);
  }
  if (['material', 'surface', 'lighting'].includes(review.passId) && review.interiorSimilarity === undefined) {
    throw new Error(`${review.passId} review requires an interior comparison score.`);
  }
  if (!Number.isInteger(review.spentTokens) || review.spentTokens < 0 || review.spentTokens > 2_000_000) throw new Error('Review token cost is unsafe.');
  if (!Array.isArray(review.featureScores) || !Array.isArray(review.hardGateFailures) || !Array.isArray(review.defectTags)) throw new Error('Review evidence lists are required.');
  if (review.featureScores.length > MAX_DETAILS || review.hardGateFailures.length > 64 || review.defectTags.length > 128) throw new Error('Review payload is too large.');
  const boundedText = (value: string) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
  if (review.hardGateFailures.some((item) => !boundedText(item)) || review.defectTags.some((item) => !boundedText(item))) {
    throw new Error('Review defect metadata is invalid.');
  }
  const scoreIds = new Set<string>();
  for (const feature of review.featureScores) {
    if (!validId(feature.featureId) || scoreIds.has(feature.featureId) || !finiteUnit(feature.score)) throw new Error(`Invalid feature score: ${feature.featureId}`);
    scoreIds.add(feature.featureId);
    if ((feature.defectTags?.length ?? 0) > 32) throw new Error(`Feature defect list is too large: ${feature.featureId}`);
    if (feature.defectTags?.some((item) => !boundedText(item))) throw new Error(`Feature defect metadata is invalid: ${feature.featureId}`);
  }
}

function effectiveReviewScore(review: FidelityReview, relevantFeatures: FidelityFeature[]): { score: number; failedFeatureIds: string[] } {
  const scores = new Map(review.featureScores.map((item) => [item.featureId, item.score]));
  const failedFeatureIds = relevantFeatures.filter((feature) => (scores.get(feature.id) ?? -1) < feature.threshold).map((feature) => feature.id);
  const weighted = relevantFeatures.length === 0 ? review.fidelity : relevantFeatures.reduce((sum, feature) => {
    const weight = feature.importance === 'critical' ? 4 : feature.importance === 'major' ? 2 : 1;
    return sum + (scores.get(feature.id) ?? 0) * weight;
  }, 0) / relevantFeatures.reduce((sum, feature) => sum + (feature.importance === 'critical' ? 4 : feature.importance === 'major' ? 2 : 1), 0);
  return {
    score: Math.min(review.fidelity, weighted, review.silhouetteIoU ?? 1, review.interiorSimilarity ?? 1),
    failedFeatureIds,
  };
}

function reviewFingerprint(review: FidelityReview): string {
  return stableHash(JSON.stringify([
    review.id, review.passId, review.comparisonArtifact, review.comparisonEvidence, review.sourceViewId,
    review.proofViews, review.fidelity, review.silhouetteIoU, review.interiorSimilarity,
    review.featureScores, review.hardGateFailures, review.defectTags, review.spentTokens,
  ]));
}

function failTransition(
  state: FidelityWorkflowState,
  review: FidelityReview,
  score: number,
  failedFeatureIds: string[],
  action: FidelityAction,
  reason: string,
  revertToReviewId?: string,
): FidelityTransition {
  const stopped = action === 'request-input';
  const decision: FidelityDecision = {
    reviewId: review.id,
    reviewFingerprint: reviewFingerprint(review),
    accepted: false,
    action,
    reason,
    effectiveScore: score,
    failedFeatureIds,
    revertToReviewId,
  };
  return {
    accepted: false,
    action,
    reason,
    effectiveScore: score,
    failedFeatureIds,
    revertToReviewId,
    state: {
      ...state,
      decisions: [...state.decisions, decision].slice(-MAX_REVIEWS),
      stopped,
      stopReason: stopped ? reason : undefined,
    },
  };
}

export function submitFidelityReview(
  contract: FidelityContract,
  current: FidelityWorkflowState,
  review: FidelityReview,
): FidelityTransition {
  validateReview(review);
  if (current.schema !== 'morphloom.fidelity-state/0.1' || current.contractFingerprint !== fidelityContractFingerprint(contract)) throw new Error('Fidelity workflow does not match this contract.');
  if (!Number.isInteger(current.activePassIndex) || current.activePassIndex < 0 || current.activePassIndex > contract.passes.length
    || !Array.isArray(current.completedPasses) || !Array.isArray(current.reviews) || current.reviews.length > MAX_REVIEWS
    || !Array.isArray(current.decisions) || current.decisions.length > MAX_REVIEWS
    || !Number.isInteger(current.spentTokens) || current.spentTokens < 0) throw new Error('Fidelity workflow state is invalid or unsafe.');
  const priorDecision = current.decisions.find((item) => item.reviewId === review.id);
  if (priorDecision) {
    if (priorDecision.reviewFingerprint !== reviewFingerprint(review)) throw new Error(`Review id conflict: ${review.id}`);
    return { ...priorDecision, reason: `${priorDecision.reason} (idempotent replay)`, state: current };
  }
  if (current.stopped) throw new Error(`Fidelity workflow is stopped: ${current.stopReason ?? 'unknown reason'}`);
  const activePass = contract.passes[current.activePassIndex];
  if (!activePass || review.passId !== activePass.id) throw new Error(`Review must target active pass ${activePass?.id ?? 'complete'}.`);
  const totalAttempts = current.reviews.length + 1;
  const passAttempts = current.reviews.filter((item) => item.passId === review.passId).length + 1;
  const reviews = [...current.reviews, structuredClone(review)].slice(-MAX_REVIEWS);
  const spentTokens = current.spentTokens + review.spentTokens;
  const state: FidelityWorkflowState = { ...current, reviews, spentTokens };
  const relevantFeatures = contract.details.filter((feature) => feature.importance === 'critical' || activePass.requiredKinds.includes(feature.kind));
  const { score, failedFeatureIds } = effectiveReviewScore(review, relevantFeatures);
  const passReviews = reviews.filter((item) => item.passId === review.passId);
  const previousBest = current.bestReviewByPass[review.passId];
  if (spentTokens > contract.tokenBudget) return failTransition(state, review, score, failedFeatureIds, 'request-input', 'token budget exceeded before acceptance');
  if (totalAttempts > contract.maxTotalIterations || passAttempts > contract.maxIterationsPerPass) {
    return failTransition(state, review, score, failedFeatureIds, 'request-input', 'bounded refinement ceiling exceeded');
  }
  const refinementCeilingReached = totalAttempts >= contract.maxTotalIterations || passAttempts >= contract.maxIterationsPerPass;
  const reject = (action: FidelityAction, reason: string, revertToReviewId?: string): FidelityTransition => failTransition(
    state,
    review,
    score,
    failedFeatureIds,
    refinementCeilingReached ? 'request-input' : action,
    refinementCeilingReached ? 'bounded refinement ceiling reached' : reason,
    revertToReviewId,
  );
  if (review.hardGateFailures.length > 0) return reject('refine-ir', `hard gate failed: ${review.hardGateFailures[0]}`);
  const missingProofView = activePass.requiredProofViews.find((view) => !review.proofViews.includes(view));
  if (missingProofView) return reject('refine-spec', `missing proof view: ${missingProofView}`);
  if (contract.cameras.length > 0 && !contract.cameras.some((camera) => camera.sourceViewId === review.sourceViewId)) {
    return reject('refine-spec', 'review source view is not calibrated');
  }
  const missingScores = relevantFeatures.filter((feature) => !review.featureScores.some((item) => item.featureId === feature.id));
  if (missingScores.length > 0) return reject('refine-spec', `missing feature evidence: ${missingScores[0].id}`);
  const previousReview = passReviews.at(-2);
  if (previousReview) {
    const previousScore = effectiveReviewScore(previousReview, relevantFeatures).score;
    if (score + 1e-9 < previousScore) return reject('refine-ir', 'latest correction regressed; revert to best known review', previousBest?.reviewId ?? previousReview.id);
    const repeatedDefect = review.defectTags.find((tag) => previousReview.defectTags.includes(tag));
    if (repeatedDefect) return reject('refine-spec', `defect survived two corrections: ${repeatedDefect}`);
    if (score < activePass.minimumFidelity && score - previousScore < 0.015) return failTransition(state, review, score, failedFeatureIds, 'request-input', 'fidelity plateaued below the pass threshold');
  }
  const bestReviewByPass = { ...current.bestReviewByPass };
  if (!previousBest || score > previousBest.score) bestReviewByPass[review.passId] = { reviewId: review.id, score };
  state.bestReviewByPass = bestReviewByPass;
  const reviewPasses = failedFeatureIds.length === 0 && review.defectTags.length === 0 && score >= activePass.minimumFidelity;
  if (!reviewPasses && refinementCeilingReached) return reject('refine-ir', `feature threshold failed: ${failedFeatureIds[0] ?? 'pass'}`);
  if (failedFeatureIds.length > 0) return reject('refine-ir', `feature threshold failed: ${failedFeatureIds[0]}`);
  if (review.defectTags.length > 0 || score < activePass.minimumFidelity) {
    return reject('refine-ir', review.defectTags[0] ?? `pass fidelity ${score.toFixed(3)} below ${activePass.minimumFidelity.toFixed(3)}`);
  }
  const completedPasses = [...current.completedPasses, activePass.id];
  const complete = completedPasses.length === contract.passes.length;
  const action: FidelityAction = complete ? 'complete' : 'advance';
  const reason = complete ? 'all fidelity passes accepted' : `${activePass.id} accepted`;
  const decision: FidelityDecision = {
    reviewId: review.id,
    reviewFingerprint: reviewFingerprint(review),
    accepted: true,
    action,
    reason,
    effectiveScore: score,
    failedFeatureIds: [],
  };
  const nextState: FidelityWorkflowState = {
    ...state,
    bestReviewByPass,
    decisions: [...state.decisions, decision].slice(-MAX_REVIEWS),
    completedPasses,
    activePassIndex: complete ? contract.passes.length : current.activePassIndex + 1,
    stopped: complete,
    stopReason: complete ? reason : undefined,
  };
  return {
    accepted: true,
    action,
    reason,
    effectiveScore: score,
    failedFeatureIds: [],
    state: nextState,
  };
}

export function auditFidelityDelivery(contract: FidelityContract, state: FidelityWorkflowState): { pass: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (state.contractFingerprint !== fidelityContractFingerprint(contract)) blockers.push('workflow contract fingerprint mismatch');
  const completedPasses = Array.isArray(state.completedPasses) ? state.completedPasses : [];
  const reviews = Array.isArray(state.reviews) ? state.reviews : [];
  const decisions = Array.isArray(state.decisions) ? state.decisions : [];
  const bestReviewByPass = state.bestReviewByPass && typeof state.bestReviewByPass === 'object' ? state.bestReviewByPass : {};
  if (!Array.isArray(state.completedPasses) || !Array.isArray(state.reviews) || !Array.isArray(state.decisions)) blockers.push('fidelity workflow evidence is malformed');
  for (const pass of contract.passes) if (!completedPasses.includes(pass.id)) blockers.push(`fidelity pass incomplete: ${pass.id}`);
  for (const pass of contract.passes) {
    const best = bestReviewByPass[pass.id];
    const review = best ? reviews.find((item) => item.id === best.reviewId && item.passId === pass.id) : undefined;
    const decision = best ? decisions.find((item) => item.reviewId === best.reviewId && item.accepted) : undefined;
    const relevantFeatures = contract.details.filter((feature) => feature.importance === 'critical' || pass.requiredKinds.includes(feature.kind));
    const computed = review ? effectiveReviewScore(review, relevantFeatures) : undefined;
    if (!best || !review || !decision || !computed || computed.failedFeatureIds.length > 0
      || Math.abs(computed.score - best.score) > 1e-9 || best.score < pass.minimumFidelity
      || review.hardGateFailures.length > 0 || review.defectTags.length > 0
      || pass.requiredProofViews.some((view) => !review.proofViews.includes(view))) blockers.push(`fidelity proof below threshold: ${pass.id}`);
  }
  if (!Number.isInteger(state.spentTokens) || state.spentTokens < 0 || state.spentTokens > contract.tokenBudget) blockers.push('fidelity token budget exceeded');
  if (!state.stopped || state.stopReason !== 'all fidelity passes accepted') blockers.push('fidelity workflow has not reached accepted completion');
  return { pass: blockers.length === 0, blockers };
}
