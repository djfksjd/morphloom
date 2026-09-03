import { describe, expect, it } from 'vitest';
import {
  fitBoundedPerViewCapturePoseResiduals,
  type CapturePoseResidualCandidate,
} from '../src/engine/capture-pose-residual-fit';

const state = (
  stateId: string,
  residualDegrees: number,
  gateMargin: number,
): CapturePoseResidualCandidate => ({
  stateId, residualDegrees, gateMargin,
  wholeIoU: Math.max(0, Math.min(1, 0.8 + gateMargin)),
  primaryMassIoU: Math.max(0, Math.min(1, 0.8 + gateMargin)),
  thinFeatureScore: Math.max(0, Math.min(1, 0.8 + gateMargin)),
});

describe('bounded per-view capture-pose residual fitting', () => {
  it('keeps the locked pose unless a residual materially improves the view', () => {
    const report = fitBoundedPerViewCapturePoseResiduals([
      { id: 'front', lockedStateId: 'yaw-0', evidenceStatus: 'inferred', candidates: [
        state('yaw-0', 0, 0.02), state('yaw-5', 5, 0.025),
      ] },
      { id: 'side', lockedStateId: 'yaw-0', evidenceStatus: 'inferred', candidates: [
        state('yaw-0', 0, -0.4), state('yaw-45', 45, 0.04),
      ] },
    ], { minimumGateImprovement: 0.01 });
    expect(report.views.map((view) => view.selected.stateId)).toEqual(['yaw-0', 'yaw-45']);
    expect(report.maximumAbsoluteSelectedResidualDegrees).toBe(45);
    expect(report.unverifiedResidualRequired).toBe(true);
    expect(report.deliveryClaimAllowed).toBe(false);
  });

  it('allows a claim only when every selected residual state is measured', () => {
    const report = fitBoundedPerViewCapturePoseResiduals([
      { id: 'a', lockedStateId: 'zero', evidenceStatus: 'measured', candidates: [state('zero', 0, 0.1)] },
      { id: 'b', lockedStateId: 'zero', evidenceStatus: 'measured', candidates: [
        state('zero', 0, 0.1), state('measured-10', 10, 0.2),
      ] },
    ]);
    expect(report.pass).toBe(true);
    expect(report.unverifiedResidualRequired).toBe(false);
    expect(report.deliveryClaimAllowed).toBe(true);
  });

  it('fails closed on missing zero pose, duplicate states, or oversized residuals', () => {
    expect(() => fitBoundedPerViewCapturePoseResiduals([
      { id: 'a', lockedStateId: 'zero', evidenceStatus: 'inferred', candidates: [state('wide', 91, 0.1)] },
      { id: 'b', lockedStateId: 'zero', evidenceStatus: 'inferred', candidates: [state('zero', 0, 0.1)] },
    ])).toThrow();
    expect(() => fitBoundedPerViewCapturePoseResiduals([
      { id: 'a', lockedStateId: 'zero', evidenceStatus: 'inferred', candidates: [state('not-zero', 1, 0.1)] },
      { id: 'b', lockedStateId: 'zero', evidenceStatus: 'inferred', candidates: [state('zero', 0, 0.1)] },
    ])).toThrow(/zero-residual/);
  });
});
