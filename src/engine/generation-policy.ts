import type { AssemblyIR, SurfaceFinishIR } from './assembly-ir';
import type { SemiProfessionalProfile, SemiProfessionalReadinessReport } from './evidence-readiness';
import { auditFidelityContract } from './fidelity-pipeline';
import { auditPartDecomposition } from './part-decomposition';
import { auditVisualPlan } from './visual-plan-audit';

export type AssetDomain =
  | 'architecture'
  | 'product'
  | 'electronics'
  | 'human'
  | 'animation'
  | 'game'
  | '3d-print'
  | 'surface'
  | 'unknown';
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
  modelPass: boolean;
  modelBlockers: string[];
  blockers: string[];
  warnings: string[];
  evidenceCoverage: number;
  explicitSurfaceCoverage: number;
  microSurfaceCoverage: number;
  semanticDetailCoverage: number;
  finiteTransformCoverage: number;
  duplicateComponentIds: string[];
  footprintVerified: boolean | undefined;
  fidelityContractPass: boolean | undefined;
  fidelityBlockers: string[];
  fidelityWarnings: string[];
  partDecompositionPass: boolean | undefined;
  partRequiredFeatureCoverage: number | undefined;
  partSourceViewCoverage: number | undefined;
  partMappedComponentCoverage: number | undefined;
  partDecompositionBlockers: string[];
  partDecompositionWarnings: string[];
  visualPlanPass: boolean | undefined;
  visualPlanBlockers: string[];
  visualPlanWarnings: string[];
}

const MICRO_SURFACE_FINISHES = new Set<SurfaceFinishIR>([
  'concrete', 'asphalt', 'plaster', 'stone', 'coated-metal',
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
  if (/전자|회로|pcb|전선|배선|커넥터|단자|센서|electronic|circuit|wiring|wire|connector|terminal/.test(normalized)) domains.push('electronics');
  if (/제품|부품|핸드폰|스마트폰|칼|product|assembly|phone|device|industrial\s*design/.test(normalized)) domains.push('product');
  if (/애니메이션|리깅|스켈레톤|스킨\s*웨이트|모프|animation|rig(?:ging)?|skeleton|skin\s*weight|morph\s*target/.test(normalized)) domains.push('animation');
  if (/게임|유니티|언리얼|고도|lod|충돌체|콜라이더|game|unity|unreal|godot|collision|collider/.test(normalized)) domains.push('game');
  if (/3d\s*프린|삼디\s*프린|적층|슬라이서|출력물|3d\s*print|additive|slicer/.test(normalized)) domains.push('3d-print');
  if (/표면|질감|재질|거칠|울퉁불퉁|아스팔트|직물|가죽|옷|주름|surface|texture|material|rough|asphalt|fabric|leather|cloth|wrinkle/.test(normalized)) domains.push('surface');
  return domains.length > 0 ? domains : ['unknown'];
}

const COMMON_CHECKS = [
  'evidence-provenance',
  'signature-feature-manifest',
  'visible-feature-ledger',
  'strict-detail-inventory',
  'locked-fidelity-passes',
  'per-feature-acceptance',
  'spatial-relationship-constraints',
  'intended-use-detail-threshold',
  'real-unit-envelope',
  'semantic-part-tree',
  'pbr-micro-surface',
  'watertight-topology',
  'reference-comparison',
  'interior-reference-difference',
  'foreground-normalized-interior-bands',
  'deterministic-material-region-comparison',
  'multi-view-visual-hull-when-supported',
  'camera-calibration',
  'camera-anchor-reprojection',
  'perspective-camera-positive-depth',
  'sparse-structure-silhouette-proof',
  'multi-mode-review',
  'export-reopen-parity',
  'autonomous-refinement-loop',
  'bounded-cost-stop-policy',
  'attachment-integrity',
  'same-input-determinism',
  'exact-delivery-byte-validation',
  'fail-closed-multi-view-proof',
];

const REVIEW_MODES: ReviewMode[] = [
  'source-camera', 'orthographic', 'clay', 'grazing-light', 'wire', 'x-ray',
];

function inferEvidenceProfile(request: string, domain: AssetDomain): SemiProfessionalProfile {
  if (domain === 'architecture') return 'architectural-review';
  if (domain === 'human' || /게임|애니메이션|리깅|캐릭터|game|animation|rig|character/.test(request.toLowerCase())) return 'game-character';
  return /분해|부품|수리|정비|내부|회로|전자|전선|배선|service|repair|teardown|assembly|circuit|wiring/.test(request.toLowerCase())
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
    architecture: ['drawing-orientation', 'footprint-voids', 'projection-and-entrance', 'opening-and-circulation-schedule', 'vertical-evidence-boundary', 'two-point-measurement', 'reference-pbr-provenance'],
    product: ['multi-view-alignment', 'exterior-side-completeness', 'unobserved-surface-material-continuity', 'manufacturing-datums', 'edge-highlight-continuity', 'component-interfaces', 'fasteners-and-seams', 'connector-pin-and-wire-continuity', 'reference-pbr-provenance'],
    electronics: ['identified-bom', 'explicit-netlist', 'terminal-map', 'connector-mating', 'wire-route-continuity', 'clearance-and-interference', 'bench-evidence-boundary'],
    human: ['style-mode', 'anatomical-side-mapping', 'pose-landmarks', 'anatomical-sanity', 'face-hand-foot-closeups', 'garment-layer-intersections', 'single-view-depth-disclosure', 'game-topology-and-rig-scope', 'reference-pbr-provenance'],
    animation: ['rig-hierarchy', 'normalized-skin-weights', 'bind-pose-error', 'deformation-sampling', 'facial-controls', 'semantic-clip-coverage', 'loop-and-root-motion'],
    game: ['runtime-triangle-budget', 'skinned-lod-preservation', 'collision-semantics', 'material-and-texture-budget', 'runtime-animation-bindings', 'target-engine-import'],
    '3d-print': ['millimetre-units', 'watertight-manifold', 'positive-volume', 'minimum-wall-thickness', 'minimum-feature-size', 'overhang-analysis', 'slicer-reopen'],
    surface: ['physical-texture-scale', 'macro-relief-geometry', 'multi-scale-microstructure', 'pbr-channel-separation', 'reference-pbr-provenance', 'irregularity-and-periodicity', 'grazing-light-response'],
    unknown: ['asset-domain-classification'],
  };
  const requiredChecks = [...new Set([...domains.flatMap((item) => checksByDomain[item]), ...COMMON_CHECKS])];
  const instructionsByDomain: Record<AssetDomain, string> = {
    architecture: 'Treat the drawing outline, courtyards/voids, returns, projections, entrances, wall openings, circulation, and measured dimensions as first-class geometry. Never fill a visible void with a convenience slab.',
    product: 'Decompose the object into independently named manufacturable parts, interfaces, fasteners, seams, optical stacks, connectors, and conductors. Preserve electrical semantics when present. Never mirror a one-view photograph onto an unseen face: synthesize only the bounded material character there, mark it estimated, and require front/rear/oblique continuity before delivery.',
    electronics: 'Compile an identified BOM, terminal-level netlist, connector mating map, and routed conductors with explicit 3D endpoints. A visually touching wire is not electrically verified; preserve bench-required boundaries.',
    human: 'Separate visible pose and silhouette evidence from inferred depth. Preserve style intent, anatomical left/right mapping, body proportions, face/hands/feet, garment layers, and material response.',
    animation: 'Build a named deforming skeleton, normalized weights, bind-pose and sampled-deformation proof, facial controls, and semantic clips. Validate bindings, motion, loop seams, and root-motion intent from delivered bytes.',
    game: 'Treat runtime budgets, skinned LOD silhouette preservation, collisions, material cost, animation bindings, and target-engine import as delivery gates rather than optional metadata.',
    '3d-print': 'Use explicit millimetre units and verify closed manifold topology, positive volume, minimum walls/features, supported detail scale, overhangs, and slicer reopenability. Do not equate a renderable shell with a printable solid.',
    surface: 'Recover physical-scale macro relief and separate base colour, normal/displacement, roughness, and directional response. Match fine, medium, and coarse structure plus natural irregularity under grazing light; do not bake all relief into colour.',
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
      'Before geometry, create and lock two independent contracts. First, an evidence-first Part Decomposition Contract listing every visible or documented primary mass, thin member, opening, repeated array, joint, routed element, layer, optical stack, fastener, and interface. Map each expected feature to its source views and evidence status before any component exists, so omitted parts cannot disappear from a geometry-derived score. Lock the visual plan fingerprint, source hashes, observed counts, explicit edit-unit IDs, unresolved evidence, minimum detail/visual thresholds, reference-PBR requirement, real-export requirement, and rendered-preview requirement. A retry may add evidence and detail but must never delete a source, bundle repeated parts behind one placeholder, disagree about counts, lower a quality floor, disable image-conditioned PBR, or erase an unknown without a new evidence receipt. Second, create the Fidelity Contract: intended use, calibrated source cameras, strict detail inventory, evidence map, signature-feature ids, negative spaces, spatial relationships, physical material zones, editable/function boundaries, and the proof view plus numeric acceptance threshold for every important feature.',
      'Use real units when evidence exists; mark every unsupported dimension or hidden surface as estimated or inferred.',
      'Persist the Evidence Pack profile, score, buildReady/deliveryReady state, and unresolved capabilities in AssemblyIR metadata so the compiled quality gate cannot lose the evidence decision.',
      'Assign a physical surface finish per material, including roughness, metalness, clearcoat/transmission/IOR where applicable, anisotropy for directional materials, and deterministic micro-normal/roughness detail.',
      `Render and inspect these review modes as needed: ${REVIEW_MODES.join(', ')}. Calibrate each orthographic source from at least four named 3D↔2D anchors and each perspective source from at least six non-coplanar anchors. Persist the actual anchor coordinates and evidence references, then require the engine to recompute projection parameters, positive projective depth, and pixel residuals; a planner-written anchor count or error number is not a receipt. Do not independently fit the reference and render foregrounds for a release proof. Compare that locked view first, and use foreground-normalized top/middle/bottom interior evidence only as a secondary diagnostic rather than judging an attractive free camera. Compare each material region for base colour, luminance, microstructure, and directional response. When at least two compatible orthographic silhouettes exist, carve a bounded welded visual hull before detail work; report unconstrained axes and never invent silhouette-invisible concavities. Reproject the result into every supplied silhouette. Dense objects require whole-area IoU per view; sparse assemblies require both a primary-mass IoU and a distance-aware thin-member score per view so a one-pixel shift cannot erase a correct rod and a line score cannot hide a missing body. For repeated rods, cables, legs, antennae, or other terminal-bearing members, associate unordered 2D endpoints across the locked views, solve their 3D orthographic coordinates, and retain the edit only when the worst required margin, a strict Pareto frontier, or the bounded sparse hybrid objective improves without a material per-gate regression. Keep body/head fitting separate from terminal fitting, record every candidate and rollback, and fail closed on underconstrained azimuths or excessive reprojection residual. When an independently licensed reference mesh exists, compare deterministic area-weighted surface samples with a symmetric distance audit. Search only a bounded yaw set, keep raw aligned axis dimensions as a separate blocking gate, and report RMS Chamfer, bidirectional P95 distance, and bidirectional coverage; similarity alignment cannot erase a size failure. Record false-positive/negative fractions and block every failed view even when the mesh is watertight. For evidence-supported organic blends and recesses, use a bounded editable implicitSurface graph rather than overlapping primitive shells; require padded bounds, triangle budget, and manifold Surface Nets output after no more than four deterministic resolution refinements. Use diagnostic views to expose form, surface, topology, attachments, and hidden relationships.`,
      'Use the locked pass order blockout → structure → form → material → surface → lighting → interaction → optimization. A pass advances only when every relevant feature clears its own threshold and every hard gate passes; an average score cannot hide a missing critical feature.',
      `Before delivery, run these gates: ${requiredChecks.join(', ')}. Treat the first compiling draft as a checkpoint. Correct the highest-impact failed gate in the IR, rebuild, and repeat until every evidence-supported blocker passes. Revert a regressing correction, refine the specification when a defect survives twice, request evidence when progress plateaus, and stop at the declared iteration/token ceiling.`,
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
  const footprintVerified = isArchitecture
    ? ir.metadata?.planFootprintVerified === true && ir.planFootprint?.schema === 'morphloom.plan-footprint/0.1'
    : undefined;
  const fidelityAudit = ir.fidelity ? auditFidelityContract(ir.fidelity, ir) : undefined;
  const partDecompositionAudit = ir.partDecomposition ? auditPartDecomposition(ir.partDecomposition, ir) : undefined;
  const visualPlanAudit = ir.visualPlan ? auditVisualPlan(ir.visualPlan) : undefined;

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
  if (fidelityAudit && !fidelityAudit.pass) blockers.push(...fidelityAudit.blockers.map((item) => `fidelity: ${item}`));
  if (!ir.fidelity && (targetsSemiProfessional || ir.metadata?.fidelityContractRequired === true)) {
    blockers.push('locked fidelity contract is required');
  }
  if (partDecompositionAudit && !partDecompositionAudit.pass) {
    blockers.push(...partDecompositionAudit.blockers.map((item) => `part decomposition: ${item}`));
  }
  if (!ir.partDecomposition && (targetsSemiProfessional || ir.metadata?.partDecompositionRequired === true)) {
    blockers.push('evidence-first part decomposition contract is required');
  }
  if (visualPlanAudit && !visualPlanAudit.pass) {
    blockers.push(...visualPlanAudit.blockers.map((item) => `visual plan: ${item}`));
  }
  if (!ir.visualPlan && ir.metadata?.visualPlanRequired === true) blockers.push('locked visual planning contract is required');

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
    if (ir.metadata?.programCompleteness !== undefined) {
      const requiredPrograms = String(ir.metadata?.requiredPrograms ?? '')
        .split(',').map((item) => item.trim()).filter(Boolean);
      const searchable = ir.components.map((component) => `${component.id} ${component.name}`.toLowerCase()).join(' ');
      const programAliases: Record<string, RegExp> = {
        living: /living|거실/, dining: /dining|식당/, kitchen: /kitchen|주방/, garage: /garage|차고/,
        foyer: /foyer|entry|현관/, stair: /stair|계단/, 'powder-room': /powder|toilet|화장실/,
        multifunction: /multifunction|다목적/, bedrooms: /bedroom|primary_bed|침실/,
        'upper-bathroom': /upper_bath|shower|욕실/,
      };
      const missingPrograms = requiredPrograms.filter((program) => !(programAliases[program] ?? new RegExp(program, 'i')).test(searchable));
      if (missingPrograms.length > 0) blockers.push(`missing architectural programs: ${missingPrograms.join(', ')}`);
      if (!ir.components.some((component) => component.geometry.op === 'hipRoof')) blockers.push('roof system is not a continuous hip-roof solid');
      if (!ir.components.some((component) => /toilet|basin|vanity|shower/.test(component.id))) blockers.push('wet-room fixtures are missing');
      if (!ir.components.some((component) => /bed|sofa|table|chair/.test(component.id))) blockers.push('editable furniture layout is missing');
      if (!ir.components.some((component) => component.light)) blockers.push('physical lighting fixtures are missing');
    }
  }

  const modelBlockers = blockers.filter((blocker) => !blocker.startsWith('evidence pack not delivery-ready'));

  return {
    pass: blockers.length === 0,
    modelPass: modelBlockers.length === 0,
    modelBlockers,
    blockers,
    warnings,
    evidenceCoverage,
    explicitSurfaceCoverage,
    microSurfaceCoverage,
    semanticDetailCoverage,
    finiteTransformCoverage,
    duplicateComponentIds: [...new Set(duplicateComponentIds)],
    footprintVerified,
    fidelityContractPass: fidelityAudit?.pass,
    fidelityBlockers: fidelityAudit?.blockers ?? [],
    fidelityWarnings: fidelityAudit?.warnings ?? [],
    partDecompositionPass: partDecompositionAudit?.pass,
    partRequiredFeatureCoverage: partDecompositionAudit?.requiredFeatureCoverage,
    partSourceViewCoverage: partDecompositionAudit?.sourceViewCoverage,
    partMappedComponentCoverage: partDecompositionAudit?.mappedComponentCoverage,
    partDecompositionBlockers: partDecompositionAudit?.blockers ?? [],
    partDecompositionWarnings: partDecompositionAudit?.warnings ?? [],
    visualPlanPass: visualPlanAudit?.pass,
    visualPlanBlockers: visualPlanAudit?.blockers ?? [],
    visualPlanWarnings: visualPlanAudit?.warnings ?? [],
  };
}
