import { fingerprintJson } from './delivery-validation';
import type { EvidenceStatusIR } from './assembly-ir';
import type { PartFeatureKind } from './part-decomposition';

export type VisualEvidenceKind = 'photo' | 'drawing' | 'scan' | 'datasheet';
export type VisualCountDeclarationSource = 'quality-target' | 'repetition-system' | 'component-inventory';

export interface VisualPlanSourceView {
  id: string;
  kind: VisualEvidenceKind;
  fingerprint: string;
}

export interface VisualPlanFeature {
  id: string;
  label: string;
  kind: PartFeatureKind;
  required: boolean;
  evidenceStatus: EvidenceStatusIR;
  sourceViewIds: string[];
  minimumCount: number;
  observedCounts: Array<{ sourceViewId: string; count: number }>;
  /** Planned stable edit-unit IDs. Repetition metadata is not an edit-unit substitute. */
  componentIds: string[];
  separatelyEditable: boolean;
}

export interface VisualPlanCountDeclaration {
  id: string;
  featureId: string;
  source: VisualCountDeclarationSource;
  count: number;
}

export interface VisualPlanQualityFloors {
  detailInventoryMinimum: number;
  minimumVisualScore: number;
  referencePbrRequiredWhenSourceImagePresent: boolean;
  renderedPreviewRequired: boolean;
  realExportRequired: boolean;
}

export interface VisualPlanResolutionReceipt {
  unknownId: string;
  evidenceViewIds: string[];
  fingerprint: string;
}

/**
 * LLM-authored, evidence-first plan locked before geometry. It exists to stop a
 * later retry from deleting requirements merely to satisfy a validator.
 */
export interface VisualPlanningContract {
  schema: 'morphloom.visual-plan/0.1';
  assetName: string;
  sourceViews: VisualPlanSourceView[];
  features: VisualPlanFeature[];
  countDeclarations: VisualPlanCountDeclaration[];
  qualityFloors: VisualPlanQualityFloors;
  surfaceFidelityRequested: boolean;
  openUnknownIds: string[];
  resolutionReceipts?: VisualPlanResolutionReceipt[];
}

export interface LockedVisualPlanningContract {
  schema: 'morphloom.locked-visual-plan/0.1';
  fingerprint: string;
  plan: Readonly<VisualPlanningContract>;
}

export interface VisualPlanAudit {
  pass: boolean;
  fingerprint: string;
  blockers: string[];
  warnings: string[];
  sourceViewCoverage: number;
  explicitEditUnitCoverage: number;
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_FEATURES = 2048;
const MAX_VIEWS = 24;
const MAX_UNKNOWN = 512;
const KINDS = new Set<PartFeatureKind>([
  'primary-mass', 'thin-feature', 'opening', 'repeated-array', 'articulation',
  'routed-element', 'layered-stack', 'surface-relief', 'optical-stack', 'fastener', 'interface',
]);
const EVIDENCE = new Set<EvidenceStatusIR>(['measured', 'datasheet', 'estimated', 'inferred']);
const VIEW_KINDS = new Set<VisualEvidenceKind>(['photo', 'drawing', 'scan', 'datasheet']);
const DECLARATION_SOURCES = new Set<VisualCountDeclarationSource>([
  'quality-target', 'repetition-system', 'component-inventory',
]);

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function clonePlan(plan: VisualPlanningContract): VisualPlanningContract {
  return structuredClone(plan);
}

export function auditVisualPlan(plan: VisualPlanningContract): VisualPlanAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sourceViews = Array.isArray(plan?.sourceViews) ? plan.sourceViews : [];
  const features = Array.isArray(plan?.features) ? plan.features : [];
  const declarations = Array.isArray(plan?.countDeclarations) ? plan.countDeclarations : [];
  const unknowns = Array.isArray(plan?.openUnknownIds) ? plan.openUnknownIds : [];
  const receipts = Array.isArray(plan?.resolutionReceipts) ? plan.resolutionReceipts : [];

  if (plan?.schema !== 'morphloom.visual-plan/0.1') blockers.push('unsupported visual planning schema');
  if (typeof plan?.assetName !== 'string' || !plan.assetName.trim() || plan.assetName.length > 200) {
    blockers.push('visual plan asset name is invalid');
  }
  if (sourceViews.length < 1 || sourceViews.length > MAX_VIEWS) blockers.push(`visual plan requires 1–${MAX_VIEWS} source views`);
  const viewIds = new Set<string>();
  for (const view of sourceViews) {
    if (!ID.test(view?.id ?? '') || viewIds.has(view.id) || !VIEW_KINDS.has(view.kind) || !SHA256.test(view.fingerprint ?? '')) {
      blockers.push(`invalid or duplicate visual source view: ${view?.id ?? 'missing'}`);
    }
    viewIds.add(view?.id);
  }

  if (features.length < 1 || features.length > MAX_FEATURES) blockers.push(`visual plan requires 1–${MAX_FEATURES} features`);
  const featureIds = new Set<string>();
  const coveredViews = new Set<string>();
  let expectedEditUnits = 0;
  let plannedEditUnits = 0;
  for (const feature of features) {
    if (!ID.test(feature?.id ?? '') || featureIds.has(feature.id)) blockers.push(`invalid or duplicate visual feature: ${feature?.id ?? 'missing'}`);
    featureIds.add(feature?.id);
    if (!feature.label?.trim() || feature.label.length > 160 || !KINDS.has(feature.kind)
      || typeof feature.required !== 'boolean' || !EVIDENCE.has(feature.evidenceStatus)) {
      blockers.push(`invalid visual feature metadata: ${feature?.id ?? 'missing'}`);
    }
    if (!Number.isInteger(feature.minimumCount) || feature.minimumCount < 1 || feature.minimumCount > 512) {
      blockers.push(`invalid visual feature minimum count: ${feature.id}`);
    }
    if (!Array.isArray(feature.sourceViewIds) || feature.sourceViewIds.length < 1 || !unique(feature.sourceViewIds)
      || feature.sourceViewIds.some((id) => !viewIds.has(id))) {
      blockers.push(`visual feature has invalid source views: ${feature.id}`);
    } else feature.sourceViewIds.forEach((id) => coveredViews.add(id));
    if (!Array.isArray(feature.componentIds) || !unique(feature.componentIds)
      || feature.componentIds.some((id) => !ID.test(id))) {
      blockers.push(`visual feature has invalid edit-unit ids: ${feature.id}`);
    }
    if (!Array.isArray(feature.observedCounts) || feature.observedCounts.length < 1
      || new Set(feature.observedCounts.map((item) => item.sourceViewId)).size !== feature.observedCounts.length
      || feature.observedCounts.some((item) => !feature.sourceViewIds.includes(item.sourceViewId)
        || !Number.isInteger(item.count) || item.count < 0 || item.count > 512)) {
      blockers.push(`visual feature has invalid observed-count evidence: ${feature.id}`);
    }
    const observed = feature.observedCounts.length > 0 ? Math.max(...feature.observedCounts.map((item) => item.count)) : 0;
    const requiredCount = Math.max(feature.minimumCount, observed);
    if (feature.required && feature.minimumCount < observed) {
      blockers.push(`visual feature undercounts observed evidence: ${feature.id} (${feature.minimumCount}/${observed})`);
    }
    if (feature.required && feature.separatelyEditable && feature.componentIds.length < requiredCount) {
      blockers.push(`visual feature bundles required edit units: ${feature.id} (${feature.componentIds.length}/${requiredCount})`);
    }
    if (feature.required) {
      expectedEditUnits += requiredCount;
      plannedEditUnits += Math.min(requiredCount, feature.componentIds.length);
    }
  }

  const declarationIds = new Set<string>();
  const declarationCounts = new Map<string, Set<number>>();
  const declarationKeys = new Set<string>();
  for (const declaration of declarations) {
    if (!ID.test(declaration?.id ?? '') || declarationIds.has(declaration.id) || !featureIds.has(declaration.featureId)
      || !DECLARATION_SOURCES.has(declaration.source) || !Number.isInteger(declaration.count)
      || declaration.count < 0 || declaration.count > 512) {
      blockers.push(`invalid visual count declaration: ${declaration?.id ?? 'missing'}`);
      continue;
    }
    declarationIds.add(declaration.id);
    const declarationKey = `${declaration.featureId}:${declaration.source}`;
    if (declarationKeys.has(declarationKey)) {
      blockers.push(`duplicate visual count declaration source: ${declarationKey}`);
    }
    declarationKeys.add(declarationKey);
    const counts = declarationCounts.get(declaration.featureId) ?? new Set<number>();
    counts.add(declaration.count);
    declarationCounts.set(declaration.featureId, counts);
  }
  for (const [featureId, counts] of declarationCounts) {
    if (counts.size > 1) blockers.push(`visual count declarations disagree: ${featureId} (${[...counts].sort((a, b) => a - b).join('/')})`);
    const feature = features.find((item) => item.id === featureId);
    if (feature && counts.size === 1 && !counts.has(feature.componentIds.length)) {
      blockers.push(`visual count declaration disagrees with edit-unit inventory: ${featureId} (${[...counts][0]}/${feature.componentIds.length})`);
    }
  }
  for (const feature of features.filter((item) => item.required && item.kind === 'repeated-array')) {
    const observed = feature.observedCounts.length > 0 ? Math.max(...feature.observedCounts.map((item) => item.count)) : 0;
    const requiredCount = Math.max(feature.minimumCount, observed);
    if (!feature.separatelyEditable) {
      blockers.push(`visual repeated feature is not separately editable: ${feature.id}`);
    }
    if (feature.componentIds.length < requiredCount) {
      blockers.push(`visual repeated feature lacks explicit edit units: ${feature.id} (${feature.componentIds.length}/${requiredCount})`);
    }
    const sources = new Set(declarations.filter((item) => item.featureId === feature.id).map((item) => item.source));
    for (const requiredSource of DECLARATION_SOURCES) {
      if (!sources.has(requiredSource)) blockers.push(`visual repeated feature lacks ${requiredSource} count: ${feature.id}`);
    }
  }

  const floors = plan?.qualityFloors;
  if (!floors || !Number.isInteger(floors.detailInventoryMinimum) || floors.detailInventoryMinimum < 1
    || floors.detailInventoryMinimum > MAX_FEATURES || !Number.isFinite(floors.minimumVisualScore)
    || floors.minimumVisualScore < 0 || floors.minimumVisualScore > 100
    || typeof floors.referencePbrRequiredWhenSourceImagePresent !== 'boolean'
    || typeof floors.renderedPreviewRequired !== 'boolean' || typeof floors.realExportRequired !== 'boolean') {
    blockers.push('visual plan quality floors are invalid');
  } else {
    if (features.length < floors.detailInventoryMinimum) {
      blockers.push(`visual detail inventory is below its locked floor (${features.length}/${floors.detailInventoryMinimum})`);
    }
    const hasImageEvidence = sourceViews.some((view) => view.kind === 'photo' || view.kind === 'scan');
    if (plan.surfaceFidelityRequested && hasImageEvidence && !floors.referencePbrRequiredWhenSourceImagePresent) {
      blockers.push('reference PBR cannot be disabled for requested image-conditioned surface fidelity');
    }
  }
  if (typeof plan?.surfaceFidelityRequested !== 'boolean') blockers.push('visual plan surface-fidelity intent is invalid');
  if (unknowns.length > MAX_UNKNOWN || !unique(unknowns) || unknowns.some((id) => !ID.test(id))) blockers.push('visual plan unknown inventory is invalid');
  const receiptUnknowns = new Set<string>();
  for (const receipt of receipts) {
    if (!ID.test(receipt?.unknownId ?? '') || receiptUnknowns.has(receipt.unknownId) || !SHA256.test(receipt.fingerprint ?? '')
      || !Array.isArray(receipt.evidenceViewIds) || receipt.evidenceViewIds.length < 1 || !unique(receipt.evidenceViewIds)
      || receipt.evidenceViewIds.some((id) => !viewIds.has(id))) {
      blockers.push(`invalid unknown-resolution receipt: ${receipt?.unknownId ?? 'missing'}`);
    }
    receiptUnknowns.add(receipt?.unknownId);
  }

  const sourceViewCoverage = sourceViews.length === 0 ? 0 : coveredViews.size / sourceViews.length;
  if (sourceViewCoverage < 1) blockers.push(`visual plan covers ${coveredViews.size}/${sourceViews.length} source views`);
  const explicitEditUnitCoverage = expectedEditUnits === 0 ? 0 : plannedEditUnits / expectedEditUnits;
  if (explicitEditUnitCoverage < 1) warnings.push(`visual plan explicitly names ${plannedEditUnits}/${expectedEditUnits} required edit units`);
  return {
    pass: blockers.length === 0,
    fingerprint: fingerprintJson(plan),
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    sourceViewCoverage,
    explicitEditUnitCoverage,
  };
}

export function lockVisualPlan(plan: VisualPlanningContract): LockedVisualPlanningContract {
  const audit = auditVisualPlan(plan);
  if (!audit.pass) throw new Error(`Cannot lock invalid visual plan: ${audit.blockers.join('; ')}`);
  const copy = clonePlan(plan);
  return deepFreeze({ schema: 'morphloom.locked-visual-plan/0.1', fingerprint: fingerprintJson(copy), plan: copy });
}

export function auditVisualPlanRevision(
  baseline: LockedVisualPlanningContract,
  candidate: VisualPlanningContract,
): VisualPlanAudit {
  const audit = auditVisualPlan(candidate);
  const blockers = [...audit.blockers];
  if (baseline?.schema !== 'morphloom.locked-visual-plan/0.1' || baseline.fingerprint !== fingerprintJson(baseline.plan)) {
    blockers.push('locked visual-plan fingerprint mismatch');
  } else {
    const candidateViews = Array.isArray(candidate?.sourceViews) ? candidate.sourceViews : [];
    const candidateFeatures = Array.isArray(candidate?.features) ? candidate.features : [];
    const oldViews = new Map(baseline.plan.sourceViews.map((view) => [view.id, view]));
    const newViews = new Map(candidateViews.map((view) => [view.id, view]));
    for (const [id, view] of oldViews) {
      const revised = newViews.get(id);
      if (!revised) blockers.push(`visual-plan revision removed source evidence: ${id}`);
      else if (revised.fingerprint !== view.fingerprint || revised.kind !== view.kind) blockers.push(`visual-plan revision changed locked source evidence: ${id}`);
    }
    const oldFeatures = new Map(baseline.plan.features.map((feature) => [feature.id, feature]));
    const newFeatures = new Map(candidateFeatures.map((feature) => [feature.id, feature]));
    for (const [id, feature] of oldFeatures) {
      const revised = newFeatures.get(id);
      if (!revised) {
        blockers.push(`visual-plan revision removed feature: ${id}`);
        continue;
      }
      const oldObserved = Math.max(0, ...feature.observedCounts.map((item) => item.count));
      const newObserved = Math.max(0, ...revised.observedCounts.map((item) => item.count));
      if (revised.minimumCount < feature.minimumCount || newObserved < oldObserved) blockers.push(`visual-plan revision lowered feature count: ${id}`);
      if (feature.required && !revised.required) blockers.push(`visual-plan revision made a required feature optional: ${id}`);
      if (feature.separatelyEditable && !revised.separatelyEditable) blockers.push(`visual-plan revision removed editability: ${id}`);
      if (revised.componentIds.length < feature.componentIds.length) blockers.push(`visual-plan revision removed planned edit units: ${id}`);
    }
    const oldFloors = baseline.plan.qualityFloors;
    const newFloors = candidate?.qualityFloors;
    if (!newFloors) blockers.push('visual-plan revision removed locked quality floors');
    else if (newFloors.detailInventoryMinimum < oldFloors.detailInventoryMinimum
      || newFloors.minimumVisualScore < oldFloors.minimumVisualScore
      || (oldFloors.referencePbrRequiredWhenSourceImagePresent && !newFloors.referencePbrRequiredWhenSourceImagePresent)
      || (oldFloors.renderedPreviewRequired && !newFloors.renderedPreviewRequired)
      || (oldFloors.realExportRequired && !newFloors.realExportRequired)) {
      blockers.push('visual-plan revision lowered locked quality floors');
    }
    const resolutionReceipts = new Map((Array.isArray(candidate?.resolutionReceipts) ? candidate.resolutionReceipts : [])
      .map((receipt) => [receipt.unknownId, receipt]));
    const candidateUnknowns = Array.isArray(candidate?.openUnknownIds) ? candidate.openUnknownIds : [];
    for (const unknownId of baseline.plan.openUnknownIds) {
      if (!candidateUnknowns.includes(unknownId) && !resolutionReceipts.has(unknownId)) {
        blockers.push(`visual-plan revision erased unresolved evidence without a receipt: ${unknownId}`);
      }
    }
  }
  return { ...audit, pass: blockers.length === 0, blockers: [...new Set(blockers)] };
}
