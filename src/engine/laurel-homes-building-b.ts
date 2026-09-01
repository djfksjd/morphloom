import type {
  AssemblyComponentIR,
  AssemblyIR,
  AssemblyMaterialIR,
  ComponentEvidenceIR,
  EvidenceStatusIR,
} from './assembly-ir';

const SOURCE_PDF = 'https://tile.loc.gov/storage-services/master/pnp/habshaer/oh/oh1800/oh1847/data/oh1847data.pdf';

// HABS OH-2468-A documents Building B as 139 ft long and 46 ft 4 in deep.
// The first-floor sheet reads as a long residential connector with one large
// U-shaped recess between north-facing end wings. The measured 27 ft central
// entrance wing projects 17 ft 6 in from the opposite (south) facade.
const LENGTH_MM = 42_367.2;
const MAIN_DEPTH_MM = 14_122.4;
const MAIN_BAR_DEPTH_MM = 7_600;
const CENTER_WING_PROJECTION_MM = 5_334;
const CENTER_WING_WIDTH_MM = 8_229.6;
const SIDE_WING_WIDTH_MM = 10_250;
const ENTRANCE_WIDTH_MM = 3_000;
const SLAB_THICKNESS_MM = 220;
const WALL_HEIGHT_MM = 2_700;
const EXTERIOR_WALL_MM = 305;
const PARTITION_WALL_MM = 140;

const components: AssemblyComponentIR[] = [];
const add = (component: AssemblyComponentIR): void => { components.push(component); };

const evidence = (
  status: EvidenceStatusIR,
  notes: string[],
  source = SOURCE_PDF,
): ComponentEvidenceIR => ({ status, source, notes });

const measuredEnvelope = evidence('measured', [
  'HABS OH-2468-A records Building B as 139 ft long with 46 ft 4 in side facades.',
  'The written survey records a 17 ft 6 in rear-wing projection that is 27 ft wide.',
]);

const scaledPlan = evidence('measured', [
  'Placement and room identity are scaled from the surviving first- and second-floor HABS plan sheets.',
  'The original sheets resolve nine four-room apartments and three stairwells; dimensions are retained where legible.',
]);

const inferredVertical = evidence('estimated', [
  'The plan sheets do not dimension floor-to-floor height; a 2700 mm cutaway wall height is used for spatial review.',
  'This is an architectural visualization assumption, not a construction or structural value.',
]);

const brick: AssemblyMaterialIR = {
  color: '#8b5948', surface: 'raw', roughness: 0.9, metalness: 0,
  clearcoat: 0.01, microNormalStrength: 0.48, textureScale: [38, 12],
};

const plaster: AssemblyMaterialIR = {
  color: '#ddd7ca', surface: 'raw', roughness: 0.83, metalness: 0,
  clearcoat: 0.02, microNormalStrength: 0.16, textureScale: [28, 28],
};

const concrete: AssemblyMaterialIR = {
  color: '#afa99f', surface: 'raw', roughness: 0.88, metalness: 0,
  clearcoat: 0, microNormalStrength: 0.4, textureScale: [42, 42],
};

const steel: AssemblyMaterialIR = {
  color: '#4f565b', surface: 'brushed-metal', roughness: 0.34, metalness: 0.82,
  anisotropy: 0.55, microNormalStrength: 0.24, textureScale: [8, 46],
};

const glass: AssemblyMaterialIR = {
  color: '#b8d1d4', surface: 'optical-glass', roughness: 0.12, metalness: 0,
  transmission: 0.76, ior: 1.48, thicknessMm: 5, clearcoat: 0.72,
};

const floorMaterials: Record<string, AssemblyMaterialIR> = {
  living: { color: '#d18b36', surface: 'wood', roughness: 0.61, microNormalStrength: 0.34, textureScale: [8, 64] },
  bedroom: { color: '#a95448', surface: 'wood', roughness: 0.67, microNormalStrength: 0.3, textureScale: [8, 54] },
  kitchen: { color: '#3f857b', surface: 'raw', roughness: 0.69, microNormalStrength: 0.25, textureScale: [22, 22] },
  bath: { color: '#377c9a', surface: 'ceramic-glass', roughness: 0.34, clearcoat: 0.24, microNormalStrength: 0.18, textureScale: [14, 14] },
  passage: { color: '#8b877e', surface: 'raw', roughness: 0.74, microNormalStrength: 0.2, textureScale: [26, 26] },
};

function box(
  id: string,
  name: string,
  category: AssemblyComponentIR['category'],
  size: [number, number, number],
  position: [number, number, number],
  materialName: string,
  material: AssemblyMaterialIR,
  componentEvidence: ComponentEvidenceIR,
  detail: string,
  radius = 18,
  rotation?: [number, number, number],
): void {
  add({
    id, name, category, materialName, detail,
    geometry: { op: 'roundedBox', size, radius, segments: 3 },
    position, rotation, material, evidence: componentEvidence,
  });
}

const northEdgeZ = MAIN_DEPTH_MM / 2;
const mainBarSouthZ = -MAIN_DEPTH_MM / 2;
const mainBarNorthZ = mainBarSouthZ + MAIN_BAR_DEPTH_MM;
const mainBarCenterZ = (mainBarNorthZ + mainBarSouthZ) / 2;
const sideWingDepth = northEdgeZ - mainBarNorthZ;
const sideWingCenterZ = mainBarNorthZ + sideWingDepth / 2;
const sideWingCenterX = LENGTH_MM / 2 - SIDE_WING_WIDTH_MM / 2;
const centerWingCenterZ = mainBarSouthZ - CENTER_WING_PROJECTION_MM / 2;
const centerWingSouthZ = mainBarSouthZ - CENTER_WING_PROJECTION_MM;

// Four separate slabs preserve the U-shaped north recess and the center wing
// that projects from the opposite facade. A single bounding rectangle would
// fill the source-plan void and reverse the massing relationship.
box('south_connector_bar_floor_slab', 'South residential connector floor slab', 'enclosure',
  [LENGTH_MM, SLAB_THICKNESS_MM, MAIN_BAR_DEPTH_MM], [0, -SLAB_THICKNESS_MM / 2, mainBarCenterZ],
  'Reinforced concrete', concrete, measuredEnvelope,
  'Measured 139 ft connector bar on the south side of the HABS first-floor outline.', 28);
for (const side of [-1, 1] as const) {
  const name = side < 0 ? 'west' : 'east';
  box(`${name}_wing_floor_slab`, `${name} return-wing floor slab`, 'enclosure',
    [SIDE_WING_WIDTH_MM, SLAB_THICKNESS_MM, sideWingDepth],
    [side * sideWingCenterX, -SLAB_THICKNESS_MM / 2, sideWingCenterZ],
    'Reinforced concrete', concrete, scaledPlan,
    'Plan-scaled north-facing end wing forming one side of the U-shaped recess.', 28);
}
box('center_entry_wing_floor_slab', 'Central entrance-wing floor slab', 'enclosure',
  [CENTER_WING_WIDTH_MM, SLAB_THICKNESS_MM, CENTER_WING_PROJECTION_MM],
  [0, -SLAB_THICKNESS_MM / 2, centerWingCenterZ],
  'Reinforced concrete', concrete, measuredEnvelope,
  'Measured 27 ft central wing projecting 17 ft 6 in from the opposite, south facade.', 28);

function addWindowedFacade(
  id: string,
  label: string,
  length: number,
  centerX: number,
  z: number,
  facing: -1 | 1,
  openingCount: number,
): void {
  box(`${id}_sill_wall`, `${label} brick sill`, 'enclosure',
    [length, 760, EXTERIOR_WALL_MM], [centerX, 380, z], 'Common-bond brick', brick, scaledPlan,
    'Masonry sill below the plan-scaled façade openings.');
  box(`${id}_head_wall`, `${label} brick head`, 'enclosure',
    [length, 560, EXTERIOR_WALL_MM], [centerX, WALL_HEIGHT_MM - 280, z], 'Common-bond brick', brick, inferredVertical,
    'Cutaway-height masonry band above the plan-scaled façade openings.');
  const bay = length / openingCount;
  const windowWidth = Math.min(1_420, bay * 0.68);
  for (let index = 0; index <= openingCount; index += 1) {
    const x = centerX - length / 2 + index * bay;
    box(`${id}_masonry_pier_${index + 1}`, `${label} masonry pier ${index + 1}`, 'enclosure',
      [Math.min(360, bay * 0.2), WALL_HEIGHT_MM - 1_320, EXTERIOR_WALL_MM],
      [x, 760 + (WALL_HEIGHT_MM - 1_320) / 2, z], 'Common-bond brick', brick, scaledPlan,
      'Plan-scaled masonry pier between façade openings.', 10);
    if (index < openingCount) {
      const windowX = x + bay / 2;
      box(`${id}_window_${index + 1}`, `${label} window ${index + 1}`, 'display',
        [windowWidth, 1_250, 18], [windowX, 1_520, z - facing * (EXTERIOR_WALL_MM / 2 + 2)],
        'Steel sash with glazing', glass, scaledPlan,
        'Independent glazing panel aligned to a HABS façade opening.', 6);
      box(`${id}_window_frame_${index + 1}`, `${label} steel window rail ${index + 1}`, 'mechanical',
        [windowWidth + 100, 64, 52], [windowX, 1_520, z - facing * (EXTERIOR_WALL_MM / 2 + 18)],
        'Painted steel sash', steel, scaledPlan, 'Named steel sash rail for the apartment window.', 8);
    }
  }
}

addWindowedFacade('west_north', 'West wing north façade', SIDE_WING_WIDTH_MM, -sideWingCenterX,
  northEdgeZ, 1, 5);
addWindowedFacade('east_north', 'East wing north façade', SIDE_WING_WIDTH_MM, sideWingCenterX,
  northEdgeZ, 1, 5);

const courtFacadeLength = LENGTH_MM - SIDE_WING_WIDTH_MM * 2;
addWindowedFacade('court_south', 'U-shaped recess south façade', courtFacadeLength, 0,
  mainBarNorthZ, 1, 10);

const southFacadeLength = (LENGTH_MM - CENTER_WING_WIDTH_MM) / 2;
const southFacadeCenter = CENTER_WING_WIDTH_MM / 2 + southFacadeLength / 2;
addWindowedFacade('west_south', 'West south façade', southFacadeLength, -southFacadeCenter,
  mainBarSouthZ, -1, 8);
addWindowedFacade('east_south', 'East south façade', southFacadeLength, southFacadeCenter,
  mainBarSouthZ, -1, 8);

for (const side of [-1, 1] as const) {
  const name = side < 0 ? 'west' : 'east';
  box(`${name}_outer_end_wall`, `${name} exterior end wall`, 'enclosure',
    [EXTERIOR_WALL_MM, WALL_HEIGHT_MM, MAIN_DEPTH_MM],
    [side * LENGTH_MM / 2, WALL_HEIGHT_MM / 2, 0], 'Common-bond brick', brick, measuredEnvelope,
    'Measured 46 ft 4 in exterior side façade.', 16);
  box(`${name}_court_side_wall`, `${name} court return wall`, 'enclosure',
    [EXTERIOR_WALL_MM, WALL_HEIGHT_MM, sideWingDepth],
    [side * (LENGTH_MM / 2 - SIDE_WING_WIDTH_MM), WALL_HEIGHT_MM / 2, sideWingCenterZ],
    'Common-bond brick', brick, scaledPlan,
    'Plan-scaled inner return wall preserving the open court void.', 16);
  box(`center_wing_${name}_wall`, `Central wing ${name} court wall`, 'enclosure',
    [EXTERIOR_WALL_MM, WALL_HEIGHT_MM, CENTER_WING_PROJECTION_MM],
    [side * CENTER_WING_WIDTH_MM / 2, WALL_HEIGHT_MM / 2, centerWingCenterZ],
    'Common-bond brick', brick, measuredEnvelope,
    'Measured side wall of the central entrance wing.', 16);
}

// The center wing's south wall is split around the public entrance opening.
const centerRearSideWidth = (CENTER_WING_WIDTH_MM - ENTRANCE_WIDTH_MM) / 2;
for (const side of [-1, 1] as const) {
  box(`center_wing_rear_${side < 0 ? 'west' : 'east'}_wall`, `Central wing rear wall ${side < 0 ? 'west' : 'east'}`, 'enclosure',
    [centerRearSideWidth, WALL_HEIGHT_MM, EXTERIOR_WALL_MM],
    [side * (ENTRANCE_WIDTH_MM / 2 + centerRearSideWidth / 2), WALL_HEIGHT_MM / 2, centerWingSouthZ],
    'Common-bond brick', brick, measuredEnvelope,
    'South wall segment beside the public entrance opening.', 14);
}
box('entrance_front_head', 'Entrance masonry head', 'enclosure',
  [ENTRANCE_WIDTH_MM, 500, EXTERIOR_WALL_MM], [0, WALL_HEIGHT_MM - 250, centerWingSouthZ],
  'Common-bond brick', brick, inferredVertical, 'Header spanning the public double-door opening.', 12);
for (const side of [-1, 1] as const) {
  box(`entrance_door_${side < 0 ? 'west' : 'east'}`, `Entrance glazed door ${side < 0 ? 'west' : 'east'}`, 'mechanical',
    [1_360, 2_150, 52], [side * 710, 1_075, centerWingSouthZ - EXTERIOR_WALL_MM / 2],
    'Steel-framed glazing', glass, scaledPlan, 'Public entrance leaf in the measured center wing.', 10);
}
box('entrance_canopy', 'Entrance canopy', 'mechanical',
  [3_650, 120, 1_050], [0, 2_480, centerWingSouthZ - 430],
  'Painted steel', steel, inferredVertical, 'Protective canopy marking the center-wing public entrance.', 18);

type UnitDefinition = {
  id: number;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  side: 'north' | 'south';
  planType: 'A' | 'B' | 'C' | 'D' | 'E';
};

const connectorWidths = [9_400, 8_000, 8_000, 9_400];
const connectorCenters = [-15_900, -5_300, 5_300, 15_900];
const units: UnitDefinition[] = [
  { id: 1, centerX: -18_480, centerZ: sideWingCenterZ, width: 4_650, depth: 5_950, side: 'north', planType: 'A' },
  { id: 2, centerX: -13_640, centerZ: sideWingCenterZ, width: 4_650, depth: 5_950, side: 'north', planType: 'B' },
  ...connectorWidths.map((width, index) => ({
    id: [3, 4, 6, 7][index], centerX: connectorCenters[index], centerZ: mainBarCenterZ, width, depth: 6_800,
    side: 'south' as const, planType: (['D', 'E', 'E', 'D'] as const)[index],
  })),
  {
    id: 5, centerX: 0, centerZ: centerWingCenterZ, width: 7_800, depth: 4_900,
    side: 'south' as const, planType: 'C' as const,
  },
  { id: 8, centerX: 13_640, centerZ: sideWingCenterZ, width: 4_650, depth: 5_950, side: 'north', planType: 'B' },
  { id: 9, centerX: 18_480, centerZ: sideWingCenterZ, width: 4_650, depth: 5_950, side: 'north', planType: 'A' },
];

function roomFloor(
  unit: UnitDefinition,
  room: 'living' | 'bedroom' | 'kitchen' | 'bath' | 'passage',
  localX: number,
  localZ: number,
  width: number,
  depth: number,
): void {
  box(
    `unit_${unit.id}_${room}_floor`, `Unit ${unit.id} · ${room} floor`, 'mechanical',
    [width - 30, 34, depth - 30], [unit.centerX + localX, 18, unit.centerZ + localZ],
    `${room} finish`, floorMaterials[room], scaledPlan,
    `HABS apartment ${unit.id}, plan type ${unit.planType}: independently named ${room} zone.`, 8,
  );
}

function partition(
  id: string,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  detail: string,
): void {
  box(id, name, 'enclosure', size, position, 'Painted interior partition', plaster, scaledPlan, detail, 10);
}

for (const unit of units) {
  const sign = unit.side === 'north' ? 1 : -1;
  const serviceDepth = 1_850;
  const habitableDepth = unit.depth - serviceDepth;
  const livingWidth = unit.width * 0.55;
  const bedroomWidth = unit.width - livingWidth;
  const outerLocalZ = sign * serviceDepth / 2;
  const serviceLocalZ = -sign * habitableDepth / 2;

  roomFloor(unit, 'living', -unit.width / 2 + livingWidth / 2, outerLocalZ, livingWidth, habitableDepth);
  roomFloor(unit, 'bedroom', livingWidth / 2, outerLocalZ, bedroomWidth, habitableDepth);
  roomFloor(unit, 'kitchen', -unit.width * 0.18, serviceLocalZ, unit.width * 0.62, serviceDepth);
  roomFloor(unit, 'bath', unit.width * 0.405, serviceLocalZ, unit.width * 0.19, serviceDepth);
  roomFloor(unit, 'passage', unit.width * 0.245, serviceLocalZ, unit.width * 0.13, serviceDepth);

  // The long divider is split around a 900 mm opening to make circulation
  // visible and keep the apartment model useful in plan view.
  const dividerZ = unit.centerZ - sign * (unit.depth / 2 - serviceDepth);
  const leftSegment = unit.width * 0.5 - 450;
  partition(`unit_${unit.id}_service_wall_west`, `Unit ${unit.id} · service wall west`,
    [leftSegment, WALL_HEIGHT_MM, PARTITION_WALL_MM],
    [unit.centerX - (unit.width / 2 - leftSegment / 2), WALL_HEIGHT_MM / 2, dividerZ],
    `Plan type ${unit.planType} partition with a 900 mm circulation opening.`);
  partition(`unit_${unit.id}_service_wall_east`, `Unit ${unit.id} · service wall east`,
    [leftSegment, WALL_HEIGHT_MM, PARTITION_WALL_MM],
    [unit.centerX + (unit.width / 2 - leftSegment / 2), WALL_HEIGHT_MM / 2, dividerZ],
    `Plan type ${unit.planType} partition with a 900 mm circulation opening.`);

  const bedroomDividerX = unit.centerX - unit.width / 2 + livingWidth;
  partition(`unit_${unit.id}_living_bedroom_wall`, `Unit ${unit.id} · living-bedroom wall`,
    [PARTITION_WALL_MM, WALL_HEIGHT_MM, habitableDepth - 820],
    [bedroomDividerX, WALL_HEIGHT_MM / 2, unit.centerZ + sign * (serviceDepth / 2 + 410)],
    'Room divider shortened to preserve the door opening visible on the HABS plan.');

  const serviceDividerX = unit.centerX + unit.width * 0.31;
  partition(`unit_${unit.id}_kitchen_bath_wall`, `Unit ${unit.id} · kitchen-bath wall`,
    [PARTITION_WALL_MM, WALL_HEIGHT_MM, serviceDepth - 420],
    [serviceDividerX, WALL_HEIGHT_MM / 2, unit.centerZ + serviceLocalZ],
    'Service-band partition separating kitchen and bath/passage zones.');

  for (let doorIndex = 0; doorIndex < 2; doorIndex += 1) {
    const x = doorIndex === 0 ? unit.centerX : bedroomDividerX;
    const z = doorIndex === 0 ? dividerZ : unit.centerZ + sign * (serviceDepth / 2 + 380);
    box(`unit_${unit.id}_door_head_${doorIndex + 1}`, `Unit ${unit.id} · door head ${doorIndex + 1}`, 'mechanical',
      [doorIndex === 0 ? 900 : 70, 90, doorIndex === 0 ? 80 : 820],
      [x, 2_080, z], 'Painted steel door frame', steel, scaledPlan,
      'Named door-frame head at a plan-derived circulation opening.', 8);
  }
}

// Three independent stairwells are a defining circulation feature in the HABS
// written record. Each flight is built from named, watertight concrete steps.
const stairCenters = [-12_900, 0, 12_900];
for (let stairIndex = 0; stairIndex < stairCenters.length; stairIndex += 1) {
  const centerX = stairCenters[stairIndex];
  const label = stairIndex + 1;
  const planAngle = [-Math.PI / 4, 0, Math.PI / 4][stairIndex];
  const rotatePlanOffset = (localX: number, localZ: number): [number, number] => [
    centerX + localX * Math.cos(planAngle) + localZ * Math.sin(planAngle),
    -localX * Math.sin(planAngle) + localZ * Math.cos(planAngle),
  ];
  box(`stair_${label}_landing`, `Stair ${label} · center landing`, 'mechanical',
    [2_600, 170, 1_050], [centerX, 1_360, 0], 'Reinforced concrete', concrete, scaledPlan,
    'Central landing for one of the three plan-documented stairwells.', 16, [0, planAngle, 0]);
  for (const flight of [-1, 1] as const) {
    for (let stepIndex = 0; stepIndex < 11; stepIndex += 1) {
      const progress = stepIndex / 10;
      const y = 90 + progress * 1_180;
      const [x, z] = rotatePlanOffset(0, flight * (520 + progress * 1_260));
      box(`stair_${label}_flight_${flight < 0 ? 'south' : 'north'}_step_${stepIndex + 1}`,
        `Stair ${label} · ${flight < 0 ? 'south' : 'north'} flight step ${stepIndex + 1}`, 'mechanical',
        [1_080, 145, 330], [x, y, z], 'Reinforced concrete', concrete, inferredVertical,
        'One watertight tread in the plan-located stair core; rise is estimated.', 10, [0, planAngle, 0]);
    }
  }
  for (const side of [-1, 1] as const) {
    const [x, z] = rotatePlanOffset(side * 610, 0);
    box(`stair_${label}_rail_${side < 0 ? 'west' : 'east'}`, `Stair ${label} · steel handrail ${side < 0 ? 'west' : 'east'}`, 'mechanical',
      [46, 820, 3_200], [x, 1_180, z], 'Painted steel', steel, inferredVertical,
      'Safety rail in the plan-located stair core; profile and height are reconstructed.', 18, [0, planAngle, side * 0.36]);
  }
}

// Balconies are visible on the upper-floor sheets. Slabs and rails remain
// separate components for material and topology inspection.
const balconies = [
  { id: 'north_west', x: -14_800, z: MAIN_DEPTH_MM / 2 + 620, width: 3_600 },
  { id: 'north_east', x: 14_800, z: MAIN_DEPTH_MM / 2 + 620, width: 3_600 },
  { id: 'south_west', x: -15_500, z: -MAIN_DEPTH_MM / 2 - 620, width: 3_300 },
  { id: 'south_east', x: 15_500, z: -MAIN_DEPTH_MM / 2 - 620, width: 3_300 },
];
for (const balcony of balconies) {
  box(`balcony_${balcony.id}_slab`, `${balcony.id} balcony slab`, 'mechanical',
    [balcony.width, 150, 1_180], [balcony.x, -30, balcony.z], 'Reinforced concrete', concrete, scaledPlan,
    'Upper-floor balcony slab shown on the HABS plan sheet.', 14);
  box(`balcony_${balcony.id}_rail`, `${balcony.id} balcony guard`, 'mechanical',
    [balcony.width, 760, 42], [balcony.x, 500, balcony.z + Math.sign(balcony.z) * 560],
    'Painted steel guard', steel, scaledPlan, 'Independent metal guard aligned to a plan-documented balcony.', 12);
}

export const LAUREL_HOMES_BUILDING_B_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'Laurel Homes Building B · HABS OH-2468-A',
  units: 'mm',
  components,
  planFootprint: {
    schema: 'morphloom.plan-footprint/0.1',
    componentIds: [
      'south_connector_bar_floor_slab',
      'west_wing_floor_slab',
      'east_wing_floor_slab',
      'center_entry_wing_floor_slab',
    ],
    targetRegions: [{
      id: 'u_shell_with_opposed_center_wing',
      polygonMm: [
        [-LENGTH_MM / 2, mainBarSouthZ],
        [-CENTER_WING_WIDTH_MM / 2, mainBarSouthZ],
        [-CENTER_WING_WIDTH_MM / 2, centerWingSouthZ],
        [CENTER_WING_WIDTH_MM / 2, centerWingSouthZ],
        [CENTER_WING_WIDTH_MM / 2, mainBarSouthZ],
        [LENGTH_MM / 2, mainBarSouthZ],
        [LENGTH_MM / 2, northEdgeZ],
        [LENGTH_MM / 2 - SIDE_WING_WIDTH_MM, northEdgeZ],
        [LENGTH_MM / 2 - SIDE_WING_WIDTH_MM, mainBarNorthZ],
        [-LENGTH_MM / 2 + SIDE_WING_WIDTH_MM, mainBarNorthZ],
        [-LENGTH_MM / 2 + SIDE_WING_WIDTH_MM, northEdgeZ],
        [-LENGTH_MM / 2, northEdgeZ],
      ],
    }],
    voidRegions: [{
      id: 'north_courtyard',
      boundsMm: [-LENGTH_MM / 2 + SIDE_WING_WIDTH_MM, mainBarNorthZ, LENGTH_MM / 2 - SIDE_WING_WIDTH_MM, northEdgeZ],
    }],
    resolution: 160,
    minimumIoU: 0.985,
    maximumFalsePositiveFraction: 0.01,
    maximumFalseNegativeFraction: 0.015,
    maximumVoidOccupancy: 0.005,
    evidence: {
      status: 'measured',
      source: SOURCE_PDF,
      note: 'HABS first-floor plan union: south connector, two north returns, and the 27 ft center wing projecting from the opposite south facade.',
    },
  },
  metadata: {
    assetKind: 'building',
    buildingType: 'multifamily-apartment',
    scope: 'architectural-shell-only',
    modeledScope: 'one-detailed-residential-floor-cutaway',
    source: 'Historic American Buildings Survey · HABS OH-2468-A',
    sourceUrl: SOURCE_PDF,
    sourcePdf: SOURCE_PDF,
    address: '549-553 West Liberty Street, Cincinnati, Ohio',
    documentedFloors: 4,
    documentedApartments: 36,
    modeledApartments: 9,
    documentedStairwells: 3,
    documentedPlanTypesPerFloor: 5,
    measuredLengthMm: LENGTH_MM,
    measuredMainDepthMm: MAIN_DEPTH_MM,
    planFootprintVerified: true,
    planFootprintAudit: 'source-plan-vs-plan-view-segmented-slab',
    footprintForm: 'u-courtyard-with-opposed-center-wing',
    courtyardVoids: 1,
    planProjectionRelationship: 'side-wings-north-center-wing-south',
    measuredCenterWingProjectionMm: CENTER_WING_PROJECTION_MM,
    measuredCenterWingWidthMm: CENTER_WING_WIDTH_MM,
    planScaledEntranceProjectionMm: CENTER_WING_PROJECTION_MM,
    planScaledEntranceWidthMm: ENTRANCE_WIDTH_MM,
    estimatedCutawayWallHeightMm: WALL_HEIGHT_MM,
    ceilingAndRoofIncluded: false,
    structureAndMepReady: false,
    evidencePolicy: '공식 HABS 외곽 치수·평면 배치를 measured로, 판독이 불명확한 수직 치수와 세부 시공 형상은 estimated로 분리합니다.',
  },
};
