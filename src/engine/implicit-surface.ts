/**
 * Bounded implicit-surface composition and Surface Nets polygonization adapted
 * from img2threejs, Copyright 2026 hoainho, Apache-2.0.
 * Source: https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage3_build/generate_threejs_factory.py
 *
 * Morphloom changes: a typed AssemblyIR descriptor, fail-closed node graph,
 * explicit padded-boundary check, triangle budget, finite-output audit, and
 * millimetre-space delivery metadata.
 */
import * as THREE from 'three';

export type ImplicitVector = [number, number, number];

export interface ImplicitTransform {
  position?: ImplicitVector;
  rotation?: ImplicitVector;
  scale?: ImplicitVector;
}

export interface ImplicitPrimitive {
  id: string;
  type: 'sphere' | 'capsule' | 'box' | 'cone' | 'ellipsoid';
  radius?: number | ImplicitVector;
  height?: number;
  size?: ImplicitVector;
  radii?: ImplicitVector;
  transform?: ImplicitTransform;
}

export interface ImplicitOperation {
  id: string;
  type: 'smooth-union' | 'subtract' | 'intersect';
  left: string;
  right: string;
  radius?: number;
}

export interface ImplicitSurfaceDescriptor {
  bounds: { min: ImplicitVector; max: ImplicitVector };
  resolution: number;
  triangleBudget: number;
  primitives: ImplicitPrimitive[];
  operations?: ImplicitOperation[];
  output?: string;
}

export interface ImplicitSurfaceResult {
  geometry: THREE.BufferGeometry;
  requestedResolution: number;
  resolution: number;
  refinementSteps: number;
  primitiveCount: number;
  operationCount: number;
  triangleCount: number;
  enclosedVolumeMm3: number;
  outwardFaceCoverage: number;
  windingCorrected: boolean;
  boundaryMinimumDistanceMm: number;
  outputNode: string;
}

type DistanceField = (point: THREE.Vector3) => number;
const MIN_RESOLUTION = 8;
const MAX_RESOLUTION = 64;
const MAX_TRIANGLES = 400_000;
const MAX_PRIMITIVES = 64;
const MAX_OPERATIONS = 128;
const VALID_ID = /^[a-zA-Z0-9_-]{1,80}$/;

function finiteVector(value: unknown): value is ImplicitVector {
  return Array.isArray(value) && value.length === 3
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function positiveVector(value: unknown): value is ImplicitVector {
  return finiteVector(value) && value.every((item) => item > 0);
}

export function validateImplicitSurfaceDescriptor(value: unknown): asserts value is ImplicitSurfaceDescriptor {
  if (!value || typeof value !== 'object') throw new Error('Implicit surface descriptor must be an object.');
  const descriptor = value as Partial<ImplicitSurfaceDescriptor>;
  if (!descriptor.bounds || !finiteVector(descriptor.bounds.min) || !finiteVector(descriptor.bounds.max)
    || descriptor.bounds.min.some((minimum, axis) => minimum >= descriptor.bounds!.max[axis])) {
    throw new Error('Implicit surface bounds must contain increasing finite min/max tuples.');
  }
  if (!Number.isInteger(descriptor.resolution) || (descriptor.resolution ?? 0) < MIN_RESOLUTION
    || (descriptor.resolution ?? 0) > MAX_RESOLUTION) {
    throw new Error(`Implicit surface resolution must be an integer from ${MIN_RESOLUTION} to ${MAX_RESOLUTION}.`);
  }
  if (!Number.isInteger(descriptor.triangleBudget) || (descriptor.triangleBudget ?? 0) < 1
    || (descriptor.triangleBudget ?? 0) > MAX_TRIANGLES) {
    throw new Error(`Implicit surface triangleBudget must be an integer from 1 to ${MAX_TRIANGLES}.`);
  }
  if (!Array.isArray(descriptor.primitives) || descriptor.primitives.length < 1
    || descriptor.primitives.length > MAX_PRIMITIVES) {
    throw new Error(`Implicit surface requires 1..${MAX_PRIMITIVES} primitives.`);
  }
  const nodes = new Set<string>();
  for (const primitive of descriptor.primitives) {
    if (!VALID_ID.test(primitive.id) || nodes.has(primitive.id)) throw new Error(`Invalid or duplicate implicit primitive id: ${primitive.id}`);
    nodes.add(primitive.id);
    if (!['sphere', 'capsule', 'box', 'cone', 'ellipsoid'].includes(primitive.type)) {
      throw new Error(`Unsupported implicit primitive type: ${primitive.type}`);
    }
    if (primitive.transform?.position !== undefined && !finiteVector(primitive.transform.position)) throw new Error(`Invalid implicit position: ${primitive.id}`);
    if (primitive.transform?.rotation !== undefined && !finiteVector(primitive.transform.rotation)) throw new Error(`Invalid implicit rotation: ${primitive.id}`);
    if (primitive.transform?.scale !== undefined && !positiveVector(primitive.transform.scale)) throw new Error(`Invalid implicit scale: ${primitive.id}`);
    if (primitive.type === 'box') {
      if (!positiveVector(primitive.size)) throw new Error(`Implicit box requires positive size: ${primitive.id}`);
    } else if (primitive.type === 'ellipsoid') {
      const radii = primitive.radii ?? (Array.isArray(primitive.radius) ? primitive.radius : undefined);
      if (!positiveVector(radii)) throw new Error(`Implicit ellipsoid requires positive radii: ${primitive.id}`);
    } else {
      if (typeof primitive.radius !== 'number' || !Number.isFinite(primitive.radius) || primitive.radius <= 0) {
        throw new Error(`Implicit ${primitive.type} requires a positive radius: ${primitive.id}`);
      }
      if (['capsule', 'cone'].includes(primitive.type)
        && (typeof primitive.height !== 'number' || !Number.isFinite(primitive.height) || primitive.height <= 0)) {
        throw new Error(`Implicit ${primitive.type} requires a positive height: ${primitive.id}`);
      }
    }
  }
  const operations = descriptor.operations ?? [];
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS) throw new Error(`Implicit surface allows at most ${MAX_OPERATIONS} operations.`);
  for (const operation of operations) {
    if (!VALID_ID.test(operation.id) || nodes.has(operation.id)) throw new Error(`Invalid or duplicate implicit operation id: ${operation.id}`);
    if (!['smooth-union', 'subtract', 'intersect'].includes(operation.type)) throw new Error(`Unsupported implicit operation: ${operation.type}`);
    if (!nodes.has(operation.left) || !nodes.has(operation.right)) throw new Error(`Implicit operation references an unavailable node: ${operation.id}`);
    if (operation.type === 'smooth-union'
      && (typeof operation.radius !== 'number' || !Number.isFinite(operation.radius) || operation.radius <= 0)) {
      throw new Error(`Implicit smooth-union requires a positive radius: ${operation.id}`);
    }
    nodes.add(operation.id);
  }
  const defaultOutput = operations.at(-1)?.id ?? descriptor.primitives.at(-1)?.id;
  const output = descriptor.output ?? defaultOutput;
  if (!output || !nodes.has(output)) throw new Error('Implicit surface output must reference a declared node.');
}

function localPoint(point: THREE.Vector3, primitive: ImplicitPrimitive): { point: THREE.Vector3; scale: number } {
  const transform = primitive.transform;
  const position = transform?.position ?? [0, 0, 0];
  const rotation = transform?.rotation ?? [0, 0, 0];
  const scale = transform?.scale ?? [1, 1, 1];
  const local = point.clone().sub(new THREE.Vector3(...position));
  local.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)).invert());
  local.set(local.x / scale[0], local.y / scale[1], local.z / scale[2]);
  return { point: local, scale: Math.min(...scale) };
}

function sphereDistance(point: THREE.Vector3, radius: number): number {
  return point.length() - radius;
}

function capsuleDistance(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const y = THREE.MathUtils.clamp(point.y, -halfHeight, halfHeight);
  return point.distanceTo(new THREE.Vector3(0, y, 0)) - radius;
}

function boxDistance(point: THREE.Vector3, size: ImplicitVector): number {
  const q = new THREE.Vector3(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
    .sub(new THREE.Vector3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5));
  return q.clone().max(new THREE.Vector3()).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function coneDistance(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (point.y + halfHeight) / height);
  return Math.max(Math.hypot(point.x, point.z) - Math.max(0, taper), Math.abs(point.y) - halfHeight);
}

function ellipsoidDistance(point: THREE.Vector3, radii: ImplicitVector): number {
  const scaled = new THREE.Vector3(point.x / radii[0], point.y / radii[1], point.z / radii[2]);
  return (scaled.length() - 1) * Math.min(...radii);
}

function primitiveDistance(point: THREE.Vector3, primitive: ImplicitPrimitive): number {
  const local = localPoint(point, primitive);
  let distance: number;
  switch (primitive.type) {
    case 'sphere': distance = sphereDistance(local.point, primitive.radius as number); break;
    case 'capsule': distance = capsuleDistance(local.point, primitive.radius as number, primitive.height!); break;
    case 'box': distance = boxDistance(local.point, primitive.size!); break;
    case 'cone': distance = coneDistance(local.point, primitive.radius as number, primitive.height!); break;
    case 'ellipsoid': distance = ellipsoidDistance(local.point, primitive.radii ?? primitive.radius as ImplicitVector); break;
  }
  return distance * local.scale;
}

function smoothMinimum(left: number, right: number, radius: number): number {
  const blend = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - blend * blend * radius * 0.25;
}

function buildField(descriptor: ImplicitSurfaceDescriptor): { sample: DistanceField; outputNode: string } {
  const nodes = new Map<string, DistanceField>();
  for (const primitive of descriptor.primitives) nodes.set(primitive.id, (point) => primitiveDistance(point, primitive));
  for (const operation of descriptor.operations ?? []) {
    const left = nodes.get(operation.left)!;
    const right = nodes.get(operation.right)!;
    const combined: DistanceField = operation.type === 'smooth-union'
      ? (point) => smoothMinimum(left(point), right(point), operation.radius!)
      : operation.type === 'subtract'
        ? (point) => Math.max(left(point), -right(point))
        : (point) => Math.max(left(point), right(point));
    nodes.set(operation.id, combined);
  }
  const outputNode = descriptor.output ?? descriptor.operations?.at(-1)?.id ?? descriptor.primitives.at(-1)!.id;
  return { sample: nodes.get(outputNode)!, outputNode };
}

const CUBE_EDGES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0],
  [0, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
  [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 1, 1], [0, 1, 0, 0, 1, 1],
];

function edgeDefectCounts(indices: number[]): { boundaryEdges: number; nonManifoldEdges: number } {
  const edges = new Map<string, number>();
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index]!, indices[index + 1]!, indices[index + 2]!];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge]!;
      const b = triangle[(edge + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const counts = [...edges.values()];
  return {
    boundaryEdges: counts.filter((count) => count === 1).length,
    nonManifoldEdges: counts.filter((count) => count > 2).length,
  };
}

function signedVolumeMm3(positions: number[], indices: number[]): number {
  let sixTimesVolume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const ai = indices[index]! * 3;
    const bi = indices[index + 1]! * 3;
    const ci = indices[index + 2]! * 3;
    const ax = positions[ai]!;
    const ay = positions[ai + 1]!;
    const az = positions[ai + 2]!;
    const bx = positions[bi]!;
    const by = positions[bi + 1]!;
    const bz = positions[bi + 2]!;
    const cx = positions[ci]!;
    const cy = positions[ci + 1]!;
    const cz = positions[ci + 2]!;
    sixTimesVolume += ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx);
  }
  return sixTimesVolume / 6;
}

function outwardFaceCoverage(positions: number[], normals: number[], indices: number[]): number {
  let outward = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  for (let index = 0; index < indices.length; index += 3) {
    const ia = indices[index]!;
    const ib = indices[index + 1]!;
    const ic = indices[index + 2]!;
    a.fromArray(positions, ia * 3);
    b.fromArray(positions, ib * 3);
    c.fromArray(positions, ic * 3);
    edgeAB.subVectors(b, a);
    edgeAC.subVectors(c, a);
    faceNormal.crossVectors(edgeAB, edgeAC);
    vertexNormal.set(
      normals[ia * 3]! + normals[ib * 3]! + normals[ic * 3]!,
      normals[ia * 3 + 1]! + normals[ib * 3 + 1]! + normals[ic * 3 + 1]!,
      normals[ia * 3 + 2]! + normals[ib * 3 + 2]! + normals[ic * 3 + 2]!,
    );
    if (faceNormal.lengthSq() > 1e-20 && vertexNormal.lengthSq() > 1e-20
      && faceNormal.dot(vertexNormal) > 0) outward += 1;
  }
  return outward / (indices.length / 3);
}

function polygonizeImplicitSurfaceAtResolution(
  descriptor: ImplicitSurfaceDescriptor,
  requestedResolution: number,
): ImplicitSurfaceResult {
  validateImplicitSurfaceDescriptor(descriptor);
  const resolution = descriptor.resolution;
  const bounds = descriptor.bounds;
  const minimum = new THREE.Vector3(...bounds.min);
  const step = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / resolution,
    (bounds.max[1] - bounds.min[1]) / resolution,
    (bounds.max[2] - bounds.min[2]) / resolution,
  );
  const { sample, outputNode } = buildField(descriptor);
  const scratch = new THREE.Vector3();
  const side = resolution + 1;
  const field = new Float32Array(side ** 3);
  const cornerAt = (x: number, y: number, z: number): number => (z * side + y) * side + x;
  let boundaryMinimumDistanceMm = Number.POSITIVE_INFINITY;
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        scratch.set(minimum.x + x * step.x, minimum.y + y * step.y, minimum.z + z * step.z);
        const distance = sample(scratch);
        if (!Number.isFinite(distance)) throw new Error('Implicit surface field produced a non-finite distance.');
        field[cornerAt(x, y, z)] = distance;
        if (x === 0 || y === 0 || z === 0 || x === resolution || y === resolution || z === resolution) {
          boundaryMinimumDistanceMm = Math.min(boundaryMinimumDistanceMm, distance);
        }
      }
    }
  }
  if (boundaryMinimumDistanceMm <= 0) {
    throw new Error(`Implicit surface intersects its sampling bounds (${boundaryMinimumDistanceMm.toFixed(6)} mm); pad bounds before delivery.`);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cellVertex = new Int32Array(resolution ** 3).fill(-1);
  const cellAt = (x: number, y: number, z: number): number => (z * resolution + y) * resolution + x;
  const epsilon = Math.min(step.x, step.y, step.z) * 0.25;
  const gradient = (point: THREE.Vector3): THREE.Vector3 => {
    const gx = sample(scratch.set(point.x + epsilon, point.y, point.z)) - sample(scratch.set(point.x - epsilon, point.y, point.z));
    const gy = sample(scratch.set(point.x, point.y + epsilon, point.z)) - sample(scratch.set(point.x, point.y - epsilon, point.z));
    const gz = sample(scratch.set(point.x, point.y, point.z + epsilon)) - sample(scratch.set(point.x, point.y, point.z - epsilon));
    const normal = new THREE.Vector3(gx, gy, gz);
    return normal.lengthSq() < 1e-20 ? new THREE.Vector3(0, 1, 0) : normal.normalize();
  };
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        let crossings = 0;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (const [ax, ay, az, bx, by, bz] of CUBE_EDGES) {
          const a = field[cornerAt(x + ax, y + ay, z + az)];
          const b = field[cornerAt(x + bx, y + by, z + bz)];
          if ((a <= 0) === (b <= 0)) continue;
          const t = a / (a - b);
          sumX += ax + (bx - ax) * t;
          sumY += ay + (by - ay) * t;
          sumZ += az + (bz - az) * t;
          crossings += 1;
        }
        if (crossings === 0) continue;
        const point = new THREE.Vector3(
          minimum.x + (x + sumX / crossings) * step.x,
          minimum.y + (y + sumY / crossings) * step.y,
          minimum.z + (z + sumZ / crossings) * step.z,
        );
        cellVertex[cellAt(x, y, z)] = positions.length / 3;
        positions.push(point.x, point.y, point.z);
        normals.push(...gradient(point).toArray());
      }
    }
  }
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const here = field[cornerAt(x, y, z)] <= 0;
        if (x + 1 < side && y > 0 && z > 0 && y < resolution && z < resolution
          && here !== (field[cornerAt(x + 1, y, z)] <= 0)) {
          quad(cellVertex[cellAt(x, y - 1, z - 1)], cellVertex[cellAt(x, y, z - 1)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y - 1, z)], !here);
        }
        if (y + 1 < side && x > 0 && z > 0 && x < resolution && z < resolution
          && here !== (field[cornerAt(x, y + 1, z)] <= 0)) {
          quad(cellVertex[cellAt(x - 1, y, z - 1)], cellVertex[cellAt(x - 1, y, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y, z - 1)], !here);
        }
        if (z + 1 < side && x > 0 && y > 0 && x < resolution && y < resolution
          && here !== (field[cornerAt(x, y, z + 1)] <= 0)) {
          quad(cellVertex[cellAt(x - 1, y - 1, z)], cellVertex[cellAt(x, y - 1, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x - 1, y, z)], !here);
        }
      }
    }
  }
  if (positions.length === 0 || indices.length === 0) throw new Error('Implicit surface contains no sampled zero crossing.');
  const triangleCount = indices.length / 3;
  if (triangleCount > descriptor.triangleBudget) {
    throw new Error(`Implicit surface triangle budget exceeded: ${triangleCount}/${descriptor.triangleBudget}.`);
  }
  const edgeDefects = edgeDefectCounts(indices);
  const maximumRefinedResolution = Math.min(MAX_RESOLUTION, requestedResolution + 4);
  if ((edgeDefects.boundaryEdges > 0 || edgeDefects.nonManifoldEdges > 0) && resolution < maximumRefinedResolution) {
    return polygonizeImplicitSurfaceAtResolution({ ...descriptor, resolution: resolution + 1 }, requestedResolution);
  }
  if (edgeDefects.boundaryEdges > 0 || edgeDefects.nonManifoldEdges > 0) {
    throw new Error(`Implicit surface remains topologically invalid after bounded refinement: ${edgeDefects.boundaryEdges} boundary and ${edgeDefects.nonManifoldEdges} non-manifold edges at resolution ${resolution}.`);
  }
  let windingCorrected = false;
  let enclosedVolumeMm3 = signedVolumeMm3(positions, indices);
  if (!Number.isFinite(enclosedVolumeMm3) || Math.abs(enclosedVolumeMm3) < 1e-6) {
    throw new Error('Implicit surface has zero or non-finite enclosed volume.');
  }
  if (enclosedVolumeMm3 < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      [indices[index + 1], indices[index + 2]] = [indices[index + 2]!, indices[index + 1]!];
    }
    enclosedVolumeMm3 = -enclosedVolumeMm3;
    windingCorrected = true;
  }
  const faceCoverage = outwardFaceCoverage(positions, normals, indices);
  if (faceCoverage < 0.995 && resolution < maximumRefinedResolution) {
    return polygonizeImplicitSurfaceAtResolution({ ...descriptor, resolution: resolution + 1 }, requestedResolution);
  }
  if (faceCoverage < 0.995) {
    throw new Error(`Implicit surface face winding disagrees with field normals: ${(faceCoverage * 100).toFixed(3)}% outward at resolution ${resolution}.`);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.implicitSurfaceEvidence = {
    schema: 'morphloom.implicit-surface/0.1', requestedResolution, resolution,
    refinementSteps: resolution - requestedResolution,
    primitiveCount: descriptor.primitives.length, operationCount: descriptor.operations?.length ?? 0,
    triangleCount, triangleBudget: descriptor.triangleBudget, enclosedVolumeMm3,
    outwardFaceCoverage: faceCoverage, windingCorrected, boundaryMinimumDistanceMm, outputNode,
  };
  return {
    geometry, requestedResolution, resolution, refinementSteps: resolution - requestedResolution,
    primitiveCount: descriptor.primitives.length,
    operationCount: descriptor.operations?.length ?? 0, triangleCount,
    enclosedVolumeMm3, outwardFaceCoverage: faceCoverage, windingCorrected,
    boundaryMinimumDistanceMm, outputNode,
  };
}

export function polygonizeImplicitSurface(descriptor: ImplicitSurfaceDescriptor): ImplicitSurfaceResult {
  validateImplicitSurfaceDescriptor(descriptor);
  return polygonizeImplicitSurfaceAtResolution(descriptor, descriptor.resolution);
}
