import type { AssemblyIR, SurfaceFinishIR } from './assembly-ir';

export type AssetDomain = 'architecture' | 'product' | 'human' | 'unknown';

export interface ExpandedGenerationBrief {
  domain: AssetDomain;
  sourceRequest: string;
  agentPrompt: string;
  requiredChecks: string[];
}

export interface AssemblyDetailAudit {
  pass: boolean;
  blockers: string[];
  warnings: string[];
  evidenceCoverage: number;
  explicitSurfaceCoverage: number;
  microSurfaceCoverage: number;
  footprintVerified: boolean | undefined;
}

const MICRO_SURFACE_FINISHES = new Set<SurfaceFinishIR>([
  'brushed-metal', 'bead-blasted-metal', 'anodized-metal', 'polished-metal', 'machined-copper',
  'ceramic-glass', 'optical-glass', 'sapphire', 'pcb-soldermask', 'molded-polymer',
  'soft-touch-polymer', 'rubber', 'leather', 'wood', 'skin', 'fabric', 'hex-knit', 'hair',
  'semiconductor',
]);

export function inferAssetDomain(request: string): AssetDomain {
  const normalized = request.toLowerCase();
  if (/도면|평면도|입면도|건물|건축|아파트|원룸|floor\s*plan|building|architecture|cad/.test(normalized)) return 'architecture';
  if (/사람|인체|캐릭터|포즈|얼굴|코스튬|human|character|person|pose/.test(normalized)) return 'human';
  if (/제품|부품|전자|회로|핸드폰|스마트폰|칼|에셋|product|assembly|phone|device|asset/.test(normalized)) return 'product';
  return 'unknown';
}

const COMMON_CHECKS = [
  'evidence-provenance',
  'real-unit-envelope',
  'semantic-part-tree',
  'pbr-micro-surface',
  'watertight-topology',
  'reference-comparison',
];

export function expandGenerationBrief(request: string): ExpandedGenerationBrief {
  const sourceRequest = request.trim();
  if (!sourceRequest) throw new Error('Generation request cannot be empty.');
  const domain = inferAssetDomain(sourceRequest);
  const domainChecks = domain === 'architecture'
    ? ['drawing-orientation', 'footprint-voids', 'projection-and-entrance', 'room-and-opening-layout', 'two-point-measurement']
    : domain === 'product'
      ? ['multi-view-alignment', 'component-interfaces', 'fasteners-and-seams', 'connector-and-wire-continuity']
      : domain === 'human'
        ? ['anatomical-side-mapping', 'pose-landmarks', 'single-view-depth-disclosure', 'game-topology-and-rig-scope']
        : ['asset-domain-classification'];
  const requiredChecks = [...domainChecks, ...COMMON_CHECKS];
  const domainInstruction = domain === 'architecture'
    ? 'Treat the drawing outline, courtyards/voids, returns, projections, entrances, wall openings, and measured dimensions as first-class geometry. Never fill a visible void with a convenience slab.'
    : domain === 'product'
      ? 'Decompose the object into independently named manufacturable parts, interfaces, fasteners, seams, connectors, and conductors. Preserve electrical semantics when present.'
      : domain === 'human'
        ? 'Separate visible pose and silhouette evidence from inferred depth. Preserve anatomical left/right mapping, body proportions, garment layers, and material response.'
        : 'Classify the asset before choosing geometry, evidence, and validation rules.';

  return {
    domain,
    sourceRequest,
    requiredChecks,
    agentPrompt: [
      `User request: ${sourceRequest}`,
      domainInstruction,
      'Expand this short request into an editable Morphloom IR without asking the user to restate ordinary quality expectations.',
      'Use real units when evidence exists; mark every unsupported dimension or hidden surface as estimated or inferred.',
      'Assign a physical surface finish per material, including roughness, metalness, clearcoat/transmission/IOR where applicable, anisotropy for directional materials, and deterministic micro-normal/roughness detail.',
      `Before delivery, run these gates: ${requiredChecks.join(', ')}. A failed evidence, footprint, topology, or reference gate must stay visible and cannot be hidden behind triangle or part counts.`,
    ].join('\n'),
  };
}

export function auditAssemblyDetail(ir: AssemblyIR): AssemblyDetailAudit {
  const componentCount = ir.components.length;
  const ratio = (count: number) => componentCount === 0 ? 0 : count / componentCount;
  const evidenceCoverage = ratio(ir.components.filter((component) => component.evidence).length);
  const explicitSurfaceCoverage = ratio(ir.components.filter((component) => component.material.surface).length);
  const microSurfaceCoverage = ratio(ir.components.filter((component) => {
    const finish = component.material.surface;
    return (finish && MICRO_SURFACE_FINISHES.has(finish))
      || (component.material.microNormalStrength ?? 0) > 0;
  }).length);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const isArchitecture = ir.metadata?.assetKind === 'building';
  const footprintVerified = isArchitecture ? ir.metadata?.planFootprintVerified === true : undefined;

  if (evidenceCoverage < 1) blockers.push(`component evidence ${Math.round(evidenceCoverage * 100)}%`);
  if (explicitSurfaceCoverage < 0.9) warnings.push(`explicit surface finish ${Math.round(explicitSurfaceCoverage * 100)}%`);
  if (microSurfaceCoverage < 0.75) warnings.push(`micro-surface detail ${Math.round(microSurfaceCoverage * 100)}%`);

  if (isArchitecture) {
    if (!footprintVerified) blockers.push('plan footprint not verified');
    const courtyardVoids = Number(ir.metadata?.courtyardVoids ?? 0);
    if (courtyardVoids > 0) {
      const slabCount = ir.components.filter((component) => component.id.endsWith('_floor_slab')).length;
      if (slabCount < courtyardVoids + 2) blockers.push('courtyard voids are not preserved by segmented slabs');
    }
    if (ir.metadata?.planProjectionRelationship === 'side-wings-north-center-wing-south') {
      const connectorZ = ir.components.find((component) => component.id === 'south_connector_bar_floor_slab')?.position?.[2];
      const westWingZ = ir.components.find((component) => component.id === 'west_wing_floor_slab')?.position?.[2];
      const eastWingZ = ir.components.find((component) => component.id === 'east_wing_floor_slab')?.position?.[2];
      const centerWingZ = ir.components.find((component) => component.id === 'center_entry_wing_floor_slab')?.position?.[2];
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
    footprintVerified,
  };
}
