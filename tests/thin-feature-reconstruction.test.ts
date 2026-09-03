import { describe, expect, it } from 'vitest';
import { reconstructThinFeature, type ThinFeatureEndpointObservation } from '../src/engine/thin-feature-reconstruction';

function observations(point: [number, number, number]): ThinFeatureEndpointObservation[] {
  return [0, 90, 180, 270].map((azimuthDegrees) => {
    const angle = azimuthDegrees * Math.PI / 180;
    return {
      viewId: `view-${azimuthDegrees}`,
      azimuthDegrees,
      horizontalMm: point[0] * Math.cos(angle) - point[2] * Math.sin(angle),
      verticalMm: point[1],
      confidence: 0.95,
    };
  });
}

describe('calibrated thin-feature reconstruction', () => {
  it('triangulates a tube from four arbitrary azimuth projections', () => {
    const result = reconstructThinFeature({
      id: 'tripod-leg-1', radiusMm: 8,
      start: observations([0, 360, 0]),
      end: observations([-260, -710, 180]),
    });
    expect(result).toMatchObject({ status: 'reconstructed', blockers: [], radiusMm: 8 });
    expect(result.start).toEqual(expect.arrayContaining([expect.closeTo(0), expect.closeTo(360), expect.closeTo(0)]));
    expect(result.end).toEqual(expect.arrayContaining([expect.closeTo(-260), expect.closeTo(-710), expect.closeTo(180)]));
    expect(result.maximumResidualMm).toBeLessThan(1e-8);
    expect(result.geometry?.op).toBe('tube');
  });

  it('supports non-cardinal calibrated views', () => {
    const point: [number, number, number] = [140, -530, -210];
    const project = (azimuthDegrees: number): ThinFeatureEndpointObservation => {
      const angle = azimuthDegrees * Math.PI / 180;
      return {
        viewId: `view-${azimuthDegrees}`, azimuthDegrees,
        horizontalMm: point[0] * Math.cos(angle) - point[2] * Math.sin(angle),
        verticalMm: point[1], confidence: 0.9,
      };
    };
    const result = reconstructThinFeature({
      id: 'brace', radiusMm: 5,
      start: [project(15), project(105), project(225)],
      end: observations([0, 0, 0]),
    });
    expect(result.status).toBe('reconstructed');
    expect(result.start?.[0]).toBeCloseTo(point[0], 8);
    expect(result.start?.[2]).toBeCloseTo(point[2], 8);
  });

  it('blocks opposite-only observations because they do not constrain depth', () => {
    const all = observations([10, 20, 30]);
    const result = reconstructThinFeature({ id: 'rail', radiusMm: 2, start: [all[0]!, all[2]!], end: [all[0]!, all[2]!] });
    expect(result.status).toBe('blocked');
    expect(result.blockers.join(' ')).toContain('do not constrain both horizontal axes');
  });

  it('blocks conflicting endpoint labels instead of averaging them into a malformed part', () => {
    const start = observations([0, 100, 0]);
    start[1]!.horizontalMm += 40;
    const result = reconstructThinFeature({
      id: 'conflicted-leg', radiusMm: 4, maximumResidualMm: 5,
      start, end: observations([0, -500, 200]),
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers.join(' ')).toContain('reprojection residual');
  });
});
