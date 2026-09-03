import { describe, expect, it } from 'vitest';
import {
  reconstructUnorderedOrthographicLandmarks,
  type OrthographicLandmark,
  type OrthographicLandmarkView,
} from '../src/engine/multiview-landmark-reconstruction';

const truth: OrthographicLandmark[] = [
  { id: 'a', position: [-3, -1, -2] },
  { id: 'b', position: [2.5, -0.5, -1] },
  { id: 'c', position: [1, -1.5, 3] },
  { id: 'd', position: [-1.5, 0, 2.5] },
];

const bounds = { minimumU: -5, maximumU: 5, minimumY: -2, maximumY: 8 };

function observation(point: OrthographicLandmark, azimuthDegrees: number) {
  const angle = azimuthDegrees * Math.PI / 180;
  const projected = point.position[0] * Math.cos(angle) - point.position[2] * Math.sin(angle);
  return { u: (projected - bounds.minimumU) / 10, v: (bounds.maximumY - point.position[1]) / 10 };
}

function views(angles = [0, 90, 180, 270]): OrthographicLandmarkView[] {
  return angles.map((azimuthDegrees, viewIndex) => {
    const values = truth.map((point) => observation(point, azimuthDegrees));
    const shift = viewIndex % values.length;
    return {
      id: `view-${viewIndex}`,
      azimuthDegrees,
      projectedBounds: bounds,
      observations: [...values.slice(shift), ...values.slice(0, shift)],
    };
  });
}

describe('unordered orthographic landmark reconstruction', () => {
  it('recovers shuffled landmark observations across four views', () => {
    const initial = truth.map((point, index) => ({
      id: point.id,
      position: [
        point.position[0] + (index % 2 === 0 ? 0.2 : -0.15),
        point.position[1] + 0.1,
        point.position[2] + (index < 2 ? -0.1 : 0.15),
      ] as [number, number, number],
    }));
    const result = reconstructUnorderedOrthographicLandmarks(initial, views(), {
      maximumRmsNormalizedError: 1e-8,
      maximumNormalizedError: 1e-8,
    });
    expect(result.status).toBe('reconstructed');
    expect(result.rmsNormalizedError).toBeLessThan(1e-10);
    expect(result.assignments).toHaveLength(16);
    for (const expected of truth) {
      const actual = result.landmarks.find((landmark) => landmark.id === expected.id)!;
      expect(actual.position[0]).toBeCloseTo(expected.position[0], 8);
      expect(actual.position[1]).toBeCloseTo(expected.position[1], 8);
      expect(actual.position[2]).toBeCloseTo(expected.position[2], 8);
    }
  });

  it('accepts bounded image noise while reporting its residual', () => {
    const noisy = views().map((view, viewIndex) => ({
      ...view,
      observations: view.observations.map((value, index) => ({
        u: value.u + ((viewIndex + index) % 2 === 0 ? 0.002 : -0.002),
        v: value.v + ((viewIndex + index) % 3 === 0 ? 0.001 : -0.001),
        confidence: 0.9,
      })),
    }));
    const result = reconstructUnorderedOrthographicLandmarks(truth, noisy, {
      maximumRmsNormalizedError: 0.01,
      maximumNormalizedError: 0.02,
    });
    expect(result.status).toBe('reconstructed');
    expect(result.rmsNormalizedError).toBeGreaterThan(0);
    expect(result.rmsNormalizedError).toBeLessThan(0.01);
  });

  it('preserves evidence-derived heights when unordered views cannot prove endpoint identity', () => {
    const ambiguous = views().map((view) => ({
      ...view,
      observations: view.observations.map((value) => ({ ...value, v: 0.9 })),
    }));
    const result = reconstructUnorderedOrthographicLandmarks(truth, ambiguous, {
      preserveInputY: true,
      maximumRmsNormalizedError: 1,
      maximumNormalizedError: 2,
    });
    expect(result.status).toBe('reconstructed');
    expect(result.landmarks.map((landmark) => landmark.position[1]))
      .toEqual(truth.map((landmark) => landmark.position[1]));
  });

  it('fails closed when the camera azimuths cannot constrain depth', () => {
    const result = reconstructUnorderedOrthographicLandmarks(truth, views([0, 180]));
    expect(result.status).toBe('blocked');
    expect(result.blockers).toContain('View azimuths do not constrain both horizontal world axes.');
  });

  it('blocks inconsistent observations rather than averaging them into a false pass', () => {
    const inconsistent = views();
    inconsistent[2]!.observations[0] = { u: 1.2, v: -0.2 };
    const result = reconstructUnorderedOrthographicLandmarks(truth, inconsistent, {
      maximumRmsNormalizedError: 0.02,
      maximumNormalizedError: 0.05,
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((blocker) => blocker.includes('reprojection error'))).toBe(true);
  });

  it('rejects unbounded work and unsafe coordinates at the trust boundary', () => {
    const tooMany = Array.from({ length: 11 }, (_, index) => ({
      id: `point-${index}`,
      position: [index, 0, 0] as [number, number, number],
    }));
    expect(() => reconstructUnorderedOrthographicLandmarks(tooMany, views())).toThrow(/requires 1-10 landmarks/);
    const invalidViews = views();
    invalidViews[0]!.observations[0] = { u: Number.NaN, v: 0.5 };
    expect(() => reconstructUnorderedOrthographicLandmarks(truth, invalidViews)).toThrow(/unsafe observation/);
  });
});
