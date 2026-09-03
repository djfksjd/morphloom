import { describe, expect, it } from 'vitest';
import { auditMultiviewSilhouetteFidelity } from '../src/engine/silhouette-fidelity';

describe('multiview silhouette fidelity', () => {
  it('uses primary-mass and thin-feature gates for sparse structures', () => {
    const audit = auditMultiviewSilhouetteFidelity([
      { id: 'front', referenceDensity: 0.04, wholeIoU: 0.42, primaryMassIoU: 0.78, thinFeatureScore: 0.88 },
      { id: 'side', referenceDensity: 0.05, wholeIoU: 0.38, primaryMassIoU: 0.74, thinFeatureScore: 0.82 },
    ]);
    expect(audit.mode).toBe('sparse-structure');
    expect(audit.pass).toBe(true);
    expect(audit.minimumWholeIoU).toBe(0.38);
  });

  it('does not let a high average hide a missing thin member in one sparse view', () => {
    const audit = auditMultiviewSilhouetteFidelity([
      { id: 'front', referenceDensity: 0.04, wholeIoU: 0.42, primaryMassIoU: 0.9, thinFeatureScore: 0.95 },
      { id: 'side', referenceDensity: 0.05, wholeIoU: 0.38, primaryMassIoU: 0.9, thinFeatureScore: 0.5 },
    ]);
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toEqual(['side: thin feature score 0.500 < 0.800']);
  });

  it('keeps whole-area IoU as the gate for dense silhouettes', () => {
    const audit = auditMultiviewSilhouetteFidelity([
      { id: 'front', referenceDensity: 0.4, wholeIoU: 0.9, primaryMassIoU: 0.9, thinFeatureScore: 0.9 },
      { id: 'side', referenceDensity: 0.35, wholeIoU: 0.7, primaryMassIoU: 0.95, thinFeatureScore: 0.95 },
    ]);
    expect(audit.mode).toBe('dense-silhouette');
    expect(audit.pass).toBe(false);
    expect(audit.blockers.join(' ')).toMatch(/whole silhouette/);
  });

  it('requires whole, primary-mass, and thin-feature evidence for hybrid structures', () => {
    const passing = auditMultiviewSilhouetteFidelity([
      { id: 'front', referenceDensity: 0.18, wholeIoU: 0.81, primaryMassIoU: 0.91, thinFeatureScore: 0.85 },
      { id: 'side', referenceDensity: 0.13, wholeIoU: 0.73, primaryMassIoU: 0.86, thinFeatureScore: 0.84 },
    ]);
    expect(passing.mode).toBe('hybrid-structure');
    expect(passing.pass).toBe(true);

    const missingWire = auditMultiviewSilhouetteFidelity([
      { id: 'front', referenceDensity: 0.18, wholeIoU: 0.81, primaryMassIoU: 0.91, thinFeatureScore: 0.79 },
      { id: 'side', referenceDensity: 0.13, wholeIoU: 0.73, primaryMassIoU: 0.86, thinFeatureScore: 0.84 },
    ]);
    expect(missingWire.pass).toBe(false);
    expect(missingWire.blockers.join(' ')).toMatch(/thin feature/);

    const wrongEnvelope = auditMultiviewSilhouetteFidelity([
      { id: 'front', referenceDensity: 0.18, wholeIoU: 0.69, primaryMassIoU: 0.91, thinFeatureScore: 0.85 },
      { id: 'side', referenceDensity: 0.13, wholeIoU: 0.73, primaryMassIoU: 0.86, thinFeatureScore: 0.84 },
    ]);
    expect(wrongEnvelope.pass).toBe(false);
    expect(wrongEnvelope.blockers.join(' ')).toMatch(/hybrid whole silhouette/);
  });

  it('rejects inconsistent hybrid thresholds', () => {
    expect(() => auditMultiviewSilhouetteFidelity([
      { id: 'front', referenceDensity: 0.1, wholeIoU: 0.8, primaryMassIoU: 0.8, thinFeatureScore: 0.8 },
      { id: 'side', referenceDensity: 0.1, wholeIoU: 0.8, primaryMassIoU: 0.8, thinFeatureScore: 0.8 },
    ], { maximumSparseDensity: 0.3, maximumHybridDensity: 0.2 })).toThrow(/inconsistent/);
  });
});
