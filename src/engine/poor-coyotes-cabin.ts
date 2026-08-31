import type {
  AssemblyComponentIR,
  AssemblyIR,
  AssemblyMaterialIR,
  ComponentEvidenceIR,
  EvidenceStatusIR,
} from './assembly-ir';

const SOURCE_PAGE = 'https://www.loc.gov/resource/hhh.id0103.sheet';
const SOURCE_PDF = 'https://tile.loc.gov/storage-services/master/pnp/habshaer/id/id0100/id0103/data/id0103data.pdf';

const LENGTH_MM = 5283.2; // 17 ft 4 in
const WIDTH_MM = 4216.4; // 13 ft 10 in, the larger measured side from the sketch plan
const LOG_HEIGHT_MM = 190;
const LOG_DEPTH_MM = 260;
const WALL_COURSES = 13;
const WALL_TOP_MM = 2535;
const WINDOW_WIDTH_MM = 609.6; // 2 ft
const WINDOW_HEIGHT_MM = 838.2; // 2 ft 9 in
const WINDOW_SILL_MM = 914.4; // estimated from the elevation description and typical sill height
const DOOR_WIDTH_MM = 762; // 2 ft 6 in
const DOOR_HEIGHT_MM = 1803.4; // 5 ft 11 in
const ROOF_PITCH = THREE_DEGREES(38);

function THREE_DEGREES(value: number): number {
  return value * Math.PI / 180;
}

const evidence = (
  status: EvidenceStatusIR,
  notes: string[],
  source = SOURCE_PDF,
): ComponentEvidenceIR => ({ status, source, notes });

const logMaterial: AssemblyMaterialIR = {
  color: '#69452d',
  surface: 'wood',
  roughness: 0.82,
  metalness: 0,
  clearcoat: 0.04,
  clearcoatRoughness: 0.78,
  sheen: 0.12,
  microNormalStrength: 0.48,
  textureScale: [5, 38],
};

const agedTrimMaterial: AssemblyMaterialIR = {
  color: '#8b6846',
  surface: 'wood',
  roughness: 0.76,
  clearcoat: 0.03,
  microNormalStrength: 0.38,
  textureScale: [5, 24],
};

const cedarShakeMaterial: AssemblyMaterialIR = {
  color: '#4d3828',
  surface: 'wood',
  roughness: 0.9,
  clearcoat: 0,
  microNormalStrength: 0.62,
  textureScale: [12, 46],
};

const components: AssemblyComponentIR[] = [];
const add = (component: AssemblyComponentIR): void => { components.push(component); };

const measuredWallEvidence = evidence('measured', [
  'HABS sketch plan records an overall north-wall length of 17 ft 4 in.',
  'The west side is marked 13 ft 10 in; the east side is marked 13 ft 6 in.',
  'The written survey describes the cabin as approximately 13 ft 10 in by 17 ft 4 in.',
]);

const wallLog = (
  id: string,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  course: number,
): void => add({
  id,
  name,
  category: 'enclosure',
  materialName: 'Hand-hewn timber log',
  detail: `Wall course ${course + 1} · heavily hewn timber with lime-mortar chinking represented as a named construction unit`,
  geometry: { op: 'roundedBox', size, radius: 24, segments: 4 },
  position,
  material: logMaterial,
  evidence: measuredWallEvidence,
});

const splitAlongX = (
  side: 'north' | 'south',
  course: number,
  y: number,
  opening: boolean,
): void => {
  const z = side === 'north' ? WIDTH_MM / 2 : -WIDTH_MM / 2;
  if (!opening) {
    wallLog(`${side}_log_${course}`, `${side} wall log ${course + 1}`, [LENGTH_MM, LOG_HEIGHT_MM, LOG_DEPTH_MM], [0, y, z], course);
    return;
  }
  const segment = (LENGTH_MM - WINDOW_WIDTH_MM) / 2;
  const offset = WINDOW_WIDTH_MM / 2 + segment / 2;
  wallLog(`${side}_log_${course}_west`, `${side} wall log ${course + 1} west segment`, [segment, LOG_HEIGHT_MM, LOG_DEPTH_MM], [-offset, y, z], course);
  wallLog(`${side}_log_${course}_east`, `${side} wall log ${course + 1} east segment`, [segment, LOG_HEIGHT_MM, LOG_DEPTH_MM], [offset, y, z], course);
};

const splitAlongZ = (
  side: 'west' | 'east',
  course: number,
  y: number,
  openingWidth: number | undefined,
): void => {
  const x = side === 'east' ? LENGTH_MM / 2 : -LENGTH_MM / 2;
  if (!openingWidth) {
    wallLog(`${side}_log_${course}`, `${side} wall log ${course + 1}`, [LOG_DEPTH_MM, LOG_HEIGHT_MM, WIDTH_MM], [x, y, 0], course);
    return;
  }
  const segment = (WIDTH_MM - openingWidth) / 2;
  const offset = openingWidth / 2 + segment / 2;
  wallLog(`${side}_log_${course}_north`, `${side} wall log ${course + 1} north segment`, [LOG_DEPTH_MM, LOG_HEIGHT_MM, segment], [x, y, offset], course);
  wallLog(`${side}_log_${course}_south`, `${side} wall log ${course + 1} south segment`, [LOG_DEPTH_MM, LOG_HEIGHT_MM, segment], [x, y, -offset], course);
};

for (let course = 0; course < WALL_COURSES; course += 1) {
  const y = 160 + course * LOG_HEIGHT_MM;
  const inWindow = y + LOG_HEIGHT_MM / 2 > WINDOW_SILL_MM
    && y - LOG_HEIGHT_MM / 2 < WINDOW_SILL_MM + WINDOW_HEIGHT_MM;
  const inDoor = y - LOG_HEIGHT_MM / 2 < DOOR_HEIGHT_MM;
  splitAlongX('north', course, y, inWindow);
  splitAlongX('south', course, y, inWindow);
  splitAlongZ('east', course, y, inWindow ? WINDOW_WIDTH_MM : undefined);
  splitAlongZ('west', course, y, inDoor ? DOOR_WIDTH_MM : undefined);
}

for (const side of [-1, 1] as const) {
  const label = side < 0 ? 'west' : 'east';
  for (let course = 0; course < 8; course += 1) {
    const length = Math.max(520, WIDTH_MM - course * 500);
    add({
      id: `${label}_gable_log_${course}`,
      name: `${label} gable log ${course + 1}`,
      category: 'enclosure',
      materialName: 'Hand-hewn gable timber',
      detail: `Estimated gable infill course ${course + 1}; roof pitch is not dimensioned in the surviving plan.`,
      geometry: { op: 'roundedBox', size: [LOG_DEPTH_MM, 170, length], radius: 22, segments: 4 },
      position: [side * LENGTH_MM / 2, WALL_TOP_MM + 95 + course * 170, 0],
      material: logMaterial,
      evidence: evidence('estimated', ['Gable form is documented, but its rise and individual log dimensions are not given.']),
    });
  }
}

const trimBar = (
  id: string,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  detail: string,
  status: EvidenceStatusIR = 'datasheet',
): void => add({
  id,
  name,
  category: 'mechanical',
  materialName: 'Plain wood board trim',
  detail,
  geometry: { op: 'roundedBox', size, radius: 8, segments: 3 },
  position,
  material: agedTrimMaterial,
  evidence: evidence(status, [detail]),
});

const addWindowTrim = (side: 'north' | 'south' | 'east'): void => {
  const centerY = WINDOW_SILL_MM + WINDOW_HEIGHT_MM / 2;
  const jambHeight = WINDOW_HEIGHT_MM + 180;
  if (side === 'north' || side === 'south') {
    const z = (side === 'north' ? 1 : -1) * (WIDTH_MM / 2 + LOG_DEPTH_MM / 2 + 18);
    trimBar(`${side}_window_trim_left`, `${side} window left jamb`, [70, jambHeight, 38], [-WINDOW_WIDTH_MM / 2 - 35, centerY, z], '2 ft by 2 ft 9 in centered opening with plain board trim.');
    trimBar(`${side}_window_trim_right`, `${side} window right jamb`, [70, jambHeight, 38], [WINDOW_WIDTH_MM / 2 + 35, centerY, z], '2 ft by 2 ft 9 in centered opening with plain board trim.');
    trimBar(`${side}_window_trim_head`, `${side} window head trim`, [WINDOW_WIDTH_MM + 140, 70, 38], [0, centerY + WINDOW_HEIGHT_MM / 2 + 55, z], 'Plain wood head trim around the documented opening.');
    trimBar(`${side}_window_trim_sill`, `${side} window sill trim`, [WINDOW_WIDTH_MM + 140, 70, 70], [0, centerY - WINDOW_HEIGHT_MM / 2 - 55, z], 'Plain wood sill trim around the documented opening.');
    if (side === 'north') {
      trimBar('north_casement_vertical', 'North surviving casement vertical', [38, WINDOW_HEIGHT_MM, 32], [0, centerY, z + 24], 'Only the north four-pane casement frame remained; no glass was present.');
      trimBar('north_casement_horizontal', 'North surviving casement horizontal', [WINDOW_WIDTH_MM, 38, 32], [0, centerY, z + 24], 'Only the north four-pane casement frame remained; no glass was present.');
    }
    return;
  }
  const x = LENGTH_MM / 2 + LOG_DEPTH_MM / 2 + 18;
  trimBar('east_window_trim_north', 'east window north jamb', [38, jambHeight, 70], [x, centerY, WINDOW_WIDTH_MM / 2 + 35], '2 ft by 2 ft 9 in centered opening with plain board trim.');
  trimBar('east_window_trim_south', 'east window south jamb', [38, jambHeight, 70], [x, centerY, -WINDOW_WIDTH_MM / 2 - 35], '2 ft by 2 ft 9 in centered opening with plain board trim.');
  trimBar('east_window_trim_head', 'east window head trim', [38, 70, WINDOW_WIDTH_MM + 140], [x, centerY + WINDOW_HEIGHT_MM / 2 + 55, 0], 'Plain wood head trim around the documented opening.');
  trimBar('east_window_trim_sill', 'east window sill trim', [70, 70, WINDOW_WIDTH_MM + 140], [x, centerY - WINDOW_HEIGHT_MM / 2 - 55, 0], 'Plain wood sill trim around the documented opening.');
};

addWindowTrim('north');
addWindowTrim('south');
addWindowTrim('east');

const westFaceX = -LENGTH_MM / 2 - LOG_DEPTH_MM / 2 - 18;
trimBar('west_door_trim_north', 'west door north jamb', [38, DOOR_HEIGHT_MM + 120, 78], [westFaceX, DOOR_HEIGHT_MM / 2, DOOR_WIDTH_MM / 2 + 40], 'Centered 2 ft 6 in by 5 ft 11 in door opening; the door itself was missing at survey time.');
trimBar('west_door_trim_south', 'west door south jamb', [38, DOOR_HEIGHT_MM + 120, 78], [westFaceX, DOOR_HEIGHT_MM / 2, -DOOR_WIDTH_MM / 2 - 40], 'Centered 2 ft 6 in by 5 ft 11 in door opening; the door itself was missing at survey time.');
trimBar('west_door_trim_head', 'west door head trim', [38, 86, DOOR_WIDTH_MM + 160], [westFaceX, DOOR_HEIGHT_MM + 43, 0], 'Plain head trim over the documented centered door opening.');

const roofRun = WIDTH_MM / 2 + 520;
const roofSlope = roofRun / Math.cos(ROOF_PITCH);
const roofRise = Math.tan(ROOF_PITCH) * roofRun;
for (const side of [-1, 1] as const) {
  add({
    id: `cedar_shake_roof_${side < 0 ? 'south' : 'north'}`,
    name: `${side < 0 ? 'South' : 'North'} cedar shake roof plane`,
    category: 'enclosure',
    materialName: 'Weathered cedar shakes over tar paper',
    detail: 'Purlin roof with 1 by 12 in sheathing, tar paper, and 30 in cedar shakes; pitch and overhang are estimated because the floor-plan sheet does not dimension them.',
    geometry: { op: 'roundedBox', size: [LENGTH_MM + 900, 78, roofSlope], radius: 18, segments: 4 },
    position: [0, WALL_TOP_MM + roofRise / 2, side * roofRun / 2],
    rotation: [side * ROOF_PITCH, 0, 0],
    material: cedarShakeMaterial,
    evidence: evidence('estimated', [
      'The written HABS record specifies a gable purlin roof, 1 by 12 in sheathing, tar paper, and 30 in cedar shakes.',
      'Roof pitch, rise, and overhang were estimated for this single-plan reconstruction.',
    ]),
  });
}

add({
  id: 'roof_ridge_cap',
  name: 'Cedar ridge cap',
  category: 'enclosure',
  materialName: 'Weathered cedar ridge shakes',
  detail: 'Named ridge weathering layer at the inferred roof apex.',
  geometry: { op: 'roundedBox', size: [LENGTH_MM + 940, 150, 180], radius: 48, segments: 5 },
  position: [0, WALL_TOP_MM + roofRise, 0],
  material: cedarShakeMaterial,
  evidence: evidence('inferred', ['Ridge cap is reconstructed from the described cedar-shake roof system.']),
});

for (const side of [-1, 1] as const) {
  add({
    id: `support_skid_${side < 0 ? 'south' : 'north'}`,
    name: `${side < 0 ? 'South' : 'North'} support skid`,
    category: 'mechanical',
    materialName: 'De-barked support log',
    detail: 'One of the two exposed support logs sitting directly on earth; exact section and spacing are estimated.',
    geometry: { op: 'roundedBox', size: [LENGTH_MM - 180, 250, 300], radius: 95, segments: 6 },
    position: [0, -52, side * 1260],
    material: { ...logMaterial, color: '#594330', roughness: 0.9 },
    evidence: evidence('estimated', ['The HABS text confirms two supporting logs and no foundation; exact placement is not dimensioned.']),
  });
}

add({
  id: 'exposed_earth_floor',
  name: 'Exposed earth interior',
  category: 'mechanical',
  materialName: 'Compacted earth',
  detail: 'The survey explicitly records no floor; earth remains exposed inside the one-room cabin.',
  geometry: { op: 'roundedBox', size: [LENGTH_MM - 420, 55, WIDTH_MM - 420], radius: 18, segments: 3 },
  position: [0, 60, 0],
  material: {
    color: '#5a4636', surface: 'raw', roughness: 0.96, metalness: 0,
    clearcoat: 0, microNormalStrength: 0,
  },
  evidence: evidence('datasheet', ['The HABS interior description states that no floor remains and earth is exposed.']),
});

export const POOR_COYOTES_CABIN_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'Poor Coyote’s Cabin · HABS ID-75',
  units: 'mm',
  components,
  metadata: {
    assetKind: 'building',
    scope: 'architectural-shell-only',
    source: 'Historic American Buildings Survey · HABS ID-75',
    sourceUrl: SOURCE_PAGE,
    sourcePdf: SOURCE_PDF,
    license: 'No known restrictions on U.S. Government HABS materials',
    measuredLengthMm: LENGTH_MM,
    measuredWidthMm: WIDTH_MM,
    measuredWestSideMm: WIDTH_MM,
    measuredEastSideMm: 4114.8,
    estimatedWallTopMm: WALL_TOP_MM,
    estimatedRoofPitchDegrees: 38,
    evidencePolicy: '도면·HABS 기록의 실측값과 미기재 형상의 추정값을 부품별로 분리 기록합니다.',
  },
};
