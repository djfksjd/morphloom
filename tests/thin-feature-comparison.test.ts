import { describe, expect, it } from 'vitest';
import { compareReferenceFrames, compareThinFeatureSilhouettes, type ComparisonFrame } from '../src/engine/reference-comparison';

function lines(segments: Array<[number, number, number, number]>): ComparisonFrame {
  const width = 64;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  const mask = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of segments) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(x0 + (x1 - x0) * step / Math.max(1, steps));
      const y = Math.round(y0 + (y1 - y0) * step / Math.max(1, steps));
      mask[y * width + x] = 1;
      const offset = (y * width + x) * 4;
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
    }
  }
  return { width, height, rgba, mask };
}

describe('thin-feature silhouette comparison', () => {
  it('recognizes a one-pixel registration shift without pretending area IoU is high', () => {
    const reference = lines([[12, 8, 30, 56], [30, 8, 48, 56]]);
    const shifted = lines([[13, 8, 31, 56], [31, 8, 49, 56]]);
    expect(compareReferenceFrames(reference, shifted).silhouetteIoU).toBeLessThan(0.4);
    const result = compareThinFeatureSilhouettes(reference, shifted, 2);
    expect(result.symmetricCoverage).toBe(1);
    expect(result.score).toBeGreaterThan(0.85);
  });

  it('penalizes a missing branch even when the remaining branch is aligned', () => {
    const reference = lines([[12, 8, 30, 56], [30, 8, 48, 56]]);
    const missing = lines([[12, 8, 30, 56]]);
    const result = compareThinFeatureSilhouettes(reference, missing, 2);
    expect(result.referenceCoverage).toBeLessThan(0.65);
    expect(result.score).toBeLessThan(0.7);
  });

  it('rejects unsafe tolerance and empty evidence', () => {
    const frame = lines([[10, 10, 20, 20]]);
    expect(() => compareThinFeatureSilhouettes(frame, frame, 33)).toThrow(/tolerance/);
    const empty = lines([]);
    expect(() => compareThinFeatureSilhouettes(empty, frame)).toThrow(/foreground/);
  });
});
