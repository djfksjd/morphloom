import { describe, expect, it } from 'vitest';
import { auditSilhouetteResidualLocalization } from '../src/engine/silhouette-residual-localization';

const mask = (rows: string[]): Uint8Array => Uint8Array.from(rows.join('').split('').map((value) => Number(value)));

describe('silhouette residual localization', () => {
  it('separates missing and excess regions while preserving locked image coordinates', () => {
    const report = auditSilhouetteResidualLocalization([{
      id: 'front', width: 6, height: 6,
      referenceMask: mask(['110000', '110000', '000000', '000000', '000011', '000011']),
      candidateMask: mask(['010000', '010000', '000000', '000000', '001110', '001110']),
    }], { columns: 3, rows: 3, minimumComponentPixels: 2 });
    const view = report.views[0]!;
    expect(view).toMatchObject({ referencePixels: 8, candidatePixels: 8, overlapPixels: 4, missingPixels: 4, excessPixels: 4 });
    expect(view.referenceRecall).toBe(0.5);
    expect(view.candidatePrecision).toBe(0.5);
    expect(view.worstMissingCellId).toBe('front:cell-1-1');
    expect(view.components.map((component) => [component.kind, component.pixels])).toEqual([
      ['excess', 4], ['missing', 2], ['missing', 2],
    ]);
    expect(view.components.find((component) => component.kind === 'missing')?.normalizedBounds)
      .toEqual({ x: 0, y: 0, width: 1 / 6, height: 2 / 6 });
  });

  it('reports the worst recall and precision across multiple views', () => {
    const report = auditSilhouetteResidualLocalization([
      { id: 'a', width: 4, height: 4, referenceMask: mask(['1100', '1100', '0000', '0000']), candidateMask: mask(['1100', '1000', '0000', '0000']) },
      { id: 'b', width: 4, height: 4, referenceMask: mask(['1100', '1100', '0000', '0000']), candidateMask: mask(['1110', '1110', '0000', '0000']) },
    ], { columns: 2, rows: 2 });
    expect(report.worstRecallViewId).toBe('a');
    expect(report.worstPrecisionViewId).toBe('b');
    expect(report.minimumReferenceRecall).toBe(0.75);
    expect(report.minimumCandidatePrecision).toBeCloseTo(2 / 3);
  });

  it('keeps exact coverage gates while skipping expensive localization for trial searches', () => {
    const report = auditSilhouetteResidualLocalization([{
      id: 'trial', width: 4, height: 4,
      referenceMask: mask(['1100', '1100', '0000', '0000']),
      candidateMask: mask(['1110', '1100', '0000', '0000']),
    }], { columns: 6, rows: 6, localize: false });
    expect(report.minimumReferenceRecall).toBe(1);
    expect(report.minimumCandidatePrecision).toBe(0.8);
    expect(report.views[0]?.cells).toEqual([]);
    expect(report.views[0]?.components).toEqual([]);
  });

  it('fails closed on empty foreground, duplicate ids, malformed masks, and oversized grids', () => {
    const valid = { id: 'a', width: 2, height: 2, referenceMask: mask(['10', '00']), candidateMask: mask(['10', '00']) };
    expect(() => auditSilhouetteResidualLocalization([{ ...valid, candidateMask: new Uint8Array(4) }], { columns: 2, rows: 2 })).toThrow(/foreground/);
    expect(() => auditSilhouetteResidualLocalization([valid, valid], { columns: 2, rows: 2 })).toThrow(/unique/);
    expect(() => auditSilhouetteResidualLocalization([{ ...valid, referenceMask: new Uint8Array(3) }], { columns: 2, rows: 2 })).toThrow(/Invalid/);
    expect(() => auditSilhouetteResidualLocalization([valid], { columns: 3, rows: 2 })).toThrow(/grid/);
  });
});
