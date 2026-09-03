import { describe, expect, it } from 'vitest';
import {
  chooseSeededHoldout,
  isPathInside,
  readBoundedBody,
  safeAboSpinUrl,
} from '../scripts/lib/holdout-lock';

describe('holdout input lock', () => {
  it('rejects sibling-prefix and parent traversal paths', () => {
    expect(isPathInside('/repo/benchmarks/holdouts', '/repo/benchmarks/holdouts/case.json')).toBe(true);
    expect(isPathInside('/repo/benchmarks/holdouts', '/repo/benchmarks/holdouts-evil/case.json')).toBe(false);
    expect(isPathInside('/repo/benchmarks/holdouts', '/repo/benchmarks/case.json')).toBe(false);
    expect(isPathInside('/repo/benchmarks/holdouts', '/repo/benchmarks/holdouts')).toBe(false);
  });

  it('selects the same candidate regardless of listing order', () => {
    const candidates = [
      { sourceItemId: 'B000000001', spinId: 'spin-a' },
      { sourceItemId: 'B000000002', spinId: 'spin-b' },
      { sourceItemId: 'B000000003', spinId: 'spin-c' },
    ];
    const seed = 'a'.repeat(40);
    expect(chooseSeededHoldout(candidates, seed)).toEqual(chooseSeededHoldout([...candidates].reverse(), seed));
  });

  it('fails closed when the candidate pool is empty', () => {
    expect(() => chooseSeededHoldout([], 'a'.repeat(40))).toThrow(/No eligible unseen/);
  });

  it('allows only canonical JPEG paths under the ABO spin directory', () => {
    const base = 'https://amazon-berkeley-objects.s3.amazonaws.com/spins/original/';
    expect(safeAboSpinUrl(base, '61/61c91265/61c91265_00.jpg')).toBe(`${base}61/61c91265/61c91265_00.jpg`);
    expect(() => safeAboSpinUrl(base, '../3dmodels/original/x.glb')).toThrow(/trusted dataset path/);
    expect(() => safeAboSpinUrl(base, 'https://evil.example/x.jpg')).toThrow(/trusted dataset path/);
  });

  it('stops streaming input as soon as the byte limit is exceeded', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    await expect(readBoundedBody(body, 10)).rejects.toThrow(/exceeded the byte limit/);
  });
});
