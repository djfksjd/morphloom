import { describe, expect, it } from 'vitest';
import { inferScaleFromAzimuthSilhouettes } from '../src/engine/multiview-scale';

function observed(width: number, depth: number, height: number, azimuthDegrees: number): number {
  const radians = azimuthDegrees * Math.PI / 180;
  return (Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * depth) / height;
}

describe('multi-view metric scale inference', () => {
  it('recovers width and depth from arbitrary azimuth silhouettes and one height anchor', () => {
    const width = 880;
    const depth = 420;
    const height = 1_500;
    const views = [0, 45, 90, 135, 180, 270].map((azimuthDegrees, index) => ({
      id: `view-${index}`,
      azimuthDegrees,
      aspectWidthOverHeight: observed(width, depth, height, azimuthDegrees),
      confidence: 0.95,
    }));
    const result = inferScaleFromAzimuthSilhouettes(views, height);
    expect(result.status).toBe('measured');
    expect(result.widthMm).toBeCloseTo(width, 8);
    expect(result.depthMm).toBeCloseTo(depth, 8);
    expect(result.normalizedRmsResidual).toBeLessThan(1e-9);
  });

  it('downweights one segmentation outlier instead of corrupting every dimension', () => {
    const width = 550;
    const depth = 425;
    const height = 545;
    const angles = [0, 30, 60, 90, 120, 150];
    const views = angles.map((azimuthDegrees, index) => ({
      id: `view-${index}`,
      azimuthDegrees,
      aspectWidthOverHeight: observed(width, depth, height, azimuthDegrees) * (index === 2 ? 1.12 : 1),
      confidence: index === 2 ? 0.6 : 1,
    }));
    const result = inferScaleFromAzimuthSilhouettes(views, height);
    expect(result.status).toBe('measured');
    expect(Math.abs(result.widthMm - width) / width).toBeLessThan(0.03);
    expect(Math.abs(result.depthMm - depth) / depth).toBeLessThan(0.03);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('blocks collinear front/rear evidence that cannot resolve depth', () => {
    const result = inferScaleFromAzimuthSilhouettes([
      { id: 'front', azimuthDegrees: 0, aspectWidthOverHeight: 0.5, confidence: 1 },
      { id: 'rear', azimuthDegrees: 180, aspectWidthOverHeight: 0.5, confidence: 1 },
      { id: 'front-repeat', azimuthDegrees: 0, aspectWidthOverHeight: 0.5, confidence: 0.8 },
    ], 1_000);
    expect(result.status).toBe('blocked');
    expect(result.blockers).toContain('view azimuths do not independently constrain width and depth');
  });

  it('rejects duplicated identities and unbounded dimensions', () => {
    const views = [0, 45, 90].map((azimuthDegrees) => ({
      id: 'same', azimuthDegrees, aspectWidthOverHeight: 1, confidence: 1,
    }));
    expect(() => inferScaleFromAzimuthSilhouettes(views, 1_000)).toThrow(/unsafe/);
    expect(() => inferScaleFromAzimuthSilhouettes([], 1_000)).toThrow(/insufficient/);
  });
});
