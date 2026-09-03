import type { AssemblyIR, AssemblyGeometryIR, EvidenceStatusIR } from './assembly-ir';

export type PartFeatureKind =
  | 'primary-mass'
  | 'thin-feature'
  | 'opening'
  | 'repeated-array'
  | 'articulation'
  | 'routed-element'
  | 'layered-stack'
  | 'surface-relief'
  | 'optical-stack'
  | 'fastener'
  | 'interface';

export type GeometryRequirement =
  | 'separate-part'
  | 'slender'
  | 'true-opening'
  | 'repeat-set'
  | 'articulated-parts'
  | 'routed-curve'
  | 'layered-parts'
  | 'physical-relief';

export interface PartFeatureContract {
  id: string;
  label: string;
  kind: PartFeatureKind;
  required: boolean;
  evidenceRef: string;
  evidenceStatus: EvidenceStatusIR;
  sourceViewIds: string[];
  componentIds: string[];
  minimumCount: number;
  geometryRequirement: GeometryRequirement;
  /** Independent silhouette/vision count receipts; used to catch an incomplete LLM inventory. */
  observedCounts?: Array<{ sourceViewId: string; count: number; method: 'silhouette-skeleton' | 'external-vision' }>;
  notes?: string[];
}

export interface PartRelationshipContract {
  id: string;
  fromFeatureId: string;
  toFeatureId: string;
  kind: 'attached-to' | 'nested-in' | 'hinges-to' | 'repeats-around' | 'passes-through' | 'layers-over' | 'mates-with';
  evidenceRef: string;
  required: boolean;
}

/**
 * Evidence-first inventory created before geometry. Unlike a fidelity contract
 * derived from the finished IR, this inventory can detect an omitted part.
 */
export interface PartDecompositionContract {
  schema: 'morphloom.part-decomposition/0.1';
  assetName: string;
  sourceViewIds: string[];
  features: PartFeatureContract[];
  relationships: PartRelationshipContract[];
}

export interface PartDecompositionAudit {
  pass: boolean;
  blockers: string[];
  warnings: string[];
  requiredFeatureCoverage: number;
  sourceViewCoverage: number;
  mappedComponentCoverage: number;
  thinFeatureCount: number;
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MAX_FEATURES = 2048;
const MAX_RELATIONSHIPS = 4096;
const MAX_TEXT = 500;
const FEATURE_KINDS = new Set<PartFeatureKind>([
  'primary-mass', 'thin-feature', 'opening', 'repeated-array', 'articulation',
  'routed-element', 'layered-stack', 'surface-relief', 'optical-stack', 'fastener', 'interface',
]);
const REQUIREMENTS = new Set<GeometryRequirement>([
  'separate-part', 'slender', 'true-opening', 'repeat-set', 'articulated-parts',
  'routed-curve', 'layered-parts', 'physical-relief',
]);
const RELATION_KINDS = new Set<PartRelationshipContract['kind']>([
  'attached-to', 'nested-in', 'hinges-to', 'repeats-around', 'passes-through', 'layers-over', 'mates-with',
]);
const EVIDENCE_STATUSES = new Set<EvidenceStatusIR>(['measured', 'datasheet', 'estimated', 'inferred']);

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function intrinsicDimensions(geometry: AssemblyGeometryIR): [number, number, number] | undefined {
  if (geometry.op === 'roundedBox') return geometry.size;
  if (geometry.op === 'cylinder') {
    const diameter = Math.max(geometry.radiusTop, geometry.radiusBottom) * 2;
    return [diameter, geometry.depth, diameter];
  }
  if (geometry.op === 'sphere') return [geometry.radius * 2, geometry.radius * 2, geometry.radius * 2];
  if (geometry.op === 'torus') {
    const diameter = (geometry.radius + geometry.tube) * 2;
    return [diameter, geometry.tube * 2, diameter];
  }
  if (geometry.op === 'extrude') {
    if (geometry.points.length < 1) return undefined;
    const xs = geometry.points.map((point) => point[0]);
    const ys = geometry.points.map((point) => point[1]);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), geometry.depth];
  }
  if (geometry.op === 'lathe') {
    if (geometry.profile.length < 1) return undefined;
    const diameter = Math.max(...geometry.profile.map((point) => Math.abs(point[0]))) * 2;
    const ys = geometry.profile.map((point) => point[1]);
    return [diameter, Math.max(...ys) - Math.min(...ys), diameter];
  }
  if (geometry.op === 'tube') {
    if (geometry.points.length < 1) return undefined;
    const xs = geometry.points.map((point) => point[0]);
    const ys = geometry.points.map((point) => point[1]);
    const zs = geometry.points.map((point) => point[2]);
    const diameter = geometry.radius * 2;
    return [
      Math.max(diameter, Math.max(...xs) - Math.min(...xs)),
      Math.max(diameter, Math.max(...ys) - Math.min(...ys)),
      Math.max(diameter, Math.max(...zs) - Math.min(...zs)),
    ];
  }
  if (geometry.op === 'surfacePatch') return [geometry.size[0], geometry.baseThickness + geometry.macroAmplitude * 2, geometry.size[1]];
  if (geometry.op === 'hipRoof') return [geometry.width, geometry.rise + geometry.thickness, geometry.depth];
  if (geometry.op === 'bladeLoft') {
    if (geometry.sections.length < 1) return undefined;
    const widths = geometry.sections.map((section) => section[0]);
    const heights = geometry.sections.map((section) => section[1]);
    return [Math.max(...widths) - Math.min(...widths), Math.max(...heights) - Math.min(...heights), geometry.thickness];
  }
  return undefined;
}

function isSlender(geometry: AssemblyGeometryIR, scale: [number, number, number] | undefined): boolean {
  if (geometry.op === 'tube') return true;
  const dimensions = intrinsicDimensions(geometry);
  if (!dimensions) return false;
  const scaled = dimensions.map((value, index) => Math.abs(value * (scale?.[index] ?? 1))).filter(finitePositive);
  if (scaled.length !== 3) return false;
  return Math.max(...scaled) / Math.min(...scaled) >= 4;
}

function hasTrueOpening(geometry: AssemblyGeometryIR): boolean {
  return geometry.op === 'extrude'
    && ((geometry.holes?.length ?? 0) > 0 || (geometry.ovalHoles?.length ?? 0) > 0);
}

function hasPhysicalRelief(geometry: AssemblyGeometryIR): boolean {
  return geometry.op === 'surfacePatch'
    && (geometry.macroAmplitude > 0 || geometry.aggregateAmplitude > 0 || geometry.referenceRelief !== undefined);
}

export function auditPartDecomposition(
  contract: PartDecompositionContract,
  ir: AssemblyIR,
): PartDecompositionAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const components = new Map(ir.components.map((component) => [component.id, component]));
  const features = Array.isArray(contract.features) ? contract.features : [];
  const relationships = Array.isArray(contract.relationships) ? contract.relationships : [];
  const sourceViewIds = Array.isArray(contract.sourceViewIds) ? contract.sourceViewIds : [];

  if (contract.schema !== 'morphloom.part-decomposition/0.1') blockers.push('unsupported part decomposition schema');
  if (contract.assetName !== ir.name) blockers.push('part decomposition assetName does not match AssemblyIR');
  if (features.length < 1 || features.length > MAX_FEATURES) blockers.push(`part feature inventory requires 1–${MAX_FEATURES} entries`);
  if (relationships.length > MAX_RELATIONSHIPS) blockers.push('part relationship inventory is too large');
  if (sourceViewIds.length < 1 || sourceViewIds.length > 24 || sourceViewIds.some((id) => !ID.test(id))) {
    blockers.push('part decomposition source views are invalid');
  }
  if (new Set(sourceViewIds).size !== sourceViewIds.length) blockers.push('part decomposition source views are duplicated');

  const featureIds = new Set<string>();
  const requiredFeatures = features.filter((feature) => feature.required);
  const satisfiedRequired = new Set<string>();
  const coveredViews = new Set<string>();
  const mappedComponents = new Set<string>();
  let thinFeatureCount = 0;

  for (const feature of features) {
    if (!ID.test(feature.id) || featureIds.has(feature.id)) blockers.push(`invalid or duplicate part feature id: ${feature.id}`);
    featureIds.add(feature.id);
    if (!feature.label?.trim() || feature.label.length > 160 || !feature.evidenceRef?.trim() || feature.evidenceRef.length > MAX_TEXT) {
      blockers.push(`invalid part feature metadata: ${feature.id}`);
    }
    if (typeof feature.required !== 'boolean' || !FEATURE_KINDS.has(feature.kind) || !REQUIREMENTS.has(feature.geometryRequirement)
      || !EVIDENCE_STATUSES.has(feature.evidenceStatus)) blockers.push(`invalid part feature classification: ${feature.id}`);
    if (feature.notes !== undefined && (!Array.isArray(feature.notes) || feature.notes.length > 16
      || feature.notes.some((note) => typeof note !== 'string' || !note.trim() || note.length > MAX_TEXT))) {
      blockers.push(`part feature notes are invalid: ${feature.id}`);
    }
    if (!Number.isInteger(feature.minimumCount) || feature.minimumCount < 1 || feature.minimumCount > 512) {
      blockers.push(`invalid part feature count: ${feature.id}`);
    }
    if (feature.observedCounts !== undefined) {
      if (!Array.isArray(feature.observedCounts) || feature.observedCounts.length < 1 || feature.observedCounts.length > 24
        || feature.observedCounts.some((observation) => !feature.sourceViewIds.includes(observation.sourceViewId)
          || !Number.isInteger(observation.count) || observation.count < 0 || observation.count > 512
          || !['silhouette-skeleton', 'external-vision'].includes(observation.method))) {
        blockers.push(`part feature has invalid observed counts: ${feature.id}`);
      } else {
        if (new Set(feature.observedCounts.map((observation) => observation.sourceViewId)).size !== feature.observedCounts.length) {
          blockers.push(`part feature repeats observed-count views: ${feature.id}`);
        }
        const strongestObservedCount = Math.max(...feature.observedCounts.map((observation) => observation.count));
        if (feature.required && strongestObservedCount > feature.minimumCount) {
          blockers.push(`part feature inventory undercounts observed evidence: ${feature.id} (${feature.minimumCount}/${strongestObservedCount})`);
        }
      }
    }
    if (!Array.isArray(feature.sourceViewIds) || feature.sourceViewIds.length < 1 || feature.sourceViewIds.length > 24
      || feature.sourceViewIds.some((id) => !sourceViewIds.includes(id))) blockers.push(`part feature has invalid source views: ${feature.id}`);
    else feature.sourceViewIds.forEach((id) => coveredViews.add(id));
    if (!Array.isArray(feature.componentIds) || feature.componentIds.length > 512) {
      blockers.push(`part feature component mapping is invalid: ${feature.id}`);
      continue;
    }
    const uniqueComponentIds = [...new Set(feature.componentIds)];
    if (uniqueComponentIds.length !== feature.componentIds.length) blockers.push(`part feature repeats a component mapping: ${feature.id}`);
    const mapped = uniqueComponentIds.map((id) => components.get(id)).filter((component) => component !== undefined);
    const missing = uniqueComponentIds.filter((id) => !components.has(id));
    if (missing.length > 0) blockers.push(`part feature maps missing components: ${feature.id} (${missing.join(', ')})`);
    uniqueComponentIds.forEach((id) => mappedComponents.add(id));

    let geometryPass = mapped.length >= feature.minimumCount;
    if (feature.geometryRequirement === 'slender') geometryPass &&= mapped.filter((component) => isSlender(component.geometry, component.scale)).length >= feature.minimumCount;
    if (feature.geometryRequirement === 'true-opening') geometryPass &&= mapped.some((component) => hasTrueOpening(component.geometry));
    if (feature.geometryRequirement === 'routed-curve') geometryPass &&= mapped.filter((component) => component.geometry.op === 'tube').length >= feature.minimumCount;
    if (feature.geometryRequirement === 'physical-relief') geometryPass &&= mapped.some((component) => hasPhysicalRelief(component.geometry));
    if (feature.geometryRequirement === 'repeat-set' || feature.geometryRequirement === 'layered-parts'
      || feature.geometryRequirement === 'articulated-parts') geometryPass &&= new Set(mapped.map((component) => component.id)).size >= Math.max(2, feature.minimumCount);
    if (feature.geometryRequirement === 'separate-part') geometryPass &&= new Set(mapped.map((component) => component.id)).size >= feature.minimumCount;
    if (feature.required && !geometryPass) blockers.push(`required part feature is not realized: ${feature.id}`);
    else if (feature.required) satisfiedRequired.add(feature.id);
    else if (!geometryPass) warnings.push(`optional part feature is unresolved: ${feature.id}`);
    if (feature.kind === 'thin-feature') thinFeatureCount += mapped.filter((component) => isSlender(component.geometry, component.scale)).length;
  }

  const relationshipIds = new Set<string>();
  const relationFeatures = new Set<string>();
  for (const relationship of relationships) {
    if (!ID.test(relationship.id) || relationshipIds.has(relationship.id)) blockers.push(`invalid or duplicate part relationship id: ${relationship.id}`);
    relationshipIds.add(relationship.id);
    if (!featureIds.has(relationship.fromFeatureId) || !featureIds.has(relationship.toFeatureId)
      || relationship.fromFeatureId === relationship.toFeatureId || !RELATION_KINDS.has(relationship.kind)
      || typeof relationship.required !== 'boolean' || !relationship.evidenceRef?.trim() || relationship.evidenceRef.length > MAX_TEXT) {
      blockers.push(`invalid part relationship: ${relationship.id}`);
    } else {
      relationFeatures.add(relationship.fromFeatureId);
      relationFeatures.add(relationship.toFeatureId);
    }
  }
  for (const feature of features) {
    if ((feature.geometryRequirement === 'articulated-parts' || feature.kind === 'interface')
      && feature.required && !relationFeatures.has(feature.id)) blockers.push(`required part relationship is missing: ${feature.id}`);
  }

  const sourceViewCoverage = sourceViewIds.length === 0 ? 0 : coveredViews.size / sourceViewIds.length;
  if (sourceViewCoverage < 1) blockers.push(`part inventory covers ${coveredViews.size}/${sourceViewIds.length} source views`);
  const requiredFeatureCoverage = requiredFeatures.length === 0 ? 0 : satisfiedRequired.size / requiredFeatures.length;
  const mappedComponentCoverage = components.size === 0 ? 0 : mappedComponents.size / components.size;
  if (components.size > 0 && mappedComponentCoverage < 1) warnings.push(`part inventory maps ${mappedComponents.size}/${components.size} components`);

  return {
    pass: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    requiredFeatureCoverage,
    sourceViewCoverage,
    mappedComponentCoverage,
    thinFeatureCount,
  };
}
