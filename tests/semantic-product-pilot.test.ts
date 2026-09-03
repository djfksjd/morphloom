import { describe, expect, it } from 'vitest';
import type { SurfaceTriangle3 } from '../src/engine/surface-geometry-fidelity';
import { silhouetteFrameFromTriangles } from '../scripts/lib/semantic-product-pilot';

const square = (x: number, y: number, z: number, size: number): SurfaceTriangle3[] => [
  { a: [x, y, z], b: [x + size, y, z], c: [x + size, y + size, z] },
  { a: [x, y, z], b: [x + size, y + size, z], c: [x, y + size, z] },
];

describe('semantic product silhouette camera', () => {
  it('keeps orthographic output deterministic and supports bounded perspective', () => {
    const triangles = [...square(-1, -1, -0.5, 2), ...square(0.5, -0.4, 0.5, 0.8)];
    const orthographic = silhouetteFrameFromTriangles(triangles, 0, 96, 96);
    const repeat = silhouetteFrameFromTriangles(triangles, 0, 96, 96);
    const perspective = silhouetteFrameFromTriangles(triangles, 0, 96, 96, {
      projection: 'perspective', distanceMultiplier: 2.5, elevationDegrees: 8,
    });
    expect(orthographic.mask).toEqual(repeat.mask);
    expect(perspective.mask).not.toEqual(orthographic.mask);
  });

  it('rejects cameras that use unsafe distance or elevation', () => {
    const triangles = square(-1, -1, 0, 2);
    expect(() => silhouetteFrameFromTriangles(triangles, 0, 64, 64, {
      projection: 'perspective', distanceMultiplier: 1,
    })).toThrow(/camera/);
    expect(() => silhouetteFrameFromTriangles(triangles, 0, 64, 64, {
      elevationDegrees: 80,
    })).toThrow(/camera/);
  });
});
