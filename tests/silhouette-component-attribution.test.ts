import { describe, expect, it } from 'vitest';
import { auditSemanticSilhouetteAttribution } from '../src/engine/silhouette-component-attribution';

const mask = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('semantic silhouette component attribution', () => {
  it('identifies a group whose removal eliminates excess silhouette without losing overlap', () => {
    const report = auditSemanticSilhouetteAttribution(['front', 'side'].map((id) => ({
      id, width: 4, height: 1,
      referenceMask: mask(1, 1, 0, 0), candidateMask: mask(1, 1, 1, 0),
      groups: [{ groupId: 'oversized-shell', candidateWithoutGroupMask: mask(1, 1, 0, 0) }],
    })));
    expect(report.shrinkOrRelocateGroupIds).toEqual(['oversized-shell']);
    expect(report.groups[0]!.weightedMeanDeltaIoU).toBeCloseTo(1 / 3);
    expect(report.groups[0]).toMatchObject({
      netCorrectionRatio: 1, recommendation: 'shrink-or-relocate',
    });
    expect(report.groups[0]!.views[0]).toMatchObject({
      baselineIoU: 2 / 3, ablatedIoU: 1, removedExcessPixels: 1, removedOverlapPixels: 0,
    });
  });

  it('protects a group whose ablation removes true-positive reference coverage', () => {
    const report = auditSemanticSilhouetteAttribution(['front', 'side'].map((id) => ({
      id, width: 4, height: 1,
      referenceMask: mask(1, 1, 0, 0), candidateMask: mask(1, 1, 0, 0),
      groups: [{ groupId: 'required-body', candidateWithoutGroupMask: mask(1, 0, 0, 0) }],
    })));
    expect(report.preserveOrExpandGroupIds).toEqual(['required-body']);
    expect(report.groups[0]?.recommendation).toBe('preserve-or-expand');
    expect(report.groups[0]?.views[0]?.removedOverlapPixels).toBe(1);
  });

  it('weights failing views without hiding per-view counter-evidence', () => {
    const report = auditSemanticSilhouetteAttribution([
      {
        id: 'front', width: 4, height: 1, weight: 1,
        referenceMask: mask(1, 1, 0, 0), candidateMask: mask(1, 1, 0, 0),
        groups: [{ groupId: 'profile', candidateWithoutGroupMask: mask(1, 0, 0, 0) }],
      },
      {
        id: 'side', width: 4, height: 1, weight: 10,
        referenceMask: mask(1, 1, 0, 0), candidateMask: mask(1, 1, 1, 0),
        groups: [{ groupId: 'profile', candidateWithoutGroupMask: mask(1, 1, 0, 0) }],
      },
    ]);
    expect(report.groups[0]!.weightedMeanDeltaIoU).toBeGreaterThan(0);
    expect(report.groups[0]!.minimumDeltaIoU).toBeLessThan(0);
    expect(report.groups[0]!.maximumDeltaIoU).toBeGreaterThan(0);
  });

  it('rejects inconsistent group inventories and malformed masks', () => {
    expect(() => auditSemanticSilhouetteAttribution([
      { id: 'a', width: 1, height: 1, referenceMask: mask(1), candidateMask: mask(1), groups: [{ groupId: 'x', candidateWithoutGroupMask: mask(0) }] },
      { id: 'b', width: 1, height: 1, referenceMask: mask(1), candidateMask: mask(1), groups: [{ groupId: 'y', candidateWithoutGroupMask: mask(0) }] },
    ])).toThrow(/same semantic groups/);
  });
});
