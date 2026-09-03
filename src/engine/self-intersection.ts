import * as THREE from 'three';

const MAX_GRID_RESOLUTION = 64;
const MAX_CELLS_PER_TRIANGLE = 512;
const MAX_CANDIDATE_PAIRS = 3_000_000;
const BARYCENTRIC_INTERIOR_EPSILON = 1e-8;
const MAX_DETERMINISTIC_REPORTS = 32;
const MAX_CONTENT_REPORTS = 256;
const MAX_CONTENT_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_CACHEABLE_GEOMETRY_BYTES = 16 * 1024 * 1024;

const deterministicReportCache = new Map<string, SelfIntersectionReport>();
const deterministicKeyByGeometry = new WeakMap<THREE.BufferGeometry, string>();

interface ContentReportEntry {
  positionBytes: Uint8Array;
  indexBytes?: Uint8Array;
  report: SelfIntersectionReport;
  bytes: number;
}

const contentReportCache = new Map<string, ContentReportEntry[]>();
let contentReportEntries = 0;
let contentReportBytes = 0;

/** Internal compiler hook. The association is private and consumed by one audit. */
export function registerDeterministicTopologyKey(geometry: THREE.BufferGeometry, key: string): void {
  if (!key || key.length > 1_000_000) throw new Error('Deterministic topology key is unsafe.');
  deterministicKeyByGeometry.set(geometry, key);
}

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
  canonicalIndices: [number, number, number];
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

function attributeBytes(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Uint8Array | undefined {
  const array = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array;
  if (!ArrayBuffer.isView(array)) return undefined;
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function bytesEqual(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function byteHash(bytes: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const value = bytes[index]!;
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function contentSignature(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: THREE.BufferAttribute | null,
): { key: string; positionBytes: Uint8Array; indexBytes?: Uint8Array; bytes: number } | undefined {
  const positionBytes = attributeBytes(position);
  const indexBytes = index ? attributeBytes(index) : undefined;
  if (!positionBytes || (index && !indexBytes)) return undefined;
  const bytes = positionBytes.byteLength + (indexBytes?.byteLength ?? 0);
  if (bytes > MAX_CACHEABLE_GEOMETRY_BYTES) return undefined;
  const positionMeta = position instanceof THREE.InterleavedBufferAttribute
    ? `i:${position.itemSize}:${position.offset}:${position.data.stride}:${position.normalized ? 1 : 0}`
    : `b:${position.itemSize}:${position.normalized ? 1 : 0}`;
  const indexMeta = index ? `${index.array.constructor.name}:${index.itemSize}:${index.normalized ? 1 : 0}` : 'none';
  return {
    key: `${positionMeta}:${position.count}:${positionBytes.byteLength}:${byteHash(positionBytes)}:${indexMeta}:${index?.count ?? 0}:${indexBytes?.byteLength ?? 0}:${indexBytes ? byteHash(indexBytes) : 'none'}`,
    positionBytes,
    indexBytes,
    bytes,
  };
}

function cloneReport(report: SelfIntersectionReport): SelfIntersectionReport {
  return { ...report, samplePairs: report.samplePairs.map((pair) => [...pair]) as Array<[number, number]> };
}

function lookupContentReport(signature: ReturnType<typeof contentSignature>): SelfIntersectionReport | undefined {
  if (!signature) return undefined;
  const entries = contentReportCache.get(signature.key);
  const matched = entries?.find((entry) => bytesEqual(signature.positionBytes, entry.positionBytes)
    && bytesEqual(signature.indexBytes, entry.indexBytes));
  if (!matched || !entries) return undefined;
  contentReportCache.delete(signature.key);
  contentReportCache.set(signature.key, entries);
  return cloneReport(matched.report);
}

function storeContentReport(signature: ReturnType<typeof contentSignature>, report: SelfIntersectionReport): void {
  if (!signature) return;
  const entries = contentReportCache.get(signature.key) ?? [];
  if (entries.some((entry) => bytesEqual(signature.positionBytes, entry.positionBytes)
    && bytesEqual(signature.indexBytes, entry.indexBytes))) return;
  const entry: ContentReportEntry = {
    positionBytes: signature.positionBytes.slice(),
    indexBytes: signature.indexBytes?.slice(),
    report: cloneReport(report),
    bytes: signature.bytes,
  };
  entries.push(entry);
  contentReportCache.delete(signature.key);
  contentReportCache.set(signature.key, entries);
  contentReportEntries += 1;
  contentReportBytes += entry.bytes;
  while (contentReportEntries > MAX_CONTENT_REPORTS || contentReportBytes > MAX_CONTENT_CACHE_BYTES) {
    const oldestKey = contentReportCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const removed = contentReportCache.get(oldestKey) ?? [];
    contentReportCache.delete(oldestKey);
    contentReportEntries -= removed.length;
    contentReportBytes -= removed.reduce((sum, item) => sum + item.bytes, 0);
  }
}

function sharesVertex(a: PreparedTriangle, b: PreparedTriangle): boolean {
  return a.canonicalIndices.some((index) => b.canonicalIndices.includes(index));
}

function canonicalVertexIds(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  epsilon: number,
): Uint32Array {
  const ids = new Uint32Array(position.count);
  const buckets = new Map<number, Array<{
    id: number;
    qx: number;
    qy: number;
    qz: number;
    x: number;
    y: number;
    z: number;
  }>>();
  // Integer cell hashes avoid allocating 27 temporary strings per vertex.
  // Hash collisions are harmless because every candidate retains its complete
  // cell coordinate and is checked before the distance comparison.
  const hashCell = (qx: number, qy: number, qz: number): number => (
    Math.imul(qx | 0, 73_856_093)
    ^ Math.imul(qy | 0, 19_349_663)
    ^ Math.imul(qz | 0, 83_492_791)
  );
  const epsilonSq = epsilon * epsilon;
  let nextId = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const qx = Math.floor(x / epsilon);
    const qy = Math.floor(y / epsilon);
    const qz = Math.floor(z / epsilon);
    let canonical: number | undefined;
    for (let dx = -1; dx <= 1 && canonical === undefined; dx += 1) {
      for (let dy = -1; dy <= 1 && canonical === undefined; dy += 1) {
        for (let dz = -1; dz <= 1 && canonical === undefined; dz += 1) {
          const candidateQx = qx + dx;
          const candidateQy = qy + dy;
          const candidateQz = qz + dz;
          const candidates = buckets.get(hashCell(candidateQx, candidateQy, candidateQz));
          const match = candidates?.find((candidate) => {
            if (candidate.qx !== candidateQx || candidate.qy !== candidateQy || candidate.qz !== candidateQz) return false;
            const px = candidate.x - x;
            const py = candidate.y - y;
            const pz = candidate.z - z;
            return px * px + py * py + pz * pz <= epsilonSq;
          });
          if (match) canonical = match.id;
        }
      }
    }
    if (canonical === undefined) {
      canonical = nextId;
      nextId += 1;
      const key = hashCell(qx, qy, qz);
      const bucket = buckets.get(key);
      const entry = { id: canonical, qx, qy, qz, x, y, z };
      if (bucket) bucket.push(entry);
      else buckets.set(key, [entry]);
    }
    ids[index] = canonical;
  }
  return ids;
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
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  if (dx * dx + dy * dy + dz * dz <= epsilon * epsilon) return false;
  const origin = triangle.points[0];
  const edge1x = triangle.points[1].x - origin.x;
  const edge1y = triangle.points[1].y - origin.y;
  const edge1z = triangle.points[1].z - origin.z;
  const edge2x = triangle.points[2].x - origin.x;
  const edge2y = triangle.points[2].y - origin.y;
  const edge2z = triangle.points[2].z - origin.z;
  const px = dy * edge2z - dz * edge2y;
  const py = dz * edge2x - dx * edge2z;
  const pz = dx * edge2y - dy * edge2x;
  const determinant = edge1x * px + edge1y * py + edge1z * pz;
  if (Math.abs(determinant) <= epsilon) return false;
  const inverse = 1 / determinant;
  const tx = start.x - origin.x;
  const ty = start.y - origin.y;
  const tz = start.z - origin.z;
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u <= BARYCENTRIC_INTERIOR_EPSILON || u >= 1 - BARYCENTRIC_INTERIOR_EPSILON) return false;
  const qx = ty * edge1z - tz * edge1y;
  const qy = tz * edge1x - tx * edge1z;
  const qz = tx * edge1y - ty * edge1x;
  const v = (dx * qx + dy * qy + dz * qz) * inverse;
  if (v <= BARYCENTRIC_INTERIOR_EPSILON || u + v >= 1 - BARYCENTRIC_INTERIOR_EPSILON) return false;
  const t = (edge2x * qx + edge2y * qy + edge2z * qz) * inverse;
  return t > BARYCENTRIC_INTERIOR_EPSILON && t < 1 - BARYCENTRIC_INTERIOR_EPSILON;
}

function trianglesIntersect(a: PreparedTriangle, b: PreparedTriangle, epsilon: number): boolean {
  if (a.box.max.x + epsilon < b.box.min.x || a.box.min.x - epsilon > b.box.max.x
    || a.box.max.y + epsilon < b.box.min.y || a.box.min.y - epsilon > b.box.max.y
    || a.box.max.z + epsilon < b.box.min.z || a.box.min.z - epsilon > b.box.max.z) return false;
  const crossX = a.normal.y * b.normal.z - a.normal.z * b.normal.y;
  const crossY = a.normal.z * b.normal.x - a.normal.x * b.normal.z;
  const crossZ = a.normal.x * b.normal.y - a.normal.y * b.normal.x;
  const deltaX = b.points[0].x - a.points[0].x;
  const deltaY = b.points[0].y - a.points[0].y;
  const deltaZ = b.points[0].z - a.points[0].z;
  const planeDistance = Math.abs(a.normal.x * deltaX + a.normal.y * deltaY + a.normal.z * deltaZ);
  if (crossX * crossX + crossY * crossY + crossZ * crossZ <= epsilon * epsilon && planeDistance <= epsilon) {
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
  const deterministicKey = deterministicKeyByGeometry.get(geometry);
  if (typeof deterministicKey === 'string') {
    // Consume the key before returning so a caller mutation can never inherit
    // a report merely because userData survived. New compiler-built geometry
    // receives a fresh key from its immutable source descriptor.
    deterministicKeyByGeometry.delete(geometry);
    const deterministic = deterministicReportCache.get(deterministicKey);
    if (deterministic) return cloneReport(deterministic);
  }
  const signature = contentSignature(position, index);
  const contentCached = lookupContentReport(signature);
  if (contentCached) {
    if (typeof deterministicKey === 'string') deterministicReportCache.set(deterministicKey, cloneReport(contentCached));
    return contentCached;
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
  const canonicalIds = canonicalVertexIds(position, epsilon);
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
    triangles.push({
      indices,
      canonicalIndices: [canonicalIds[indices[0]]!, canonicalIds[indices[1]]!, canonicalIds[indices[2]]!],
      points,
      normal,
      box: new THREE.Box3().setFromPoints(points),
    });
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
  const cells = new Map<number, number[]>();
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
          const key = (x * resolution + y) * resolution + z;
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
    if (sharesVertex(a, b) || !a.box.intersectsBox(b.box)) return true;
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
  if (typeof deterministicKey === 'string') {
    if (deterministicReportCache.size >= MAX_DETERMINISTIC_REPORTS) {
      const oldest = deterministicReportCache.keys().next().value as string | undefined;
      if (oldest !== undefined) deterministicReportCache.delete(oldest);
    }
    deterministicReportCache.set(deterministicKey, cloneReport(report));
  }
  storeContentReport(signature, report);
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
