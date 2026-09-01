import { describe, expect, it } from 'vitest';
import { compareMaterialFrames } from '../src/engine/material-comparison';
import type { ComparisonFrame } from '../src/engine/reference-comparison';

function texture(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): ComparisonFrame {
  const rgba = new Uint8Array(width * height * 4);
  const mask = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba.set([...pixel(x, y), 255], (y * width + x) * 4);
  }
  return { width, height, rgba, mask };
}

describe('material-region comparison', () => {
  it('accepts identical directional microstructure deterministically', () => {
    const brushed = texture(64, 64, (x) => {
      const value = 70 + (x % 8) * 18;
      return [value, value + 5, value + 10];
    });
    const first = compareMaterialFrames(brushed, structuredClone(brushed), { family: 'metal', anisotropy: 0.8 }, 32);
    const second = compareMaterialFrames(brushed, structuredClone(brushed), { family: 'metal', anisotropy: 0.8 }, 32);
    expect(first).toEqual(second);
    expect(first.scores.overall).toBeCloseTo(1);
    expect(first.passed).toBe(true);
    expect(first.mismatches).toEqual([]);
  });

  it('separates wrong colour and missing environment response from geometry evidence', () => {
    const blueMetal = texture(32, 32, (x, y) => [20 + ((x + y) % 3) * 20, 60, 180]);
    const flatRed = texture(32, 32, () => [190, 30, 25]);
    const result = compareMaterialFrames(blueMetal, flatRed, { family: 'metal', roughness: 0.1 });
    expect(result.passed).toBe(false);
    expect(result.mismatches).toContain('wrong-base-color');
    expect(result.mismatches).toContain('missing-environment-response');
    expect(result.nextAction).toBe('refine-material');
  });

  it('rejects regular stripes that imitate the colour and variance of irregular crushed aggregate', () => {
    let state = 0x8c31_7a29;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffff_ffff;
    };
    const aggregate = texture(64, 64, (x, y) => {
      const coarse = ((Math.floor(x / 5) * 37 + Math.floor(y / 7) * 53) % 92) - 46;
      const fine = Math.round((random() - 0.5) * 84);
      const value = Math.max(8, Math.min(224, 92 + coarse + fine));
      return [value, value, value];
    });
    const stripes = texture(64, 64, (x) => {
      const value = x % 8 < 4 ? 38 : 146;
      return [value, value, value];
    });
    const result = compareMaterialFrames(aggregate, stripes, {
      family: 'coating', roughness: 0.94, surfaceCharacter: 'granular',
    });
    expect(result.passed).toBe(false);
    expect(result.scores.surfaceScale).toBeLessThan(0.8);
    expect(result.mismatches).toEqual(expect.arrayContaining([
      'wrong-surface-scale', 'surface-too-regular',
    ]));
  });

  it('rejects unbounded sampling requests and malformed frames', () => {
    const source = texture(8, 8, () => [20, 20, 20]);
    expect(() => compareMaterialFrames(source, source, undefined, 256)).toThrow(/grid/);
    expect(() => compareMaterialFrames({ ...source, rgba: new Uint8Array(3) }, source)).toThrow(/invalid/);
  });
});
