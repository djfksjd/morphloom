import type { AssemblyIR, EvidenceStatusIR } from './assembly-ir';
import {
  evaluateSemiProfessionalReadiness,
  type DimensionEvidenceStatus,
  type SemiProfessionalEvidencePack,
  type SemiProfessionalReadinessReport,
  type SourceAuditObservation,
} from './evidence-readiness';
import type { ReferenceManifest, ReferenceView } from './reference-set';

export interface EvidenceClaimAudit {
  schema: 'morphloom.evidence-claim-audit/0.1';
  pass: boolean;
  blockers: string[];
  warnings: string[];
  checkedComponents: number;
  checkedDimensions: number;
  recomputedReadiness: SemiProfessionalReadinessReport;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const MAX_TEXT = 2_000;

function boundedText(value: unknown, maximum = MAX_TEXT): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function sourceViewFromManifest(view: ReferenceManifest['views'][number], assetKind: ReferenceManifest['assetKind']): ReferenceView {
  return {
    id: view.id,
    assetKind,
    url: `evidence:${view.id}`,
    fileName: view.fileName,
    fileSize: view.fileSize,
    mimeType: view.mimeType,
    lastModified: 0,
    role: view.role,
    coveredRoles: [...view.coveredRoles],
    capabilities: [...view.capabilities],
    sourceType: view.sourceType,
    componentId: view.componentId,
    evidence: {
      fileName: view.fileName,
      width: view.width,
      height: view.height,
      averageColor: view.averageColor,
      brightness: view.brightness,
      portraitSuitability: view.inputFit,
      notes: [...view.notes],
    },
  };
}

function manifestShapeBlockers(pack: SemiProfessionalEvidencePack): string[] {
  const blockers: string[] = [];
  const manifest = pack?.baseManifest;
  if (pack?.schema !== 'morphloom.evidence-pack/0.2'
    || pack?.target !== 'semi-professional-editable'
    || !manifest || manifest.schema !== 'morphloom.evidence/0.1'
    || manifest.units !== 'mm') {
    return ['unsupported or missing evidence-pack schema'];
  }
  if (!Array.isArray(manifest.views) || manifest.views.length < 1 || manifest.views.length > 24) {
    blockers.push('evidence pack must contain 1–24 views');
    return blockers;
  }
  const ids = new Set<string>();
  for (const view of manifest.views) {
    if (!SAFE_ID.test(view?.id ?? '') || ids.has(view.id)) blockers.push(`invalid or duplicate evidence view id: ${view?.id ?? 'missing'}`);
    ids.add(view.id);
    if (!boundedText(view?.fileName, 500) || !boundedText(view?.mimeType, 120)
      || !Number.isSafeInteger(view?.fileSize) || view.fileSize < 0 || view.fileSize > 96 * 1024 * 1024
      || !Number.isSafeInteger(view?.width) || view.width < 1 || view.width > 100_000
      || !Number.isSafeInteger(view?.height) || view.height < 1 || view.height > 100_000
      || !Number.isFinite(view?.inputFit) || view.inputFit < 0 || view.inputFit > 100) {
      blockers.push(`unsafe evidence view metadata: ${view?.id ?? 'missing'}`);
    }
  }
  return blockers;
}

function claimIssue(
  status: DimensionEvidenceStatus | EvidenceStatusIR,
  view: ReferenceManifest['views'][number] | undefined,
  audit: SourceAuditObservation | undefined,
): string | undefined {
  if (status === 'estimated' || status === 'inferred') return undefined;
  if (!view) return 'does not reference a listed evidence view';
  if (status === 'datasheet') {
    return view.sourceType === 'datasheet' ? undefined : `claims datasheet evidence from ${view.sourceType}`;
  }
  if (view.sourceType === 'scan' || view.sourceType === 'cad') return undefined;
  if (view.sourceType === 'datasheet') return 'claims a measured value from a datasheet';
  if (view.sourceType === 'technical-drawing') {
    if (audit?.provenance === 'synthetic-concept' || audit?.provenance === 'unknown'
      || audit?.geometryConsistency === 'conflict' || audit?.dimensionLegibility === 'unreadable') {
      return 'claims a measured value from an untrusted or unreadable drawing';
    }
    const coversMeasurement = view.role === 'measurement'
      || view.coveredRoles.includes('measurement') || view.capabilities.includes('scale');
    return coversMeasurement ? undefined : 'claims a measured value from a drawing without scale evidence';
  }
  const clientMeasurement = (view.role === 'measurement'
    || view.coveredRoles.includes('measurement')
    || view.capabilities.includes('scale'))
    && audit?.provenance === 'client-measured'
    && audit.dimensionLegibility === 'verified'
    && audit.geometryConsistency !== 'conflict';
  return clientMeasurement ? undefined : 'claims a measured value from an uncalibrated photograph';
}

export function recomputeEvidencePackReadiness(pack: SemiProfessionalEvidencePack): SemiProfessionalReadinessReport {
  const shapeBlockers = manifestShapeBlockers(pack);
  if (shapeBlockers.length > 0) throw new Error(`Evidence pack is unsafe: ${shapeBlockers.join('; ')}`);
  const views = pack.baseManifest.views.map((view) => sourceViewFromManifest(view, pack.baseManifest.assetKind));
  return evaluateSemiProfessionalReadiness(views, {
    profile: pack.profile,
    dimensions: structuredClone(pack.dimensions),
    cameraCalibrations: structuredClone(pack.cameraCalibrations),
    sourceAudits: structuredClone(pack.sourceAudits),
    expectedComponentIds: [...pack.expectedComponentIds],
  });
}

function sameDimensionClaim(
  contract: NonNullable<AssemblyIR['dimensionContracts']>[number],
  observation: SemiProfessionalEvidencePack['dimensions'][number],
): boolean {
  const tolerance = observation.toleranceMm ?? 0;
  return observation.sourceViewId === contract.evidence.sourceViewId
    && observation.status === contract.evidence.status
    && Math.abs(observation.valueMm - contract.expectedMm) <= 1e-6
    && Math.abs(tolerance - contract.toleranceMm) <= 1e-6;
}

/**
 * Cross-checks strong AssemblyIR claims against the immutable evidence pack.
 * Free-form prose and agent-selected labels are never accepted as provenance.
 */
export function auditAssemblyEvidenceClaims(
  assembly: AssemblyIR,
  pack: SemiProfessionalEvidencePack,
): EvidenceClaimAudit {
  const recomputedReadiness = recomputeEvidencePackReadiness(pack);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const viewById = new Map(pack.baseManifest.views.map((view) => [view.id, view]));
  const auditByViewId = new Map(pack.sourceAudits.map((audit) => [audit.viewId, audit]));

  if (pack.readiness.profile !== recomputedReadiness.profile
    || pack.readiness.buildReady !== recomputedReadiness.buildReady
    || pack.readiness.deliveryReady !== recomputedReadiness.deliveryReady
    || pack.readiness.score !== recomputedReadiness.score) {
    blockers.push('evidence-pack readiness receipt does not match an independent recomputation');
  }

  for (const dimension of pack.dimensions) {
    const issue = claimIssue(dimension.status, viewById.get(dimension.sourceViewId), auditByViewId.get(dimension.sourceViewId));
    if (issue) blockers.push(`dimension ${dimension.id} ${issue}`);
  }

  for (const contract of assembly.dimensionContracts ?? []) {
    if (!contract.evidence.sourceViewId) {
      blockers.push(`dimension contract ${contract.id} has no evidence sourceViewId`);
      continue;
    }
    const view = viewById.get(contract.evidence.sourceViewId);
    const issue = claimIssue(contract.evidence.status, view, auditByViewId.get(contract.evidence.sourceViewId));
    if (issue) blockers.push(`dimension contract ${contract.id} ${issue}`);
    if (!pack.dimensions.some((observation) => sameDimensionClaim(contract, observation))) {
      blockers.push(`dimension contract ${contract.id} has no exact evidence-pack observation`);
    }
  }

  for (const component of assembly.components) {
    const evidence = component.evidence;
    if (!evidence) continue;
    if ((evidence.status === 'measured' || evidence.status === 'datasheet') && !evidence.sourceViewId) {
      blockers.push(`component ${component.id} has an unbound ${evidence.status} claim`);
      continue;
    }
    if (evidence.sourceViewId) {
      const issue = claimIssue(evidence.status, viewById.get(evidence.sourceViewId), auditByViewId.get(evidence.sourceViewId));
      if (issue) blockers.push(`component ${component.id} ${issue}`);
    } else if (!evidence.source) {
      warnings.push(`component ${component.id} has ${evidence.status} evidence without a descriptive source`);
    }
  }

  const metadata = assembly.metadata ?? {};
  if (metadata.evidenceDeliveryReady === true && !recomputedReadiness.deliveryReady) {
    blockers.push('AssemblyIR claims delivery-ready evidence but recomputation is not delivery-ready');
  }
  if (metadata.evidenceBuildReady === true && !recomputedReadiness.buildReady) {
    blockers.push('AssemblyIR claims build-ready evidence but recomputation is not build-ready');
  }

  return {
    schema: 'morphloom.evidence-claim-audit/0.1',
    pass: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    checkedComponents: assembly.components.length,
    checkedDimensions: (assembly.dimensionContracts?.length ?? 0) + pack.dimensions.length,
    recomputedReadiness,
  };
}
