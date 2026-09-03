import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { DELIVERY_PIPELINE_REVISION, snapshotScene } from '../src/engine/delivery-validation';
import {
  auditAssetPackRevision,
  auditStaticDeliveryProof,
  compareStaticMeshRoundTrip,
  exportMillimetreStlBytes,
  STATIC_DELIVERY_REVISION,
  type StaticDeliveryProofClaim,
} from '../src/engine/static-mesh-roundtrip';

const validStaticProof = (): StaticDeliveryProofClaim => ({
  schema: 'morphloom.static-delivery-proof/0.4',
  compilerRevision: DELIVERY_PIPELINE_REVISION,
  staticDeliveryRevision: STATIC_DELIVERY_REVISION,
  assetId: 'release-surface',
  expectedSourceTriangles: 12_345,
  status: 'pass',
  blenderVersion: '5.2.1 LTS',
  assetPack: {
    compilerRevision: DELIVERY_PIPELINE_REVISION,
    inputFingerprint: 'a'.repeat(16),
    browserRoundTrip: 'pass',
    sha256: 'b'.repeat(64),
  },
  formats: {
    obj: { triangles: 12_345, sha256: 'c'.repeat(64), coordinateUnit: 'm', coordinateScaleFromMeters: 1, axisConvention: 'source-y-up' },
    stl: { triangles: 12_345, sha256: 'd'.repeat(64), coordinateUnit: 'mm', coordinateScaleFromMeters: 1_000, axisConvention: 'print-z-up' },
    ply: { triangles: 12_345, sha256: 'e'.repeat(64), coordinateUnit: 'm', coordinateScaleFromMeters: 1, axisConvention: 'source-y-up' },
  },
  parity: { triangles: 12_345, maximumAxisNormalizedEnvelopeDriftMm: 0.001 },
  usdz: { status: 'pass', validator: '/usr/bin/usdchecker', sha256: 'f'.repeat(64) },
  blockers: [],
});

const matchingBrowserReceipt = () => ({
  status: 'pass',
  inputFingerprint: 'a'.repeat(16),
  qualityReleaseReady: true,
  morphTargetPayloadParity: true,
  texturePayloadParity: true,
  materialPayloadParity: true,
});

function snapshot() {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial());
  mesh.name = 'delivery_box';
  root.add(mesh);
  return snapshotScene(root);
}

describe('static mesh delivery round-trip', () => {
  it('writes binary STL coordinates in millimetres with an exact byte contract', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial()));
    const bytes = exportMillimetreStlBytes(root);
    const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(bytes.byteLength).toBe(84 + 12 * 50);
    expect(size.toArray()).toEqual([1_000, 3_000, 2_000]);
  });

  it('accepts triangle and bounds parity while recording format limits', () => {
    const source = snapshot();
    for (const format of ['obj', 'stl', 'ply'] as const) {
      const reopened = structuredClone(source);
      if (format === 'stl') {
        const sourceMin = source.boundsMeters.min;
        const sourceMax = source.boundsMeters.max;
        reopened.boundsMeters.min = [sourceMin[0]! * 1_000, -sourceMax[2]! * 1_000, sourceMin[1]! * 1_000];
        reopened.boundsMeters.max = [sourceMax[0]! * 1_000, -sourceMin[2]! * 1_000, sourceMax[1]! * 1_000];
        reopened.boundsMeters.size = reopened.boundsMeters.max.map((value, axis) => value - reopened.boundsMeters.min[axis]!);
      }
      const audit = compareStaticMeshRoundTrip(source, reopened, format, 512);
      expect(audit).toMatchObject({
        status: 'pass', format, triangleParity: true, boundsErrorMm: 0,
        coordinateUnit: format === 'stl' ? 'mm' : 'm',
        coordinateScaleFromMeters: format === 'stl' ? 1_000 : 1,
        axisConvention: format === 'stl' ? 'print-z-up' : 'source-y-up',
      });
      expect(audit.warnings).toHaveLength(1);
    }
  });

  it('blocks triangle loss and sub-millimetre envelope drift beyond tolerance', () => {
    const source = snapshot();
    const reopened = structuredClone(source);
    reopened.triangles -= 1;
    reopened.boundsMeters.max[0] += 0.0002;
    const audit = compareStaticMeshRoundTrip(source, reopened, 'obj', 512, 0.1);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers).toEqual(expect.arrayContaining([
      expect.stringMatching(/triangle count changed/),
      expect.stringMatching(/bounds drift 0\.200 mm/),
    ]));
  });

  it('rejects unsafe payload sizes and tolerances', () => {
    const source = snapshot();
    expect(() => compareStaticMeshRoundTrip(source, source, 'stl', 0)).toThrow(/payload/);
    expect(() => compareStaticMeshRoundTrip(source, source, 'ply', 512, 11)).toThrow(/tolerance/);
    expect(() => compareStaticMeshRoundTrip(source, source, 'obj', 512, 0.1, 10)).toThrow(/coordinate scale/);
  });

  it('accepts only an asset pack bound to both current delivery revisions', () => {
    expect(auditAssetPackRevision({
      compilerRevision: DELIVERY_PIPELINE_REVISION,
      staticDeliveryRevision: STATIC_DELIVERY_REVISION,
    })).toEqual([]);
  });

  it('blocks a stale or unversioned browser asset pack instead of relabelling it', () => {
    expect(auditAssetPackRevision({ staticDeliveryRevision: 'morphloom-static-delivery/0.4.0' }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/compiler revision missing/),
        expect.stringMatching(/static-delivery revision .*0\.4\.0/),
      ]));
  });

  it('accepts a current static proof by browser input identity instead of a hard-coded demo asset', () => {
    expect(auditStaticDeliveryProof(validStaticProof(), [matchingBrowserReceipt()])).toEqual([]);
  });

  it('blocks static proof when browser identity, release state, units, or triangle parity drift', () => {
    const proof = validStaticProof();
    proof.formats!.stl!.coordinateUnit = 'm';
    proof.formats!.ply!.triangles = 12_344;
    expect(auditStaticDeliveryProof(proof, [{ ...matchingBrowserReceipt(), inputFingerprint: '0'.repeat(16) }]))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/matching release-ready current browser receipt/),
        expect.stringMatching(/STL proof/),
        expect.stringMatching(/PLY proof/),
      ]));
  });
});
