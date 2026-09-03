import { compareReferenceFrames, type ComparisonFrame } from './reference-comparison';

export interface AzimuthFrame {
  id: string;
  azimuthDegrees: number;
  frame: ComparisonFrame;
}

export interface MultiviewPairConsistency {
  from: string;
  to: string;
  angularSeparationDegrees: number;
  upperIoU: number;
  lowerIoU: number;
  localizedDifference: number;
  suspiciousStationaryRegion: boolean;
}

export interface MultiviewConsistencyAudit {
  status: 'consistent' | 'blocked' | 'inconclusive';
  pass: boolean;
  pairs: MultiviewPairConsistency[];
  blockers: string[];
  warnings: string[];
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;

function angleDifference(left: number, right: number): number {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

/**
 * Detects a common false multi-view assumption: only one articulated region
 * moves while the camera and the rest of the asset remain stationary.
 */
export function auditRigidMultiviewSet(
  views: AzimuthFrame[],
  stationaryThreshold = 0.94,
  localizedDifferenceThreshold = 0.12,
): MultiviewConsistencyAudit {
  if (!Array.isArray(views) || views.length < 3 || views.length > 24
    || !Number.isFinite(stationaryThreshold) || stationaryThreshold < 0.7 || stationaryThreshold > 1
    || !Number.isFinite(localizedDifferenceThreshold) || localizedDifferenceThreshold < 0.05 || localizedDifferenceThreshold > 0.5) {
    throw new Error('Multiview consistency configuration is unsafe.');
  }
  const ids = new Set<string>();
  const first = views[0]!.frame;
  for (const view of views) {
    if (!SAFE_ID.test(view.id) || ids.has(view.id) || !Number.isFinite(view.azimuthDegrees)
      || view.azimuthDegrees < 0 || view.azimuthDegrees >= 360
      || view.frame.width !== first.width || view.frame.height !== first.height) {
      throw new Error('Multiview consistency inputs are invalid or incompatible.');
    }
    ids.add(view.id);
  }
  const split = Math.max(1, Math.min(first.height - 1, Math.round(first.height * 0.36)));
  const pairs: MultiviewPairConsistency[] = [];
  for (let left = 0; left < views.length; left += 1) for (let right = left + 1; right < views.length; right += 1) {
    const from = views[left]!;
    const to = views[right]!;
    const angularSeparationDegrees = angleDifference(from.azimuthDegrees, to.azimuthDegrees);
    if (angularSeparationDegrees < 40 || angularSeparationDegrees > 140) continue;
    const comparison = compareReferenceFrames(from.frame, to.frame, [
      { featureId: 'upper-region', x: 0, y: 0, width: first.width, height: split },
      { featureId: 'lower-region', x: 0, y: split, width: first.width, height: first.height - split },
    ]);
    const upperIoU = comparison.regions[0]!.silhouetteIoU;
    const lowerIoU = comparison.regions[1]!.silhouetteIoU;
    const localizedDifference = lowerIoU - upperIoU;
    pairs.push({
      from: from.id, to: to.id, angularSeparationDegrees, upperIoU, lowerIoU, localizedDifference,
      suspiciousStationaryRegion: lowerIoU >= stationaryThreshold && localizedDifference >= localizedDifferenceThreshold,
    });
  }
  if (pairs.length < 2) return {
    status: 'inconclusive', pass: false, pairs, blockers: ['insufficient angularly separated view pairs'], warnings: [],
  };
  const suspicious = pairs.filter((pair) => pair.suspiciousStationaryRegion);
  const blockers = suspicious.length >= Math.ceil(pairs.length / 2)
    ? ['claimed rigid camera orbit contains a stationary lower region and localized upper motion']
    : [];
  const nearlyIdentical = pairs.filter((pair) => pair.upperIoU >= stationaryThreshold && pair.lowerIoU >= stationaryThreshold);
  const warnings = nearlyIdentical.length === pairs.length
    ? ['all separated views are nearly identical; symmetry or repeated frames require independent camera calibration']
    : [];
  const status = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'inconclusive' : 'consistent';
  return { status, pass: status === 'consistent', pairs, blockers, warnings };
}
