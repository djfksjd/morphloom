import type { SceneSnapshot } from './delivery-validation';

export type StaticMeshFormat = 'obj' | 'stl' | 'ply';

export interface StaticMeshRoundTripAudit {
  schema: 'morphloom.static-mesh-roundtrip/0.1';
  format: StaticMeshFormat;
  status: 'pass' | 'blocked';
  bytes: number;
  triangleParity: boolean;
  sourceTriangles: number;
  reopenedTriangles: number;
  boundsErrorMm: number;
  blockers: string[];
  warnings: string[];
}

export const MAX_STATIC_EXPORT_BYTES = 256 * 1024 * 1024;

export function assertStaticMeshPayloadBytes(bytes: number): void {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_STATIC_EXPORT_BYTES) {
    throw new Error('Static mesh payload is outside the 1 byte..256 MB budget.');
  }
}

function maximumBoundsErrorMm(source: SceneSnapshot, reopened: SceneSnapshot): number {
  const differences = source.boundsMeters.min.map((value, axis) => Math.abs(value - reopened.boundsMeters.min[axis]!))
    .concat(source.boundsMeters.max.map((value, axis) => Math.abs(value - reopened.boundsMeters.max[axis]!)));
  return Math.max(...differences, 0) * 1_000;
}

export function compareStaticMeshRoundTrip(
  source: SceneSnapshot,
  reopened: SceneSnapshot,
  format: StaticMeshFormat,
  bytes: number,
  boundsToleranceMm = 0.1,
): StaticMeshRoundTripAudit {
  if (!['obj', 'stl', 'ply'].includes(format)) throw new Error(`Unsupported static mesh format: ${String(format)}`);
  assertStaticMeshPayloadBytes(bytes);
  if (!Number.isFinite(boundsToleranceMm) || boundsToleranceMm < 0 || boundsToleranceMm > 10) {
    throw new Error('Static mesh bounds tolerance must be within 0..10 mm.');
  }
  const blockers: string[] = [];
  const triangleParity = source.triangles === reopened.triangles;
  const boundsErrorMm = maximumBoundsErrorMm(source, reopened);
  if (!source.finiteTransforms || !reopened.finiteTransforms) blockers.push('non-finite transform or geometry after static mesh round-trip');
  if (source.meshes < 1 || source.triangles < 1) blockers.push('source scene has no mesh triangles');
  if (reopened.meshes < 1 || reopened.triangles < 1) blockers.push('reopened static mesh has no triangles');
  if (!triangleParity) blockers.push(`triangle count changed ${source.triangles}→${reopened.triangles}`);
  if (!Number.isFinite(boundsErrorMm) || boundsErrorMm > boundsToleranceMm) {
    blockers.push(`bounds drift ${boundsErrorMm.toFixed(3)} mm exceeds ${boundsToleranceMm.toFixed(3)} mm`);
  }
  const warnings = format === 'obj'
    ? ['OBJ round-trip covers static geometry only; PBR textures, rigging and animation remain GLB-only.']
    : format === 'stl'
      ? ['STL is unitless static geometry; Morphloom handoff declares millimetres outside the payload.']
      : ['PLY round-trip covers static geometry attributes; external texture files are not embedded.'];
  return {
    schema: 'morphloom.static-mesh-roundtrip/0.1',
    format,
    status: blockers.length === 0 ? 'pass' : 'blocked',
    bytes,
    triangleParity,
    sourceTriangles: source.triangles,
    reopenedTriangles: reopened.triangles,
    boundsErrorMm,
    blockers,
    warnings,
  };
}
