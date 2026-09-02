import * as THREE from 'three';

export interface SampledWallThicknessAudit {
  complete: boolean;
  meshes: number;
  connectedShells: number;
  weldedVertices: number;
  maximumWeldedVertices: number;
  componentEdges: number;
  maximumComponentEdges: number;
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
  maximumWeldedVertices?: number;
  maximumComponentEdges?: number;
}

interface TriangleComponent {
  triangles: number[];
  signedVolumeM3: number;
}

interface TriangleMesh {
  name: string;
  triangles: Float64Array;
  validTriangles: number[];
  components: TriangleComponent[];
  weldedVertices: number;
  componentEdges: number;
  componentCollectionComplete: boolean;
  weldedVertexBudgetExceeded: boolean;
  componentEdgeBudgetExceeded: boolean;
}

const TRIANGLE_STRIDE = 12;
const DEFAULT_MAXIMUM_MESHES = 256;
const DEFAULT_MAXIMUM_SAMPLES_PER_MESH = 96;
const DEFAULT_MAXIMUM_TRIANGLES = 500_000;
const DEFAULT_MAXIMUM_TRIANGLE_TESTS = 24_000_000;
const DEFAULT_MAXIMUM_WELDED_VERTICES = 500_000;
const DEFAULT_MAXIMUM_COMPONENT_EDGES = 1_000_000;
// Match the topology gate's 1e-6-metre weld tolerance so UV seams do not
// masquerade as disconnected printable shells.
const WELD_QUANTIZATION_PER_METRE = 1_000_000;

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

function weldKey(x: number, y: number, z: number): string {
  return `${Math.round(x * WELD_QUANTIZATION_PER_METRE)}:${Math.round(y * WELD_QUANTIZATION_PER_METRE)}:${Math.round(z * WELD_QUANTIZATION_PER_METRE)}`;
}

function collectMeshTriangles(
  mesh: THREE.Mesh,
  triangleCount: number,
  maximumWeldedVertices: number,
  maximumComponentEdges: number,
): TriangleMesh | undefined {
  if (triangleCount === 0) return undefined;
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.itemSize < 3) return undefined;
  const index = mesh.geometry.getIndex();
  const triangles = new Float64Array(triangleCount * TRIANGLE_STRIDE);
  const validTriangles: number[] = [];
  const triangleVolumes = new Float64Array(triangleCount);
  const parents = new Int32Array(triangleCount);
  parents.fill(-1);
  const ranks = new Uint8Array(triangleCount);
  const vertexIds = new Map<string, number>();
  const edgeOwners = new Map<number, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let componentCollectionComplete = true;
  let weldedVertexBudgetExceeded = false;
  let componentEdgeBudgetExceeded = false;
  let collectedWeldedVertices = 0;
  let collectedComponentEdges = 0;
  const find = (triangle: number): number => {
    let root = triangle;
    while (parents[root] !== root) root = parents[root]!;
    while (parents[triangle] !== triangle) {
      const next = parents[triangle]!;
      parents[triangle] = root;
      triangle = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (ranks[leftRoot]! < ranks[rightRoot]!) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    parents[rightRoot] = leftRoot;
    if (ranks[leftRoot] === ranks[rightRoot]) ranks[leftRoot] += 1;
  };
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
    parents[triangle] = triangle;
    triangleVolumes[triangle] = a.dot(cross.crossVectors(b, c)) / 6;
    if (componentCollectionComplete) {
      const triangleVertexIds: number[] = [];
      for (const vertex of [a, b, c]) {
        const key = weldKey(vertex.x, vertex.y, vertex.z);
        let vertexId = vertexIds.get(key);
        if (vertexId === undefined) {
          if (vertexIds.size >= maximumWeldedVertices) {
            componentCollectionComplete = false;
            weldedVertexBudgetExceeded = true;
            collectedWeldedVertices = vertexIds.size;
            collectedComponentEdges = edgeOwners.size;
            vertexIds.clear();
            edgeOwners.clear();
            break;
          }
          vertexId = vertexIds.size;
          vertexIds.set(key, vertexId);
        }
        triangleVertexIds.push(vertexId);
      }
      if (componentCollectionComplete) {
        const edgeBase = maximumWeldedVertices + 1;
        for (const [from, to] of [
          [triangleVertexIds[0]!, triangleVertexIds[1]!],
          [triangleVertexIds[1]!, triangleVertexIds[2]!],
          [triangleVertexIds[2]!, triangleVertexIds[0]!],
        ]) {
          const edge = Math.min(from, to) * edgeBase + Math.max(from, to);
          const owner = edgeOwners.get(edge);
          if (owner === undefined) {
            if (edgeOwners.size >= maximumComponentEdges) {
              componentCollectionComplete = false;
              componentEdgeBudgetExceeded = true;
              collectedWeldedVertices = vertexIds.size;
              collectedComponentEdges = edgeOwners.size;
              vertexIds.clear();
              edgeOwners.clear();
              break;
            }
            edgeOwners.set(edge, triangle);
          } else {
            union(triangle, owner);
          }
        }
      }
    }
  }
  const components: TriangleComponent[] = [];
  if (componentCollectionComplete) {
    collectedWeldedVertices = vertexIds.size;
    collectedComponentEdges = edgeOwners.size;
    const byRoot = new Map<number, TriangleComponent>();
    for (const triangle of validTriangles) {
      const root = find(triangle);
      let component = byRoot.get(root);
      if (!component) {
        component = { triangles: [], signedVolumeM3: 0 };
        byRoot.set(root, component);
        components.push(component);
      }
      component.triangles.push(triangle);
      component.signedVolumeM3 += triangleVolumes[triangle]!;
    }
  }
  return {
    name: mesh.name || mesh.uuid,
    triangles,
    validTriangles,
    components,
    weldedVertices: collectedWeldedVertices,
    componentEdges: collectedComponentEdges,
    componentCollectionComplete,
    weldedVertexBudgetExceeded,
    componentEdgeBudgetExceeded,
  };
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

function directionalSamples(triangles: Float64Array, component: TriangleComponent): number[] {
  const directions = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ] as const;
  const selected = new Set<number>();
  for (const [dx, dy, dz] of directions) {
    let bestTriangle = component.triangles[0]!;
    let bestAlignment = Number.NEGATIVE_INFINITY;
    for (const triangle of component.triangles) {
      const offset = triangle * TRIANGLE_STRIDE + 9;
      const alignment = triangles[offset]! * dx + triangles[offset + 1]! * dy + triangles[offset + 2]! * dz;
      if (alignment > bestAlignment) {
        bestAlignment = alignment;
        bestTriangle = triangle;
      }
    }
    selected.add(bestTriangle);
  }
  return [...selected];
}

function featureSpaceSamples(
  triangles: Float64Array,
  component: TriangleComponent,
  required: readonly number[],
  targetCount: number,
): number[] {
  if (targetCount >= component.triangles.length) return [...component.triangles];
  const featureStride = 6;
  const features = new Float32Array(component.triangles.length * featureStride);
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < component.triangles.length; index += 1) {
    const triangle = component.triangles[index]!;
    const offset = triangle * TRIANGLE_STRIDE;
    const featureOffset = index * featureStride;
    const x = (triangles[offset]! + triangles[offset + 3]! + triangles[offset + 6]!) / 3;
    const y = (triangles[offset + 1]! + triangles[offset + 4]! + triangles[offset + 7]!) / 3;
    const z = (triangles[offset + 2]! + triangles[offset + 5]! + triangles[offset + 8]!) / 3;
    features[featureOffset] = x;
    features[featureOffset + 1] = y;
    features[featureOffset + 2] = z;
    features[featureOffset + 3] = triangles[offset + 9]!;
    features[featureOffset + 4] = triangles[offset + 10]!;
    features[featureOffset + 5] = triangles[offset + 11]!;
    minimumX = Math.min(minimumX, x); maximumX = Math.max(maximumX, x);
    minimumY = Math.min(minimumY, y); maximumY = Math.max(maximumY, y);
    minimumZ = Math.min(minimumZ, z); maximumZ = Math.max(maximumZ, z);
  }
  const extentX = Math.max(1e-12, maximumX - minimumX);
  const extentY = Math.max(1e-12, maximumY - minimumY);
  const extentZ = Math.max(1e-12, maximumZ - minimumZ);
  const normalWeight = 0.35;
  for (let index = 0; index < component.triangles.length; index += 1) {
    const offset = index * featureStride;
    features[offset] = (features[offset]! - minimumX) / extentX;
    features[offset + 1] = (features[offset + 1]! - minimumY) / extentY;
    features[offset + 2] = (features[offset + 2]! - minimumZ) / extentZ;
    features[offset + 3] *= normalWeight;
    features[offset + 4] *= normalWeight;
    features[offset + 5] *= normalWeight;
  }
  const selected = [...required];
  const selectedSet = new Set(selected);
  const minimumDistance = new Float32Array(component.triangles.length);
  minimumDistance.fill(Number.POSITIVE_INFINITY);
  const updateDistances = (sampleIndex: number): void => {
    const sampleOffset = sampleIndex * featureStride;
    for (let index = 0; index < component.triangles.length; index += 1) {
      const offset = index * featureStride;
      let distance = 0;
      for (let axis = 0; axis < featureStride; axis += 1) {
        const delta = features[offset + axis]! - features[sampleOffset + axis]!;
        distance += delta * delta;
      }
      if (distance < minimumDistance[index]!) minimumDistance[index] = distance;
    }
  };
  for (const triangle of selected) {
    const sampleIndex = component.triangles.indexOf(triangle);
    if (sampleIndex >= 0) updateDistances(sampleIndex);
  }
  while (selected.length < targetCount) {
    let nextIndex = -1;
    let nextDistance = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < component.triangles.length; index += 1) {
      const triangle = component.triangles[index]!;
      if (selectedSet.has(triangle)) continue;
      if (minimumDistance[index]! > nextDistance) {
        nextIndex = index;
        nextDistance = minimumDistance[index]!;
      }
    }
    if (nextIndex < 0) break;
    const triangle = component.triangles[nextIndex]!;
    selected.push(triangle);
    selectedSet.add(triangle);
    updateDistances(nextIndex);
  }
  return selected;
}

function allocateComponentSamples(
  mesh: TriangleMesh,
  maximumSamples: number,
): { samples: number[][]; requiredSamples: number[][]; complete: boolean } {
  const requiredSamples = mesh.components.map((component) => directionalSamples(mesh.triangles, component));
  const requiredCount = requiredSamples.reduce((total, samples) => total + samples.length, 0);
  if (requiredCount > maximumSamples) return { samples: requiredSamples, requiredSamples, complete: false };
  const targetCount = Math.min(maximumSamples, mesh.validTriangles.length);
  const samples = requiredSamples.map((selected) => [...selected]);
  let remaining = targetCount - requiredCount;
  const capacities = mesh.components.map((component, index) => component.triangles.length - samples[index]!.length);
  const totalCapacity = capacities.reduce((total, capacity) => total + capacity, 0);
  const extras = capacities.map((capacity) => totalCapacity > 0 ? Math.floor(remaining * capacity / totalCapacity) : 0);
  let assigned = extras.reduce((total, count) => total + count, 0);
  for (let index = 0; assigned < remaining && index < capacities.length; index = (index + 1) % capacities.length) {
    if (extras[index]! < capacities[index]!) {
      extras[index] += 1;
      assigned += 1;
    }
  }
  for (let componentIndex = 0; componentIndex < mesh.components.length; componentIndex += 1) {
    const component = mesh.components[componentIndex]!;
    const extraCount = extras[componentIndex]!;
    samples[componentIndex] = featureSpaceSamples(
      mesh.triangles,
      component,
      requiredSamples[componentIndex]!,
      requiredSamples[componentIndex]!.length + extraCount,
    );
  }
  remaining -= extras.reduce((total, count) => total + count, 0);
  return { samples, requiredSamples, complete: remaining === 0 };
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
  const maximumWeldedVertices = finitePositiveInteger(
    options.maximumWeldedVertices,
    DEFAULT_MAXIMUM_WELDED_VERTICES,
    2_000_000,
  );
  const maximumComponentEdges = finitePositiveInteger(
    options.maximumComponentEdges,
    DEFAULT_MAXIMUM_COMPONENT_EDGES,
    3_000_000,
  );
  root.updateMatrixWorld(true);
  const meshes: TriangleMesh[] = [];
  let visibleMeshCount = 0;
  let observedTriangles = 0;
  let collectedTriangles = 0;
  let triangleCollectionBudgetExceeded = false;
  let connectedShells = 0;
  let weldedVertices = 0;
  let componentEdges = 0;
  let weldedVertexCollectionBudgetExceeded = false;
  let componentEdgeCollectionBudgetExceeded = false;
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
    if (weldedVertices >= maximumWeldedVertices || componentEdges >= maximumComponentEdges) {
      weldedVertexCollectionBudgetExceeded ||= weldedVertices >= maximumWeldedVertices;
      componentEdgeCollectionBudgetExceeded ||= componentEdges >= maximumComponentEdges;
      return;
    }
    const remainingWeldedVertices = Math.max(1, maximumWeldedVertices - weldedVertices);
    const remainingComponentEdges = Math.max(1, maximumComponentEdges - componentEdges);
    const collected = collectMeshTriangles(
      object,
      triangleCount,
      remainingWeldedVertices,
      remainingComponentEdges,
    );
    collectedTriangles += triangleCount;
    if (collected) {
      meshes.push(collected);
      weldedVertices += collected.weldedVertices;
      componentEdges += collected.componentEdges;
      connectedShells += collected.components.length;
    }
  });
  const blockers: string[] = [];
  if (visibleMeshCount > maximumMeshes) blockers.push(`mesh budget exceeded: ${visibleMeshCount}/${maximumMeshes}`);
  if (triangleCollectionBudgetExceeded) {
    blockers.push(`triangle collection budget exceeded: ${observedTriangles}/${maximumTriangles}`);
  }
  if (weldedVertexCollectionBudgetExceeded) {
    blockers.push(`welded-vertex collection budget exceeded: ${weldedVertices}/${maximumWeldedVertices}`);
  }
  if (componentEdgeCollectionBudgetExceeded) {
    blockers.push(`connected-edge collection budget exceeded: ${componentEdges}/${maximumComponentEdges}`);
  }
  if (meshes.length === 0) blockers.push('no triangle mesh available for local wall-thickness sampling');
  const distancesMm: number[] = [];
  let sampledRays = 0;
  let hitRays = 0;
  let triangleTests = 0;
  for (const mesh of meshes) {
    if (!mesh.componentCollectionComplete || weldedVertices > maximumWeldedVertices
      || componentEdges > maximumComponentEdges) {
      if (mesh.weldedVertexBudgetExceeded || weldedVertices > maximumWeldedVertices) {
        blockers.push(`${mesh.name}: welded-vertex budget exhausted`);
      }
      if (mesh.componentEdgeBudgetExceeded || componentEdges > maximumComponentEdges) {
        blockers.push(`${mesh.name}: connected-edge budget exhausted`);
      }
      continue;
    }
    if (mesh.validTriangles.length === 0 || mesh.components.length === 0) {
      blockers.push(`${mesh.name}: degenerate mesh`);
      continue;
    }
    if (mesh.components.some((component) => Math.abs(component.signedVolumeM3) <= 1e-15)) {
      blockers.push(`${mesh.name}: degenerate or zero-volume connected shell`);
      continue;
    }
    const allocation = allocateComponentSamples(mesh, maximumSamplesPerMesh);
    if (!allocation.complete) {
      blockers.push(`${mesh.name}: connected-shell sampling budget exhausted`);
      continue;
    }
    const requestedTestCount = allocation.samples.reduce((total, samples, index) => (
      total + samples.length * mesh.components[index]!.triangles.length
    ), 0);
    const requiredTestCount = allocation.requiredSamples.reduce((total, samples, index) => (
      total + samples.length * mesh.components[index]!.triangles.length
    ), 0);
    const remainingTests = maximumTriangleTests - triangleTests;
    let samples = allocation.samples;
    if (requestedTestCount > remainingTests) {
      blockers.push(`${mesh.name}: triangle-test budget exhausted`);
      if (requiredTestCount > remainingTests) continue;
      samples = allocation.requiredSamples;
    }
    for (let componentIndex = 0; componentIndex < mesh.components.length; componentIndex += 1) {
      const component = mesh.components[componentIndex]!;
      const windingSign = Math.sign(component.signedVolumeM3);
      for (const sourceTriangle of samples[componentIndex]!) {
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
        for (const candidate of component.triangles) {
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
  }
  distancesMm.sort((left, right) => left - right);
  const percentileIndex = distancesMm.length > 0 ? Math.floor((distancesMm.length - 1) * 0.05) : 0;
  const hitCoverage = sampledRays > 0 ? hitRays / sampledRays : 0;
  if (sampledRays > 0 && hitCoverage < 1) blockers.push(`inward ray hit coverage ${(hitCoverage * 100).toFixed(1)}%`);
  return {
    complete: blockers.length === 0 && sampledRays > 0 && hitCoverage === 1,
    meshes: meshes.length,
    connectedShells,
    weldedVertices,
    maximumWeldedVertices,
    componentEdges,
    maximumComponentEdges,
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
