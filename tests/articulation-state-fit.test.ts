import { describe, expect, it } from 'vitest';
import {
  fitBoundedPerViewArticulationStates,
  type ArticulationStateCandidate,
} from '../src/engine/articulation-state-fit';

const state = (stateId: string, jointDegrees: number, gateMargin: number): ArticulationStateCandidate => ({
  stateId, jointDegrees, gateMargin,
  wholeIoU: Math.max(0, Math.min(1, 0.8 + gateMargin)),
  primaryMassIoU: Math.max(0, Math.min(1, 0.8 + gateMargin)),
  thinFeatureScore: Math.max(0, Math.min(1, 0.8 + gateMargin)),
});

describe('bounded per-view articulation-state fitting', () => {
  it('keeps neutral unless a bounded articulated state materially improves the view', () => {
    const report = fitBoundedPerViewArticulationStates([
      { id: 'front', neutralStateId: 'yaw-0', evidenceStatus: 'estimated', candidates: [state('yaw-0', 0, 0.02), state('yaw-15', 15, 0.025)] },
      { id: 'side', neutralStateId: 'yaw-0', evidenceStatus: 'estimated', candidates: [state('yaw-0', 0, -0.4), state('yaw-75', 75, 0.04)] },
    ], { minimumGateImprovement: 0.01 });
    expect(report.views.map((view) => view.selected.stateId)).toEqual(['yaw-0', 'yaw-75']);
    expect(report.inferredStateRequired).toBe(true);
    expect(report.deliveryClaimAllowed).toBe(false);
  });

  it('allows a delivery claim only for fully measured selected states', () => {
    const report = fitBoundedPerViewArticulationStates([
      { id: 'a', neutralStateId: 'neutral', evidenceStatus: 'measured', candidates: [state('neutral', 0, 0.1)] },
      { id: 'b', neutralStateId: 'neutral', evidenceStatus: 'measured', candidates: [state('neutral', 0, 0.2)] },
    ]);
    expect(report.pass).toBe(true);
    expect(report.deliveryClaimAllowed).toBe(true);
  });

  it('fails closed on an out-of-range or missing neutral state', () => {
    expect(() => fitBoundedPerViewArticulationStates([
      { id: 'a', neutralStateId: 'neutral', evidenceStatus: 'inferred', candidates: [state('wide', 150, 0.1)] },
      { id: 'b', neutralStateId: 'neutral', evidenceStatus: 'inferred', candidates: [state('neutral', 0, 0.1)] },
    ], { maximumAbsoluteJointDegrees: 120 })).toThrow();
  });
});
