import type { AssemblyComponentIR, AssemblyIR, AssemblyMaterialIR } from './assembly-ir';

export interface CaseworkFurnitureSpec {
  name: string;
  widthMm: number;
  depthMm: number;
  bodyHeightMm: number;
  legHeightMm: number;
  drawerCount: number;
  source: string;
}

const walnut: AssemblyMaterialIR = {
  color: '#4f2d1b', surface: 'wood', roughness: 0.62, metalness: 0,
  clearcoat: 0.08, clearcoatRoughness: 0.58, microNormalStrength: 0.2, textureScale: [3, 12],
};
const accentWood: AssemblyMaterialIR = {
  ...walnut, color: '#694127', roughness: 0.58,
};
const darkWood: AssemblyMaterialIR = {
  ...walnut, color: '#3b2418', roughness: 0.66,
};
const rearBoard: AssemblyMaterialIR = {
  color: '#202020', surface: 'coated-metal', roughness: 0.76, metalness: 0.03,
  microNormalStrength: 0.12,
};
const brass: AssemblyMaterialIR = {
  color: '#8d7450', surface: 'brushed-metal', roughness: 0.31, metalness: 0.86,
  anisotropy: 0.64, anisotropyRotation: Math.PI / 2, microNormalStrength: 0.1,
};
const rubber: AssemblyMaterialIR = {
  color: '#151515', surface: 'rubber', roughness: 0.9, metalness: 0,
};
const legMetal: AssemblyMaterialIR = {
  color: '#403b31', surface: 'coated-metal', roughness: 0.58, metalness: 0.38,
  clearcoat: 0.06, clearcoatRoughness: 0.62, microNormalStrength: 0.08,
};

export function createCaseworkFurnitureIR(spec: CaseworkFurnitureSpec): AssemblyIR {
  if (![spec.widthMm, spec.depthMm, spec.bodyHeightMm, spec.legHeightMm].every(Number.isFinite)
    || spec.widthMm < 200 || spec.depthMm < 150 || spec.bodyHeightMm < 200 || spec.legHeightMm < 50
    || !Number.isInteger(spec.drawerCount) || spec.drawerCount < 1 || spec.drawerCount > 8) {
    throw new Error('Casework furniture dimensions or drawer count are outside safe bounds.');
  }
  const components: AssemblyComponentIR[] = [];
  const bodyBottom = spec.legHeightMm;
  const bodyCenter = bodyBottom + spec.bodyHeightMm / 2;
  const frontZ = -spec.depthMm / 2;
  const rearZ = spec.depthMm / 2;
  const sideThickness = 22;
  const topThickness = 38;
  const gap = 7;
  const drawerHeight = (spec.bodyHeightMm - topThickness - gap * (spec.drawerCount + 1)) / spec.drawerCount;
  const evidence = { status: 'estimated' as const, source: spec.source };
  const add = (component: AssemblyComponentIR) => components.push({ ...component, evidence });

  add({ id: 'top_slab', name: 'solid wood top slab', category: 'enclosure', materialName: 'reference walnut',
    detail: 'Rounded independent top with visible edge thickness.', geometry: { op: 'roundedBox', size: [spec.widthMm + 12, topThickness, spec.depthMm + 10], radius: 5, segments: 4 },
    position: [0, bodyBottom + spec.bodyHeightMm - topThickness / 2 + 5, 0], material: walnut });
  for (const side of [-1, 1] as const) add({ id: `side_panel_${side < 0 ? 'left' : 'right'}`, name: `${side < 0 ? 'left' : 'right'} carcass side panel`,
    category: 'enclosure', materialName: 'reference walnut', detail: 'Full-depth independently editable side panel.',
    geometry: { op: 'roundedBox', size: [sideThickness, spec.bodyHeightMm - topThickness, spec.depthMm], radius: 2.5, segments: 3 },
    position: [side * (spec.widthMm - sideThickness) / 2, bodyCenter - topThickness / 2, 0], material: walnut });
  add({ id: 'carcass_bottom', name: 'carcass bottom rail', category: 'mechanical', materialName: 'dark walnut',
    detail: 'Structural lower rail visible between the legs.', geometry: { op: 'roundedBox', size: [spec.widthMm - 34, 24, spec.depthMm - 30], radius: 2, segments: 3 },
    position: [0, bodyBottom + 15, 0], material: darkWood });
  add({ id: 'rear_panel', name: 'black inset rear panel with cable port', category: 'enclosure', materialName: 'black backing board',
    detail: 'Inset rear service panel with a real circular cable opening.', geometry: {
      op: 'extrude', points: [[-spec.widthMm / 2 + 22, -spec.bodyHeightMm / 2 + 22], [spec.widthMm / 2 - 22, -spec.bodyHeightMm / 2 + 22], [spec.widthMm / 2 - 22, spec.bodyHeightMm / 2 - 24], [-spec.widthMm / 2 + 22, spec.bodyHeightMm / 2 - 24]],
      ovalHoles: [{ center: [0, spec.bodyHeightMm * 0.23], radii: [14, 14], segments: 32 }], depth: 8, bevelSize: 0.8, bevelThickness: 0.8, bevelSegments: 1,
    }, position: [0, bodyCenter - 8, rearZ - 5], material: rearBoard });

  for (let drawer = 0; drawer < spec.drawerCount; drawer += 1) {
    const y = bodyBottom + gap + drawerHeight / 2 + drawer * (drawerHeight + gap);
    const index = spec.drawerCount - drawer;
    add({ id: `drawer_${index}_front`, name: `drawer ${index} chevron front`, category: 'mechanical', materialName: 'reference walnut',
      detail: 'Independent drawer front with layered chevron marquetry.', geometry: { op: 'roundedBox', size: [spec.widthMm - 54, drawerHeight, 24], radius: 2.4, segments: 3 },
      position: [0, y, frontZ - 2], material: accentWood });
    add({ id: `drawer_${index}_box`, name: `drawer ${index} storage box`, category: 'mechanical', materialName: 'dark walnut',
      detail: 'Editable drawer volume separated from its decorative face.', geometry: { op: 'roundedBox', size: [spec.widthMm - 82, drawerHeight - 30, spec.depthMm - 54], radius: 2, segments: 3 },
      position: [0, y, -2], material: darkWood });
    const stripY = y + (drawer % 2 === 0 ? 0 : 3);
    for (let strip = 0; strip < 5; strip += 1) {
      const x = (strip - 2) * (spec.widthMm - 86) / 5;
      const rotation = (strip % 2 === 0 ? 1 : -1) * Math.PI / 3.65;
      add({ id: `drawer_${index}_inlay_${strip + 1}`, name: `drawer ${index} chevron veneer ${strip + 1}`,
        category: 'mechanical', materialName: strip % 2 === 0 ? 'dark walnut veneer' : 'reference walnut veneer',
        detail: 'Raised sub-millimetre veneer strip preserves the photographed chevron direction at grazing angles.',
        geometry: { op: 'roundedBox', size: [drawerHeight * 0.74, Math.max(46, (spec.widthMm - 90) / 10), 0.4], radius: 0.1, segments: 3 },
        position: [x, stripY, frontZ - 14.25], rotation: [0, 0, rotation], material: strip % 2 === 0 ? darkWood : walnut });
    }
    add({ id: `drawer_${index}_handle`, name: `drawer ${index} brushed brass pull`, category: 'mechanical', materialName: 'brushed brass',
      detail: 'Independent rectangular pull with visible stand-off depth.', geometry: { op: 'roundedBox', size: [92, 24, 12], radius: 2.2, segments: 3 },
      position: [0, y + 6, frontZ - 29], material: brass });
    for (const side of [-1, 1] as const) add({ id: `drawer_${index}_handle_post_${side < 0 ? 'left' : 'right'}`,
      name: `drawer ${index} handle ${side < 0 ? 'left' : 'right'} post`, category: 'mechanical', materialName: 'brushed brass',
      detail: 'Mechanical pull stand-off retained as a separate edit unit.', geometry: { op: 'cylinder', radiusTop: 5, radiusBottom: 5, depth: 18, radialSegments: 20 },
      position: [side * 32, y + 6, frontZ - 20], rotation: [Math.PI / 2, 0, 0], material: brass });
  }

  for (const [id, x, z, rx, rz] of [
    ['front_left', -1, -1, -0.035, -0.045], ['front_right', 1, -1, -0.035, 0.045],
    ['rear_left', -1, 1, 0.035, -0.045], ['rear_right', 1, 1, 0.035, 0.045],
  ] as const) {
    add({ id: `leg_${id}`, name: `${id.replace('_', ' ')} tapered leg`, category: 'mechanical', materialName: 'dark bronze',
      detail: 'Independently editable outward-splayed tapered support.', geometry: { op: 'cylinder', radiusTop: 16, radiusBottom: 10, depth: spec.legHeightMm, radialSegments: 24 },
      position: [x * (spec.widthMm / 2 - 52), spec.legHeightMm / 2, z * (spec.depthMm / 2 - 47)], rotation: [rx, 0, rz], material: legMetal });
    add({ id: `foot_${id}`, name: `${id.replace('_', ' ')} rubber foot`, category: 'mechanical', materialName: 'black rubber',
      detail: 'Replaceable floor-contact cap.', geometry: { op: 'cylinder', radiusTop: 10.5, radiusBottom: 10.5, depth: 7, radialSegments: 24 },
      position: [x * (spec.widthMm / 2 - 52), 3.5, z * (spec.depthMm / 2 - 47)], material: rubber });
  }
  for (const [index, x, y] of [[1, -spec.widthMm * 0.44, spec.bodyHeightMm * 0.38], [2, 0, spec.bodyHeightMm * 0.38], [3, spec.widthMm * 0.44, spec.bodyHeightMm * 0.38], [4, -spec.widthMm * 0.44, -spec.bodyHeightMm * 0.38], [5, 0, -spec.bodyHeightMm * 0.38], [6, spec.widthMm * 0.44, -spec.bodyHeightMm * 0.38]] as const) {
    add({ id: `rear_fastener_${index}`, name: `rear panel fastener ${index}`, category: 'mechanical', materialName: 'black steel',
      detail: 'Visible rear panel screw head.', geometry: { op: 'cylinder', radiusTop: 2.8, radiusBottom: 2.8, depth: 1.6, radialSegments: 16 },
      position: [x, bodyCenter + y, rearZ + 0.2], rotation: [Math.PI / 2, 0, 0], material: rearBoard });
  }

  const sourceViewIds = ['front', 'right', 'rear', 'left'];
  const ir: AssemblyIR = {
    schema: 'morphloom.assembly/0.1', name: spec.name, units: 'mm', components,
    partDecomposition: {
      schema: 'morphloom.part-decomposition/0.1', assetName: spec.name, sourceViewIds,
      features: [
        { id: 'top', label: 'independent top slab', kind: 'primary-mass', required: true, evidenceRef: spec.source, evidenceStatus: 'estimated', sourceViewIds, componentIds: ['top_slab'], minimumCount: 1, geometryRequirement: 'separate-part' },
        { id: 'carcass', label: 'two side panels and bottom rail', kind: 'primary-mass', required: true, evidenceRef: spec.source, evidenceStatus: 'estimated', sourceViewIds, componentIds: ['side_panel_left', 'side_panel_right', 'carcass_bottom'], minimumCount: 3, geometryRequirement: 'separate-part' },
        { id: 'drawers', label: 'two editable drawer fronts and boxes', kind: 'layered-stack', required: true, evidenceRef: `${spec.source}:front`, evidenceStatus: 'estimated', sourceViewIds: ['front', 'right'], componentIds: ['drawer_1_front', 'drawer_1_box', 'drawer_2_front', 'drawer_2_box'], minimumCount: 4, geometryRequirement: 'layered-parts' },
        { id: 'chevron', label: 'ten flush chevron veneer strips', kind: 'layered-stack', required: true, evidenceRef: `${spec.source}:front`, evidenceStatus: 'estimated', sourceViewIds: ['front'], componentIds: Array.from({ length: 2 }, (_, drawer) => Array.from({ length: 5 }, (__, strip) => `drawer_${drawer + 1}_inlay_${strip + 1}`)).flat(), minimumCount: 10, geometryRequirement: 'layered-parts' },
        { id: 'handles', label: 'paired brass drawer pulls', kind: 'repeated-array', required: true, evidenceRef: `${spec.source}:front`, evidenceStatus: 'estimated', sourceViewIds: ['front'], componentIds: ['drawer_1_handle', 'drawer_2_handle'], minimumCount: 2, geometryRequirement: 'repeat-set', observedCounts: [{ sourceViewId: 'front', count: 2, method: 'external-vision' }] },
        { id: 'handle-posts', label: 'four handle stand-off posts', kind: 'interface', required: true, evidenceRef: `${spec.source}:front`, evidenceStatus: 'estimated', sourceViewIds: ['front', 'right'], componentIds: ['drawer_1_handle_post_left', 'drawer_1_handle_post_right', 'drawer_2_handle_post_left', 'drawer_2_handle_post_right'], minimumCount: 4, geometryRequirement: 'repeat-set' },
        { id: 'legs', label: 'four tapered legs', kind: 'repeated-array', required: true, evidenceRef: spec.source, evidenceStatus: 'estimated', sourceViewIds, componentIds: ['leg_front_left', 'leg_front_right', 'leg_rear_left', 'leg_rear_right'], minimumCount: 4, geometryRequirement: 'repeat-set', observedCounts: sourceViewIds.map((sourceViewId) => ({ sourceViewId, count: 4, method: 'external-vision' as const })) },
        { id: 'feet', label: 'four replaceable rubber feet', kind: 'repeated-array', required: true, evidenceRef: spec.source, evidenceStatus: 'estimated', sourceViewIds, componentIds: ['foot_front_left', 'foot_front_right', 'foot_rear_left', 'foot_rear_right'], minimumCount: 4, geometryRequirement: 'repeat-set' },
        { id: 'cable-port', label: 'rear circular cable opening', kind: 'opening', required: true, evidenceRef: `${spec.source}:rear`, evidenceStatus: 'estimated', sourceViewIds: ['rear', 'left'], componentIds: ['rear_panel'], minimumCount: 1, geometryRequirement: 'true-opening' },
        { id: 'rear-fasteners', label: 'six rear panel fasteners', kind: 'fastener', required: true, evidenceRef: `${spec.source}:rear`, evidenceStatus: 'estimated', sourceViewIds: ['rear'], componentIds: Array.from({ length: 6 }, (_, index) => `rear_fastener_${index + 1}`), minimumCount: 6, geometryRequirement: 'repeat-set', observedCounts: [{ sourceViewId: 'rear', count: 6, method: 'external-vision' }] },
      ],
      relationships: [
        { id: 'drawers-nested', fromFeatureId: 'drawers', toFeatureId: 'carcass', kind: 'nested-in', evidenceRef: `${spec.source}:front`, required: true },
        { id: 'veneer-over-drawers', fromFeatureId: 'chevron', toFeatureId: 'drawers', kind: 'layers-over', evidenceRef: `${spec.source}:front`, required: true },
        { id: 'handles-on-drawers', fromFeatureId: 'handles', toFeatureId: 'drawers', kind: 'attached-to', evidenceRef: `${spec.source}:front`, required: true },
        { id: 'posts-mate-handles', fromFeatureId: 'handle-posts', toFeatureId: 'handles', kind: 'mates-with', evidenceRef: `${spec.source}:front`, required: true },
        { id: 'legs-on-carcass', fromFeatureId: 'legs', toFeatureId: 'carcass', kind: 'attached-to', evidenceRef: spec.source, required: true },
        { id: 'feet-on-legs', fromFeatureId: 'feet', toFeatureId: 'legs', kind: 'attached-to', evidenceRef: spec.source, required: true },
        { id: 'fasteners-on-rear', fromFeatureId: 'rear-fasteners', toFeatureId: 'cable-port', kind: 'attached-to', evidenceRef: `${spec.source}:rear`, required: true },
      ],
    },
    metadata: {
      assetKind: 'product', qualityTarget: 'semi-professional-editable',
      evidenceDeliveryReady: false, evidenceUnresolvedCapabilities: 'measured physical dimensions and calibrated BRDF',
      benchmarkSource: 'locked-multiview-reference', furnitureSystem: 'casework-v1',
    },
  };
  return ir;
}
