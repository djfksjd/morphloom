import { describe, expect, it } from 'vitest';
import {
  auditGroundTruthCorpus,
  validateGroundTruthCorpusManifest,
  type GroundTruthAssetReceipt,
  type GroundTruthCorpusManifest,
} from '../src/engine/ground-truth-corpus';

const attribution = [
  'Data, images, and 3D model: Amazon.com',
  'Dataset builders: independent credited contributors',
];

function manifest(): GroundTruthCorpusManifest {
  const image = (id: 'front' | 'right' | 'rear' | 'left', relativeAzimuthDegrees: number, index: number) => ({
    id,
    kind: 'input-image' as const,
    relativePath: `fixture/${id}.jpg`,
    sourceUrl: `https://amazon-berkeley-objects.s3.amazonaws.com/spins/original/fixture-${id}.jpg`,
    sha256: String(index).repeat(64),
    bytes: 1_000 + index,
    mimeType: 'image/jpeg' as const,
    role: id,
    sequenceIndex: index === 1 ? 0 : (index - 1) * 18,
    relativeAzimuthDegrees,
    width: 800,
    height: 600,
  });
  return {
    schema: 'morphloom.ground-truth-corpus/0.2',
    id: 'fixture-corpus',
    revision: '2026-09-03.1',
    sourceDataset: 'Amazon Berkeley Objects',
    sourceDatasetUrl: 'https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
    purpose: 'Verify that external sources and ground-truth bytes remain independently bound.',
    cases: [{
      id: 'fixture-product',
      domains: ['industrial-design'],
      sourceItemId: 'B012345678',
      title: 'Fixture product',
      license: { spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution },
      evidenceMode: 'multi-view+metric+reference-3d',
      cameraPoseEvidence: {
        schema: 'morphloom.camera-pose-evidence/0.1',
        turntableSequence: {
          id: 'fixture-spin', frameCount: 72, degreesPerStep: 5, direction: 'clockwise',
          metadataSourceUrl: 'https://amazon-berkeley-objects.s3.amazonaws.com/spins/metadata/spins.csv.gz',
          metadataRecordFingerprint: 'b'.repeat(64),
        },
        views: [
          { id: 'front', sourceFingerprint: '1'.repeat(64), sequenceIndex: 0, relativeAzimuthDegrees: 0 },
          { id: 'right', sourceFingerprint: '2'.repeat(64), sequenceIndex: 18, relativeAzimuthDegrees: 90 },
          { id: 'rear', sourceFingerprint: '3'.repeat(64), sequenceIndex: 36, relativeAzimuthDegrees: 180 },
          { id: 'left', sourceFingerprint: '4'.repeat(64), sequenceIndex: 54, relativeAzimuthDegrees: 270 },
        ].map((view) => ({
          ...view, derivation: 'dataset-turntable-metadata' as const,
          derivationReceiptFingerprint: 'b'.repeat(64), usesCandidateGeometry: false,
        })),
      },
      inputAssetIds: ['front', 'right', 'rear', 'left'],
      groundTruthAssetId: 'ground-truth',
      listingDimensionsMm: { width: 100, height: 200, depth: 50, confidence: 0.7 },
      expectedModel: {
        nodes: 1, meshes: 1, materials: 2, textures: 3, vertices: 1_000, triangles: 1_800,
        boundsMeters: [0.1, 0.2, 0.05],
      },
      assets: [
        {
          id: 'ground-truth', kind: 'ground-truth-model', relativePath: 'fixture/ground-truth.glb',
          sourceUrl: 'https://amazon-berkeley-objects.s3.amazonaws.com/3dmodels/original/F/fixture.glb',
          sha256: 'a'.repeat(64), bytes: 20_000, mimeType: 'model/gltf-binary',
        },
        image('front', 0, 1), image('right', 90, 2), image('rear', 180, 3), image('left', 270, 4),
      ],
    }],
  };
}

function receipts(source: GroundTruthCorpusManifest): GroundTruthAssetReceipt[] {
  const item = source.cases[0]!;
  return item.assets.map((asset) => asset.kind === 'input-image' ? {
    caseId: item.id, assetId: asset.id, sha256: asset.sha256, bytes: asset.bytes,
    width: asset.width, height: asset.height,
  } : {
    caseId: item.id, assetId: asset.id, sha256: asset.sha256, bytes: asset.bytes,
    model: {
      ...item.expectedModel,
      boundsMeters: [...item.expectedModel.boundsMeters],
      validatorStatus: 'warn', validatorErrors: 0, validatorWarnings: 1,
      issueCodes: ['MESH_PRIMITIVE_GENERATED_TANGENT_SPACE'], independentRead: true,
    },
  });
}

describe('independent ground-truth corpus audit', () => {
  it('accepts hash-bound multi-view evidence and an independently parsed reference GLB', () => {
    const source = manifest();
    const report = auditGroundTruthCorpus(source, receipts(source), 'f'.repeat(64));
    expect(report.pass).toBe(true);
    expect(report.verifiedCases).toBe(1);
    expect(report.verifiedAssets).toBe(5);
    expect(report.cases[0]).toMatchObject({
      distinctRelativeViewAzimuths: 4, relativeCameraPoseVerified: true,
      sameCameraVisualClaimAllowed: false, maximumBoundsErrorMm: 0,
    });
    expect(report.cases[0]!.warnings[0]).toContain('MESH_PRIMITIVE_GENERATED_TANGENT_SPACE');
  });

  it('fails when downloaded bytes no longer match the licensed manifest', () => {
    const source = manifest();
    const observed = receipts(source);
    observed[1]!.sha256 = 'e'.repeat(64);
    const report = auditGroundTruthCorpus(source, observed, 'f'.repeat(64));
    expect(report.pass).toBe(false);
    expect(report.blockers).toContain('fixture-product: front: SHA-256 mismatch');
  });

  it('fails when the reference GLB geometry differs from its fixed metadata', () => {
    const source = manifest();
    const observed = receipts(source);
    observed[0]!.model!.triangles -= 1;
    observed[0]!.model!.boundsMeters[2] += 0.001;
    const report = auditGroundTruthCorpus(source, observed, 'f'.repeat(64));
    expect(report.pass).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'fixture-product: ground-truth: triangles drift',
      'fixture-product: ground-truth: bounds drift 1.000 mm',
    ]));
  });

  it('rejects a corpus that repeats one image under multiple view labels', () => {
    const source = manifest();
    source.cases[0]!.assets[2]!.sha256 = source.cases[0]!.assets[1]!.sha256;
    expect(() => validateGroundTruthCorpusManifest(source)).toThrow(/reuses asset bytes/);
  });

  it('rejects path traversal and unapproved source hosts before reading files', () => {
    const source = manifest();
    source.cases[0]!.assets[1]!.relativePath = '../front.jpg';
    expect(() => validateGroundTruthCorpusManifest(source)).toThrow(/unsafe identity, path, URL, hash, or size/);

    const other = manifest();
    other.cases[0]!.assets[1]!.sourceUrl = 'https://example.com/front.jpg';
    expect(() => validateGroundTruthCorpusManifest(other)).toThrow(/unsafe identity, path, URL, hash, or size/);
  });
});
