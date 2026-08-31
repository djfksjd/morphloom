import { describe, expect, it } from 'vitest';
import { compareInteriorBands, compareReferenceFrames, type ComparisonFrame } from '../src/engine/reference-comparison';

function frame(width: number, height: number, pixels: Array<[number, number, [number, number, number]]>): ComparisonFrame {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) rgba.set([255, 255, 255, 255], index * 4);
  for (const [x, y, color] of pixels) rgba.set([...color, 255], (y * width + x) * 4);
  return { width, height, rgba, backgroundRgb: [255, 255, 255] };
}

describe('same-view reference comparison', () => {
  it('produces perfect deterministic evidence for identical frames', () => {
    const source = frame(4, 4, [[1, 1, [220, 20, 30]], [2, 1, [220, 20, 30]]]);
    const first = compareReferenceFrames(source, structuredClone(source), [{ featureId: 'blade', x: 1, y: 1, width: 2, height: 1 }]);
    const second = compareReferenceFrames(source, structuredClone(source), [{ featureId: 'blade', x: 1, y: 1, width: 2, height: 1 }]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ method: 'pixel-frame-v1', silhouetteIoU: 1, interiorSimilarity: 1, score: 1 });
    expect(first.regions[0]).toMatchObject({ featureId: 'blade', score: 1 });
  });

  it('penalizes both a shifted silhouette and wrong material colour', () => {
    const source = frame(4, 4, [[1, 1, [220, 20, 30]], [2, 1, [220, 20, 30]]]);
    const shifted = frame(4, 4, [[2, 1, [20, 20, 220]], [3, 1, [20, 20, 220]]]);
    const result = compareReferenceFrames(source, shifted);
    expect(result.silhouetteIoU).toBeCloseTo(1 / 3, 8);
    expect(result.interiorSimilarity).toBeLessThan(0.5);
    expect(result.score).toBeLessThan(0.5);
    expect(result.referenceFingerprint).not.toBe(result.renderFingerprint);
  });

  it('rejects mismatched frames, oversized inputs, and invalid feature regions', () => {
    const source = frame(2, 2, [[0, 0, [0, 0, 0]]]);
    expect(() => compareReferenceFrames(source, frame(3, 2, []))).toThrow(/identical dimensions/);
    expect(() => compareReferenceFrames(source, source, [{ featureId: 'outside', x: 1, y: 1, width: 2, height: 2 }])).toThrow(/region is invalid/);
    expect(() => compareReferenceFrames({ width: 5000, height: 5000, rgba: new Uint8Array(0) }, { width: 5000, height: 5000, rgba: new Uint8Array(0) })).toThrow(/pixel budget/);
  });

  it('finds interior changes within normalized foreground height bands', () => {
    const reference = frame(12, 12, Array.from({ length: 64 }, (_, index) => [
      2 + (index % 8), 2 + Math.floor(index / 8), [40, 40, 40],
    ] as [number, number, [number, number, number]]));
    const render = structuredClone(reference);
    for (let y = 2; y < 5; y += 1) {
      for (let x = 2; x < 10; x += 1) render.rgba.set([220, 220, 220, 255], (y * render.width + x) * 4);
    }
    const result = compareInteriorBands(reference, render);
    expect(result.bands.find((band) => band.id === 'top')?.interiorSimilarity).toBeLessThan(0.5);
    expect(result.bands.find((band) => band.id === 'bottom')?.interiorSimilarity).toBeCloseTo(1);
    expect(result.cellsCompared).toBeGreaterThan(0);
  });

  it('aligns different frame sizes by foreground bounds and refuses empty evidence', () => {
    const small = frame(8, 8, Array.from({ length: 16 }, (_, index) => [
      2 + (index % 4), 2 + Math.floor(index / 4), [30, 60, 90],
    ] as [number, number, [number, number, number]]));
    const large = frame(16, 16, Array.from({ length: 64 }, (_, index) => [
      4 + (index % 8), 4 + Math.floor(index / 8), [30, 60, 90],
    ] as [number, number, [number, number, number]]));
    expect(compareInteriorBands(small, large, [{ id: 'all', from: 0, to: 1 }], 16).aggregateSimilarity).toBeCloseTo(1);
    const empty = frame(8, 8, []);
    const refused = compareInteriorBands(empty, small, [{ id: 'all', from: 0, to: 1 }], 16);
    expect(refused.aggregateSimilarity).toBeNull();
    expect(refused.bands[0].status).toBe('no-overlapping-foreground-cells');
  });
});
