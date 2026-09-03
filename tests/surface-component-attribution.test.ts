import { describe, expect, it } from 'vitest';
import { auditSurfaceComponentAttribution } from '../src/engine/surface-component-attribution';
import type { SurfacePoint3 } from '../src/engine/surface-geometry-fidelity';

const cluster = (center: SurfacePoint3): SurfacePoint3[] => [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => (
  [-1, 1].map((z): SurfacePoint3 => [center[0] + x * 0.1, center[1] + y * 0.1, center[2] + z * 0.1])
)));

describe('surface component attribution', () => {
  it('attributes paired excess and missing surface to a misplaced editable component', () => {
    const report = auditSurfaceComponentAttribution(
      [...cluster([-2, 0, 0]), ...cluster([0, 0, 0]), ...cluster([2, 0, 0])],
      [
        { componentId: 'body', points: [...cluster([-2, 0, 0]), ...cluster([2, 0, 0])] },
        { componentId: 'module', points: cluster([1, 0, 0]) },
      ],
      { selectedYawDegrees: 0, distanceThreshold: 0.08, minimumMissingResponsibility: 0.1 },
    );
    const module = report.components.find((component) => component.componentId === 'module')!;
    expect(module.recommendation).toBe('relocate-or-reshape');
    expect(module.missingResponsibility).toBeGreaterThan(0.4);
    expect(module.suggestedTranslationCandidateUnits?.[0]).toBeLessThan(0);
    expect(report.relocateOrReshapeComponentIds).toContain('module');
    expect(report.evidenceFingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('estimates one dominant robust scale axis without coupling the other axes', () => {
    const stretched = (radiusX: number): SurfacePoint3[] => [-1, 1].flatMap((x) => (
      [-1, 1].flatMap((y) => [-1, 1].map((z): SurfacePoint3 => [x * radiusX, y * 0.1, z * 0.1]))
    ));
    const anchors = [...cluster([-3, 0, 0]), ...cluster([3, 0, 0])];
    const report = auditSurfaceComponentAttribution(
      [...anchors, ...stretched(0.2)],
      [
        { componentId: 'body', points: anchors },
        { componentId: 'module', points: stretched(0.1) },
      ],
      { selectedYawDegrees: 0, distanceThreshold: 0.01, minimumMissingResponsibility: 0.1 },
    );
    const module = report.components.find((component) => component.componentId === 'module')!;
    expect(module.candidateRobustSpan).toBeDefined();
    expect(module.assignedReferenceRobustSpan).toBeDefined();
    expect(module.suggestedAlignedScaleAxis).toBe(0);
    expect(module.suggestedAlignedScaleFactor).toBeGreaterThan(1.8);
  });

  it('attributes a local residual to the nearest declared control anchor', () => {
    const body = [
      ...cluster([-4, 0, 0]), ...cluster([4, 0, 0]),
      ...cluster([0, -4, 0]), ...cluster([0, 4, 0]),
      ...cluster([0, 0, -4]), ...cluster([0, 0, 4]),
    ];
    const report = auditSurfaceComponentAttribution(
      [...body, ...cluster([0, 0, 0]), ...cluster([2, 1, 0])],
      [{ componentId: 'body', points: body }, {
        componentId: 'route',
        points: [...cluster([0, 0, 0]), ...cluster([2, 0, 0])],
        controlAnchors: [
          { controlIndex: 0, point: [0, 0, 0] },
          { controlIndex: 1, point: [2, 0, 0] },
        ],
      }],
      { selectedYawDegrees: 0, distanceThreshold: 0.04, minimumMissingResponsibility: 0.1 },
    );
    const route = report.components.find((component) => component.componentId === 'route')!;
    expect(route.recommendation).toBe('relocate-or-reshape');
    expect(route.controlPointTranslations).toHaveLength(1);
    expect(route.controlPointTranslations![0]!.controlIndex).toBe(1);
    expect(route.controlPointTranslations![0]!.suggestedTranslationCandidateUnits[1]).toBeCloseTo(1);
    expect(route.controlPointTranslations![0]!.confidence).toBeGreaterThan(0.9);
  });

  it('fails closed on duplicate component ids and degenerate evidence', () => {
    const points = [...cluster([-1, 0, 0]), ...cluster([1, 0, 0])];
    expect(() => auditSurfaceComponentAttribution(points, [
      { componentId: 'same', points: cluster([-1, 0, 0]) },
      { componentId: 'same', points: cluster([1, 0, 0]) },
    ], { selectedYawDegrees: 0 })).toThrow(/inventory/);
    expect(() => auditSurfaceComponentAttribution(Array.from({ length: 16 }, () => [0, 0, 0]), [
      { componentId: 'one', points },
    ], { selectedYawDegrees: 0 })).toThrow(/non-degenerate/);
    expect(() => auditSurfaceComponentAttribution(points, [{
      componentId: 'one', points,
      controlAnchors: [{ controlIndex: 0, point: [0, 0, 0] }, { controlIndex: 0, point: [1, 0, 0] }],
    }], { selectedYawDegrees: 0 })).toThrow(/inventory/);
  });
});
