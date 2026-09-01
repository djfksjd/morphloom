import * as THREE from 'three';

export interface PlanFootprintRegion {
  id: string;
  /** [minimum X, minimum Z, maximum X, maximum Z] in assembly millimetres. */
  boundsMm?: [number, number, number, number];
  /** Ordered X/Z outline in assembly millimetres. Concave simple polygons are supported. */
  polygonMm?: Array<[number, number]>;
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

type Point2 = readonly [number, number];

function regionPolygon(region: PlanFootprintRegion): Point2[] {
  if (region.boundsMm) {
    const [minX, minZ, maxX, maxZ] = region.boundsMm;
    return [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  }
  return region.polygonMm ?? [];
}

function polygonSignedArea(points: readonly Point2[]): number {
  let doubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    doubleArea += current[0] * next[1] - next[0] * current[1];
  }
  return doubleArea / 2;
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Point2, b: Point2, point: Point2): boolean {
  const epsilon = 1e-7;
  return Math.abs(orientation(a, b, point)) <= epsilon
    && point[0] >= Math.min(a[0], b[0]) - epsilon && point[0] <= Math.max(a[0], b[0]) + epsilon
    && point[1] >= Math.min(a[1], b[1]) - epsilon && point[1] <= Math.max(a[1], b[1]) + epsilon;
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function simplePolygon(points: readonly Point2[]): boolean {
  if (points.length < 3 || points.length > 256 || Math.abs(polygonSignedArea(points)) <= 1e-6) return false;
  if (points.some((point) => point.length !== 2 || !point.every(Number.isFinite))) return false;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    if (a[0] === b[0] && a[1] === b[1]) return false;
    for (let other = index + 1; other < points.length; other += 1) {
      if (other === index || other === (index + 1) % points.length
        || index === (other + 1) % points.length) continue;
      const c = points[other]!;
      const d = points[(other + 1) % points.length]!;
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function regionEnvelope(region: PlanFootprintRegion): [number, number, number, number] {
  if (region.boundsMm) return region.boundsMm;
  return regionPolygon(region).reduce<[number, number, number, number]>((bounds, point) => [
    Math.min(bounds[0], point[0]), Math.min(bounds[1], point[1]),
    Math.max(bounds[2], point[0]), Math.max(bounds[3], point[1]),
  ], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]);
}

function pointInPolygon(points: readonly Point2[], xMm: number, zMm: number): boolean {
  for (let index = 0; index < points.length; index += 1) {
    if (onSegment(points[index]!, points[(index + 1) % points.length]!, [xMm, zMm])) return true;
  }
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index]!;
    const prior = points[previous]!;
    if ((current[1] > zMm) !== (prior[1] > zMm)
      && xMm < (prior[0] - current[0]) * (zMm - current[1]) / (prior[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
}

function regionsOverlap(a: PlanFootprintRegion, b: PlanFootprintRegion): boolean {
  const aBounds = regionEnvelope(a);
  const bBounds = regionEnvelope(b);
  const minX = Math.max(aBounds[0], bBounds[0]);
  const minZ = Math.max(aBounds[1], bBounds[1]);
  const maxX = Math.min(aBounds[2], bBounds[2]);
  const maxZ = Math.min(aBounds[3], bBounds[3]);
  if (maxX <= minX || maxZ <= minZ) return false;
  // Interior sampling treats shared walls as legal but catches positive-area overlap
  // between concave regions without depending on polygon winding.
  const samples = 24;
  for (let zIndex = 0; zIndex < samples; zIndex += 1) {
    for (let xIndex = 0; xIndex < samples; xIndex += 1) {
      const x = minX + (xIndex + 0.5) * (maxX - minX) / samples;
      const z = minZ + (zIndex + 0.5) * (maxZ - minZ) / samples;
      if (contains(a, x, z) && contains(b, x, z)) return true;
    }
  }
  return false;
}

export function validatePlanFootprintDescriptor(descriptor: PlanFootprintDescriptor): void {
  if (!descriptor || descriptor.schema !== 'morphloom.plan-footprint/0.1') {
    throw new Error('Unsupported plan-footprint schema.');
  }
  if (!Array.isArray(descriptor.componentIds) || descriptor.componentIds.length < 1
    || descriptor.componentIds.length > 256 || new Set(descriptor.componentIds).size !== descriptor.componentIds.length
    || descriptor.componentIds.some((id) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) {
    throw new Error('Plan-footprint component ids are invalid.');
  }
  if (!Array.isArray(descriptor.targetRegions) || !Array.isArray(descriptor.voidRegions ?? [])) {
    throw new Error('Plan-footprint regions are invalid.');
  }
  const regions = [...descriptor.targetRegions, ...(descriptor.voidRegions ?? [])];
  const regionIds = regions.map((region) => region?.id);
  if (descriptor.targetRegions.length < 1 || descriptor.targetRegions.length > 128
    || (descriptor.voidRegions?.length ?? 0) > 128
    || new Set(regionIds).size !== regionIds.length
    || regions.some((region) => {
      if (!region || !/^[a-zA-Z0-9_-]{1,80}$/.test(region.id)) return true;
      const forms = Number(region.boundsMm !== undefined) + Number(region.polygonMm !== undefined);
      return forms !== 1 || (region.boundsMm ? !finiteBounds(region.boundsMm) : !simplePolygon(region.polygonMm ?? []));
    })) {
    throw new Error('Plan-footprint regions are invalid.');
  }
  if ((descriptor.voidRegions ?? []).some((empty) => descriptor.targetRegions.some((occupied) => regionsOverlap(empty, occupied)))) {
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
  if (region.boundsMm) {
    const [minX, minZ, maxX, maxZ] = region.boundsMm;
    return xMm >= minX && xMm <= maxX && zMm >= minZ && zMm <= maxZ;
  }
  return pointInPolygon(regionPolygon(region), xMm, zMm);
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
  const targetEnvelope = [...descriptor.targetRegions, ...(descriptor.voidRegions ?? [])].reduce((bounds, region) => {
    const envelope = regionEnvelope(region);
    return {
      minX: Math.min(bounds.minX, envelope[0]), minZ: Math.min(bounds.minZ, envelope[1]),
      maxX: Math.max(bounds.maxX, envelope[2]), maxZ: Math.max(bounds.maxZ, envelope[3]),
    };
  }, { minX: Number.POSITIVE_INFINITY, minZ: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxZ: Number.NEGATIVE_INFINITY });
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
