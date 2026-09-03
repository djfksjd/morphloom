import { describe, expect, it } from 'vitest';
import { prepareVisualHullMask, solidifySilhouetteMask } from '../src/engine/silhouette-mask';

function mask(rows: string[]): Uint8Array {
  return Uint8Array.from(rows.join(''), (value) => Number(value === '1'));
}

describe('visual-hull silhouette preparation', () => {
  it('fills enclosed colour holes without bridging exterior negative space', () => {
    const source = mask([
      '000000',
      '011110',
      '010010',
      '010010',
      '011110',
      '000000',
    ]);
    const solid = solidifySilhouetteMask(source, 6, 6);
    expect(solid.filled).toBe(4);
    expect(solid.mask[2 * 6 + 2]).toBe(1);
    expect(solid.mask[4 * 6 + 3]).toBe(1);
    expect(solid.mask[0]).toBe(0);
  });

  it('fills interior appearance holes before carving physical volume', () => {
    const rows = [
      '00000000',
      '01111110',
      '01000010',
      '01000010',
      '01000010',
      '01000010',
      '01111110',
      '00000000',
    ];
    const result = prepareVisualHullMask(mask(rows), 8, 8, { maximumDimension: 12, paddingPixels: 1 });
    expect(result.filledHolePixels).toBe(16);
    expect(result.rows.slice(1, -1).every((row) => !row.slice(1, -1).includes('0'))).toBe(true);
  });

  it('preserves an irregular narrow silhouette with deterministic bounded output', () => {
    const rows = Array.from({ length: 32 }, (_, y) => Array.from({ length: 64 }, (_, x) => (
      x >= 3 && x <= 58 - Math.floor(y / 8) && y >= 4 && y <= 28 ? '1' : '0'
    )).join(''));
    const first = prepareVisualHullMask(mask(rows), 64, 32, { maximumDimension: 48, paddingPixels: 2 });
    const second = prepareVisualHullMask(mask(rows), 64, 32, { maximumDimension: 48, paddingPixels: 2 });
    expect(first).toEqual(second);
    expect(Math.max(first.width, first.height)).toBe(48);
    expect(first.outputForegroundPixels).toBeGreaterThan(300);
    expect(first.rows[0]).toBe('0'.repeat(first.width));
    expect(first.rows.at(-1)).toBe('0'.repeat(first.width));
  });

  it('rejects empty, oversized, and inconsistent masks', () => {
    expect(() => prepareVisualHullMask(new Uint8Array(64), 8, 8)).toThrow(/no foreground/);
    expect(() => prepareVisualHullMask(new Uint8Array(63), 8, 8)).toThrow(/unsafe or inconsistent/);
    expect(() => prepareVisualHullMask(new Uint8Array(64).fill(1), 8, 8, { maximumDimension: 300 })).toThrow(/options/);
  });
});
