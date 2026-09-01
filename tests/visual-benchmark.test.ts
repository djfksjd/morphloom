import { describe, expect, it } from 'vitest';
import { auditSameInputVisualBenchmark, type SameInputVisualBenchmark, type VisualBenchmarkView } from '../src/engine/visual-benchmark';
import type { ComparisonFrame } from '../src/engine/reference-comparison';

function frame(foreground: [number, number, number], offset = 0): ComparisonFrame {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let index = 0; index < 64; index += 1) rgba.set(index % 3 === 0
    ? [foreground[0] + offset, foreground[1] + offset, foreground[2] + offset, 255]
    : [255, 255, 255, 255], index * 4);
  return { width: 8, height: 8, rgba, backgroundRgb: [255, 255, 255] };
}

function view(id: string, renderOffset: number, renderSha: string): VisualBenchmarkView {
  const suffix = id === 'front' ? '1' : '2';
  const referenceColor: [number, number, number] = id === 'front' ? [120, 30, 40] : [120, 31, 40];
  return {
    viewId: id,
    cameraFingerprint: 'abcddcba12345678',
    referenceSha256: `${'a'.repeat(63)}${suffix}`,
    renderSha256: `${renderSha.repeat(63)}${suffix}`,
    sceneFingerprint: `${renderSha.repeat(63)}${suffix}`,
    referenceOrigin: 'admitted-local-reference',
    renderOrigin: 'browser-webgl-canvas',
    reference: frame(referenceColor),
    render: frame(referenceColor, renderOffset),
    regions: [
      { featureId: 'silhouette', x: 0, y: 0, width: 8, height: 8 },
      { featureId: 'primary-detail', x: 0, y: 0, width: 4, height: 8 },
      { featureId: 'secondary-detail', x: 4, y: 0, width: 4, height: 8 },
    ],
    materialExpectation: { family: 'coating', roughness: 0.5 },
  };
}

function benchmark(withBlind = false): SameInputVisualBenchmark {
  const views = ['front', 'side'];
  return {
    id: 'same-input-product',
    domain: 'industrial-design',
    lockedInputFingerprint: '1234567890abcdef',
    candidates: [
      { id: 'morphloom', rendererVersion: 'morphloom-test', inputFingerprint: '1234567890abcdef', views: views.map((id) => view(id, 1, 'b')) },
      { id: 'img2threejs', rendererVersion: 'img2threejs-test', inputFingerprint: '1234567890abcdef', views: views.map((id) => view(id, 36, 'c')) },
    ],
    blindRatings: withBlind ? [
      { raterFingerprint: '10000000', presentationOrder: 'morphloom-first', preferred: 'morphloom' },
      { raterFingerprint: '20000000', presentationOrder: 'img2threejs-first', preferred: 'morphloom' },
      { raterFingerprint: '30000000', presentationOrder: 'morphloom-first', preferred: 'morphloom' },
      { raterFingerprint: '40000000', presentationOrder: 'img2threejs-first', preferred: 'morphloom' },
      { raterFingerprint: '50000000', presentationOrder: 'morphloom-first', preferred: 'img2threejs' },
    ] : undefined,
  };
}

describe('same-input blind visual benchmark contract', () => {
  it('reports only an automatic lead when no balanced blind panel exists', () => {
    const report = auditSameInputVisualBenchmark(benchmark());
    expect(report.status).toBe('automatic-morphloom-lead');
    expect(report.claimAllowed).toBe(false);
    expect(report.blockers).toContain('blind evaluation requires at least five unique raters and balanced presentation order');
  });

  it('allows a winner claim only when automatic metrics and a balanced blind panel agree', () => {
    const report = auditSameInputVisualBenchmark(benchmark(true));
    expect(report.status).toBe('morphloom-winner');
    expect(report.claimAllowed).toBe(true);
    expect(report.blind).toMatchObject({ eligible: true, ratings: 5, morphloomShare: 0.8 });
  });

  it('blocks candidates that do not use the locked identical input', () => {
    const input = benchmark(true);
    input.candidates[1].inputFingerprint = 'ffffffffffffffff';
    const report = auditSameInputVisualBenchmark(input);
    expect(report.claimAllowed).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/input fingerprint/);
  });

  it('blocks a reference plate passed off as a rendered scene', () => {
    const input = benchmark(true);
    input.candidates[0].views[0].renderSha256 = input.candidates[0].views[0].referenceSha256;
    const report = auditSameInputVisualBenchmark(input);
    expect(report.claimAllowed).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/byte-identical/);
  });

  it('requires matched cameras, references, views and critical feature regions', () => {
    const input = benchmark(true);
    input.candidates[1].views[0].cameraFingerprint = 'deadbeefdeadbeef';
    input.candidates[1].views[1].regions = [];
    const report = auditSameInputVisualBenchmark(input);
    expect(report.claimAllowed).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/same calibrated camera/);
    expect(report.blockers.join(' ')).toMatch(/required critical feature regions/);
  });

  it('rejects reused renders, mismatched regions and identical candidate pixels', () => {
    const input = benchmark(true);
    input.candidates[0].views[1].renderSha256 = input.candidates[0].views[0].renderSha256;
    input.candidates[1].views[0].regions[0] = { featureId: 'silhouette', x: 0, y: 0, width: 7, height: 8 };
    input.candidates[1].views[1].render = input.candidates[0].views[1].render;
    const report = auditSameInputVisualBenchmark(input);
    expect(report.claimAllowed).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/reused across calibrated views/);
    expect(report.blockers.join(' ')).toMatch(/identical critical feature regions/);
    expect(report.blockers.join(' ')).toMatch(/same rendered pixels/);
  });

  it('rejects the same reference image relabelled as multiple calibrated views', () => {
    const input = benchmark(true);
    input.candidates[0].views[1].referenceSha256 = input.candidates[0].views[0].referenceSha256;
    input.candidates[1].views[1].referenceSha256 = input.candidates[1].views[0].referenceSha256;
    const report = auditSameInputVisualBenchmark(input);
    expect(report.claimAllowed).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/reference capture was reused/);
  });

  it('publishes multi-scale material evidence instead of treating equal mean colour as equal surface', () => {
    const report = auditSameInputVisualBenchmark(benchmark());
    expect(report.scores.morphloom).toMatchObject({
      surfaceScaleSimilarity: expect.any(Number),
      irregularitySimilarity: expect.any(Number),
    });
    expect(report.scores.morphloom.views[0]).toMatchObject({
      surfaceScaleSimilarity: expect.any(Number),
      irregularitySimilarity: expect.any(Number),
    });
  });
});
