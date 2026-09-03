import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { DELIVERY_PIPELINE_REVISION, snapshotScene, type SceneSnapshot } from './delivery-validation';

export type StaticMeshFormat = 'obj' | 'stl' | 'ply';
export const STATIC_DELIVERY_REVISION = 'morphloom-static-delivery/0.6.0';

export interface StaticMeshRoundTripAudit {
  schema: 'morphloom.static-mesh-roundtrip/0.2';
  format: StaticMeshFormat;
  coordinateUnit: 'm' | 'mm';
  coordinateScaleFromMeters: number;
  axisConvention: 'source-y-up' | 'print-z-up';
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

export interface AssetPackRevisionClaim {
  compilerRevision?: string;
  staticDeliveryRevision?: string;
}

export interface StaticDeliveryBrowserReceipt {
  status?: string;
  inputFingerprint?: string;
  qualityReleaseReady?: boolean;
  morphTargetPayloadParity?: boolean;
  texturePayloadParity?: boolean;
  materialPayloadParity?: boolean;
}

export interface StaticDeliveryProofClaim {
  schema?: string;
  compilerRevision?: string;
  staticDeliveryRevision?: string;
  assetId?: string;
  expectedSourceTriangles?: number;
  status?: string;
  blenderVersion?: string;
  assetPack?: {
    compilerRevision?: string;
    inputFingerprint?: string;
    browserRoundTrip?: string;
    sha256?: string;
  };
  formats?: Partial<Record<StaticMeshFormat, {
    triangles?: number;
    sha256?: string;
    coordinateUnit?: string;
    coordinateScaleFromMeters?: number;
    axisConvention?: string;
  }>>;
  parity?: { triangles?: number; maximumAxisNormalizedEnvelopeDriftMm?: number };
  usdz?: { status?: string; validator?: string; sha256?: string };
  blockers?: string[];
}

/** Prevents an old browser export from being relabelled as current proof. */
export function auditAssetPackRevision(claim: AssetPackRevisionClaim): string[] {
  const blockers: string[] = [];
  if (claim.compilerRevision !== DELIVERY_PIPELINE_REVISION) {
    blockers.push(`Asset pack compiler revision ${claim.compilerRevision ?? 'missing'} does not match ${DELIVERY_PIPELINE_REVISION}.`);
  }
  if (claim.staticDeliveryRevision !== STATIC_DELIVERY_REVISION) {
    blockers.push(`Asset pack static-delivery revision ${claim.staticDeliveryRevision ?? 'missing'} does not match ${STATIC_DELIVERY_REVISION}.`);
  }
  return blockers;
}

/**
 * Admits a static-delivery receipt only when its real browser source, Blender
 * imports, Apple validation, units, triangle count, and current revisions all
 * describe the same release-ready asset. The asset name is intentionally not
 * hard-coded: identity comes from the browser input fingerprint.
 */
export function auditStaticDeliveryProof(
  claim: StaticDeliveryProofClaim | undefined,
  browserReceipts: StaticDeliveryBrowserReceipt[],
): string[] {
  if (!claim) return ['No revision-bound static delivery report exists.'];
  const blockers: string[] = [];
  if (claim.schema !== 'morphloom.static-delivery-proof/0.4') blockers.push('Static delivery schema is invalid.');
  blockers.push(...auditAssetPackRevision(claim));
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(claim.assetId ?? '')) blockers.push('Static delivery asset id is invalid.');
  if (claim.status !== 'pass') blockers.push('Static delivery report is not passing.');
  if (claim.assetPack?.compilerRevision !== DELIVERY_PIPELINE_REVISION) blockers.push('Asset-pack compiler revision is stale.');
  if (claim.assetPack?.browserRoundTrip !== 'pass') blockers.push('Asset pack lacks a passing browser round-trip.');
  if (!/^[a-f0-9]{16}$/.test(claim.assetPack?.inputFingerprint ?? '')) blockers.push('Asset-pack input fingerprint is invalid.');
  if (!/^[a-f0-9]{64}$/.test(claim.assetPack?.sha256 ?? '')) blockers.push('Asset-pack SHA-256 is invalid.');
  const matchingBrowserReceipt = browserReceipts.find((receipt) => receipt.inputFingerprint === claim.assetPack?.inputFingerprint);
  if (!matchingBrowserReceipt
    || matchingBrowserReceipt.status !== 'pass'
    || matchingBrowserReceipt.qualityReleaseReady !== true
    || matchingBrowserReceipt.morphTargetPayloadParity !== true
    || matchingBrowserReceipt.texturePayloadParity !== true
    || matchingBrowserReceipt.materialPayloadParity !== true) {
    blockers.push('No matching release-ready current browser receipt preserves all GLB payload classes.');
  }
  const triangles = claim.expectedSourceTriangles;
  if (!Number.isInteger(triangles) || Number(triangles) < 1 || Number(triangles) > 10_000_000) {
    blockers.push('Static delivery triangle count is invalid.');
  }
  if (claim.parity?.triangles !== triangles) blockers.push('Static delivery aggregate triangle parity failed.');
  const drift = Number(claim.parity?.maximumAxisNormalizedEnvelopeDriftMm);
  if (!Number.isFinite(drift) || drift < 0 || drift > 0.1) blockers.push('Static delivery envelope drift exceeds 0.1 mm.');
  const expectedFormats: Record<StaticMeshFormat, { unit: string; scale: number; axis: string }> = {
    obj: { unit: 'm', scale: 1, axis: 'source-y-up' },
    stl: { unit: 'mm', scale: 1_000, axis: 'print-z-up' },
    ply: { unit: 'm', scale: 1, axis: 'source-y-up' },
  };
  for (const format of Object.keys(expectedFormats) as StaticMeshFormat[]) {
    const proof = claim.formats?.[format];
    const expected = expectedFormats[format];
    if (proof?.triangles !== triangles
      || !/^[a-f0-9]{64}$/.test(proof?.sha256 ?? '')
      || proof?.coordinateUnit !== expected.unit
      || proof?.coordinateScaleFromMeters !== expected.scale
      || proof?.axisConvention !== expected.axis) {
      blockers.push(`${format.toUpperCase()} proof does not match the shared triangle, hash, unit, or axis contract.`);
    }
  }
  if (!/^\d+\.\d+\.\d+(?:\s+LTS)?$/.test(claim.blenderVersion ?? '')) blockers.push('Blender version evidence is invalid.');
  if (claim.usdz?.status !== 'pass'
    || !/(?:^|\/)usdchecker$/.test(claim.usdz?.validator ?? '')
    || !/^[a-f0-9]{64}$/.test(claim.usdz?.sha256 ?? '')) {
    blockers.push('USDZ Apple validation proof is invalid.');
  }
  if ((claim.blockers?.length ?? 0) > 0) blockers.push('Static delivery report contains blockers.');
  return blockers;
}

export function assertStaticMeshPayloadBytes(bytes: number): void {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_STATIC_EXPORT_BYTES) {
    throw new Error('Static mesh payload is outside the 1 byte..256 MB budget.');
  }
}

/**
 * STL has no unit metadata. Morphloom's delivery contract therefore writes
 * millimetre-valued, Z-up coordinates and rejects a scene that would exceed
 * the static-payload budget before asking Three.js to allocate the buffer.
 */
export function exportMillimetreStlBytes(root: THREE.Object3D): Uint8Array {
  const source = snapshotScene(root);
  const expectedBytes = 84 + source.triangles * 50;
  assertStaticMeshPayloadBytes(expectedBytes);

  const printRoot = new THREE.Group();
  printRoot.rotation.x = Math.PI / 2;
  const millimetreRoot = root.clone(true);
  millimetreRoot.scale.multiplyScalar(1_000);
  printRoot.add(millimetreRoot);
  printRoot.updateMatrixWorld(true);
  const view = new STLExporter().parse(printRoot, { binary: true });
  const bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`STL byte count changed: expected ${expectedBytes}, received ${bytes.byteLength}.`);
  }
  return bytes;
}

function maximumBoundsErrorMm(
  source: SceneSnapshot,
  reopened: SceneSnapshot,
  coordinateScaleFromMeters: number,
  format: StaticMeshFormat,
): number {
  const expectedMinimum = format === 'stl'
    ? [source.boundsMeters.min[0]!, -source.boundsMeters.max[2]!, source.boundsMeters.min[1]!]
    : source.boundsMeters.min;
  const expectedMaximum = format === 'stl'
    ? [source.boundsMeters.max[0]!, -source.boundsMeters.min[2]!, source.boundsMeters.max[1]!]
    : source.boundsMeters.max;
  const differences = expectedMinimum.map((value, axis) => Math.abs(value - reopened.boundsMeters.min[axis]! / coordinateScaleFromMeters))
    .concat(expectedMaximum.map((value, axis) => Math.abs(value - reopened.boundsMeters.max[axis]! / coordinateScaleFromMeters)));
  return Math.max(...differences, 0) * 1_000;
}

export function compareStaticMeshRoundTrip(
  source: SceneSnapshot,
  reopened: SceneSnapshot,
  format: StaticMeshFormat,
  bytes: number,
  boundsToleranceMm = 0.1,
  coordinateScaleFromMeters = format === 'stl' ? 1_000 : 1,
): StaticMeshRoundTripAudit {
  if (!['obj', 'stl', 'ply'].includes(format)) throw new Error(`Unsupported static mesh format: ${String(format)}`);
  assertStaticMeshPayloadBytes(bytes);
  if (!Number.isFinite(boundsToleranceMm) || boundsToleranceMm < 0 || boundsToleranceMm > 10) {
    throw new Error('Static mesh bounds tolerance must be within 0..10 mm.');
  }
  if (coordinateScaleFromMeters !== 1 && coordinateScaleFromMeters !== 1_000) {
    throw new Error('Static mesh coordinate scale must be 1 (metres) or 1000 (millimetres).');
  }
  const blockers: string[] = [];
  const triangleParity = source.triangles === reopened.triangles;
  const boundsErrorMm = maximumBoundsErrorMm(source, reopened, coordinateScaleFromMeters, format);
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
      ? ['STL is unitless static geometry; Morphloom writes millimetre-valued coordinates and records that contract in the asset manifest.']
      : ['PLY round-trip covers static geometry attributes; external texture files are not embedded.'];
  return {
    schema: 'morphloom.static-mesh-roundtrip/0.2',
    format,
    coordinateUnit: coordinateScaleFromMeters === 1_000 ? 'mm' : 'm',
    coordinateScaleFromMeters,
    axisConvention: format === 'stl' ? 'print-z-up' : 'source-y-up',
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
