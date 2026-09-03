import { describe, expect, it } from 'vitest';
import { auditRigidMultiviewSet } from '../src/engine/multiview-consistency';
import type { ComparisonFrame } from '../src/engine/reference-comparison';

function frame(upperX: number, lowerX: number): ComparisonFrame {
  const width = 64; const height = 64; const rgba = new Uint8Array(width * height * 4).fill(255); const mask = new Uint8Array(width * height);
  const rectangle = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      mask[y * width + x] = 1; const offset = (y * width + x) * 4; rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
    }
  };
  rectangle(upperX, 3, upperX + 14, 20); rectangle(lowerX, 25, lowerX + 8, 61);
  return { width, height, rgba, mask };
}

describe('rigid multiview consistency audit', () => {
  it('blocks an articulated top photographed over a stationary base', () => {
    const audit = auditRigidMultiviewSet([
      { id: 'front', azimuthDegrees: 0, frame: frame(4, 28) },
      { id: 'right', azimuthDegrees: 90, frame: frame(24, 28) },
      { id: 'rear', azimuthDegrees: 180, frame: frame(44, 28) },
      { id: 'left', azimuthDegrees: 270, frame: frame(24, 28) },
    ]);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers[0]).toContain('stationary lower region');
  });

  it('accepts a consistent full-object change across separated views', () => {
    const audit = auditRigidMultiviewSet([
      { id: 'front', azimuthDegrees: 0, frame: frame(4, 8) },
      { id: 'right', azimuthDegrees: 90, frame: frame(24, 28) },
      { id: 'rear', azimuthDegrees: 180, frame: frame(44, 48) },
      { id: 'left', azimuthDegrees: 270, frame: frame(24, 28) },
    ]);
    expect(audit).toMatchObject({ status: 'consistent', pass: true, blockers: [] });
  });

  it('marks repeated or rotationally symmetric frames inconclusive', () => {
    const same = frame(20, 28);
    const audit = auditRigidMultiviewSet([
      { id: 'front', azimuthDegrees: 0, frame: same },
      { id: 'right', azimuthDegrees: 90, frame: same },
      { id: 'rear', azimuthDegrees: 180, frame: same },
      { id: 'left', azimuthDegrees: 270, frame: same },
    ]);
    expect(audit.status).toBe('inconclusive');
    expect(audit.warnings[0]).toContain('nearly identical');
  });
});
