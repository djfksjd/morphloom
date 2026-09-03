import { describe, expect, it } from 'vitest';
import { fitDiscreteMultiviewCameras, type CameraFitCandidate } from '../src/engine/discrete-multiview-camera-fit';

const candidate = (azimuthDegrees: number, gateMargin: number): CameraFitCandidate => ({
  azimuthDegrees, gateMargin, wholeIoU: 0.9, primaryMassIoU: 0.9, thinFeatureScore: 0.9,
});

describe('discrete multiview camera fitting', () => {
  it('keeps ordered irregular turntable views and maximizes the worst gate', () => {
    const fit = fitDiscreteMultiviewCameras([
      { id: 'front', candidates: [candidate(8, 0.05), candidate(190, 0.4)] },
      { id: 'right', candidates: [candidate(103, 0.06), candidate(10, 0.5)] },
      { id: 'rear', candidates: [candidate(197, 0.07), candidate(20, 0.5)] },
      { id: 'left', candidates: [candidate(287, 0.08), candidate(30, 0.5)] },
    ]);
    expect(fit.pass).toBe(true);
    expect(fit.views.map((view) => view.candidate.azimuthDegrees)).toEqual([8, 103, 197, 287]);
    expect(fit.minimumGateMargin).toBeCloseTo(0.05);
    expect(fit.stepDegrees).toEqual([95, 94, 90, 81]);
  });

  it('rejects a mirrored or collapsed high-score ordering', () => {
    const fit = fitDiscreteMultiviewCameras([
      { id: 'a', candidates: [candidate(0, 0.1)] },
      { id: 'b', candidates: [candidate(270, 0.8)] },
      { id: 'c', candidates: [candidate(180, 0.8)] },
      { id: 'd', candidates: [candidate(90, 0.8)] },
    ]);
    expect(fit.pass).toBe(false);
    expect(fit.blockers[0]).toContain('No ordered cyclic');
  });

  it('fails closed when the best ordered solution misses a required fidelity gate', () => {
    const fit = fitDiscreteMultiviewCameras([
      { id: 'a', candidates: [candidate(0, -0.1)] },
      { id: 'b', candidates: [candidate(90, 0.1)] },
      { id: 'c', candidates: [candidate(180, 0.1)] },
      { id: 'd', candidates: [candidate(270, 0.1)] },
    ]);
    expect(fit.pass).toBe(false);
    expect(fit.minimumGateMargin).toBe(-0.1);
  });

  it('uses known turntable increments to reject a high-score collapsed camera cycle', () => {
    const fit = fitDiscreteMultiviewCameras([
      { id: 'front', candidates: [candidate(0, 0.1)] },
      { id: 'right', candidates: [candidate(40, 0.8), candidate(88, 0.2)] },
      { id: 'rear', candidates: [candidate(130, 0.8), candidate(181, 0.2)] },
      { id: 'left', candidates: [candidate(270, 0.2), candidate(317, 0.8)] },
    ], { expectedStepDegrees: 90, maximumStepDeviationDegrees: 12 });
    expect(fit.views.map((view) => view.candidate.azimuthDegrees)).toEqual([0, 88, 181, 270]);
    expect(fit.stepDegrees).toEqual([88, 93, 89, 90]);
  });

  it('rejects malformed expected turntable-step evidence', () => {
    const views = [
      { id: 'a', candidates: [candidate(0, 0)] },
      { id: 'b', candidates: [candidate(90, 0)] },
      { id: 'c', candidates: [candidate(180, 0)] },
    ];
    expect(() => fitDiscreteMultiviewCameras(views, { expectedStepDegrees: [90] })).toThrow(/Expected/);
    expect(() => fitDiscreteMultiviewCameras(views, { expectedStepDegrees: 90, maximumStepDeviationDegrees: 90 })).toThrow(/Expected/);
  });

  it('rejects invalid duplicate angles and unsafe step bounds', () => {
    expect(() => fitDiscreteMultiviewCameras([
      { id: 'a', candidates: [candidate(0, 0), candidate(360, 0)] },
      { id: 'b', candidates: [candidate(90, 0)] },
      { id: 'c', candidates: [candidate(180, 0)] },
    ])).toThrow(/duplicate/);
    expect(() => fitDiscreteMultiviewCameras([
      { id: 'a', candidates: [candidate(0, 0)] },
      { id: 'b', candidates: [candidate(90, 0)] },
      { id: 'c', candidates: [candidate(180, 0)] },
    ], { minimumStepDegrees: 150, maximumStepDegrees: 140 })).toThrow(/bounds/);
  });

  it('derives relative steps from source evidence and keeps one camera model across every view', () => {
    const hash = (value: string): string => value.repeat(64);
    const evidence = {
      schema: 'morphloom.camera-pose-evidence/0.1' as const,
      turntableSequence: {
        id: 'sequence', frameCount: 72, degreesPerStep: 5, direction: 'clockwise' as const,
        metadataSourceUrl: 'https://example.com/spins.csv.gz', metadataRecordFingerprint: hash('a'),
      },
      views: [0, 18, 36, 54].map((sequenceIndex, index) => ({
        id: ['front', 'right', 'rear', 'left'][index]!, sourceFingerprint: String(index + 1).repeat(64),
        derivation: 'dataset-turntable-metadata' as const, derivationReceiptFingerprint: hash('a'),
        usesCandidateGeometry: false, sequenceIndex, relativeAzimuthDegrees: index * 90,
      })),
    };
    const fit = fitDiscreteMultiviewCameras([
      { id: 'front', candidates: [{ ...candidate(2, 0.2), cameraModelId: 'ortho' }, { ...candidate(4, 0.8), cameraModelId: 'perspective' }] },
      { id: 'right', candidates: [{ ...candidate(92, 0.2), cameraModelId: 'ortho' }, { ...candidate(94, 0.8), cameraModelId: 'perspective' }] },
      { id: 'rear', candidates: [{ ...candidate(182, 0.2), cameraModelId: 'ortho' }, { ...candidate(184, 0.8), cameraModelId: 'perspective' }] },
      { id: 'left', candidates: [{ ...candidate(272, 0.2), cameraModelId: 'ortho' }, { ...candidate(274, 0.8), cameraModelId: 'perspective' }] },
    ], {
      requireSharedCameraModel: true,
      maximumStepDeviationDegrees: 0,
      poseEvidence: {
        contract: evidence,
        expectedSourceFingerprints: Object.fromEntries(evidence.views.map((view) => [view.id, view.sourceFingerprint])),
      },
    });
    expect(fit.pass).toBe(true);
    expect(fit.stepDegrees).toEqual([90, 90, 90, 90]);
    expect(fit.selectedCameraModelId).toBe('perspective');
    expect(fit.poseEvidenceAudit?.relativePoseVerified).toBe(true);
    expect(fit.sameCameraVisualClaimAllowed).toBe(false);
  });

  it('rejects camera steps that contradict bound source evidence', () => {
    const hash = (value: string): string => value.repeat(64);
    const evidence = {
      schema: 'morphloom.camera-pose-evidence/0.1' as const,
      turntableSequence: {
        id: 'sequence', frameCount: 4, degreesPerStep: 90, direction: 'clockwise' as const,
        metadataSourceUrl: 'https://example.com/spins.csv', metadataRecordFingerprint: hash('a'),
      },
      views: [0, 1, 2, 3].map((sequenceIndex, index) => ({
        id: `v${index}`, sourceFingerprint: String(index + 1).repeat(64),
        derivation: 'dataset-turntable-metadata' as const, derivationReceiptFingerprint: hash('a'),
        usesCandidateGeometry: false, sequenceIndex, relativeAzimuthDegrees: index * 90,
      })),
    };
    expect(() => fitDiscreteMultiviewCameras([
      { id: 'v0', candidates: [candidate(0, 0)] }, { id: 'v1', candidates: [candidate(90, 0)] },
      { id: 'v2', candidates: [candidate(180, 0)] }, { id: 'v3', candidates: [candidate(270, 0)] },
    ], {
      expectedStepDegrees: 80,
      poseEvidence: { contract: evidence, expectedSourceFingerprints: {} },
    })).toThrow(/disagree/);
  });
});
