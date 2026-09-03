import { describe, expect, it } from 'vitest';
import { extractThinTerminals } from '../src/engine/silhouette-skeleton';

function drawLine(mask: Uint8Array, width: number, start: [number, number], end: [number, number], thickness = 3): void {
  const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(start[0] + (end[0] - start[0]) * step / Math.max(1, steps));
    const y = Math.round(start[1] + (end[1] - start[1]) * step / Math.max(1, steps));
    for (let dy = -thickness; dy <= thickness; dy += 1) for (let dx = -thickness; dx <= thickness; dx += 1) {
      const px = x + dx; const py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < mask.length / width) mask[py * width + px] = 1;
    }
  }
}

describe('silhouette skeleton terminal extraction', () => {
  it('finds three leg endpoints under a thick product body', () => {
    const width = 96; const height = 128; const mask = new Uint8Array(width * height);
    for (let y = 4; y < 34; y += 1) for (let x = 30; x < 66; x += 1) mask[y * width + x] = 1;
    drawLine(mask, width, [48, 30], [12, 120]);
    drawLine(mask, width, [48, 30], [49, 116]);
    drawLine(mask, width, [48, 30], [84, 121]);
    const result = extractThinTerminals(mask, width, height, { regionTopFraction: 0.2, terminalStartFraction: 0.65, minimumTerminals: 3, maximumTerminals: 3 });
    expect(result.status).toBe('extracted');
    expect(result.terminals).toHaveLength(3);
    expect(result.terminals.map((terminal) => terminal.x)).toEqual(expect.arrayContaining([
      expect.closeTo(12, -1), expect.closeTo(49, -1), expect.closeTo(84, -1),
    ]));
  });

  it('blocks an occluded view that exposes too few terminals', () => {
    const width = 64; const height = 96; const mask = new Uint8Array(width * height);
    drawLine(mask, width, [32, 12], [20, 90]);
    const result = extractThinTerminals(mask, width, height, { minimumTerminals: 3 });
    expect(result.status).toBe('blocked');
    expect(result.blockers[0]).toMatch(/found .*\/3/);
  });

  it('rejects unsafe image budgets and region options', () => {
    expect(() => extractThinTerminals(new Uint8Array(16), 4, 4)).toThrow(/unsafe/);
    expect(() => extractThinTerminals(new Uint8Array(64 * 64), 64, 64, { regionTopFraction: 0.8, terminalStartFraction: 0.7 })).toThrow(/options/);
  });
});
