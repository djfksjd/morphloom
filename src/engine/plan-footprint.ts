import * as THREE from 'three';

export interface PlanFootprintRegion {
  id: string;
  /** [minimum X, minimum Z, maximum X, maximum Z] in assembly millimetres. */
  boundsMm: [number, number, number, number];
}

export interface PlanFootprintDescriptor {
  schema: 'morphloom.plan-footprint/0.1';
  /** Named compiled components that physically carry the plan footprint. */
  componentIds: string[];
  /** Union of source-derived occupied regions. */
  targetRegions: PlanFootprintRegion[];
  /** Source-derived spaces that must remain empty, such as a courtyard. */
  voidRegions?: PlanFootprintRegion[];
  /** Raster resolution per longest axis. */
  resolution?: number;
  minimumIoU?: number;
  maximumFalsePositiveFraction?: number;
  maximumFalseNegativeFraction?: number;
  maximumVoidOccupancy?: number;
  evidence: {
    status: 'measured' | 'datasheet';
    source: string;
    note: string;
  };
}

export interface PlanFootprintAudit {
  schema: 'morphloom.plan-footprint-audit/0.1';
  pass: boolean;
  blockers: string[];
  resolution: [number, number];
  targetCells: number;
  actualCells: number;
  intersectionCells: number;
  unionCells: number;
  iou: number;
  falsePositiveFraction: number;
  falseNegativeFraction: number;
  voidOccupancy: Array<{ id: string; occupiedCells: number; cells: number; fraction: number }>;
  missingComponentIds: string[];
}

const finiteBounds = (bounds: readonly number[]): boolean => bounds.length === 4
  && bounds.every(Number.isFinite)
  && bounds[2]! > bounds[0]!
  && bounds[3]! > bounds[1]!;

export function validatePlanFootprintDescriptor(descriptor: PlanFootprintDescriptor): void {
  if (!descriptor || descriptor.schema !== 'morphloom.plan-footprint/0.1') {
    throw new Error('Unsupported plan-footprint schema.');
  }
  if (!Array.isArray(descriptor.componentIds) || descriptor.componentIds.length < 1
    || descriptor.componentIds.length > 256 || new Set(descriptor.componentIds).size !== descriptor.componentIds.length
    || descriptor.componentIds.some((id) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) {
    throw new Error('Plan-footprint component ids are invalid.');
  }
  const regions = [...descriptor.targetRegions, ...(descriptor.voidRegions ?? [])];
  const regionIds = regions.map((region) => region?.id);
  if (descriptor.targetRegions.length < 1 || descriptor.targetRegions.length > 128
    || (descriptor.voidRegions?.length ?? 0) > 128
    || new Set(regionIds).size !== regionIds.length
    || regions.some((region) => !region || !/^[a-zA-Z0-9_-]{1,80}$/.test(region.id)
      || !finiteBounds(region.boundsMm))) {
    throw new Error('Plan-footprint regions are invalid.');
  }
  if ((descriptor.voidRegions ?? []).some((empty) => descriptor.targetRegions.some((occupied) => (
    Math.min(empty.boundsMm[2], occupied.boundsMm[2]) > Math.max(empty.boundsMm[0], occupied.boundsMm[0])
      && Math.min(empty.boundsMm[3], occupied.boundsMm[3]) > Math.max(empty.boundsMm[1], occupied.boundsMm[1])
  )))) {
    throw new Error('Plan-footprint occupied and void regions overlap.');
  }
  const resolution = descriptor.resolution ?? 128;
  if (!Number.isInteger(resolution) || resolution < 32 || resolution > 256) {
    throw new Error('Plan-footprint resolution must be an integer from 32 to 256.');
  }
  for (const [label, value] of [
    ['minimum IoU', descriptor.minimumIoU ?? 0.97],
    ['maximum false-positive fraction', descriptor.maximumFalsePositiveFraction ?? 0.02],
    ['maximum false-negative fraction', descriptor.maximumFalseNegativeFraction ?? 0.02],
    ['maximum void occupancy', descriptor.maximumVoidOccupancy ?? 0.01],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Plan-footprint ${label} is invalid.`);
  }
  if (!descriptor.evidence || !['measured', 'datasheet'].includes(descriptor.evidence.status)
    || typeof descriptor.evidence.source !== 'string' || descriptor.evidence.source.length < 1
    || descriptor.evidence.source.length > 500 || typeof descriptor.evidence.note !== 'string'
    || descriptor.evidence.note.length < 1 || descriptor.evidence.note.length > 1_000) {
    throw new Error('Plan-footprint evidence is invalid.');
  }
}

function contains(region: PlanFootprintRegion, xMm: number, zMm: number): boolean {
  const [minX, minZ, maxX, maxZ] = region.boundsMm;
  return xMm >= minX && xMm <= maxX && zMm >= minZ && zMm <= maxZ;
}

export function auditPlanFootprint(root: THREE.Object3D, descriptor: PlanFootprintDescriptor): PlanFootprintAudit {
  validatePlanFootprintDescriptor(descriptor);
  root.updateMatrixWorld(true);
  const missingComponentIds = descriptor.componentIds.filter((id) => !root.getObjectByName(id));
  const footprintObjects = descriptor.componentIds
    .map((id) => root.getObjectByName(id))
    .filter((object): object is THREE.Object3D => Boolean(object));
  const objectBounds = new THREE.Box3();
  footprintObjects.forEach((object) => objectBounds.expandByObject(object));
  const targetEnvelope = [...descriptor.targetRegions, ...(descriptor.voidRegions ?? [])].reduce((bounds, region) => ({
    minX: Math.min(bounds.minX, region.boundsMm[0]),
    minZ: Math.min(bounds.minZ, region.boundsMm[1]),
    maxX: Math.max(bounds.maxX, region.boundsMm[2]),
    maxZ: Math.max(bounds.maxZ, region.boundsMm[3]),
  }), { minX: Number.POSITIVE_INFINITY, minZ: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxZ: Number.NEGATIVE_INFINITY });
  if (!objectBounds.isEmpty()) {
    targetEnvelope.minX = Math.min(targetEnvelope.minX, objectBounds.min.x * 1000);
    targetEnvelope.minZ = Math.min(targetEnvelope.minZ, objectBounds.min.z * 1000);
    targetEnvelope.maxX = Math.max(targetEnvelope.maxX, objectBounds.max.x * 1000);
    targetEnvelope.maxZ = Math.max(targetEnvelope.maxZ, objectBounds.max.z * 1000);
  }
  const widthMm = targetEnvelope.maxX - targetEnvelope.minX;
  const depthMm = targetEnvelope.maxZ - targetEnvelope.minZ;
  const longestResolution = descriptor.resolution ?? 128;
  const cellsX = Math.max(32, Math.round(longestResolution * widthMm / Math.max(widthMm, depthMm)));
  const cellsZ = Math.max(32, Math.round(longestResolution * depthMm / Math.max(widthMm, depthMm)));
  const stepX = widthMm / cellsX;
  const stepZ = depthMm / cellsZ;
  const rayHeight = Number.isFinite(objectBounds.max.y) ? objectBounds.max.y + Math.max(1, objectBounds.max.y - objectBounds.min.y + 1) : 1;
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let targetCells = 0;
  let actualCells = 0;
  let intersectionCells = 0;
  let unionCells = 0;
  let falsePositiveCells = 0;
  let falseNegativeCells = 0;
  const voidCounts = (descriptor.voidRegions ?? []).map((region) => ({ id: region.id, occupiedCells: 0, cells: 0 }));
  for (let zIndex = 0; zIndex < cellsZ; zIndex += 1) {
    const zMm = targetEnvelope.minZ + (zIndex + 0.5) * stepZ;
    for (let xIndex = 0; xIndex < cellsX; xIndex += 1) {
      const xMm = targetEnvelope.minX + (xIndex + 0.5) * stepX;
      const target = descriptor.targetRegions.some((region) => contains(region, xMm, zMm));
      raycaster.set(new THREE.Vector3(xMm / 1000, rayHeight, zMm / 1000), down);
      const actual = footprintObjects.length > 0 && raycaster.intersectObjects(footprintObjects, true).length > 0;
      if (target) targetCells += 1;
      if (actual) actualCells += 1;
      if (target && actual) intersectionCells += 1;
      if (target || actual) unionCells += 1;
      if (!target && actual) falsePositiveCells += 1;
      if (target && !actual) falseNegativeCells += 1;
      (descriptor.voidRegions ?? []).forEach((region, index) => {
        if (!contains(region, xMm, zMm)) return;
        voidCounts[index]!.cells += 1;
        if (actual) voidCounts[index]!.occupiedCells += 1;
      });
    }
  }
  const iou = intersectionCells / Math.max(1, unionCells);
  const falsePositiveFraction = falsePositiveCells / Math.max(1, targetCells);
  const falseNegativeFraction = falseNegativeCells / Math.max(1, targetCells);
  const voidOccupancy = voidCounts.map((entry) => ({
    ...entry,
    fraction: entry.occupiedCells / Math.max(1, entry.cells),
  }));
  const blockers: string[] = [];
  if (missingComponentIds.length > 0) blockers.push(`missing footprint components: ${missingComponentIds.join(', ')}`);
  if (iou < (descriptor.minimumIoU ?? 0.97)) blockers.push(`plan projection IoU ${iou.toFixed(3)} is below ${(descriptor.minimumIoU ?? 0.97).toFixed(3)}`);
  if (falsePositiveFraction > (descriptor.maximumFalsePositiveFraction ?? 0.02)) blockers.push(`plan overbuild ${(falsePositiveFraction * 100).toFixed(1)}% exceeds ${((descriptor.maximumFalsePositiveFraction ?? 0.02) * 100).toFixed(1)}%`);
  if (falseNegativeFraction > (descriptor.maximumFalseNegativeFraction ?? 0.02)) blockers.push(`plan underbuild ${(falseNegativeFraction * 100).toFixed(1)}% exceeds ${((descriptor.maximumFalseNegativeFraction ?? 0.02) * 100).toFixed(1)}%`);
  for (const entry of voidOccupancy) {
    if (entry.fraction > (descriptor.maximumVoidOccupancy ?? 0.01)) blockers.push(`void ${entry.id} occupancy ${(entry.fraction * 100).toFixed(1)}% exceeds ${((descriptor.maximumVoidOccupancy ?? 0.01) * 100).toFixed(1)}%`);
  }
  return {
    schema: 'morphloom.plan-footprint-audit/0.1', pass: blockers.length === 0, blockers,
    resolution: [cellsX, cellsZ], targetCells, actualCells, intersectionCells, unionCells,
    iou, falsePositiveFraction, falseNegativeFraction, voidOccupancy, missingComponentIds,
  };
}
