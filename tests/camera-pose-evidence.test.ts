import { describe, expect, it } from 'vitest';
import {
  auditCameraPoseEvidence,
  type CameraPoseEvidenceContract,
} from '../src/engine/camera-pose-evidence';

const hash = (value: string): string => value.repeat(64);

function turntable(): CameraPoseEvidenceContract {
  return {
    schema: 'morphloom.camera-pose-evidence/0.1',
    turntableSequence: {
      id: 'abo-spin-281a313b', frameCount: 72, degreesPerStep: 5, direction: 'clockwise',
      metadataSourceUrl: 'https://amazon-berkeley-objects.s3.amazonaws.com/spins/metadata/spins.csv.gz',
      metadataRecordFingerprint: hash('a'),
    },
    views: [0, 18, 36, 54].map((sequenceIndex, index) => ({
      id: ['front', 'right', 'rear', 'left'][index]!,
      sourceFingerprint: String(index + 1).repeat(64),
      derivation: 'dataset-turntable-metadata',
      derivationReceiptFingerprint: hash('a'),
      usesCandidateGeometry: false,
      sequenceIndex,
      relativeAzimuthDegrees: index * 90,
    })),
  };
}

describe('camera pose evidence', () => {
  it('proves exact relative turntable steps without inventing absolute camera calibration', () => {
    const contract = turntable();
    const audit = auditCameraPoseEvidence(contract, Object.fromEntries(
      contract.views.map((view) => [view.id, view.sourceFingerprint]),
    ));
    expect(audit).toMatchObject({
      pass: true,
      relativePoseVerified: true,
      absolutePoseVerified: false,
      intrinsicsVerified: false,
      sameCameraVisualClaimAllowed: false,
      expectedStepDegrees: [90, 90, 90, 90],
    });
    expect(audit.claimBlockers).toContain('absolute object-frame camera pose is not independently calibrated');
  });

  it('rejects a candidate silhouette fit disguised as independent evidence', () => {
    const contract = turntable();
    contract.views[0]!.derivation = 'candidate-silhouette-fit';
    contract.views[0]!.usesCandidateGeometry = false;
    const audit = auditCameraPoseEvidence(contract);
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toContain('candidate camera fit hides candidate dependency: front');
    expect(audit.sameCameraVisualClaimAllowed).toBe(false);
  });

  it('allows a same-camera claim only for bounded independent correspondence receipts', () => {
    const contract = turntable();
    delete contract.turntableSequence;
    contract.views = contract.views.map((view, index) => ({
      id: view.id,
      sourceFingerprint: view.sourceFingerprint,
      derivation: 'calibrated-3d-2d-correspondences',
      derivationReceiptFingerprint: hash('b'),
      usesCandidateGeometry: false,
      absolutePose: {
        azimuthDegrees: index * 90, elevationDegrees: 8, projection: 'perspective',
        reprojectionErrorPixels: 0.8, anchorCount: 8,
        anchorReceiptFingerprint: hash('c'), intrinsicsReceiptFingerprint: hash('d'),
        modelFrameReceiptFingerprint: hash('e'), anchorSource: 'measured-drawing',
      },
    }));
    expect(auditCameraPoseEvidence(contract)).toMatchObject({
      pass: true, absolutePoseVerified: true, intrinsicsVerified: true,
      sameCameraVisualClaimAllowed: true,
    });
  });

  it('fails closed on source hash drift and inconsistent relative angles', () => {
    const contract = turntable();
    contract.views[1]!.relativeAzimuthDegrees = 80;
    const audit = auditCameraPoseEvidence(contract, { front: hash('f') });
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toEqual(expect.arrayContaining([
      'camera-pose source fingerprint mismatch: front',
      'turntable indices, relative azimuths, or cycle closure disagree',
    ]));
  });

  it('rejects unsafe thresholds and malformed sequence metadata', () => {
    expect(() => auditCameraPoseEvidence(turntable(), {}, { maximumReprojectionErrorPixels: 0 })).toThrow(/threshold/);
    const contract = turntable();
    contract.turntableSequence!.degreesPerStep = 6;
    expect(auditCameraPoseEvidence(contract).blockers).toContain('invalid turntable-sequence evidence');
  });
});
