import type { AssetKind } from '../types';
import type { AssemblyIR } from './assembly-ir';
import {
  buildReferenceManifest,
  inferReferenceCapabilities,
  MAX_REFERENCE_FILES,
  normalizeComponentId,
  type ReferenceCapability,
  type ReferenceManifest,
  type ReferenceRole,
  type ReferenceView,
} from './reference-set';

export type SemiProfessionalProfile =
  | 'product-visualization'
  | 'service-assembly'
  | 'architectural-review'
  | 'game-character';

export type DimensionEvidenceStatus = 'measured' | 'datasheet' | 'estimated';

export interface DimensionObservation {
  id: string;
  property: string;
  valueMm: number;
  toleranceMm?: number;
  status: DimensionEvidenceStatus;
  sourceViewId: string;
}

export interface CameraCalibrationObservation {
  viewId: string;
  projection: 'perspective' | 'orthographic';
  anchorCount: number;
  reprojectionErrorPx: number;
}

export interface SemiProfessionalEvidenceOptions {
  profile: SemiProfessionalProfile;
  dimensions?: DimensionObservation[];
  cameraCalibrations?: CameraCalibrationObservation[];
  expectedComponentIds?: string[];
}

export interface EvidenceConflict {
  property: string;
  observationIds: string[];
  minValueMm: number;
  maxValueMm: number;
  allowedSpreadMm: number;
}

export interface SemiProfessionalReadinessReport {
  target: 'semi-professional-editable';
  profile: SemiProfessionalProfile;
  buildReady: boolean;
  deliveryReady: boolean;
  score: number;
  recommendedRoles: ReferenceRole[];
  presentRecommendedRoles: ReferenceRole[];
  missingRecommendedRoles: ReferenceRole[];
  requiredCapabilities: ReferenceCapability[];
  resolvedCapabilities: ReferenceCapability[];
  unresolvedCapabilities: ReferenceCapability[];
  strongDimensionProperties: string[];
  calibratedViews: string[];
  identifiedComponentIds: string[];
  conflicts: EvidenceConflict[];
  blockers: string[];
  warnings: string[];
  nextActions: string[];
}

export interface SemiProfessionalEvidencePack {
  schema: 'morphloom.evidence-pack/0.2';
  target: 'semi-professional-editable';
  profile: SemiProfessionalProfile;
  baseManifest: ReferenceManifest;
  dimensions: DimensionObservation[];
  cameraCalibrations: CameraCalibrationObservation[];
  expectedComponentIds: string[];
  readiness: SemiProfessionalReadinessReport;
  agentInstructions: string[];
}

interface ProfileRequirements {
  assetKind: AssetKind;
  recommendedRoles: ReferenceRole[];
  buildCapabilities: ReferenceCapability[];
  deliveryCapabilities: ReferenceCapability[];
  minStrongDimensions: number;
  minCalibratedViews: number;
  requireIdentifiedComponentView: boolean;
}

const MAX_DIMENSION_OBSERVATIONS = 128;
const MAX_CAMERA_CALIBRATIONS = 24;
const MAX_EXPECTED_COMPONENTS = 512;
const MAX_TEXT_LENGTH = 120;
const MAX_DIMENSION_MM = 100_000_000;
const MAX_TOLERANCE_MM = 1_000_000;
const MAX_REPROJECTION_ERROR_PX = 4;

const PROFILE_REQUIREMENTS: Record<SemiProfessionalProfile, ProfileRequirements> = {
  'product-visualization': {
    assetKind: 'product',
    recommendedRoles: ['front', 'rear', 'left', 'right', 'top', 'bottom', 'measurement', 'material'],
    buildCapabilities: ['shape', 'depth', 'scale'],
    deliveryCapabilities: ['shape', 'depth', 'scale', 'surface', 'interfaces'],
    minStrongDimensions: 1,
    minCalibratedViews: 1,
    requireIdentifiedComponentView: false,
  },
  'service-assembly': {
    assetKind: 'product',
    recommendedRoles: ['front', 'rear', 'left', 'right', 'top', 'bottom', 'measurement', 'material', 'exploded', 'component'],
    buildCapabilities: ['shape', 'depth', 'scale', 'internals'],
    deliveryCapabilities: ['shape', 'depth', 'scale', 'surface', 'interfaces', 'internals', 'assembly-order'],
    minStrongDimensions: 1,
    minCalibratedViews: 1,
    requireIdentifiedComponentView: true,
  },
  'architectural-review': {
    assetKind: 'product',
    recommendedRoles: ['plan', 'elevation', 'section', 'measurement', 'material'],
    buildCapabilities: ['layout', 'scale', 'verticals'],
    deliveryCapabilities: ['layout', 'scale', 'verticals', 'openings', 'surface', 'circulation'],
    minStrongDimensions: 1,
    minCalibratedViews: 1,
    requireIdentifiedComponentView: false,
  },
  'game-character': {
    assetKind: 'human',
    recommendedRoles: ['front', 'rear', 'left', 'right', 'measurement', 'material', 'detail'],
    buildCapabilities: ['shape', 'depth', 'scale', 'pose'],
    deliveryCapabilities: ['shape', 'depth', 'scale', 'surface', 'pose', 'identity'],
    minStrongDimensions: 1,
    minCalibratedViews: 1,
    requireIdentifiedComponentView: false,
  },
};

function boundedText(value: string): boolean {
  return value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resolvedRoles(views: ReferenceView[]): Set<ReferenceRole> {
  return new Set(views.flatMap((view) => [view.role, ...(view.coveredRoles ?? [])]));
}

function isCameraIndependentGeometry(view: ReferenceView): boolean {
  const resolvesGeometry = inferReferenceCapabilities(view)
    .some((capability) => ['shape', 'depth', 'layout', 'verticals'].includes(capability));
  if (!resolvesGeometry) return false;
  if (view.sourceType === 'technical-drawing' || view.sourceType === 'scan' || view.sourceType === 'cad') return true;
  return ['plan', 'elevation', 'section'].includes(view.role);
}

function validDimension(observation: DimensionObservation, viewIds: Set<string>): boolean {
  return boundedText(observation.id)
    && boundedText(observation.property)
    && viewIds.has(observation.sourceViewId)
    && Number.isFinite(observation.valueMm)
    && observation.valueMm > 0
    && observation.valueMm <= MAX_DIMENSION_MM
    && ['measured', 'datasheet', 'estimated'].includes(observation.status)
    && (observation.toleranceMm === undefined
      || (Number.isFinite(observation.toleranceMm)
        && observation.toleranceMm >= 0
        && observation.toleranceMm <= MAX_TOLERANCE_MM));
}

function findDimensionConflicts(observations: DimensionObservation[]): EvidenceConflict[] {
  const byProperty = new Map<string, DimensionObservation[]>();
  for (const observation of observations) {
    if (observation.status === 'estimated') continue;
    const property = observation.property.trim().toLowerCase();
    const group = byProperty.get(property);
    if (group) group.push(observation);
    else byProperty.set(property, [observation]);
  }

  const conflicts: EvidenceConflict[] = [];
  for (const [property, group] of byProperty) {
    if (group.length < 2) continue;
    const values = group.map((observation) => observation.valueMm);
    const minValueMm = Math.min(...values);
    const maxValueMm = Math.max(...values);
    const declaredTolerance = Math.max(...group.map((observation) => observation.toleranceMm ?? 0));
    const allowedSpreadMm = Math.max(declaredTolerance, minValueMm * 0.005, 0.1);
    if (maxValueMm - minValueMm > allowedSpreadMm) {
      conflicts.push({
        property,
        observationIds: group.map((observation) => observation.id),
        minValueMm,
        maxValueMm,
        allowedSpreadMm,
      });
    }
  }
  return conflicts;
}

function evidenceMeanFit(views: ReferenceView[]): number {
  if (views.length === 0) return 0;
  return Math.round(views.reduce((sum, view) => {
    const fit = view.evidence.portraitSuitability;
    return sum + (Number.isFinite(fit) ? Math.max(0, Math.min(100, fit)) : 0);
  }, 0) / views.length);
}

export function evaluateSemiProfessionalReadiness(
  views: ReferenceView[],
  options: SemiProfessionalEvidenceOptions,
): SemiProfessionalReadinessReport {
  const requirements = PROFILE_REQUIREMENTS[options.profile];
  if (!requirements) throw new Error(`Unsupported semi-professional evidence profile: ${String(options.profile)}`);
  const dimensionInputs = options.dimensions ?? [];
  const calibrationInputs = options.cameraCalibrations ?? [];
  const expectedComponentInputs = options.expectedComponentIds ?? [];
  const boundedViews = views.slice(0, MAX_REFERENCE_FILES);
  const scopedViews = boundedViews.filter((view) => view.assetKind === requirements.assetKind);
  const viewIds = new Set(scopedViews.map((view) => view.id));
  const present = resolvedRoles(scopedViews);
  const resolvedCapabilitySet = new Set(scopedViews.flatMap(inferReferenceCapabilities));
  const requiredCapabilities = [...requirements.deliveryCapabilities];
  const resolvedCapabilities = requiredCapabilities.filter((capability) => resolvedCapabilitySet.has(capability));
  const unresolvedCapabilities = requiredCapabilities.filter((capability) => !resolvedCapabilitySet.has(capability));
  const presentRecommendedRoles = requirements.recommendedRoles.filter((role) => present.has(role));
  const missingRecommendedRoles = requirements.recommendedRoles.filter((role) => !present.has(role));
  const dimensions = dimensionInputs.slice(0, MAX_DIMENSION_OBSERVATIONS);
  const calibrations = calibrationInputs.slice(0, MAX_CAMERA_CALIBRATIONS);
  const expectedComponentIds = expectedComponentInputs.slice(0, MAX_EXPECTED_COMPONENTS);
  const invalidDimensions = dimensions.filter((observation) => !validDimension(observation, viewIds));
  const validDimensions = dimensions.filter((observation) => validDimension(observation, viewIds));
  const strongDimensionProperties = unique(validDimensions
    .filter((observation) => observation.status !== 'estimated')
    .map((observation) => observation.property.trim().toLowerCase()));
  const invalidCalibrations = calibrations.filter((calibration) => !viewIds.has(calibration.viewId)
    || !['perspective', 'orthographic'].includes(calibration.projection)
    || !Number.isFinite(calibration.anchorCount)
    || calibration.anchorCount < 4
    || !Number.isFinite(calibration.reprojectionErrorPx)
    || calibration.reprojectionErrorPx < 0);
  const calibratedViews = unique([
    ...calibrations
    .filter((calibration) => !invalidCalibrations.includes(calibration)
      && calibration.reprojectionErrorPx <= MAX_REPROJECTION_ERROR_PX)
      .map((calibration) => calibration.viewId),
    ...scopedViews.filter(isCameraIndependentGeometry).map((view) => view.id),
  ]);
  const componentSources = scopedViews.filter((view) => view.role === 'component'
    || view.coveredRoles?.includes('component')
    || normalizeComponentId(view.componentId ?? '') !== '');
  const unidentifiedComponentViews = componentSources.filter((view) => !normalizeComponentId(view.componentId ?? ''));
  const identifiedComponentIds = unique(scopedViews
    .map((view) => normalizeComponentId(view.componentId ?? ''))
    .filter(Boolean));
  const normalizedExpectedIds = expectedComponentIds.map(normalizeComponentId).filter(Boolean);
  const invalidExpectedIds = expectedComponentIds.length - normalizedExpectedIds.length;
  const missingExpectedComponents = unique(normalizedExpectedIds)
    .filter((componentId) => !identifiedComponentIds.includes(componentId));
  const conflicts = findDimensionConflicts(validDimensions);
  const meanInputFit = evidenceMeanFit(scopedViews);
  const invalidEvidenceViews = scopedViews.filter((view) => !Number.isFinite(view.evidence.portraitSuitability)
    || view.evidence.portraitSuitability < 0
    || view.evidence.portraitSuitability > 100
    || !Number.isInteger(view.evidence.width)
    || view.evidence.width <= 0
    || !Number.isInteger(view.evidence.height)
    || view.evidence.height <= 0);

  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];
  if (scopedViews.length === 0) blockers.push('프로필에 맞는 근거 자료가 없습니다.');
  if (views.length > MAX_REFERENCE_FILES) blockers.push(`근거 파일은 최대 ${MAX_REFERENCE_FILES}개입니다.`);
  const unresolvedBuildCapabilities = requirements.buildCapabilities
    .filter((capability) => !resolvedCapabilitySet.has(capability));
  if (unresolvedBuildCapabilities.length > 0) {
    blockers.push(`기하 해석 핵심 근거 미해결: ${unresolvedBuildCapabilities.join(', ')}`);
  }
  if (invalidDimensions.length > 0) blockers.push(`잘못된 치수 근거 ${invalidDimensions.length}개`);
  if (invalidEvidenceViews.length > 0) blockers.push(`잘못된 원본 품질 메타데이터 ${invalidEvidenceViews.length}개`);
  if (dimensionInputs.length > MAX_DIMENSION_OBSERVATIONS) blockers.push(`치수 근거는 최대 ${MAX_DIMENSION_OBSERVATIONS}개입니다.`);
  if (invalidCalibrations.length > 0) blockers.push(`잘못된 카메라 보정 ${invalidCalibrations.length}개`);
  if (calibrationInputs.length > MAX_CAMERA_CALIBRATIONS) blockers.push(`카메라 보정은 최대 ${MAX_CAMERA_CALIBRATIONS}개입니다.`);
  if (expectedComponentInputs.length > MAX_EXPECTED_COMPONENTS) blockers.push(`예상 부품 ID는 최대 ${MAX_EXPECTED_COMPONENTS}개입니다.`);
  if (invalidExpectedIds > 0) blockers.push(`ASCII로 정규화할 수 없는 예상 부품 ID ${invalidExpectedIds}개`);
  if (unidentifiedComponentViews.length > 0) blockers.push(`부품 ID가 없는 부품 사진 ${unidentifiedComponentViews.length}개`);
  if (missingExpectedComponents.length > 0) blockers.push(`근거가 없는 예상 부품 ${missingExpectedComponents.join(', ')}`);
  if (conflicts.length > 0) blockers.push(`상충하는 강한 치수 근거 ${conflicts.length}건`);
  if (scopedViews.length > 0 && meanInputFit < 60) blockers.push(`평균 입력 적합도 ${meanInputFit}/100`);

  if (unresolvedCapabilities.length > 0) {
    warnings.push(`준실무 납품 속성 미해결: ${unresolvedCapabilities.join(', ')}`);
    nextActions.push(`사진·도면·치수·데이터시트·스캔 중 적합한 근거로 해결: ${unresolvedCapabilities.join(', ')}`);
  }
  if (strongDimensionProperties.length < requirements.minStrongDimensions) {
    warnings.push(`강한 치수 축 ${strongDimensionProperties.length}/${requirements.minStrongDimensions}`);
    nextActions.push(`서로 독립적인 실측/데이터시트 치수 ${requirements.minStrongDimensions}축 확보`);
  }
  if (calibratedViews.length < requirements.minCalibratedViews) {
    warnings.push(`정투상 도면 또는 허용 오차 ${MAX_REPROJECTION_ERROR_PX}px 이하 카메라 보정 필요`);
    nextActions.push('정투상 도면을 제공하거나 최소 한 사진에서 4개 이상 대응점으로 카메라 보정');
  }
  if (requirements.requireIdentifiedComponentView && identifiedComponentIds.length === 0) {
    warnings.push('서비스 어셈블리용 식별 부품 근거가 없습니다.');
    nextActions.push('BOM·부품 도면·분해 자료 중 하나에서 안정적인 ASCII component_id 지정');
  }

  const buildReady = blockers.length === 0;
  const deliveryReady = buildReady
    && unresolvedCapabilities.length === 0
    && strongDimensionProperties.length >= requirements.minStrongDimensions
    && calibratedViews.length >= requirements.minCalibratedViews
    && (!requirements.requireIdentifiedComponentView || identifiedComponentIds.length > 0);
  const capabilityScore = resolvedCapabilities.length / requiredCapabilities.length;
  const dimensionScore = Math.min(1, strongDimensionProperties.length / requirements.minStrongDimensions);
  const calibrationScore = Math.min(1, calibratedViews.length / requirements.minCalibratedViews);
  const componentScore = requirements.requireIdentifiedComponentView ? Math.min(1, identifiedComponentIds.length) : 1;
  const rawScore = capabilityScore * 45 + dimensionScore * 20 + calibrationScore * 15
    + (meanInputFit / 100) * 10 + componentScore * 10;
  const score = Math.round(Math.max(0, Math.min(blockers.length > 0 ? 59 : deliveryReady ? 100 : 84, rawScore)));

  if (deliveryReady) nextActions.push('근거 팩을 잠그고 동일 시점 비교·토폴로지·표면·내보내기 게이트 실행');
  else if (buildReady) nextActions.push('현재 자료로 초벌 IR은 가능하지만 준실무 납품 표시는 보류');

  return {
    target: 'semi-professional-editable',
    profile: options.profile,
    buildReady,
    deliveryReady,
    score,
    recommendedRoles: [...requirements.recommendedRoles],
    presentRecommendedRoles,
    missingRecommendedRoles,
    requiredCapabilities,
    resolvedCapabilities,
    unresolvedCapabilities,
    strongDimensionProperties,
    calibratedViews,
    identifiedComponentIds,
    conflicts,
    blockers,
    warnings,
    nextActions,
  };
}

export function buildSemiProfessionalEvidencePack(
  views: ReferenceView[],
  options: SemiProfessionalEvidenceOptions,
): SemiProfessionalEvidencePack {
  const readiness = evaluateSemiProfessionalReadiness(views, options);
  const requirements = PROFILE_REQUIREMENTS[options.profile];
  if (!requirements) throw new Error(`Unsupported semi-professional evidence profile: ${String(options.profile)}`);
  const scopedViews = views.slice(0, MAX_REFERENCE_FILES)
    .filter((view) => view.assetKind === requirements.assetKind);
  const baseManifest = buildReferenceManifest(scopedViews, requirements.assetKind);
  const stableViewIds = new Map(scopedViews.map((view, index) => [view.id, baseManifest.views[index].id]));
  const stableViewId = (viewId: string): string => stableViewIds.get(viewId) ?? viewId;
  return {
    schema: 'morphloom.evidence-pack/0.2',
    target: 'semi-professional-editable',
    profile: options.profile,
    baseManifest,
    dimensions: (options.dimensions ?? []).slice(0, MAX_DIMENSION_OBSERVATIONS)
      .map((observation) => ({ ...structuredClone(observation), sourceViewId: stableViewId(observation.sourceViewId) })),
    cameraCalibrations: (options.cameraCalibrations ?? []).slice(0, MAX_CAMERA_CALIBRATIONS)
      .map((calibration) => ({ ...structuredClone(calibration), viewId: stableViewId(calibration.viewId) })),
    expectedComponentIds: unique((options.expectedComponentIds ?? []).slice(0, MAX_EXPECTED_COMPONENTS).map(normalizeComponentId).filter(Boolean)),
    readiness: {
      ...readiness,
      calibratedViews: readiness.calibratedViews.map(stableViewId),
    },
    agentInstructions: [
      'Do not start from a single-image completion claim; use the full evidence pack as the source of truth.',
      'Resolve dimension conflicts before geometry and preserve the chosen source and tolerance.',
      'Lock calibrated cameras before same-view silhouette and landmark comparison.',
      'Treat buildReady as permission to compile a review draft, not permission to claim semi-professional delivery.',
      'Claim semi-professional delivery only when deliveryReady is true and compiled-asset gates also pass.',
    ],
  };
}

export function attachEvidenceReadinessToAssembly(
  assembly: AssemblyIR,
  readiness: SemiProfessionalReadinessReport,
): AssemblyIR {
  return {
    ...assembly,
    metadata: {
      ...assembly.metadata,
      qualityTarget: readiness.target,
      evidencePackSchema: 'morphloom.evidence-pack/0.2',
      evidenceProfile: readiness.profile,
      evidenceBuildReady: readiness.buildReady,
      evidenceDeliveryReady: readiness.deliveryReady,
      evidencePackScore: readiness.score,
      evidenceUnresolvedCapabilities: readiness.unresolvedCapabilities.join(','),
    },
  };
}
