import { describe, expect, it } from 'vitest';
import { calibratePerspectiveCamera, projectWithPerspectiveCamera } from '../src/engine/perspective-camera-calibration';

const worlds: Array<[number, number, number]> = [
  [-3, -2, -1], [3, -2, 0], [-2, 2, 1], [2, 2, 2],
  [0, 0, -2], [1, -1, 3], [-1, 1, 2.5], [2.5, 0.5, -0.5],
];

function projectFixture(world: [number, number, number]): [number, number] {
  const depth = world[2] + 12;
  return [320 + 700 * world[0] / depth, 240 - 700 * world[1] / depth];
}

function anchors() {
  return worlds.map((world, index) => ({ id: `anchor-${index + 1}`, world, image: projectFixture(world) }));
}

describe('perspective camera calibration', () => {
  it('reconstructs a pinhole projection from non-coplanar anchors', () => {
    const result = calibratePerspectiveCamera(anchors());
    expect(result.status).toBe('calibrated');
    expect(result.rmsReprojectionErrorPixels).toBeLessThan(1e-6);
    for (const anchor of anchors()) {
      const projected = projectWithPerspectiveCamera(result, anchor.world);
      expect(projected).toBeDefined();
      expect(Math.hypot(projected![0] - anchor.image[0], projected![1] - anchor.image[1])).toBeLessThan(1e-6);
    }
  });

  it('blocks a high-error correspondence instead of averaging it away', () => {
    const corrupted = anchors();
    corrupted[0]!.image = [corrupted[0]!.image[0] + 100, corrupted[0]!.image[1] - 70];
    const result = calibratePerspectiveCamera(corrupted, 1);
    expect(result.status).toBe('blocked');
    expect(result.blockers.join(' ')).toContain('reprojection RMS');
  });

  it('blocks coplanar anchors that cannot constrain 3D perspective', () => {
    const coplanar = anchors().map((anchor) => ({ ...anchor, world: [anchor.world[0], anchor.world[1], 0] as [number, number, number] }));
    expect(calibratePerspectiveCamera(coplanar).status).toBe('blocked');
  });

  it('rejects unsafe counts and coordinates at the trust boundary', () => {
    expect(() => calibratePerspectiveCamera(anchors().slice(0, 5))).toThrow(/6–512/);
    const unsafe = anchors();
    unsafe[0]!.world[0] = Number.POSITIVE_INFINITY;
    expect(() => calibratePerspectiveCamera(unsafe)).toThrow(/invalid coordinates/);
  });
});
