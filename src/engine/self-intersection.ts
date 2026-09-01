import * as THREE from 'three';

const MAX_GRID_RESOLUTION = 64;
const MAX_CELLS_PER_TRIANGLE = 512;
const MAX_CANDIDATE_PAIRS = 3_000_000;
const BARYCENTRIC_INTERIOR_EPSILON = 1e-8;

const reportCache = new WeakMap<THREE.BufferGeometry, {
  positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  indexAttribute: THREE.BufferAttribute | null;
  positionVersion: number;
  positionCount: number;
  indexVersion: number;
  indexCount: number;
  report: SelfIntersectionReport;
}>();

interface PreparedTriangle {
  indices: [number, number, number];
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  box: THREE.Box3;
  normal: THREE.Vector3;
}

export interface SelfIntersectionReport {
  intersections: number;
  candidatePairs: number;
  complete: boolean;
  triangleCount: number;
  samplePairs: Array<[number, number]>;
}

function attributeVersion(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  return attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute.version;
}

function sharesVertex(a: PreparedTriangle, b: PreparedTriangle, epsilon: number): boolean {
  if (a.indices.some((index) => b.indices.includes(index))) return true;
  const epsilonSq = epsilon * epsilon;
  return a.points.some((point) => b.points.some((other) => point.distanceToSquared(other) <= epsilonSq));
}

function orient2d(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect2d(
  a: THREE.Vector2,
  b: THREE.Vector2,
  c: THREE.Vector2,
  d: THREE.Vector2,
  epsilon: number,
): boolean {
  const o1 = orient2d(a, b, c);
  const o2 = orient2d(a, b, d);
  const o3 = orient2d(c, d, a);
  const o4 = orient2d(c, d, b);
  if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
    && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
  return false;
}

function coplanarTrianglesIntersect(a: PreparedTriangle, b: PreparedTriangle, epsilon: number): boolean {
  const abs = [Math.abs(a.normal.x), Math.abs(a.normal.y), Math.abs(a.normal.z)];
  const drop = abs[0] > abs[1] && abs[0] > abs[2] ? 0 : abs[1] > abs[2] ? 1 : 2;
  const project = (point: THREE.Vector3): THREE.Vector2 => drop === 0
    ? new THREE.Vector2(point.y, point.z)
    : drop === 1 ? new THREE.Vector2(point.x, point.z) : new THREE.Vector2(point.x, point.y);
  const pa = a.points.map(project);
  const pb = b.points.map(project);
  for (let ai = 0; ai < 3; ai += 1) {
    for (let bi = 0; bi < 3; bi += 1) {
      if (segmentsIntersect2d(pa[ai], pa[(ai + 1) % 3], pb[bi], pb[(bi + 1) % 3], epsilon)) return true;
    }
  }
  const contains = (point: THREE.Vector2, triangle: THREE.Vector2[]): boolean => {
    const signs = triangle.map((value, index) => orient2d(value, triangle[(index + 1) % 3], point));
    return signs.every((value) => value > epsilon) || signs.every((value) => value < -epsilon);
  };
  return contains(pa[0], pb) || contains(pb[0], pa);
}

function segmentHitsTriangle(
  start: THREE.Vector3,
  end: THREE.Vector3,
  triangle: PreparedTriangle,
  epsilon: number,
): boolean {
  const direction = new THREE.Vector3().subVectors(end, start);
  if (direction.lengthSq() <= epsilon * epsilon) return false;
  const edge1 = new THREE.Vector3().subVectors(triangle.points[1], triangle.points[0]);
  const edge2 = new THREE.Vector3().subVectors(triangle.points[2], triangle.points[0]);
  const p = new THREE.Vector3().crossVectors(direction, edge2);
  const determinant = edge1.dot(p);
  if (Math.abs(determinant) <= epsilon) return false;
  const inverse = 1 / determinant;
  const translated = new THREE.Vector3().subVectors(start, triangle.points[0]);
  const u = translated.dot(p) * inverse;
  if (u <= BARYCENTRIC_INTERIOR_EPSILON || u >= 1 - BARYCENTRIC_INTERIOR_EPSILON) return false;
  const q = new THREE.Vector3().crossVectors(translated, edge1);
  const v = direction.dot(q) * inverse;
  if (v <= BARYCENTRIC_INTERIOR_EPSILON || u + v >= 1 - BARYCENTRIC_INTERIOR_EPSILON) return false;
  const t = edge2.dot(q) * inverse;
  return t > BARYCENTRIC_INTERIOR_EPSILON && t < 1 - BARYCENTRIC_INTERIOR_EPSILON;
}

function trianglesIntersect(a: PreparedTriangle, b: PreparedTriangle, epsilon: number): boolean {
  if (!a.box.clone().expandByScalar(epsilon).intersectsBox(b.box)) return false;
  const normalCross = new THREE.Vector3().crossVectors(a.normal, b.normal);
  const planeDistance = Math.abs(a.normal.dot(new THREE.Vector3().subVectors(b.points[0], a.points[0])));
  if (normalCross.lengthSq() <= epsilon * epsilon && planeDistance <= epsilon) {
    return coplanarTrianglesIntersect(a, b, epsilon);
  }
  for (let index = 0; index < 3; index += 1) {
    if (segmentHitsTriangle(a.points[index], a.points[(index + 1) % 3], b, epsilon)) return true;
    if (segmentHitsTriangle(b.points[index], b.points[(index + 1) % 3], a, epsilon)) return true;
  }
  return false;
}

export function analyzeSelfIntersections(geometry: THREE.BufferGeometry): SelfIntersectionReport {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const indexCount = index?.count ?? position?.count ?? 0;
  if (!position || indexCount < 6) {
    return { intersections: 0, candidatePairs: 0, complete: true, triangleCount: Math.floor(indexCount / 3), samplePairs: [] };
  }
  const cached = reportCache.get(geometry);
  const positionVersion = attributeVersion(position);
  const indexVersion = index ? attributeVersion(index) : -1;
  if (cached
    && cached.positionAttribute === position
    && cached.indexAttribute === index
    && cached.positionVersion === positionVersion
    && cached.positionCount === position.count
    && cached.indexVersion === indexVersion
    && cached.indexCount === indexCount) return { ...cached.report };

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox ?? new THREE.Box3();
  const diagonal = bounds.getSize(new THREE.Vector3()).length();
  const epsilon = Math.max(diagonal * 1e-9, 1e-10);
  const triangles: PreparedTriangle[] = [];
  for (let offset = 0; offset < indexCount; offset += 3) {
    const indices: [number, number, number] = index
      ? [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)]
      : [offset, offset + 1, offset + 2];
    const points = indices.map((vertex) => new THREE.Vector3().fromBufferAttribute(position, vertex)) as PreparedTriangle['points'];
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(points[1], points[0]),
      new THREE.Vector3().subVectors(points[2], points[0]),
    ).normalize();
    triangles.push({ indices, points, normal, box: new THREE.Box3().setFromPoints(points) });
  }

  const resolution = Math.max(1, Math.min(MAX_GRID_RESOLUTION, Math.ceil(Math.cbrt(triangles.length))));
  const size = bounds.getSize(new THREE.Vector3());
  const cellSize = new THREE.Vector3(
    size.x > epsilon ? size.x / resolution : 1,
    size.y > epsilon ? size.y / resolution : 1,
    size.z > epsilon ? size.z / resolution : 1,
  );
  const cellIndex = (value: number, axis: 'x' | 'y' | 'z'): number => Math.max(
    0,
    Math.min(resolution - 1, Math.floor((value - bounds.min[axis]) / cellSize[axis])),
  );
  const cells = new Map<string, number[]>();
  const oversized: number[] = [];
  triangles.forEach((triangle, triangleIndex) => {
    const min = {
      x: cellIndex(triangle.box.min.x, 'x'), y: cellIndex(triangle.box.min.y, 'y'), z: cellIndex(triangle.box.min.z, 'z'),
    };
    const max = {
      x: cellIndex(triangle.box.max.x, 'x'), y: cellIndex(triangle.box.max.y, 'y'), z: cellIndex(triangle.box.max.z, 'z'),
    };
    const cellCount = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
    if (cellCount > MAX_CELLS_PER_TRIANGLE) {
      oversized.push(triangleIndex);
      return;
    }
    for (let x = min.x; x <= max.x; x += 1) {
      for (let y = min.y; y <= max.y; y += 1) {
        for (let z = min.z; z <= max.z; z += 1) {
          const key = `${x}:${y}:${z}`;
          const bucket = cells.get(key);
          if (bucket) bucket.push(triangleIndex);
          else cells.set(key, [triangleIndex]);
        }
      }
    }
  });

  const seen = new Set<number>();
  let candidatePairs = 0;
  let intersections = 0;
  let complete = true;
  const samplePairs: Array<[number, number]> = [];
  const inspectPair = (first: number, second: number): boolean => {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    if (low === high) return true;
    const pairKey = low * triangles.length + high;
    if (seen.has(pairKey)) return true;
    seen.add(pairKey);
    const a = triangles[low];
    const b = triangles[high];
    if (sharesVertex(a, b, epsilon) || !a.box.intersectsBox(b.box)) return true;
    candidatePairs += 1;
    if (candidatePairs > MAX_CANDIDATE_PAIRS) {
      complete = false;
      return false;
    }
    if (trianglesIntersect(a, b, epsilon)) {
      intersections += 1;
      if (samplePairs.length < 128) samplePairs.push([low, high]);
    }
    return true;
  };

  outer: for (const bucket of cells.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        if (!inspectPair(bucket[left], bucket[right])) break outer;
      }
    }
  }
  if (complete && oversized.length) {
    outer: for (const large of oversized) {
      for (let other = 0; other < triangles.length; other += 1) {
        if (!inspectPair(large, other)) break outer;
      }
    }
  }

  const report = { intersections, candidatePairs, complete, triangleCount: triangles.length, samplePairs };
  reportCache.set(geometry, {
    positionAttribute: position,
    indexAttribute: index,
    positionVersion,
    positionCount: position.count,
    indexVersion,
    indexCount,
    report,
  });
  return { ...report };
}
