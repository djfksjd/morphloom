import { describe, expect, it } from 'vitest';
import { delightReferenceProjection, extendOpaqueProjectionColors } from '../src/engine/reference-projection-image';

describe('reference projection transparent-edge preparation', () => {
  it('extends nearest admitted colours without retaining black transparent fringes', () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 0, 210, 25, 40, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 220, 35, 50, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 230, 45, 60, 255, 0, 0, 0, 0,
    ]);
    const result = extendOpaqueProjectionColors(rgba, 3, 3);
    expect(result).toMatchObject({ sourcePixels: 3, filledPixels: 6 });
    for (let index = 0; index < 9; index += 1) {
      expect(result.rgba[index * 4 + 3]).toBe(255);
      expect(result.rgba[index * 4]).toBeGreaterThanOrEqual(210);
    }
  });

  it('rejects empty, oversized and malformed reference plates', () => {
    expect(() => extendOpaqueProjectionColors(new Uint8ClampedArray(16), 2, 2)).toThrow(/no opaque/);
    expect(() => extendOpaqueProjectionColors(new Uint8ClampedArray(3), 1, 1)).toThrow(/invalid/);
    expect(() => extendOpaqueProjectionColors(new Uint8ClampedArray(4), 1, 1, 255)).toThrow(/invalid/);
  });
});

describe('bounded reference de-lighting', () => {
  function litPlate(width: number, height: number): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const illumination = 0.42 + x / (width - 1) * 0.5;
        const marking = (x % 8) < 2 ? 0.54 : 1;
        rgba.set([
          Math.round(205 * illumination * marking),
          Math.round(76 * illumination * marking),
          Math.round(43 * illumination * marking),
          255,
        ], offset);
      }
    }
    return rgba;
  }

  it('reduces broad photographed lighting while preserving chromatic fine markings deterministically', () => {
    const source = litPlate(96, 48);
    const first = delightReferenceProjection(source, 96, 48);
    const second = delightReferenceProjection(source, 96, 48);
    expect(first.metrics).toEqual(second.metrics);
    expect(Array.from(first.rgba)).toEqual(Array.from(second.rgba));
    expect(first.metrics.method).toBe('bounded-linear-illumination-field-v1');
    expect(first.metrics.lumaRangeAfter).toBeLessThan(first.metrics.lumaRangeBefore);
    expect(first.metrics.confidence).toBeLessThanOrEqual(0.72);
    expect(first.metrics.minimumCorrection).toBeGreaterThanOrEqual(0.55);
    expect(first.metrics.maximumCorrection).toBeLessThanOrEqual(1.8);
    const marked = (20 * 96 + 16) * 4;
    const adjacent = (20 * 96 + 19) * 4;
    expect(first.rgba[marked]).toBeLessThan(first.rgba[adjacent]! * 0.8);
    expect(first.rgba[marked]! / Math.max(1, first.rgba[marked + 1]!)).toBeGreaterThan(2);
  });

  it('is an exact colour passthrough at zero strength and rejects unsafe requests', () => {
    const source = litPlate(12, 8);
    expect(Array.from(delightReferenceProjection(source, 12, 8, 0).rgba)).toEqual(Array.from(source));
    expect(() => delightReferenceProjection(source, 12, 8, 1.01)).toThrow(/invalid/);
    expect(() => delightReferenceProjection(new Uint8ClampedArray(4), 1, 1)).toThrow(/invalid/);
  });
});
