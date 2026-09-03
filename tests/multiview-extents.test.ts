import { describe, expect, it } from 'vitest';
import { inferOrthographicPlanExtents, measureForegroundBand } from '../src/engine/multiview-extents';

describe('orthographic plan extent inference', () => {
  it('recovers independent X and Z extents from repeated cardinal views', () => {
    const audit = inferOrthographicPlanExtents([
      { id: 'front', azimuthDegrees: 0, projectedWidth: 80 },
      { id: 'right', azimuthDegrees: 90, projectedWidth: 140 },
      { id: 'rear', azimuthDegrees: 180, projectedWidth: 80 },
      { id: 'left', azimuthDegrees: 270, projectedWidth: 140 },
    ]);
    expect(audit.status).toBe('inferred');
    expect(audit.xExtent).toBeCloseTo(80, 8);
    expect(audit.zExtent).toBeCloseTo(140, 8);
    expect(audit.normalizedRmsResidual).toBeLessThan(1e-10);
  });

  it('uses oblique widths and blocks contradictory evidence', () => {
    const consistent = inferOrthographicPlanExtents([
      { id: 'a', azimuthDegrees: 0, projectedWidth: 100 },
      { id: 'b', azimuthDegrees: 45, projectedWidth: 106.066017 },
      { id: 'c', azimuthDegrees: 90, projectedWidth: 50 },
    ]);
    expect(consistent.status).toBe('inferred');
    expect(consistent.xExtent).toBeCloseTo(100, 4);
    expect(consistent.zExtent).toBeCloseTo(50, 4);

    const contradictory = inferOrthographicPlanExtents([
      { id: 'a', azimuthDegrees: 0, projectedWidth: 100 },
      { id: 'b', azimuthDegrees: 45, projectedWidth: 250 },
      { id: 'c', azimuthDegrees: 90, projectedWidth: 50 },
    ]);
    expect(contradictory.status).toBe('blocked');
    expect(contradictory.blockers.join(' ')).toMatch(/residual/);
  });

  it('blocks collinear camera evidence', () => {
    const audit = inferOrthographicPlanExtents([
      { id: 'front', azimuthDegrees: 0, projectedWidth: 80 },
      { id: 'rear', azimuthDegrees: 180, projectedWidth: 80 },
    ]);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers.join(' ')).toMatch(/do not constrain/);
  });
});

describe('foreground band measurement', () => {
  it('returns exact inclusive bounds and ignores foreground outside the band', () => {
    const mask = new Uint8Array(10 * 10);
    for (let y = 1; y <= 3; y += 1) for (let x = 2; x <= 6; x += 1) mask[y * 10 + x] = 1;
    mask[9 * 10 + 9] = 1;
    expect(measureForegroundBand(mask, 10, 10, 0, 0.5)).toEqual({
      minX: 2, minY: 1, maxX: 6, maxY: 3, width: 5, height: 3, pixels: 15,
    });
  });

  it('rejects unsafe dimensions and returns undefined for an empty band', () => {
    expect(measureForegroundBand(new Uint8Array(4), 2, 2, 0, 0.5)).toBeUndefined();
    expect(() => measureForegroundBand(new Uint8Array(4), 3, 2, 0, 1)).toThrow(/invalid or unsafe/);
  });
});
