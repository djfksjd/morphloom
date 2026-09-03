import { describe, expect, it } from 'vitest';
import {
  compareSurfaceGeometry,
  sampleTriangleSurface,
  type SurfacePoint3,
  type SurfaceTriangle3,
} from '../src/engine/surface-geometry-fidelity';

function box(width: number, height: number, depth: number): SurfaceTriangle3[] {
  const x = width / 2; const y = height / 2; const z = depth / 2;
  const p: SurfacePoint3[] = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  return faces.flatMap(([a, b, c, d]) => [
    { a: p[a!]!, b: p[b!]!, c: p[c!]! },
    { a: p[a!]!, b: p[c!]!, c: p[d!]! },
  ]);
}

function transform(points: SurfacePoint3[], scale: number, translation: SurfacePoint3, yawDegrees = 0): SurfacePoint3[] {
  const angle = yawDegrees * Math.PI / 180;
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  return points.map(([x, y, z]) => [
    (x * cosine - z * sine) * scale + translation[0],
    y * scale + translation[1],
    (x * sine + z * cosine) * scale + translation[2],
  ]);
}

describe('surface geometry fidelity', () => {
  it('samples triangle area deterministically and compares an identical closed surface', () => {
    const first = sampleTriangleSurface(box(2, 3, 1), 256);
    const second = sampleTriangleSurface(box(2, 3, 1), 256);
    expect(second).toEqual(first);
    const report = compareSurfaceGeometry(first.points, second.points);
    expect(report.pass).toBe(true);
    expect(report.symmetricRmsChamfer).toBe(0);
    expect(report.maximumDimensionRelativeError).toBe(0);
  });

  it('finds a bounded yaw alignment without hiding raw dimension errors', () => {
    const reference = sampleTriangleSurface(box(2, 3, 1), 256).points;
    const rotated = transform(reference, 1, [0, 0, 0], 90);
    const aligned = compareSurfaceGeometry(reference, rotated);
    expect(aligned.pass).toBe(true);
    expect([90, 270]).toContain(aligned.selectedYawDegrees);

    const scaled = transform(reference, 1.2, [10, -3, 2], 90);
    const scaleAudit = compareSurfaceGeometry(reference, scaled);
    expect(scaleAudit.shapePass).toBe(true);
    expect(scaleAudit.dimensionPass).toBe(false);
    expect(scaleAudit.pass).toBe(false);
    expect(scaleAudit.blockers.some((blocker) => blocker.includes('dimension error'))).toBe(true);
  });

  it('blocks a proportionally wrong surface after uniform alignment', () => {
    const reference = sampleTriangleSurface(box(2, 3, 1), 256).points;
    const candidate = sampleTriangleSurface(box(2, 3, 2.2), 256).points;
    const report = compareSurfaceGeometry(reference, candidate, {
      maximumDimensionRelativeError: 0.05,
      maximumRmsChamfer: 0.03,
      minimumCoverage: 0.95,
    });
    expect(report.pass).toBe(false);
    expect(report.dimensionPass).toBe(false);
    expect(report.shapePass).toBe(false);
  });

  it('localizes a deformation into deterministic reference/candidate axis bands', () => {
    const reference = sampleTriangleSurface(box(2, 3, 1), 512).points;
    const deformed = reference.map(([x, y, z]) => [x + (y > 0.4 ? 0.8 : 0), y, z] as SurfacePoint3);
    const report = compareSurfaceGeometry(reference, deformed, { distanceThreshold: 0.025 });
    expect(report.spatialCoverage.reference).toHaveLength(9);
    expect(report.spatialCoverage.candidate).toHaveLength(9);
    expect(report.spatialCoverage.worstBand.samples).toBeGreaterThan(0);
    expect(report.spatialCoverage.worstBand.coverage).toBeLessThan(1);
    expect(report.spatialCoverage.worstBand.id).toMatch(/^(reference|candidate):[xyz]-(low|middle|high)$/);
    expect(report.spatialCoverage.referenceCells).toHaveLength(27);
    expect(report.spatialCoverage.candidateCells).toHaveLength(27);
    expect(report.spatialCoverage.worstCell.samples).toBeGreaterThan(0);
    expect(report.spatialCoverage.worstCell.id)
      .toMatch(/^(reference|candidate):cell:x-(low|middle|high):y-(low|middle|high):z-(low|middle|high)$/);
    expect(report.spatialCoverage.referenceCells.reduce((sum, cell) => sum + cell.samples, 0)).toBe(reference.length);
    expect(report.spatialCoverage.candidateCells.reduce((sum, cell) => sum + cell.samples, 0)).toBe(deformed.length);
  });

  it('rejects degenerate geometry and excessive comparison work', () => {
    expect(() => sampleTriangleSurface([{
      a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0],
    }], 16)).toThrow(/non-degenerate triangle/);
    const points = Array.from({ length: 2_048 }, (_, index) => [index % 17, Math.floor(index / 17) % 19, index % 23] as SurfacePoint3);
    expect(() => compareSurfaceGeometry(points, points, { yawStepDegrees: 1 })).toThrow(/comparison budget/);
  });

  it('rejects non-finite external coordinates', () => {
    const triangles = box(1, 1, 1);
    triangles[0]!.a[0] = Number.NaN;
    expect(() => sampleTriangleSurface(triangles, 16)).toThrow(/non-finite or unsafe/);
  });
});
