import { describe, expect, it } from 'vitest';
import { auditSemanticSilhouetteAttribution } from '../src/engine/silhouette-component-attribution';
import { auditSilhouetteResidualLocalization } from '../src/engine/silhouette-residual-localization';
import { planSilhouetteSemanticRepairs } from '../src/engine/silhouette-semantic-repair';

const mask = (rows: string[]): Uint8Array => Uint8Array.from(rows.join('').split('').map(Number));

const buildEvidence = (preserve = false) => {
  const views = ['front', 'right'].map((id) => ({
    id, width: 8, height: 4,
    referenceMask: mask(['00000000', preserve ? '01100000' : '01000110', preserve ? '01100000' : '01000110', '00000000']),
    candidateMask: mask(['00000000', '01100000', '01100000', '00000000']),
    groups: [{
      groupId: 'support',
      candidateWithoutGroupMask: mask(['00000000', '01000000', '01000000', '00000000']),
    }],
  }));
  return {
    attribution: auditSemanticSilhouetteAttribution(views),
    residual: auditSilhouetteResidualLocalization(views.map(({ groups: _groups, ...view }) => view), {
      columns: 4, rows: 2, minimumComponentPixels: 2,
    }),
  };
};

describe('silhouette semantic repair planning', () => {
  it('permits a bounded regional trial only with compatible residuals and calibrated orthogonal views', () => {
    const evidence = buildEvidence();
    const report = planSilhouetteSemanticRepairs(evidence.attribution, evidence.residual, [
      { viewId: 'front', azimuthDegrees: 0, projection: 'orthographic', absolutePoseVerified: true, intrinsicsVerified: true },
      { viewId: 'right', azimuthDegrees: 90, projection: 'orthographic', absolutePoseVerified: true, intrinsicsVerified: true },
    ]);
    expect(report.actionableGroupIds).toEqual(['support']);
    expect(report.hints[0]).toMatchObject({
      groupId: 'support', candidateOperation: 'relocate-or-reshape', automatic3dTrialEligible: true,
      evidenceViewIds: ['front', 'right'], blockers: [],
    });
    expect(report.hints[0]!.screenMatches[0]!.screenDeltaNormalized.x).toBeCloseTo(0.4375);
  });

  it('blocks a plausible 2D repair when camera calibration is inferred', () => {
    const evidence = buildEvidence();
    const report = planSilhouetteSemanticRepairs(evidence.attribution, evidence.residual, [
      { viewId: 'front', azimuthDegrees: 0, projection: 'orthographic', absolutePoseVerified: false, intrinsicsVerified: false },
      { viewId: 'right', azimuthDegrees: 90, projection: 'orthographic', absolutePoseVerified: false, intrinsicsVerified: false },
    ]);
    expect(report.actionableGroupIds).toEqual([]);
    expect(report.hints[0]!.blockers).toContain('absolute camera pose is not verified');
    expect(report.hints[0]!.blockers).toContain('camera intrinsics are not verified');
  });

  it('does not relocate a group whose removal damages verified coverage', () => {
    const evidence = buildEvidence(true);
    const report = planSilhouetteSemanticRepairs(evidence.attribution, evidence.residual, [
      { viewId: 'front', azimuthDegrees: 0, projection: 'orthographic', absolutePoseVerified: true, intrinsicsVerified: true },
      { viewId: 'right', azimuthDegrees: 90, projection: 'orthographic', absolutePoseVerified: true, intrinsicsVerified: true },
    ]);
    expect(report.actionableGroupIds).toEqual([]);
    expect(report.hints[0]).toMatchObject({
      recommendation: 'preserve-or-expand', candidateOperation: 'preserve-or-expand', automatic3dTrialEligible: false,
    });
  });
});
