import { describe, expect, it } from 'vitest';
import { calibrateOrthographicYawCamera, projectWithOrthographicYawCamera } from '../src/engine/orthographic-camera-calibration';

describe('orthographic yaw camera calibration', () => {
  const expected = { azimuthDegrees: 32, pixelsPerWorldUnit: 2.4, offsetPixels: [320, 210] as [number, number] };
  const worlds: Array<[number, number, number]> = [
    [-20, 30, -8], [22, 18, -14], [-15, -25, 26], [31, -32, 19], [0, 48, 0],
  ];

  it('recovers yaw, scale, offsets and reprojects independent anchors', () => {
    const anchors = worlds.map((world, index) => ({
      id: `p${index}`, world, image: projectWithOrthographicYawCamera(expected, world),
    }));
    const audit = calibrateOrthographicYawCamera(anchors);
    expect(audit.status).toBe('calibrated');
    expect(audit.azimuthDegrees).toBeCloseTo(expected.azimuthDegrees, 8);
    expect(audit.pixelsPerWorldUnit).toBeCloseTo(expected.pixelsPerWorldUnit, 8);
    expect(audit.offsetPixels[0]).toBeCloseTo(expected.offsetPixels[0], 8);
    expect(audit.offsetPixels[1]).toBeCloseTo(expected.offsetPixels[1], 8);
    expect(audit.rmsReprojectionErrorPixels).toBeLessThan(1e-8);
  });

  it('blocks perspective or correspondence drift above the locked error', () => {
    const anchors = worlds.map((world, index) => {
      const image = projectWithOrthographicYawCamera(expected, world);
      if (index === 4) image[1] += 30;
      return { id: `p${index}`, world, image };
    });
    const audit = calibrateOrthographicYawCamera(anchors, 3);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers.join(' ')).toMatch(/reprojection/);
  });

  it('blocks anchors that cannot constrain horizontal orientation', () => {
    const anchors = [0, 1, 2, 3].map((index) => ({
      id: `p${index}`, world: [0, index * 10, 0] as [number, number, number], image: [100, 200 - index * 10] as [number, number],
    }));
    const audit = calibrateOrthographicYawCamera(anchors);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers.join(' ')).toMatch(/does not constrain/);
  });
});
