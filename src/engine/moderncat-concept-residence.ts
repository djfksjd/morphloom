import type {
  AssemblyComponentIR,
  AssemblyIR,
  AssemblyMaterialIR,
  ComponentEvidenceIR,
  EvidenceStatusIR,
} from './assembly-ir';

const SOURCE_URL = 'https://kr.pinterest.com/pin/657033033177060840/';
const WIDTH_MM = 12_440;
const DEPTH_MM = 9_720;
const FLOOR_HEIGHT_MM = 3_150;
const UPPER_HEIGHT_MM = 2_950;
const SLAB_MM = 220;
const WALL_MM = 200;
const UPPER_DEPTH_MM = 7_180;
const UPPER_CENTER_Z = 930;
const FRONT_Z = -DEPTH_MM / 2;
const REAR_Z = DEPTH_MM / 2;
const UPPER_FRONT_Z = UPPER_CENTER_Z - UPPER_DEPTH_MM / 2;
const UPPER_REAR_Z = UPPER_CENTER_Z + UPPER_DEPTH_MM / 2;

const components: AssemblyComponentIR[] = [];
const add = (component: AssemblyComponentIR): void => { components.push(component); };

const evidence = (status: EvidenceStatusIR, notes: string[]): ComponentEvidenceIR => ({
  status,
  source: SOURCE_URL,
  notes,
});

const planEvidence = evidence('measured', [
  'The composite concept sheet prints a 12.44 m overall horizontal dimension and shows two aligned floor plans.',
  'Room boundaries and openings are traced from the visible drawing, but the sheet is not a verified construction document.',
]);
const renderEvidence = evidence('inferred', [
  'Material and façade character are inferred from the presentation render rather than a specification schedule.',
]);
const verticalEvidence = evidence('estimated', [
  'No verified section or readable floor-to-floor dimension is present; vertical dimensions are concept-review estimates.',
]);

const concrete: AssemblyMaterialIR = {
  color: '#9a8e80', surface: 'concrete', roughness: 0.86, metalness: 0,
  clearcoat: 0.02, microNormalStrength: 0.42, textureScale: [36, 36],
};
const stucco: AssemblyMaterialIR = {
  color: '#8d7567', surface: 'plaster', roughness: 0.82, metalness: 0,
  clearcoat: 0.02, microNormalStrength: 0.31, textureScale: [30, 30],
};
const wood: AssemblyMaterialIR = {
  color: '#68402c', surface: 'wood', roughness: 0.56, metalness: 0,
  clearcoat: 0.12, microNormalStrength: 0.4, textureScale: [8, 72], anisotropy: 0.34,
};
const darkWood: AssemblyMaterialIR = {
  ...wood, color: '#3d271e', roughness: 0.48, clearcoat: 0.2,
};
const glass: AssemblyMaterialIR = {
  color: '#afc8c8', surface: 'optical-glass', roughness: 0.08, metalness: 0,
  transmission: 0.82, ior: 1.5, thicknessMm: 10, clearcoat: 0.72,
  microNormalStrength: 0.04, textureScale: [64, 64],
};
const steel: AssemblyMaterialIR = {
  color: '#292b2d', surface: 'brushed-metal', roughness: 0.34, metalness: 0.88,
  anisotropy: 0.62, microNormalStrength: 0.2, textureScale: [8, 64],
};
const roof: AssemblyMaterialIR = {
  color: '#303136', surface: 'coated-metal', roughness: 0.68, metalness: 0.18,
  clearcoat: 0.08, microNormalStrength: 0.5, textureScale: [18, 54],
};
const paint: AssemblyMaterialIR = {
  color: '#d7d0c4', surface: 'plaster', roughness: 0.76, metalness: 0,
  clearcoat: 0.03, microNormalStrength: 0.18, textureScale: [34, 34],
};
const floorWood: AssemblyMaterialIR = {
  color: '#8b6141', surface: 'wood', roughness: 0.58, metalness: 0,
  clearcoat: 0.13, microNormalStrength: 0.36, textureScale: [7, 58], anisotropy: 0.36,
};
const tile: AssemblyMaterialIR = {
  color: '#b8afa2', surface: 'ceramic-glass', roughness: 0.34, metalness: 0,
  clearcoat: 0.28, microNormalStrength: 0.15, textureScale: [18, 18],
};
const fabric: AssemblyMaterialIR = {
  color: '#8f847b', surface: 'fabric', roughness: 0.92, metalness: 0,
  sheen: 0.3, sheenRoughness: 0.84, microNormalStrength: 0.52, textureScale: [24, 24],
};
const porcelain: AssemblyMaterialIR = {
  color: '#eeeae2', surface: 'ceramic-glass', roughness: 0.2, metalness: 0,
  clearcoat: 0.46, microNormalStrength: 0.08, textureScale: [28, 28],
};
const mirror: AssemblyMaterialIR = {
  color: '#bac7c9', surface: 'optical-glass', roughness: 0.035, metalness: 0.78,
  clearcoat: 0.85, microNormalStrength: 0.02, textureScale: [64, 64],
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

function roomFloor(id: string, name: string, size: [number, number], center: [number, number], levelY = 24): void {
  box(`${id}_floor`, `${name} floor finish`, 'enclosure', [size[0], 42, size[1]], [center[0], levelY, center[1]],
    'Warm timber floor', floorWood, planEvidence, `Editable finish zone traced for ${name}.`, 10);
}

function lightFixture(id: string, name: string, position: [number, number, number], level: 'L1' | 'L2'): void {
  add({
    id, name, category: 'mechanical', materialName: 'Warm LED luminaire',
    detail: 'Editable physical light fixture with day/night illumination metadata.',
    level,
    geometry: { op: 'cylinder', radiusTop: 82, radiusBottom: 82, depth: 34, radialSegments: 32 },
    position,
    material: { ...steel, color: '#242626', emissive: '#ffd5a3' },
    light: { color: '#ffd2a0', intensity: 450, rangeMm: 7_500, decay: 2 },
    evidence: renderEvidence,
  });
}

box('ground_floor_slab', 'Ground floor structural slab', 'enclosure', [WIDTH_MM, SLAB_MM, DEPTH_MM], [0, -SLAB_MM / 2, 0],
  'Reinforced concrete', concrete, planEvidence, '12.44 m-wide ground-floor footprint traced from the panel.', 26);
box('upper_floor_slab', 'Upper floor structural slab', 'enclosure', [WIDTH_MM, SLAB_MM, UPPER_DEPTH_MM],
  [0, FLOOR_HEIGHT_MM - SLAB_MM / 2, UPPER_CENTER_Z], 'Reinforced concrete', concrete, planEvidence,
  'Upper-floor plate aligned to the two-storey drawing and front balcony.', 24);

roomFloor('living', 'Living room', [3_450, 3_050], [-4_250, -3_100]);
roomFloor('dining', 'Dining room', [3_450, 2_250], [-4_250, -420]);
roomFloor('kitchen', 'Kitchen', [3_450, 3_350], [-4_250, 2_650], 25);
roomFloor('foyer', 'Foyer', [1_650, 2_900], [-1_590, -3_180], 28);
roomFloor('stair', 'Stair hall', [1_700, 3_250], [-350, 2_540], 28);
roomFloor('powder', 'Powder room', [1_450, 1_900], [-1_640, 2_520], 25);
roomFloor('multifunction', 'Multifunction room', [3_350, 3_360], [3_900, 2_610], 25);
box('garage_floor', 'Two-car garage floor', 'enclosure', [4_150, 54, 4_720], [3_720, 28, -2_330],
  'Sealed concrete', concrete, planEvidence, 'Two-car garage zone shown on the ground plan.', 10);

// Ground-floor shell: the street façade is segmented around real openings.
box('ground_rear_wall', 'Ground rear exterior wall', 'enclosure', [WIDTH_MM, FLOOR_HEIGHT_MM, WALL_MM],
  [0, FLOOR_HEIGHT_MM / 2, REAR_Z], 'Textured stucco', stucco, planEvidence, 'Rear wall aligned to the plan outline.', 16);
box('ground_west_wall', 'Ground west exterior wall', 'enclosure', [WALL_MM, FLOOR_HEIGHT_MM, DEPTH_MM],
  [-WIDTH_MM / 2, FLOOR_HEIGHT_MM / 2, 0], 'Textured stucco', stucco, planEvidence, 'West plan perimeter wall.', 16);
box('ground_east_wall', 'Ground east exterior wall', 'enclosure', [WALL_MM, FLOOR_HEIGHT_MM, DEPTH_MM],
  [WIDTH_MM / 2, FLOOR_HEIGHT_MM / 2, 0], 'Textured stucco', stucco, planEvidence, 'East plan perimeter wall.', 16);
box('ground_front_head', 'Ground street façade head band', 'enclosure', [WIDTH_MM, 620, WALL_MM],
  [0, FLOOR_HEIGHT_MM - 310, FRONT_Z], 'Textured stucco', stucco, renderEvidence, 'Continuous façade band above living, entry and garage openings.', 14);
for (const [id, x, width] of [
  ['west_corner', -5_950, 540], ['living_entry_pier', -2_720, 420], ['entry_garage_pier', 250, 520], ['east_corner', 6_020, 400],
] as const) {
  box(`ground_front_${id}`, `Ground façade ${id.replaceAll('_', ' ')}`, 'enclosure', [width, 2_530, WALL_MM],
    [x, 1_265, FRONT_Z], 'Textured stucco', stucco, planEvidence, 'Street-wall pier preserving the plan opening rhythm.', 12);
}
box('living_front_glazing', 'Living room street glazing', 'display', [2_760, 2_240, 22],
  [-4_240, 1_220, FRONT_Z - 112], 'Low-E clear glazing', glass, renderEvidence, 'Floor-to-ceiling living-room window visible at the left of the façade.', 5);
for (const x of [-5_160, -4_240, -3_320]) {
  box(`living_mullion_${x}`, 'Living glazing vertical mullion', 'mechanical', [48, 2_300, 64],
    [x, 1_220, FRONT_Z - 138], 'Dark aluminium', steel, renderEvidence, 'Independent façade mullion.', 8);
}
box('entry_door', 'Recessed horizontal-slat entry door', 'mechanical', [1_180, 2_420, 90],
  [-1_470, 1_210, FRONT_Z - 150], 'Dark stained timber', darkWood, renderEvidence,
  'Wide timber entrance leaf with horizontal shadow gaps from the façade render.', 20);
for (let slat = 0; slat < 9; slat += 1) {
  box(`entry_door_slat_${slat + 1}`, `Entry door shadow slat ${slat + 1}`, 'mechanical', [1_050, 28, 18],
    [-1_470, 340 + slat * 225, FRONT_Z - 202], 'Black reveal', steel, renderEvidence, 'Named horizontal entrance-door reveal.', 5);
}
box('entry_canopy', 'Entry canopy', 'mechanical', [2_050, 120, 1_020], [-1_210, 2_590, FRONT_Z - 420],
  'Powder-coated steel', steel, renderEvidence, 'Thin projecting canopy above the entrance.', 18);
box('garage_door', 'Two-car sectional garage door', 'mechanical', [3_760, 2_360, 86],
  [3_780, 1_190, FRONT_Z - 142], 'Charcoal coated steel', { ...steel, color: '#35363a', roughness: 0.42 },
  renderEvidence, 'Large dark garage door occupying the right façade bay.', 16);
for (let seam = 1; seam < 5; seam += 1) {
  box(`garage_door_seam_${seam}`, `Garage door horizontal seam ${seam}`, 'mechanical', [3_650, 22, 18],
    [3_780, seam * 470, FRONT_Z - 196], 'Recessed steel joint', steel, renderEvidence, 'Sectional-door joint.', 5);
}

// Ground partitions and circulation.
for (const [id, size, position] of [
  ['living_dining_partition', [WALL_MM, 2_850, 3_020], [-2_480, 1_425, -3_120]],
  ['kitchen_service_partition', [WALL_MM, 2_850, 3_020], [-2_480, 1_425, 2_930]],
  ['garage_west_partition', [WALL_MM, 2_850, 4_820], [1_520, 1_425, -2_390]],
  ['garage_rear_partition', [4_220, 2_850, WALL_MM], [3_710, 1_425, 90]],
  ['multifunction_front_partition', [3_550, 2_850, WALL_MM], [4_350, 1_425, 930]],
  ['stair_east_partition', [WALL_MM, 2_850, 3_180], [690, 1_425, 2_860]],
] as const) {
  box(id, id.replaceAll('_', ' '), 'enclosure', size as [number, number, number], position as [number, number, number],
    'Painted gypsum wall', paint, planEvidence, 'Plan-traced ground-floor partition.', 10);
}
for (let step = 0; step < 13; step += 1) {
  box(`stair_step_${step + 1}`, `Stair tread ${step + 1}`, 'mechanical', [1_260, 150, 310],
    [-320, 75 + step * 218, 1_460 + step * 248], 'Timber tread', darkWood, verticalEvidence,
    'Plan-located stair flight; rise and run estimated without a verified section.', 8);
}

// Essential ground-floor furniture keeps room meaning inspectable without pretending to be fabrication-ready.
box('kitchen_back_counter', 'Kitchen rear counter', 'mechanical', [3_050, 900, 620], [-4_350, 450, 4_300],
  'Walnut cabinetry', darkWood, renderEvidence, 'Kitchen counter inferred from plan and interior mood image.', 18);
box('kitchen_island', 'Kitchen island', 'mechanical', [2_050, 920, 760], [-4_080, 460, 2_330],
  'Stone and walnut island', { ...tile, color: '#d4c9ba' }, renderEvidence, 'Central island aligned to the kitchen symbol.', 20);
box('dining_table', 'Dining table', 'mechanical', [2_180, 92, 980], [-4_160, 760, -430],
  'Dark timber', darkWood, planEvidence, 'Eight-seat dining table footprint.', 18);
for (let chair = 0; chair < 8; chair += 1) {
  const side = chair < 4 ? -1 : 1;
  const index = chair % 4;
  box(`dining_chair_${chair + 1}`, `Dining chair ${chair + 1}`, 'mechanical', [430, 760, 430],
    [-5_020 + index * 570, 380, -430 + side * 720], 'Upholstered chair', fabric, planEvidence, 'Named dining chair shown in plan.', 34);
}
box('living_sofa', 'Living room sofa', 'mechanical', [2_450, 760, 820], [-4_650, 400, -3_650],
  'Warm fabric upholstery', fabric, renderEvidence, 'Low sofa inferred from the living-room mood image.', 80);
box('living_coffee_table', 'Living coffee table', 'mechanical', [1_420, 330, 720], [-4_050, 195, -2_450],
  'Dark timber', darkWood, renderEvidence, 'Low rectangular coffee table.', 32);
box('living_media_console', 'Living media console', 'mechanical', [2_100, 480, 420], [-2_720, 260, -3_120],
  'Dark timber', darkWood, renderEvidence, 'Editable low media console completing the living-room layout.', 26);
box('powder_vanity', 'Ground powder-room vanity', 'mechanical', [860, 820, 480], [-1_830, 430, 3_180],
  'Stone vanity', porcelain, planEvidence, 'Compact vanity placed inside the plan-traced powder room.', 42);
box('powder_basin', 'Ground powder-room basin', 'mechanical', [520, 120, 360], [-1_830, 900, 3_180],
  'Glazed porcelain basin', porcelain, planEvidence, 'Named basin fixture kept separate for layout editing.', 44);
add({
  id: 'powder_toilet', name: 'Ground powder-room toilet', category: 'mechanical', materialName: 'Glazed porcelain',
  detail: 'Plan-scale toilet fixture proving bathroom program completeness.', level: 'L1',
  geometry: { op: 'lathe', profile: [[0, 0], [230, 20], [250, 150], [205, 410], [170, 520], [0, 540]], segments: 40 },
  position: [-1_440, 270, 2_280], rotation: [0, 0, Math.PI / 2], material: porcelain, evidence: planEvidence,
});
for (const side of [-1, 1] as const) {
  box(`garage_car_${side < 0 ? 'west' : 'east'}_body`, `${side < 0 ? 'West' : 'East'} garage car body`, 'mechanical',
    [1_620, 780, 3_750], [3_720 + side * 980, 420, -2_240], 'Painted automotive shell',
    { ...steel, color: side < 0 ? '#858687' : '#bbb9b3', metalness: 0.52, clearcoat: 0.62 }, planEvidence,
    'Plan-scale vehicle proxy proving two-car clearance; not an automotive asset.', 180);
}

// Upper floor, balcony and façade.
roomFloor('upper_bedroom_1', 'Upper bedroom 1', [3_250, 2_700], [-4_420, 2_420], FLOOR_HEIGHT_MM + 25);
roomFloor('upper_bedroom_2', 'Upper bedroom 2', [3_250, 2_620], [-4_420, -650], FLOOR_HEIGHT_MM + 25);
roomFloor('upper_primary', 'Upper primary bedroom', [3_850, 3_250], [4_140, 300], FLOOR_HEIGHT_MM + 25);
roomFloor('upper_corridor', 'Upper corridor and storage', [2_200, 3_650], [200, 360], FLOOR_HEIGHT_MM + 28);
box('front_balcony_slab', 'Full-width front balcony slab', 'mechanical', [WIDTH_MM - 120, 180, 1_900],
  [0, FLOOR_HEIGHT_MM - 70, UPPER_FRONT_Z - 950], 'Reinforced concrete', concrete, planEvidence,
  'Deep street balcony visible in both the upper plan and façade.', 20);
box('front_balcony_glass', 'Front balcony glass guard', 'display', [WIDTH_MM - 640, 1_050, 26],
  [0, FLOOR_HEIGHT_MM + 660, UPPER_FRONT_Z - 1_850], 'Clear laminated glass', glass, renderEvidence,
  'Continuous glazed balcony guard from the façade image.', 6);
for (let post = 0; post < 9; post += 1) {
  box(`balcony_post_${post + 1}`, `Balcony guard post ${post + 1}`, 'mechanical', [38, 1_080, 38],
    [-5_500 + post * 1_375, FLOOR_HEIGHT_MM + 660, UPPER_FRONT_Z - 1_860], 'Dark aluminium', steel,
    renderEvidence, 'Independent balcony guard post.', 6);
}
box('upper_rear_wall', 'Upper rear exterior wall', 'enclosure', [WIDTH_MM, UPPER_HEIGHT_MM, WALL_MM],
  [0, FLOOR_HEIGHT_MM + UPPER_HEIGHT_MM / 2, UPPER_REAR_Z], 'Timber rainscreen', wood, planEvidence,
  'Upper rear perimeter wall.', 14);
box('upper_west_wall', 'Upper west exterior wall', 'enclosure', [WALL_MM, UPPER_HEIGHT_MM, UPPER_DEPTH_MM],
  [-WIDTH_MM / 2, FLOOR_HEIGHT_MM + UPPER_HEIGHT_MM / 2, UPPER_CENTER_Z], 'Timber rainscreen', wood,
  planEvidence, 'Upper west perimeter wall.', 14);
box('upper_east_wall', 'Upper east exterior wall', 'enclosure', [WALL_MM, UPPER_HEIGHT_MM, UPPER_DEPTH_MM],
  [WIDTH_MM / 2, FLOOR_HEIGHT_MM + UPPER_HEIGHT_MM / 2, UPPER_CENTER_Z], 'Timber rainscreen', wood,
  planEvidence, 'Upper east perimeter wall.', 14);
box('upper_front_head', 'Upper façade roof band', 'enclosure', [WIDTH_MM, 520, WALL_MM],
  [0, FLOOR_HEIGHT_MM + UPPER_HEIGHT_MM - 260, UPPER_FRONT_Z], 'Timber rainscreen', wood,
  renderEvidence, 'Wood-clad head band above upper glazing.', 12);
for (const [id, x, width] of [
  ['west_corner', -5_910, 500], ['bedroom_divider', -2_770, 380], ['stair_divider', 580, 460], ['east_corner', 5_920, 480],
] as const) {
  box(`upper_front_${id}`, `Upper façade ${id.replaceAll('_', ' ')}`, 'enclosure', [width, 2_430, WALL_MM],
    [x, FLOOR_HEIGHT_MM + 1_215, UPPER_FRONT_Z], 'Timber rainscreen', wood, renderEvidence,
    'Upper-storey façade pier.', 10);
}
for (const [id, x, width] of [
  ['west_window', -4_300, 2_380], ['center_door', -1_180, 1_720], ['east_window', 3_470, 4_420],
] as const) {
  box(id, id.replaceAll('_', ' '), 'display', [width, 2_180, 24],
    [x, FLOOR_HEIGHT_MM + 1_210, UPPER_FRONT_Z - 112], 'Low-E clear glazing', glass, renderEvidence,
    'Upper façade opening aligned to the presentation image.', 5);
}
for (const x of [-5_000, -4_200, -3_400, -1_500, -850, 2_000, 3_000, 4_000, 5_000]) {
  box(`upper_mullion_${String(x).replace('-', 'n')}`, 'Upper glazing mullion', 'mechanical', [44, 2_250, 58],
    [x, FLOOR_HEIGHT_MM + 1_210, UPPER_FRONT_Z - 138], 'Dark aluminium', steel, renderEvidence,
    'Independent upper-storey glazing mullion.', 6);
}
for (const [id, size, position] of [
  ['upper_west_center_partition', [WALL_MM, 2_700, 6_100], [-2_650, FLOOR_HEIGHT_MM + 1_350, 900]],
  ['upper_east_center_partition', [WALL_MM, 2_700, 5_300], [1_420, FLOOR_HEIGHT_MM + 1_350, 1_150]],
  ['upper_west_bedroom_partition', [3_600, 2_700, WALL_MM], [-4_420, FLOOR_HEIGHT_MM + 1_350, 800]],
  ['upper_east_bath_partition', [4_400, 2_700, WALL_MM], [3_950, FLOOR_HEIGHT_MM + 1_350, 2_220]],
] as const) {
  box(id, id.replaceAll('_', ' '), 'enclosure', size as [number, number, number], position as [number, number, number],
    'Painted gypsum wall', paint, planEvidence, 'Plan-traced upper-floor partition.', 10);
}
for (const [id, x, z, width] of [
  ['bedroom_1_bed', -4_300, 2_450, 1_650], ['bedroom_2_bed', -4_300, -650, 1_650], ['primary_bed', 4_120, 100, 2_050],
] as const) {
  const primary = id === 'primary_bed';
  const rotation: [number, number, number] | undefined = primary ? [0, Math.PI / 2, 0] : undefined;
  box(id, id.replaceAll('_', ' '), 'mechanical', [width, 620, 2_100], [x, FLOOR_HEIGHT_MM + 330, z],
    'Upholstered bed', fabric, planEvidence, 'Plan-positioned bed mass with editable dimensions and corrected orientation.', 90, rotation);
  box(`${id}_headboard`, `${id.replaceAll('_', ' ')} headboard`, 'mechanical', [width + 180, 1_120, 120],
    primary ? [x + 1_020, FLOOR_HEIGHT_MM + 760, z] : [x, FLOOR_HEIGHT_MM + 760, z + 1_020],
    'Timber headboard', darkWood, renderEvidence, 'Warm timber headboard inferred from the mood image.', 24, rotation);
}

// Bathroom program is explicit so the build audit cannot pass a shell with missing wet-room fixtures.
roomFloor('upper_bath', 'Upper shared bathroom', [2_450, 1_900], [3_900, 2_760], FLOOR_HEIGHT_MM + 30);
box('upper_bath_vanity', 'Upper bathroom vanity', 'mechanical', [1_020, 840, 500], [3_180, FLOOR_HEIGHT_MM + 430, 3_120],
  'Stone vanity', porcelain, planEvidence, 'Editable vanity aligned to the upper wet-room zone.', 42);
box('upper_bath_basin', 'Upper bathroom basin', 'mechanical', [620, 130, 390], [3_180, FLOOR_HEIGHT_MM + 900, 3_120],
  'Glazed porcelain basin', porcelain, planEvidence, 'Separate upper basin fixture.', 44);
box('upper_bath_mirror', 'Upper bathroom mirror', 'display', [980, 780, 18], [3_180, FLOOR_HEIGHT_MM + 1_520, 3_360],
  'Silvered mirror glass', mirror, renderEvidence, 'Reflective mirror above the vanity.', 5);
add({
  id: 'upper_bath_toilet', name: 'Upper bathroom toilet', category: 'mechanical', materialName: 'Glazed porcelain',
  detail: 'Plan-scale upper-floor toilet fixture.', level: 'L2',
  geometry: { op: 'lathe', profile: [[0, 0], [230, 20], [250, 150], [205, 410], [170, 520], [0, 540]], segments: 40 },
  position: [4_500, FLOOR_HEIGHT_MM + 270, 3_050], rotation: [0, 0, Math.PI / 2], material: porcelain, evidence: planEvidence,
});
box('upper_bath_shower_tray', 'Upper walk-in shower tray', 'mechanical', [900, 70, 1_200], [5_000, FLOOR_HEIGHT_MM + 45, 2_300],
  'Non-slip ceramic tray', tile, planEvidence, 'Separate shower base defining the wet zone.', 24);
box('upper_bath_shower_glass', 'Upper shower glass', 'display', [18, 1_950, 1_180], [4_550, FLOOR_HEIGHT_MM + 1_000, 2_300],
  'Tempered clear glass', glass, renderEvidence, 'Walk-in shower partition with optical transmission.', 4);
for (const [id, x, z] of [
  ['bedroom_1_wardrobe', -5_510, 3_600], ['bedroom_2_wardrobe', -5_510, -1_700], ['primary_wardrobe', 5_480, 1_660],
] as const) {
  box(id, id.replaceAll('_', ' '), 'mechanical', [1_250, 2_280, 620], [x, FLOOR_HEIGHT_MM + 1_140, z],
    'Timber wardrobe', darkWood, planEvidence, 'Editable full-height bedroom storage.', 26);
}
for (const [id, x, z] of [
  ['primary_nightstand_west', 3_050, -900], ['primary_nightstand_east', 5_150, -900],
] as const) {
  box(id, id.replaceAll('_', ' '), 'mechanical', [520, 480, 430], [x, FLOOR_HEIGHT_MM + 240, z],
    'Timber nightstand', darkWood, renderEvidence, 'Movable bedside storage.', 30);
}

// One closed hip-roof solid replaces the four overlapping slabs. The silhouette is inspectable and watertight.
const roofY = FLOOR_HEIGHT_MM + UPPER_HEIGHT_MM + 40;
add({
  id: 'roof_hip_shell', name: 'Continuous hipped roof shell', category: 'enclosure',
  materialName: 'Dark standing-seam roof', detail: 'Single closed, watertight hip roof with explicit ridge and overhang.',
  level: 'ROOF', geometry: {
    op: 'hipRoof', width: WIDTH_MM + 1_100, depth: UPPER_DEPTH_MM + 1_050,
    rise: 880, thickness: 120, ridgeLength: 5_300,
  },
  position: [0, roofY, UPPER_CENTER_Z], material: roof, evidence: verticalEvidence,
});
box('roof_ridge_cap', 'Roof ridge cap', 'mechanical', [5_340, 110, 120], [0, roofY + 900, UPPER_CENTER_Z],
  'Coated ridge metal', steel, verticalEvidence, 'Named ridge flashing above the continuous hip shell.', 36);

// Entrance steps and wall lights complete the source-view comparison silhouette.
for (let step = 0; step < 3; step += 1) {
  box(`entry_step_${step + 1}`, `Entry step ${step + 1}`, 'mechanical', [2_400 + step * 320, 150, 420],
    [-1_380, 75 + step * 110, FRONT_Z - 460 - step * 330], 'Honed stone', tile, renderEvidence,
    'Wide floating entrance step visible in the façade render.', 18);
}
for (const x of [-2_430, -210, 5_780]) {
  const id = `facade_light_${String(x).replace('-', 'n')}`;
  lightFixture(id, 'Façade wall light', [x, 1_820, FRONT_Z - 180], 'L1');
}
for (const [id, x, y, z, level] of [
  ['living_ceiling_light', -4_250, 2_720, -3_100, 'L1'],
  ['kitchen_ceiling_light', -4_250, 2_720, 2_650, 'L1'],
  ['foyer_ceiling_light', -1_590, 2_720, -3_180, 'L1'],
  ['upper_hall_ceiling_light', 200, FLOOR_HEIGHT_MM + 2_540, 360, 'L2'],
  ['primary_ceiling_light', 4_140, FLOOR_HEIGHT_MM + 2_540, 300, 'L2'],
  ['upper_bath_ceiling_light', 3_900, FLOOR_HEIGHT_MM + 2_540, 2_760, 'L2'],
] as const) lightFixture(id, id.replaceAll('_', ' '), [x, y, z], level);

// Morphloom's architectural front camera looks from +Z. The source drawing
// uses the opposite page convention, so mirror only the depth axis while
// preserving left/right (garage remains on the viewer's right).
for (const component of components) {
  component.level = component.id.startsWith('roof_')
    ? 'ROOF'
    : (component.position?.[1] ?? 0) >= FLOOR_HEIGHT_MM - SLAB_MM ? 'L2' : 'L1';
  if (component.position) component.position = [component.position[0], component.position[1], -component.position[2]];
  if (component.rotation) component.rotation = [-component.rotation[0], -component.rotation[1], component.rotation[2]];
}

export const MODERNCAT_CONCEPT_RESIDENCE_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'ModernCat two-storey residence · Pinterest concept-panel test',
  units: 'mm',
  components,
  metadata: {
    assetKind: 'building',
    buildingType: 'two-storey-residence',
    scope: 'architectural-review',
    modeledScope: 'concept-review-shell-interiors-wet-rooms-furniture-and-lighting',
    qualityTarget: 'semi-professional-editable',
    source: 'Pinterest composite concept panel · ModernCat Blueprints',
    sourceUrl: SOURCE_URL,
    sourceReliability: 'synthetic-concept',
    sourceAudit: 'partial geometry consistency; partial dimension legibility; no verified authoring or survey record',
    evidenceBuildReady: true,
    evidenceDeliveryReady: false,
    evidencePackScore: 84,
    evidenceUnresolvedCapabilities: 'verified-provenance,verified-section,field-measured-height,dimension-arithmetic',
    measuredWidthMm: WIDTH_MM,
    planScaledDepthMm: DEPTH_MM,
    estimatedGroundFloorHeightMm: FLOOR_HEIGHT_MM,
    estimatedUpperFloorHeightMm: UPPER_HEIGHT_MM,
    documentedFloors: 2,
    planFootprintVerified: true,
    planFootprintAudit: 'single composite sheet traced against both visible floor plans',
    footprintForm: 'rectangular-two-storey-house-with-front-balcony-and-attached-two-car-garage',
    courtyardVoids: 0,
    ceilingAndRoofIncluded: true,
    roofSystem: 'single-watertight-hip-roof',
    programCompleteness: 100,
    layoutEditable: true,
    lightingPreviewReady: true,
    requiredPrograms: 'living,dining,kitchen,garage,foyer,stair,powder-room,multifunction,bedrooms,upper-bathroom',
    structureAndMepReady: false,
    evidencePolicy: '패널에서 판독 가능한 12.44 m 폭과 평면 관계만 measured로 기록하고, 층고·지붕·재질·숨은 면은 estimated/inferred로 분리합니다.',
  },
};
