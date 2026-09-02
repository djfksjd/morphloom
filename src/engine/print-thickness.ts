import * as THREE from 'three';

export interface SampledWallThicknessAudit {
  complete: boolean;
  meshes: number;
  sampledRays: number;
  hitRays: number;
  hitCoverage: number;
  minimumMm: number;
  percentile05Mm: number;
  triangles: number;
  maximumTriangles: number;
  triangleTests: number;
  maximumTriangleTests: number;
  blockers: string[];
}

export interface SampledWallThicknessOptions {
  maximumMeshes?: number;
  maximumSamplesPerMesh?: number;
  maximumTriangles?: number;
  maximumTriangleTests?: number;
}

interface TriangleMesh {
  name: string;
  triangles: Float64Array;
  validTriangles: number[];
  signedVolumeM3: number;
}

const TRIANGLE_STRIDE = 12;
const DEFAULT_MAXIMUM_MESHES = 256;
const DEFAULT_MAXIMUM_SAMPLES_PER_MESH = 96;
const DEFAULT_MAXIMUM_TRIANGLES = 500_000;
const DEFAULT_MAXIMUM_TRIANGLE_TESTS = 24_000_000;

function finitePositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`Wall-thickness audit limit must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function meshTriangleCount(mesh: THREE.Mesh): number {
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.itemSize < 3 || position.count < 3) return 0;
  const index = mesh.geometry.getIndex();
  return Math.floor((index?.count ?? position.count) / 3);
}

function collectMeshTriangles(mesh: THREE.Mesh, triangleCount: number): TriangleMesh | undefined {
  if (triangleCount === 0) return undefined;
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.itemSize < 3) return undefined;
  const index = mesh.geometry.getIndex();
  const triangles = new Float64Array(triangleCount * TRIANGLE_STRIDE);
  const validTriangles: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let signedVolumeM3 = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = index ? index.getX(triangle * 3) : triangle * 3;
    const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
    const offset = triangle * TRIANGLE_STRIDE;
    triangles.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], offset);
    normal.crossVectors(edgeA.copy(b).sub(a), edgeB.copy(c).sub(a));
    const doubledArea = normal.length();
    if (doubledArea <= 1e-14 || !Number.isFinite(doubledArea)) continue;
    normal.multiplyScalar(1 / doubledArea);
    triangles.set([normal.x, normal.y, normal.z], offset + 9);
    validTriangles.push(triangle);
    signedVolumeM3 += a.dot(cross.crossVectors(b, c)) / 6;
  }
  return { name: mesh.name || mesh.uuid, triangles, validTriangles, signedVolumeM3 };
}

function rayTriangleDistance(
  triangles: Float64Array,
  triangle: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minimumDistance: number,
): number | undefined {
  const offset = triangle * TRIANGLE_STRIDE;
  const ax = triangles[offset]!; const ay = triangles[offset + 1]!; const az = triangles[offset + 2]!;
  const edge1x = triangles[offset + 3]! - ax;
  const edge1y = triangles[offset + 4]! - ay;
  const edge1z = triangles[offset + 5]! - az;
  const edge2x = triangles[offset + 6]! - ax;
  const edge2y = triangles[offset + 7]! - ay;
  const edge2z = triangles[offset + 8]! - az;
  const px = dy * edge2z - dz * edge2y;
  const py = dz * edge2x - dx * edge2z;
  const pz = dx * edge2y - dy * edge2x;
  const determinant = edge1x * px + edge1y * py + edge1z * pz;
  if (Math.abs(determinant) <= 1e-12) return undefined;
  const inverse = 1 / determinant;
  const tx = ox - ax; const ty = oy - ay; const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < -1e-9 || u > 1 + 1e-9) return undefined;
  const qx = ty * edge1z - tz * edge1y;
  const qy = tz * edge1x - tx * edge1z;
  const qz = tx * edge1y - ty * edge1x;
  const v = (dx * qx + dy * qy + dz * qz) * inverse;
  if (v < -1e-9 || u + v > 1 + 1e-9) return undefined;
  const distance = (edge2x * qx + edge2y * qy + edge2z * qz) * inverse;
  return Number.isFinite(distance) && distance > minimumDistance ? distance : undefined;
}

function evenlyDistributedSamples(triangles: readonly number[], count: number): number[] {
  if (count >= triangles.length) return [...triangles];
  return Array.from({ length: count }, (_, index) => (
    triangles[Math.min(triangles.length - 1, Math.floor((index + 0.5) * triangles.length / count))]!
  ));
}

/**
 * Deterministic, bounded local wall-thickness proxy for closed print meshes.
 * Rays start at distributed face centroids and travel inward according to the
 * mesh winding; missing hits or exhausted budgets fail closed.
 */
export function auditSampledWallThickness(
  root: THREE.Object3D,
  options: SampledWallThicknessOptions = {},
): SampledWallThicknessAudit {
  const maximumMeshes = finitePositiveInteger(options.maximumMeshes, DEFAULT_MAXIMUM_MESHES, 1_024);
  const maximumSamplesPerMesh = finitePositiveInteger(
    options.maximumSamplesPerMesh,
    DEFAULT_MAXIMUM_SAMPLES_PER_MESH,
    512,
  );
  const maximumTriangles = finitePositiveInteger(
    options.maximumTriangles,
    DEFAULT_MAXIMUM_TRIANGLES,
    5_000_000,
  );
  const maximumTriangleTests = finitePositiveInteger(
    options.maximumTriangleTests,
    DEFAULT_MAXIMUM_TRIANGLE_TESTS,
    100_000_000,
  );
  root.updateMatrixWorld(true);
  const meshes: TriangleMesh[] = [];
  let visibleMeshCount = 0;
  let observedTriangles = 0;
  let collectedTriangles = 0;
  let triangleCollectionBudgetExceeded = false;
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    visibleMeshCount += 1;
    if (meshes.length >= maximumMeshes) return;
    const triangleCount = meshTriangleCount(object);
    observedTriangles += triangleCount;
    if (triangleCount <= 0) return;
    if (collectedTriangles + triangleCount > maximumTriangles) {
      triangleCollectionBudgetExceeded = true;
      return;
    }
    const collected = collectMeshTriangles(object, triangleCount);
    collectedTriangles += triangleCount;
    if (collected) meshes.push(collected);
  });
  const blockers: string[] = [];
  if (visibleMeshCount > maximumMeshes) blockers.push(`mesh budget exceeded: ${visibleMeshCount}/${maximumMeshes}`);
  if (triangleCollectionBudgetExceeded) {
    blockers.push(`triangle collection budget exceeded: ${observedTriangles}/${maximumTriangles}`);
  }
  if (meshes.length === 0) blockers.push('no triangle mesh available for local wall-thickness sampling');
  const distancesMm: number[] = [];
  let sampledRays = 0;
  let hitRays = 0;
  let triangleTests = 0;
  for (const mesh of meshes) {
    if (mesh.validTriangles.length === 0 || Math.abs(mesh.signedVolumeM3) <= 1e-15) {
      blockers.push(`${mesh.name}: degenerate or zero-volume mesh`);
      continue;
    }
    const remainingTests = maximumTriangleTests - triangleTests;
    const affordableSamples = Math.floor(remainingTests / mesh.validTriangles.length);
    const requestedSamples = Math.min(maximumSamplesPerMesh, mesh.validTriangles.length);
    const sampleCount = Math.min(requestedSamples, affordableSamples);
    if (sampleCount < requestedSamples) blockers.push(`${mesh.name}: triangle-test budget exhausted`);
    if (sampleCount <= 0) continue;
    const windingSign = Math.sign(mesh.signedVolumeM3);
    for (const sourceTriangle of evenlyDistributedSamples(mesh.validTriangles, sampleCount)) {
      const offset = sourceTriangle * TRIANGLE_STRIDE;
      const cx = (mesh.triangles[offset]! + mesh.triangles[offset + 3]! + mesh.triangles[offset + 6]!) / 3;
      const cy = (mesh.triangles[offset + 1]! + mesh.triangles[offset + 4]! + mesh.triangles[offset + 7]!) / 3;
      const cz = (mesh.triangles[offset + 2]! + mesh.triangles[offset + 5]! + mesh.triangles[offset + 8]!) / 3;
      const dx = -mesh.triangles[offset + 9]! * windingSign;
      const dy = -mesh.triangles[offset + 10]! * windingSign;
      const dz = -mesh.triangles[offset + 11]! * windingSign;
      const epsilon = 1e-8;
      const ox = cx + dx * epsilon;
      const oy = cy + dy * epsilon;
      const oz = cz + dz * epsilon;
      sampledRays += 1;
      let nearest = Number.POSITIVE_INFINITY;
      for (const candidate of mesh.validTriangles) {
        triangleTests += 1;
        if (candidate === sourceTriangle) continue;
        const distance = rayTriangleDistance(mesh.triangles, candidate, ox, oy, oz, dx, dy, dz, epsilon * 2);
        if (distance !== undefined && distance < nearest) nearest = distance;
      }
      if (Number.isFinite(nearest)) {
        hitRays += 1;
        distancesMm.push((nearest + epsilon) * 1_000);
      }
    }
  }
  distancesMm.sort((left, right) => left - right);
  const percentileIndex = distancesMm.length > 0 ? Math.floor((distancesMm.length - 1) * 0.05) : 0;
  const hitCoverage = sampledRays > 0 ? hitRays / sampledRays : 0;
  if (sampledRays > 0 && hitCoverage < 1) blockers.push(`inward ray hit coverage ${(hitCoverage * 100).toFixed(1)}%`);
  return {
    complete: blockers.length === 0 && sampledRays > 0 && hitCoverage === 1,
    meshes: meshes.length,
    sampledRays,
    hitRays,
    hitCoverage,
    minimumMm: distancesMm[0] ?? 0,
    percentile05Mm: distancesMm[percentileIndex] ?? 0,
    triangles: collectedTriangles,
    maximumTriangles,
    triangleTests,
    maximumTriangleTests,
    blockers,
  };
}
