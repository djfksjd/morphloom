import type { AssemblyIR, SurfaceFinishIR } from './assembly-ir';
import type { SemiProfessionalProfile, SemiProfessionalReadinessReport } from './evidence-readiness';

export type AssetDomain = 'architecture' | 'product' | 'human' | 'unknown';
export type ReviewMode = 'source-camera' | 'orthographic' | 'clay' | 'grazing-light' | 'wire' | 'x-ray';

export interface ExpandedGenerationBrief {
  domain: AssetDomain;
  domains: AssetDomain[];
  sourceRequest: string;
  agentPrompt: string;
  requiredChecks: string[];
  reviewModes: ReviewMode[];
  evidenceProfile: SemiProfessionalProfile;
  evidenceStatus: 'not-assessed' | 'blocked' | 'build-ready' | 'delivery-ready';
  targetQuality: 'semi-professional-editable';
  completionPolicy: 'all-evidence-supported-blockers-pass';
}

export interface AssemblyDetailAudit {
  pass: boolean;
  blockers: string[];
  warnings: string[];
  evidenceCoverage: number;
  explicitSurfaceCoverage: number;
  microSurfaceCoverage: number;
  semanticDetailCoverage: number;
  finiteTransformCoverage: number;
  duplicateComponentIds: string[];
  footprintVerified: boolean | undefined;
}

const MICRO_SURFACE_FINISHES = new Set<SurfaceFinishIR>([
  'brushed-metal', 'bead-blasted-metal', 'anodized-metal', 'polished-metal', 'machined-copper',
  'ceramic-glass', 'optical-glass', 'sapphire', 'pcb-soldermask', 'molded-polymer',
  'soft-touch-polymer', 'rubber', 'leather', 'wood', 'skin', 'fabric', 'hex-knit', 'hair',
  'semiconductor',
]);

export function inferAssetDomain(request: string): AssetDomain {
  return inferAssetDomains(request)[0] ?? 'unknown';
}

export function inferAssetDomains(request: string): AssetDomain[] {
  const normalized = request.toLowerCase();
  const domains: AssetDomain[] = [];
  if (/도면|평면도|입면도|건물|건축|아파트|원룸|floor\s*plan|building|architecture|cad/.test(normalized)) domains.push('architecture');
  if (/사람|인체|캐릭터|포즈|얼굴|코스튬|human|character|person|pose/.test(normalized)) domains.push('human');
  if (/제품|부품|전자|회로|핸드폰|스마트폰|칼|에셋|product|assembly|phone|device|asset/.test(normalized)) domains.push('product');
  return domains.length > 0 ? domains : ['unknown'];
}

const COMMON_CHECKS = [
  'evidence-provenance',
  'signature-feature-manifest',
  'visible-feature-ledger',
  'spatial-relationship-constraints',
  'intended-use-detail-threshold',
  'real-unit-envelope',
  'semantic-part-tree',
  'pbr-micro-surface',
  'watertight-topology',
  'reference-comparison',
  'camera-calibration',
  'multi-mode-review',
  'export-reopen-parity',
  'autonomous-refinement-loop',
];

const REVIEW_MODES: ReviewMode[] = [
  'source-camera', 'orthographic', 'clay', 'grazing-light', 'wire', 'x-ray',
];

function inferEvidenceProfile(request: string, domain: AssetDomain): SemiProfessionalProfile {
  if (domain === 'architecture') return 'architectural-review';
  if (domain === 'human') return 'game-character';
  return /분해|부품|수리|정비|내부|회로|service|repair|teardown|assembly/.test(request.toLowerCase())
    ? 'service-assembly'
    : 'product-visualization';
}

function evidenceStatus(readiness?: SemiProfessionalReadinessReport): ExpandedGenerationBrief['evidenceStatus'] {
  if (!readiness) return 'not-assessed';
  if (readiness.deliveryReady) return 'delivery-ready';
  if (readiness.buildReady) return 'build-ready';
  return 'blocked';
}

export function expandGenerationBrief(
  request: string,
  readiness?: SemiProfessionalReadinessReport,
): ExpandedGenerationBrief {
  const sourceRequest = request.trim();
  if (!sourceRequest) throw new Error('Generation request cannot be empty.');
  const domains = inferAssetDomains(sourceRequest);
  const domain = domains[0];
  const evidenceProfile = inferEvidenceProfile(sourceRequest, domain);
  const profileMismatch = readiness !== undefined && readiness.profile !== evidenceProfile;
  const checksByDomain: Record<AssetDomain, string[]> = {
    architecture: ['drawing-orientation', 'footprint-voids', 'projection-and-entrance', 'opening-and-circulation-schedule', 'vertical-evidence-boundary', 'two-point-measurement'],
    product: ['multi-view-alignment', 'exterior-side-completeness', 'manufacturing-datums', 'edge-highlight-continuity', 'component-interfaces', 'fasteners-and-seams', 'connector-pin-and-wire-continuity'],
    human: ['style-mode', 'anatomical-side-mapping', 'pose-landmarks', 'anatomical-sanity', 'face-hand-foot-closeups', 'garment-layer-intersections', 'single-view-depth-disclosure', 'game-topology-and-rig-scope'],
    unknown: ['asset-domain-classification'],
  };
  const requiredChecks = [...new Set([...domains.flatMap((item) => checksByDomain[item]), ...COMMON_CHECKS])];
  const instructionsByDomain: Record<AssetDomain, string> = {
    architecture: 'Treat the drawing outline, courtyards/voids, returns, projections, entrances, wall openings, circulation, and measured dimensions as first-class geometry. Never fill a visible void with a convenience slab.',
    product: 'Decompose the object into independently named manufacturable parts, interfaces, fasteners, seams, optical stacks, connectors, and conductors. Preserve electrical semantics when present.',
    human: 'Separate visible pose and silhouette evidence from inferred depth. Preserve style intent, anatomical left/right mapping, body proportions, face/hands/feet, garment layers, and material response.',
    unknown: 'Classify the asset before choosing geometry, evidence, and validation rules.',
  };
  const domainInstruction = domains.map((item) => instructionsByDomain[item]).join(' ');
  const readinessInstruction = !readiness
    ? `Build a ${evidenceProfile} Evidence Pack 0.2 first. Do not interpret one image or an arbitrary photo count as the target; technical drawings, datasheets, measurements, scans, and photographs may satisfy the same resolved-view and property requirements.`
    : profileMismatch
      ? `BLOCKED: the evidence profile is ${readiness.profile}, but the request requires ${evidenceProfile}. Reclassify the evidence before geometry.`
      : readiness.deliveryReady
        ? `Evidence Pack is delivery-ready (${readiness.score}/100). Lock it and continue with compiled-asset gates.`
        : readiness.buildReady
          ? `Evidence Pack is build-ready but not delivery-ready (${readiness.score}/100). Compile only a review draft and resolve: ${readiness.nextActions.join('; ')}.`
          : `BLOCKED before geometry (${readiness.score}/100): ${readiness.blockers.join('; ')}. Request or recover only the listed missing evidence.`;

  return {
    domain,
    domains,
    sourceRequest,
    requiredChecks,
    reviewModes: [...REVIEW_MODES],
    evidenceProfile,
    evidenceStatus: profileMismatch ? 'blocked' : evidenceStatus(readiness),
    targetQuality: 'semi-professional-editable',
    completionPolicy: 'all-evidence-supported-blockers-pass',
    agentPrompt: [
      `User request: ${sourceRequest}`,
      domainInstruction,
      'The target is a semi-professional editable asset with minimal review, not a one-photo generation demo and not manufacturing/as-built certification.',
      readinessInstruction,
      'Expand the request into an editable Morphloom IR without asking the user to restate ordinary quality expectations.',
      'Before geometry, derive an internal completion contract: intended use, evidence map, signature-feature ids, negative spaces, spatial relationships, physical material zones, editable/function boundaries, and the proof view for every important feature.',
      'Use real units when evidence exists; mark every unsupported dimension or hidden surface as estimated or inferred.',
      'Persist the Evidence Pack profile, score, buildReady/deliveryReady state, and unresolved capabilities in AssemblyIR metadata so the compiled quality gate cannot lose the evidence decision.',
      'Assign a physical surface finish per material, including roughness, metalness, clearcoat/transmission/IOR where applicable, anisotropy for directional materials, and deterministic micro-normal/roughness detail.',
      `Render and inspect these review modes as needed: ${REVIEW_MODES.join(', ')}. Always compare the source camera first; use the diagnostic views to expose form, surface, topology, and hidden relationships.`,
      `Before delivery, run these gates: ${requiredChecks.join(', ')}. Treat the first compiling draft as a checkpoint. Correct the highest-impact failed gate in the IR, rebuild, and repeat until every evidence-supported blocker passes.`,
      'Never hide a failed evidence, silhouette, relationship, topology, or reference gate behind camera choice, attractive materials, triangle count, or part count. If missing evidence is the only remaining blocker, keep the readiness claim limited and name the exact missing evidence instead of inventing detail.',
    ].join('\n'),
  };
}

export function auditAssemblyDetail(ir: AssemblyIR): AssemblyDetailAudit {
  const componentCount = ir.components.length;
  const ratio = (count: number) => componentCount === 0 ? 0 : count / componentCount;
  let evidencedComponents = 0;
  let surfacedComponents = 0;
  let microSurfacedComponents = 0;
  let semanticDetailComponents = 0;
  let finiteTransformComponents = 0;
  const componentById = new Map<string, AssemblyIR['components'][number]>();
  const duplicateComponentIds: string[] = [];
  const finiteVector = (value: number[] | undefined): boolean => value === undefined || value.every(Number.isFinite);
  for (const component of ir.components) {
    if (component.evidence) evidencedComponents += 1;
    const finish = component.material.surface;
    if (finish) surfacedComponents += 1;
    if ((finish && MICRO_SURFACE_FINISHES.has(finish)) || (component.material.microNormalStrength ?? 0) > 0) {
      microSurfacedComponents += 1;
    }
    if (component.detail.trim().length > 0) semanticDetailComponents += 1;
    if (finiteVector(component.position) && finiteVector(component.rotation) && finiteVector(component.scale)) {
      finiteTransformComponents += 1;
    }
    if (componentById.has(component.id)) duplicateComponentIds.push(component.id);
    else componentById.set(component.id, component);
  }
  const evidenceCoverage = ratio(evidencedComponents);
  const explicitSurfaceCoverage = ratio(surfacedComponents);
  const microSurfaceCoverage = ratio(microSurfacedComponents);
  const semanticDetailCoverage = ratio(semanticDetailComponents);
  const finiteTransformCoverage = ratio(finiteTransformComponents);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const isArchitecture = ir.metadata?.assetKind === 'building';
  const targetsSemiProfessional = ir.metadata?.qualityTarget === 'semi-professional-editable';
  const footprintVerified = isArchitecture ? ir.metadata?.planFootprintVerified === true : undefined;

  if (evidenceCoverage < 1) blockers.push(`component evidence ${Math.round(evidenceCoverage * 100)}%`);
  if (duplicateComponentIds.length > 0) blockers.push(`duplicate component ids: ${[...new Set(duplicateComponentIds)].join(', ')}`);
  if (finiteTransformCoverage < 1) blockers.push(`finite transforms ${Math.round(finiteTransformCoverage * 100)}%`);
  if (explicitSurfaceCoverage < 0.9) warnings.push(`explicit surface finish ${Math.round(explicitSurfaceCoverage * 100)}%`);
  if (microSurfaceCoverage < 0.75) warnings.push(`micro-surface detail ${Math.round(microSurfaceCoverage * 100)}%`);
  if (semanticDetailCoverage < 1) warnings.push(`semantic component detail ${Math.round(semanticDetailCoverage * 100)}%`);
  if (targetsSemiProfessional && ir.metadata?.evidenceDeliveryReady !== true) {
    const unresolved = String(ir.metadata?.evidenceUnresolvedCapabilities ?? '').trim();
    blockers.push(`evidence pack not delivery-ready${unresolved ? `: ${unresolved}` : ''}`);
  }

  if (isArchitecture) {
    if (!footprintVerified) blockers.push('plan footprint not verified');
    const courtyardVoids = Number(ir.metadata?.courtyardVoids ?? 0);
    if (courtyardVoids > 0) {
      const slabCount = ir.components.filter((component) => component.id.endsWith('_floor_slab')).length;
      if (slabCount < courtyardVoids + 2) blockers.push('courtyard voids are not preserved by segmented slabs');
    }
    if (ir.metadata?.planProjectionRelationship === 'side-wings-north-center-wing-south') {
      const connectorZ = componentById.get('south_connector_bar_floor_slab')?.position?.[2];
      const westWingZ = componentById.get('west_wing_floor_slab')?.position?.[2];
      const eastWingZ = componentById.get('east_wing_floor_slab')?.position?.[2];
      const centerWingZ = componentById.get('center_entry_wing_floor_slab')?.position?.[2];
      if (connectorZ === undefined || westWingZ === undefined || eastWingZ === undefined || centerWingZ === undefined
        || westWingZ <= connectorZ || eastWingZ <= connectorZ || centerWingZ >= connectorZ) {
        blockers.push('side wings and center wing are not on opposite facades');
      }
    }
    const entranceProjection = Number(ir.metadata?.planScaledEntranceProjectionMm ?? 0);
    if (entranceProjection > 0 && !ir.components.some((component) => component.id.startsWith('entrance_'))) {
      blockers.push('projecting entrance has no named geometry');
    }
  }

  return {
    pass: blockers.length === 0,
    blockers,
    warnings,
    evidenceCoverage,
    explicitSurfaceCoverage,
    microSurfaceCoverage,
    semanticDetailCoverage,
    finiteTransformCoverage,
    duplicateComponentIds: [...new Set(duplicateComponentIds)],
    footprintVerified,
  };
}
