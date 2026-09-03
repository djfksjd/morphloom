/**
 * Space-carving algorithm adapted from img2threejs.
 * Copyright 2026 hoainho. Licensed under Apache-2.0.
 * Source: https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/visual_hull.py
 * Modified for Morphloom: TypeScript typed-array output, bounded allocation,
 * explicit empty-hull status, and direct Three.js BufferGeometry conversion.
 */
import * as THREE from 'three';

export type VisualHullViewAxis = 'front' | 'side' | 'top' | 'azimuth';
export type VisualHullWorldAxis = 'x' | 'y' | 'z';

export interface VisualHullView {
  axis: VisualHullViewAxis;
  /** Clockwise yaw around +Y. Required only for `axis: 'azimuth'`. */
  azimuthDegrees?: number;
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
  viewAxes: string[];
  viewAgreement: Array<{
    axis: string;
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
const MAX_RESOLUTION = 48;
const MAX_TRIANGLES = 1_400_000;
const MAX_VOXELS = MAX_RESOLUTION ** 3;

interface ProjectionFrame {
  label: string;
  horizontal: [number, number, number];
  vertical: [number, number, number];
  direction: [number, number, number];
  rowFlip: boolean;
  minimumHorizontal: number;
  maximumHorizontal: number;
  minimumVertical: number;
  maximumVertical: number;
}

const CANONICAL_FRAMES: Record<Exclude<VisualHullViewAxis, 'azimuth'>, Pick<ProjectionFrame, 'label' | 'horizontal' | 'vertical' | 'direction' | 'rowFlip'>> = {
  front: { label: 'front', horizontal: [1, 0, 0], vertical: [0, 1, 0], direction: [0, 0, 1], rowFlip: true },
  side: { label: 'side', horizontal: [0, 0, 1], vertical: [0, 1, 0], direction: [1, 0, 0], rowFlip: true },
  top: { label: 'top', horizontal: [1, 0, 0], vertical: [0, 0, 1], direction: [0, 1, 0], rowFlip: false },
};
const AXIS_NAMES: VisualHullWorldAxis[] = ['x', 'y', 'z'];

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function viewLabel(view: VisualHullView): string {
  return view.axis === 'azimuth' ? `azimuth-${String(view.azimuthDegrees).padStart(3, '0')}` : view.axis;
}

function baseFrame(view: VisualHullView): Pick<ProjectionFrame, 'label' | 'horizontal' | 'vertical' | 'direction' | 'rowFlip'> {
  if (view.axis !== 'azimuth') return CANONICAL_FRAMES[view.axis];
  const radians = (view.azimuthDegrees ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    label: viewLabel(view),
    horizontal: [cosine, 0, sine],
    vertical: [0, 1, 0],
    direction: [-sine, 0, cosine],
    rowFlip: true,
  };
}

function projectionFrame(
  view: VisualHullView,
  low: [number, number, number],
  high: [number, number, number],
): ProjectionFrame {
  const frame = baseFrame(view);
  let minimumHorizontal = Number.POSITIVE_INFINITY;
  let maximumHorizontal = Number.NEGATIVE_INFINITY;
  let minimumVertical = Number.POSITIVE_INFINITY;
  let maximumVertical = Number.NEGATIVE_INFINITY;
  for (const x of [low[0], high[0]]) for (const y of [low[1], high[1]]) for (const z of [low[2], high[2]]) {
    const point = [x, y, z];
    const horizontal = dot(point, frame.horizontal);
    const vertical = dot(point, frame.vertical);
    minimumHorizontal = Math.min(minimumHorizontal, horizontal);
    maximumHorizontal = Math.max(maximumHorizontal, horizontal);
    minimumVertical = Math.min(minimumVertical, vertical);
    maximumVertical = Math.max(maximumVertical, vertical);
  }
  return { ...frame, minimumHorizontal, maximumHorizontal, minimumVertical, maximumVertical };
}

function project(point: readonly number[], frame: ProjectionFrame): [number, number] {
  const horizontalRange = frame.maximumHorizontal - frame.minimumHorizontal;
  const verticalRange = frame.maximumVertical - frame.minimumVertical;
  const u = (dot(point, frame.horizontal) - frame.minimumHorizontal) / horizontalRange;
  const vertical = (dot(point, frame.vertical) - frame.minimumVertical) / verticalRange;
  return [u, frame.rowFlip ? 1 - vertical : vertical];
}

function directionIsParallel(left: readonly number[], right: readonly number[]): boolean {
  const crossX = left[1]! * right[2]! - left[2]! * right[1]!;
  const crossY = left[2]! * right[0]! - left[0]! * right[2]!;
  const crossZ = left[0]! * right[1]! - left[1]! * right[0]!;
  return Math.hypot(crossX, crossY, crossZ) < 1e-6;
}

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
  if (!Array.isArray(value.views) || value.views.length < 2 || value.views.length > 8) {
    errors.push('views must contain two to eight distinct orthographic views.');
  } else {
    const projections = new Set<string>();
    const directions: [number, number, number][] = [];
    value.views.forEach((view, index) => {
      if (!view || !['front', 'side', 'top', 'azimuth'].includes(view.axis)) errors.push(`views[${index}].axis is invalid.`);
      else {
        if (view.axis === 'azimuth') {
          if (!Number.isInteger(view.azimuthDegrees) || (view.azimuthDegrees ?? -1) < 0 || (view.azimuthDegrees ?? 360) >= 360) {
            errors.push(`views[${index}].azimuthDegrees must be an integer from 0 to 359.`);
          }
        } else if (view.azimuthDegrees !== undefined) {
          errors.push(`views[${index}].azimuthDegrees is only valid for an azimuth view.`);
        }
        const label = viewLabel(view as VisualHullView);
        if (projections.has(label)) errors.push('view projections must be distinct.');
        else projections.add(label);
        if ((view.axis !== 'azimuth' || Number.isInteger(view.azimuthDegrees))) {
          directions.push(baseFrame(view as VisualHullView).direction);
        }
      }
      if (typeof view?.confidence !== 'number' || !Number.isFinite(view.confidence) || view.confidence <= 0 || view.confidence > 1) {
        errors.push(`views[${index}].confidence must be within (0, 1].`);
      }
      validateMask(view?.mask, `views[${index}].mask`, errors);
    });
    if (directions.length >= 2 && !directions.some((direction, index) => (
      directions.slice(index + 1).some((other) => !directionIsParallel(direction, other))
    ))) {
      errors.push('views must contain at least two non-collinear projection directions.');
    }
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
  frames: ProjectionFrame[],
  low: [number, number, number],
  step: [number, number, number],
): Pick<VisualHullResult, 'viewAgreement' | 'minimumViewIoU' | 'confidenceWeightedIoU'> {
  const viewAgreement = views.map((view, viewIndex) => {
    const frame = frames[viewIndex]!;
    const predicted = new Uint8Array(resolution * resolution);
    for (let z = 0; z < resolution; z += 1) {
      for (let y = 0; y < resolution; y += 1) {
        for (let x = 0; x < resolution; x += 1) {
          if (occupied[voxelKey(x, y, z, resolution)] === 0) continue;
          const point = [
            low[0] + (x + 0.5) * step[0],
            low[1] + (y + 0.5) * step[1],
            low[2] + (z + 0.5) * step[2],
          ];
          const [u, v] = project(point, frame);
          const column = Math.min(resolution - 1, Math.max(0, Math.floor(u * resolution)));
          const row = Math.min(resolution - 1, Math.max(0, Math.floor(v * resolution)));
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
      axis: frame.label,
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
  const frames = descriptor.views.map((view) => projectionFrame(view, low, high));
  const occupied = new Uint8Array(totalVoxelCount);
  const silhouetteToleranceVoxels = descriptor.silhouetteToleranceVoxels ?? 0;
  let occupiedVoxelCount = 0;
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const point = [low[0] + (x + 0.5) * step[0], low[1] + (y + 0.5) * step[1], low[2] + (z + 0.5) * step[2]];
        const inside = descriptor.views.every((view, viewIndex) => {
          const [u, v] = project(point, frames[viewIndex]!);
          return sampleMaskWithTolerance(view.mask, u, v, silhouetteToleranceVoxels, resolution);
        });
        if (!inside) continue;
        occupied[voxelKey(x, y, z, resolution)] = 1;
        occupiedVoxelCount += 1;
      }
    }
  }
  const surface = boundarySurface(occupied, low, step, resolution);
  const projectionAgreement = inspectProjectionAgreement(occupied, resolution, descriptor.views, frames, low, step);
  const worldAxes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const unconstrainedAxes = AXIS_NAMES.filter((_, axis) => frames.every((frame) => (
    Math.abs(dot(worldAxes[axis]!, frame.horizontal)) < 1e-6
      && Math.abs(dot(worldAxes[axis]!, frame.vertical)) < 1e-6
  )));
  const limitations = [
    'A visual hull is an upper bound and cannot reproduce a concavity that no supplied silhouette exposes.',
  ];
  if (unconstrainedAxes.length > 0) limitations.push(`${unconstrainedAxes.join(', ')} remains unconstrained by every supplied view.`);
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
    viewAxes: frames.map((frame) => frame.label),
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
