import { describe, expect, it } from 'vitest';
import { extendOpaqueProjectionColors } from '../src/engine/reference-projection-image';

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
