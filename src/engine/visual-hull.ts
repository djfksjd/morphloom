/**
 * Space-carving algorithm adapted from img2threejs.
 * Copyright 2026 hoainho. Licensed under Apache-2.0.
 * Source: https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/visual_hull.py
 * Modified for Morphloom: TypeScript typed-array output, bounded allocation,
 * explicit empty-hull status, and direct Three.js BufferGeometry conversion.
 */
import * as THREE from 'three';

export type VisualHullViewAxis = 'front' | 'side' | 'top';
export type VisualHullWorldAxis = 'x' | 'y' | 'z';

export interface VisualHullView {
  axis: VisualHullViewAxis;
  confidence: number;
  /** Equal-width binary rows: `1` is foreground, `0` is background. */
  mask: string[];
}

export interface VisualHullDescriptor {
  projection: 'orthographic';
  boundsSpace: 'component-local';
  bounds: { min: [number, number, number]; max: [number, number, number] };
  resolution: number;
  triangleBudget: number;
  /** Bounded silhouette dilation for small calibration/segmentation errors. */
  silhouetteToleranceVoxels?: number;
  views: VisualHullView[];
  hiddenRegions?: string[];
}

export interface VisualHullResult {
  positions: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  triangleBudget: number;
  resolution: number;
  occupiedVoxelCount: number;
  totalVoxelCount: number;
  occupiedFraction: number;
  viewAxes: VisualHullViewAxis[];
  viewAgreement: Array<{
    axis: VisualHullViewAxis;
    confidence: number;
    silhouetteIoU: number;
    falseNegativeFraction: number;
    falsePositiveFraction: number;
  }>;
  minimumViewIoU: number;
  confidenceWeightedIoU: number;
  unconstrainedAxes: VisualHullWorldAxis[];
  status: 'carved' | 'empty';
  limitations: string[];
}

const MIN_MASK_DIMENSION = 4;
const MAX_MASK_DIMENSION = 256;
const MAX_RESOLUTION = 32;
const MAX_TRIANGLES = 400_000;
const MAX_VOXELS = MAX_RESOLUTION ** 3;

const VIEW_AXES: Record<VisualHullViewAxis, readonly [number, boolean, number, boolean]> = {
  front: [0, false, 1, true],
  side: [2, false, 1, true],
  top: [0, false, 2, false],
};
const VIEW_FREE_AXIS: Record<VisualHullViewAxis, number> = { front: 2, side: 0, top: 1 };
const AXIS_NAMES: VisualHullWorldAxis[] = ['x', 'y', 'z'];

function finiteTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function validateMask(mask: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(mask) || mask.length < MIN_MASK_DIMENSION || mask.length > MAX_MASK_DIMENSION) {
    errors.push(`${label} height must be ${MIN_MASK_DIMENSION}..${MAX_MASK_DIMENSION}.`);
    return;
  }
  let width: number | undefined;
  let foreground = 0;
  mask.forEach((row, index) => {
    if (typeof row !== 'string' || !/^[01]+$/.test(row)) {
      errors.push(`${label}[${index}] must be a non-empty binary string.`);
      return;
    }
    width ??= row.length;
    if (row.length !== width) errors.push(`${label} rows must have equal width.`);
    foreground += row.split('1').length - 1;
  });
  if (width === undefined || width < MIN_MASK_DIMENSION || width > MAX_MASK_DIMENSION) {
    errors.push(`${label} width must be ${MIN_MASK_DIMENSION}..${MAX_MASK_DIMENSION}.`);
  }
  if (foreground === 0) errors.push(`${label} must contain foreground pixels.`);
}

export function validateVisualHullDescriptor(descriptor: unknown): asserts descriptor is VisualHullDescriptor {
  const errors: string[] = [];
  if (typeof descriptor !== 'object' || descriptor === null) throw new Error('Visual hull descriptor must be an object.');
  const value = descriptor as Partial<VisualHullDescriptor>;
  if (value.projection !== 'orthographic') errors.push('projection must be orthographic.');
  if (value.boundsSpace !== 'component-local') errors.push('boundsSpace must be component-local.');
  if (!value.bounds || !finiteTuple(value.bounds.min) || !finiteTuple(value.bounds.max)) {
    errors.push('bounds must contain finite min/max tuples.');
  } else if (value.bounds.min.some((minimum, axis) => minimum >= value.bounds!.max[axis])) {
    errors.push('each minimum bound must be below its maximum.');
  }
  if (!Number.isInteger(value.resolution) || (value.resolution ?? 0) < MIN_MASK_DIMENSION || (value.resolution ?? 0) > MAX_RESOLUTION) {
    errors.push(`resolution must be an integer from ${MIN_MASK_DIMENSION} to ${MAX_RESOLUTION}.`);
  }
  if (!Number.isInteger(value.triangleBudget) || (value.triangleBudget ?? 0) < 1 || (value.triangleBudget ?? 0) > MAX_TRIANGLES) {
    errors.push(`triangleBudget must be an integer from 1 to ${MAX_TRIANGLES}.`);
  }
  if (value.silhouetteToleranceVoxels !== undefined
    && (!Number.isInteger(value.silhouetteToleranceVoxels) || value.silhouetteToleranceVoxels < 0 || value.silhouetteToleranceVoxels > 2)) {
    errors.push('silhouetteToleranceVoxels must be an integer from 0 to 2.');
  }
  if (Number.isInteger(value.resolution) && Number.isInteger(value.triangleBudget)) {
    const worstCase = (value.resolution as number) ** 3 * 12;
    if ((value.triangleBudget as number) < worstCase) errors.push(`triangleBudget must be at least ${worstCase} for this resolution.`);
  }
  if (!Array.isArray(value.views) || value.views.length < 2 || value.views.length > 3) {
    errors.push('views must contain two or three distinct orthographic views.');
  } else {
    const axes = new Set<VisualHullViewAxis>();
    value.views.forEach((view, index) => {
      if (!view || !Object.hasOwn(VIEW_AXES, view.axis)) errors.push(`views[${index}].axis is invalid.`);
      else if (axes.has(view.axis)) errors.push('view axes must be distinct.');
      else axes.add(view.axis);
      if (typeof view?.confidence !== 'number' || !Number.isFinite(view.confidence) || view.confidence <= 0 || view.confidence > 1) {
        errors.push(`views[${index}].confidence must be within (0, 1].`);
      }
      validateMask(view?.mask, `views[${index}].mask`, errors);
    });
  }
  if (value.hiddenRegions !== undefined && (!Array.isArray(value.hiddenRegions)
    || value.hiddenRegions.length > 256
    || value.hiddenRegions.some((region) => typeof region !== 'string' || region.trim().length === 0 || region.length > 256))) {
    errors.push('hiddenRegions must be at most 256 non-empty strings of at most 256 characters.');
  }
  if (errors.length > 0) throw new Error(`Invalid visual hull descriptor: ${errors.join(' ')}`);
}

function sampleMask(mask: string[], column: number, row: number): boolean {
  const width = mask[0].length;
  const x = Math.floor(column * width);
  const y = Math.floor(row * mask.length);
  return x >= 0 && y >= 0 && x < width && y < mask.length && mask[y][x] === '1';
}

function sampleMaskWithTolerance(mask: string[], column: number, row: number, toleranceVoxels: number, resolution: number): boolean {
  if (toleranceVoxels <= 0) return sampleMask(mask, column, row);
  const width = mask[0]!.length;
  const height = mask.length;
  const centerX = Math.floor(column * width);
  const centerY = Math.floor(row * height);
  const radiusX = Math.max(1, Math.ceil(toleranceVoxels * width / resolution));
  const radiusY = Math.max(1, Math.ceil(toleranceVoxels * height / resolution));
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
      if (x < 0 || x >= width) continue;
      const normalized = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2;
      if (normalized <= 1 && mask[y]![x] === '1') return true;
    }
  }
  return false;
}

function voxelKey(x: number, y: number, z: number, resolution: number): number {
  return x + resolution * (y + resolution * z);
}

function inspectProjectionAgreement(
  occupied: Uint8Array,
  resolution: number,
  views: VisualHullView[],
): Pick<VisualHullResult, 'viewAgreement' | 'minimumViewIoU' | 'confidenceWeightedIoU'> {
  const viewAgreement = views.map((view) => {
    const predicted = new Uint8Array(resolution * resolution);
    for (let z = 0; z < resolution; z += 1) {
      for (let y = 0; y < resolution; y += 1) {
        for (let x = 0; x < resolution; x += 1) {
          if (occupied[voxelKey(x, y, z, resolution)] === 0) continue;
          const coordinates = [x, y, z];
          const [columnAxis, columnFlip, rowAxis, rowFlip] = VIEW_AXES[view.axis];
          let column = coordinates[columnAxis]!;
          let row = coordinates[rowAxis]!;
          if (columnFlip) column = resolution - column - 1;
          if (rowFlip) row = resolution - row - 1;
          predicted[row * resolution + column] = 1;
        }
      }
    }
    let intersection = 0;
    let union = 0;
    let targetCount = 0;
    let predictedCount = 0;
    for (let row = 0; row < resolution; row += 1) {
      for (let column = 0; column < resolution; column += 1) {
        const target = sampleMask(view.mask, (column + 0.5) / resolution, (row + 0.5) / resolution);
        const projected = predicted[row * resolution + column] === 1;
        if (target) targetCount += 1;
        if (projected) predictedCount += 1;
        if (target && projected) intersection += 1;
        if (target || projected) union += 1;
      }
    }
    return {
      axis: view.axis,
      confidence: view.confidence,
      silhouetteIoU: intersection / Math.max(1, union),
      falseNegativeFraction: (targetCount - intersection) / Math.max(1, targetCount),
      falsePositiveFraction: (predictedCount - intersection) / Math.max(1, predictedCount),
    };
  });
  const confidenceTotal = views.reduce((sum, view) => sum + view.confidence, 0);
  return {
    viewAgreement,
    minimumViewIoU: Math.min(...viewAgreement.map((item) => item.silhouetteIoU)),
    confidenceWeightedIoU: viewAgreement.reduce((sum, item) => sum + item.silhouetteIoU * item.confidence, 0)
      / Math.max(1e-9, confidenceTotal),
  };
}

function boundarySurface(
  occupied: Uint8Array,
  low: [number, number, number],
  step: [number, number, number],
  resolution: number,
): { positions: Float32Array; indices: Uint32Array } {
  const positionValues: number[] = [];
  const indexValues: number[] = [];
  const vertexIds = new Map<number, number>();
  const cornerStride = resolution + 1;
  const corner = (x: number, y: number, z: number): number => {
    const key = x + cornerStride * (y + cornerStride * z);
    const found = vertexIds.get(key);
    if (found !== undefined) return found;
    const index = positionValues.length / 3;
    vertexIds.set(key, index);
    positionValues.push(low[0] + x * step[0], low[1] + y * step[1], low[2] + z * step[2]);
    return index;
  };
  const faces: ReadonlyArray<readonly [number, number, ReadonlyArray<readonly [number, number, number]>]> = [
    [0, 1, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [0, -1, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
    [1, 1, [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [1, -1, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [2, 1, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [2, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ];
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        if (occupied[voxelKey(x, y, z, resolution)] === 0) continue;
        for (const [axis, direction, offsets] of faces) {
          const neighbor = [x, y, z];
          neighbor[axis] += direction;
          const outside = neighbor[axis] < 0 || neighbor[axis] >= resolution;
          if (!outside && occupied[voxelKey(neighbor[0], neighbor[1], neighbor[2], resolution)] !== 0) continue;
          const quad = offsets.map(([dx, dy, dz]) => corner(x + dx, y + dy, z + dz));
          indexValues.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
        }
      }
    }
  }
  return { positions: new Float32Array(positionValues), indices: new Uint32Array(indexValues) };
}

export function carveVisualHull(descriptor: VisualHullDescriptor): VisualHullResult {
  validateVisualHullDescriptor(descriptor);
  const { min: low, max: high } = descriptor.bounds;
  const resolution = descriptor.resolution;
  const totalVoxelCount = resolution ** 3;
  if (totalVoxelCount > MAX_VOXELS) throw new Error('Visual hull voxel budget exceeded.');
  const step: [number, number, number] = [
    (high[0] - low[0]) / resolution,
    (high[1] - low[1]) / resolution,
    (high[2] - low[2]) / resolution,
  ];
  const occupied = new Uint8Array(totalVoxelCount);
  const silhouetteToleranceVoxels = descriptor.silhouetteToleranceVoxels ?? 0;
  let occupiedVoxelCount = 0;
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const point = [low[0] + (x + 0.5) * step[0], low[1] + (y + 0.5) * step[1], low[2] + (z + 0.5) * step[2]];
        const inside = descriptor.views.every((view) => {
          const [columnAxis, columnFlip, rowAxis, rowFlip] = VIEW_AXES[view.axis];
          let u = (point[columnAxis] - low[columnAxis]) / (high[columnAxis] - low[columnAxis]);
          let v = (point[rowAxis] - low[rowAxis]) / (high[rowAxis] - low[rowAxis]);
          if (columnFlip) u = 1 - u;
          if (rowFlip) v = 1 - v;
          return sampleMaskWithTolerance(view.mask, u, v, silhouetteToleranceVoxels, resolution);
        });
        if (!inside) continue;
        occupied[voxelKey(x, y, z, resolution)] = 1;
        occupiedVoxelCount += 1;
      }
    }
  }
  const surface = boundarySurface(occupied, low, step, resolution);
  const projectionAgreement = inspectProjectionAgreement(occupied, resolution, descriptor.views);
  const covered = new Set(descriptor.views.map((view) => VIEW_FREE_AXIS[view.axis]));
  const unconstrainedAxes = AXIS_NAMES.filter((_, axis) => !covered.has(axis));
  const limitations = [
    'A visual hull is an upper bound and cannot reproduce a concavity that no supplied silhouette exposes.',
  ];
  if (descriptor.views.length < 3) limitations.push(`Only ${descriptor.views.length} views were supplied; ${unconstrainedAxes.join(', ')} remains loose.`);
  if (silhouetteToleranceVoxels > 0) limitations.push(`Silhouettes were dilated by at most ${silhouetteToleranceVoxels} voxel(s); inspect per-view projection error before delivery.`);
  if (projectionAgreement.minimumViewIoU < 0.75) limitations.push(`Minimum source-view silhouette IoU is ${projectionAgreement.minimumViewIoU.toFixed(3)}; source calibration or masks require review.`);
  return {
    ...surface,
    triangleCount: surface.indices.length / 3,
    triangleBudget: descriptor.triangleBudget,
    resolution,
    occupiedVoxelCount,
    totalVoxelCount,
    occupiedFraction: occupiedVoxelCount / totalVoxelCount,
    viewAxes: descriptor.views.map((view) => view.axis),
    ...projectionAgreement,
    unconstrainedAxes,
    status: occupiedVoxelCount === 0 ? 'empty' : 'carved',
    limitations,
  };
}

export function visualHullToBufferGeometry(result: VisualHullResult): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
