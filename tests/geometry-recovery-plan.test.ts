import { describe, expect, it } from 'vitest';
import {
  createGeometryRecoveryPlan,
  observeAlignedComponentBounds,
  type ComponentSpatialObservation,
} from '../src/engine/geometry-recovery-plan';
import { compareSurfaceGeometry, sampleTriangleSurface, type SurfaceTriangle3 } from '../src/engine/surface-geometry-fidelity';
import type { VisualPlanningContract } from '../src/engine/visual-plan-audit';

const hash = (value: string): string => value.repeat(64);

function box(width: number, height: number, depth: number): SurfaceTriangle3[] {
  const x = width / 2; const y = height / 2; const z = depth / 2;
  const p = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] as [number, number, number][];
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  return faces.flatMap(([a, b, c, d]) => [{ a: p[a!]!, b: p[b!]!, c: p[c!]! }, { a: p[a!]!, b: p[c!]!, c: p[d!]! }]);
}

function visualPlan(componentIds: string[] = ['base']): VisualPlanningContract {
  return {
    schema: 'morphloom.visual-plan/0.1', assetName: 'fixture',
    sourceViews: [{ id: 'front', kind: 'photo', fingerprint: hash('a') }],
    features: [{
      id: 'base', label: 'base frame', kind: 'primary-mass', required: true,
      evidenceStatus: 'measured', sourceViewIds: ['front'], minimumCount: 1,
      observedCounts: [{ sourceViewId: 'front', count: componentIds.length }], componentIds, separatelyEditable: true,
    }],
    countDeclarations: [], qualityFloors: {
      detailInventoryMinimum: 1, minimumVisualScore: 85,
      referencePbrRequiredWhenSourceImagePresent: true, renderedPreviewRequired: true, realExportRequired: true,
    },
    surfaceFidelityRequested: true, openUnknownIds: [],
  };
}

const observations: ComponentSpatialObservation[] = [{
  componentId: 'base', normalizedBounds: { minimum: [0, 0, 0], maximum: [1, 0.4, 1] },
  evidenceStatus: 'measured',
}];

describe('localized geometry recovery planning', () => {
  it('maps failed spatial bands to stable edit units without allowing requirement deletion', () => {
    const reference = sampleTriangleSurface(box(2, 3, 1), 512).points;
    const deformed = reference.map(([x, y, z]) => [x, y, z + (y < 0 ? 0.8 : 0)] as [number, number, number]);
    const audit = compareSurfaceGeometry(reference, deformed, { distanceThreshold: 0.025 });
    const plan = createGeometryRecoveryPlan(audit, visualPlan(), observations);
    expect(plan.pass).toBe(true);
    expect(plan.actionable).toBe(true);
    expect(plan.actions.some((action) => action.targetComponentIds.includes('base'))).toBe(true);
    expect(plan.actions.every((action) => action.prohibitedOperations.includes('delete-required-component'))).toBe(true);
    expect(plan.actions.every((action) => action.verificationGates.includes('visual-plan-revision'))).toBe(true);
    expect(plan.actions.every((action) => action.candidateComponentCount >= action.targetComponentIds.length)).toBe(true);
    expect(plan.actions.some((action) => action.targetingMode === 'spatial-cell-overlap')).toBe(true);
    expect(plan.actions.some((action) => action.targetingMode === 'semantic-feature-overlap')).toBe(true);
  });

  it('requests evidence instead of hallucinating geometry for an unmapped failed region', () => {
    const reference = sampleTriangleSurface(box(2, 3, 1), 512).points;
    const deformed = reference.map(([x, y, z]) => [x + (y > 0 ? 0.8 : 0), y, z] as [number, number, number]);
    const audit = compareSurfaceGeometry(reference, deformed, { distanceThreshold: 0.025 });
    const upperOnly = [{
      ...observations[0]!, normalizedBounds: { minimum: [0, 0.8, 0], maximum: [1, 1, 1] } as const,
    }];
    const plan = createGeometryRecoveryPlan(audit, visualPlan(), upperOnly, { maximumActions: 6 });
    expect(plan.actions.some((action) => action.operation === 'request-region-evidence')).toBe(true);
    expect(plan.warnings[0]).toContain('unmapped');
  });

  it('rejects malformed normalized bounds and unsafe work budgets', () => {
    const points = sampleTriangleSurface(box(1, 1, 1), 64).points;
    const audit = compareSurfaceGeometry(points, points);
    expect(() => createGeometryRecoveryPlan(audit, visualPlan(), [{
      ...observations[0]!, normalizedBounds: { minimum: [0.8, 0, 0], maximum: [0.2, 1, 1] },
    }])).toThrow(/Invalid component/);
    expect(() => createGeometryRecoveryPlan(audit, visualPlan(), observations, { maximumActions: 100 })).toThrow(/options/);
    expect(() => createGeometryRecoveryPlan(audit, visualPlan(), observations, { maximumTargetsPerAction: 0 })).toThrow(/options/);
  });

  it('maps raw component bounds through the geometry audit yaw instead of using the unaligned axis', () => {
    const reference = sampleTriangleSurface(box(2, 3, 1), 256).points;
    const candidate = reference.map(([x, y, z]) => [-x, y, -z] as [number, number, number]);
    const audit = compareSurfaceGeometry(reference, candidate);
    const observed = observeAlignedComponentBounds('base', {
      minimum: [-1, -1.5, -0.5], maximum: [0, 0, 0.5],
    }, 'measured', audit);
    expect(observed.componentId).toBe('base');
    expect(observed.normalizedBounds.minimum.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(observed.normalizedBounds.maximum.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('uses intersecting failed axes to narrow a broad band to the common edit unit', () => {
    const points = sampleTriangleSurface(box(1, 1, 1), 128).points;
    const baseAudit = compareSurfaceGeometry(points, points);
    const audit = {
      ...baseAudit,
      pass: false,
      spatialCoverage: {
        ...baseAudit.spatialCoverage,
        reference: baseAudit.spatialCoverage.reference.map((band) => ({
          ...band,
          coverage: band.id === 'reference:x-low' ? 0.1 : band.id === 'reference:y-low' ? 0.2 : 1,
        })),
        candidate: baseAudit.spatialCoverage.candidate.map((band) => ({ ...band, coverage: 1 })),
      },
    };
    const candidates: ComponentSpatialObservation[] = [
      { componentId: 'common', normalizedBounds: { minimum: [0, 0, 0.4], maximum: [0.2, 0.2, 0.6] }, evidenceStatus: 'measured' },
      { componentId: 'x-only', normalizedBounds: { minimum: [0, 0.8, 0.4], maximum: [0.2, 1, 0.6] }, evidenceStatus: 'measured' },
      { componentId: 'y-only', normalizedBounds: { minimum: [0.8, 0, 0.4], maximum: [1, 0.2, 0.6] }, evidenceStatus: 'measured' },
    ];
    const plan = createGeometryRecoveryPlan(audit, visualPlan(candidates.map(({ componentId }) => componentId)), candidates);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.causeBandIds).toEqual(['reference:x-low', 'reference:y-low']);
    expect(plan.actions.every((action) => action.targetingMode === 'cross-axis-intersection')).toBe(true);
    expect(plan.actions.every((action) => action.targetComponentIds.join(',') === 'common')).toBe(true);
    expect(plan.actions.every((action) => action.spatialConstraintIds.length === 2)).toBe(true);
  });

  it('requires finer region evidence rather than truncating an ambiguous target set', () => {
    const points = sampleTriangleSurface(box(1, 1, 1), 128).points;
    const baseAudit = compareSurfaceGeometry(points, points);
    const audit = {
      ...baseAudit,
      pass: false,
      spatialCoverage: {
        ...baseAudit.spatialCoverage,
        reference: baseAudit.spatialCoverage.reference.map((band) => ({
          ...band, coverage: band.id === 'reference:x-low' ? 0.1 : 1,
        })),
        candidate: baseAudit.spatialCoverage.candidate.map((band) => ({ ...band, coverage: 1 })),
      },
    };
    const candidates: ComponentSpatialObservation[] = ['a', 'b', 'c'].map((componentId) => ({
      componentId,
      normalizedBounds: { minimum: [0, 0, 0], maximum: [0.2, 0.2, 0.2] },
      evidenceStatus: 'measured',
    }));
    const plan = createGeometryRecoveryPlan(
      audit, visualPlan(candidates.map(({ componentId }) => componentId)), candidates,
      { maximumTargetsPerAction: 2 },
    );
    expect(plan.actions[0]?.operation).toBe('request-region-evidence');
    expect(plan.actions[0]?.targetComponentIds).toEqual([]);
    expect(plan.actions[0]?.candidateComponentCount).toBe(3);
    expect(plan.actions[0]?.reason).toContain('above the safe limit');
  });

  it('prefers a fully localized semantic assembly and retains distinct failures on one axis', () => {
    const points = sampleTriangleSurface(box(1, 1, 1), 128).points;
    const baseAudit = compareSurfaceGeometry(points, points);
    const audit = {
      ...baseAudit,
      pass: false,
      spatialCoverage: {
        ...baseAudit.spatialCoverage,
        reference: baseAudit.spatialCoverage.reference.map((band) => ({ ...band, coverage: 1 })),
        candidate: baseAudit.spatialCoverage.candidate.map((band) => ({
          ...band,
          coverage: band.id === 'candidate:z-low' ? 0.05
            : band.id === 'candidate:z-middle' ? 0.1 : 1,
        })),
        referenceCells: baseAudit.spatialCoverage.referenceCells.map((cell) => ({ ...cell, coverage: 1 })),
        candidateCells: baseAudit.spatialCoverage.candidateCells.map((cell) => ({
          ...cell,
          samples: cell.id === 'candidate:cell:x-middle:y-middle:z-middle' ? 20 : cell.samples,
          coverage: cell.id === 'candidate:cell:x-middle:y-middle:z-middle' ? 0.1 : 1,
        })),
      },
    };
    const candidates: ComponentSpatialObservation[] = [
      { componentId: 'broad-a', normalizedBounds: { minimum: [0.4, 0.4, 0.34], maximum: [0.6, 0.6, 0.6] }, evidenceStatus: 'measured' },
      { componentId: 'broad-b', normalizedBounds: { minimum: [0.4, 0.4, 0.8], maximum: [0.6, 0.6, 0.9] }, evidenceStatus: 'measured' },
      { componentId: 'stack-a', normalizedBounds: { minimum: [0.4, 0.4, 0.36], maximum: [0.6, 0.6, 0.48] }, evidenceStatus: 'measured' },
      { componentId: 'stack-b', normalizedBounds: { minimum: [0.4, 0.4, 0.5], maximum: [0.6, 0.6, 0.62] }, evidenceStatus: 'measured' },
    ];
    const planFixture = visualPlan(candidates.map(({ componentId }) => componentId));
    const baseFeature = planFixture.features[0]!;
    planFixture.features = [
      { ...baseFeature, id: 'broad', kind: 'primary-mass', componentIds: ['broad-a', 'broad-b'] },
      { ...baseFeature, id: 'stack', kind: 'layered-stack', componentIds: ['stack-a', 'stack-b'] },
    ];
    const plan = createGeometryRecoveryPlan(audit, planFixture, candidates, { maximumActions: 8 });
    const middle = plan.actions.find((action) => action.causeBandId === 'candidate:z-middle');
    expect(middle?.targetingMode).toBe('semantic-feature-overlap');
    expect(middle?.targetComponentIds).toEqual(['stack-a', 'stack-b']);
    expect(plan.actions.some((action) => action.causeBandId === 'candidate:z-low')).toBe(true);
  });
});
