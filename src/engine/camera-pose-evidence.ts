export type CameraPoseDerivation =
  | 'dataset-turntable-metadata'
  | 'calibrated-3d-2d-correspondences'
  | 'candidate-silhouette-fit'
  | 'manual-semantic-label'
  | 'unknown';

export interface TurntableSequenceEvidence {
  id: string;
  frameCount: number;
  degreesPerStep: number;
  direction: 'clockwise' | 'counterclockwise';
  metadataSourceUrl: string;
  metadataRecordFingerprint: string;
}

export interface AbsoluteCameraPoseEvidence {
  azimuthDegrees: number;
  elevationDegrees: number;
  projection: 'orthographic' | 'perspective';
  reprojectionErrorPixels: number;
  anchorCount: number;
  anchorReceiptFingerprint: string;
  intrinsicsReceiptFingerprint: string;
  modelFrameReceiptFingerprint: string;
  anchorSource: 'measured-drawing' | 'reference-ground-truth' | 'candidate-output';
}

export interface CameraPoseViewEvidence {
  id: string;
  sourceFingerprint: string;
  derivation: CameraPoseDerivation;
  derivationReceiptFingerprint: string;
  usesCandidateGeometry: boolean;
  sequenceIndex?: number;
  relativeAzimuthDegrees?: number;
  absolutePose?: AbsoluteCameraPoseEvidence;
}

export interface CameraPoseEvidenceContract {
  schema: 'morphloom.camera-pose-evidence/0.1';
  views: CameraPoseViewEvidence[];
  turntableSequence?: TurntableSequenceEvidence;
}

export interface CameraPoseEvidenceAudit {
  schema: 'morphloom.camera-pose-evidence-audit/0.1';
  pass: boolean;
  relativePoseVerified: boolean;
  absolutePoseVerified: boolean;
  intrinsicsVerified: boolean;
  sameCameraVisualClaimAllowed: boolean;
  expectedStepDegrees: number[];
  blockers: string[];
  claimBlockers: string[];
  warnings: string[];
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_VIEWS = 24;

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function circularDelta(from: number, to: number, frameCount: number, direction: TurntableSequenceEvidence['direction']): number {
  return direction === 'clockwise'
    ? ((to - from) % frameCount + frameCount) % frameCount
    : ((from - to) % frameCount + frameCount) % frameCount;
}

function validAbsolutePose(pose: AbsoluteCameraPoseEvidence | undefined): boolean {
  return !!pose
    && Number.isFinite(pose.azimuthDegrees) && Math.abs(pose.azimuthDegrees) <= 1_000_000
    && Number.isFinite(pose.elevationDegrees) && Math.abs(pose.elevationDegrees) <= 90
    && (pose.projection === 'orthographic' || pose.projection === 'perspective')
    && Number.isFinite(pose.reprojectionErrorPixels) && pose.reprojectionErrorPixels >= 0
    && pose.reprojectionErrorPixels <= 10_000
    && Number.isInteger(pose.anchorCount) && pose.anchorCount >= 4 && pose.anchorCount <= 512
    && SHA256.test(pose.anchorReceiptFingerprint)
    && SHA256.test(pose.intrinsicsReceiptFingerprint)
    && SHA256.test(pose.modelFrameReceiptFingerprint)
    && ['measured-drawing', 'reference-ground-truth', 'candidate-output'].includes(pose.anchorSource);
}

/**
 * Audits where camera information came from before it may affect a visual
 * quality claim. A turntable sequence proves relative rotation only. Absolute
 * object-frame pose and lens parameters require independent 3D↔2D evidence;
 * optimizing a camera against the candidate can never certify its own score.
 */
export function auditCameraPoseEvidence(
  contract: CameraPoseEvidenceContract,
  expectedSourceFingerprints: Readonly<Record<string, string>> = {},
  options: { maximumReprojectionErrorPixels?: number } = {},
): CameraPoseEvidenceAudit {
  const blockers: string[] = [];
  const claimBlockers: string[] = [];
  const warnings: string[] = [];
  const views = Array.isArray(contract?.views) ? contract.views : [];
  const maximumReprojectionErrorPixels = options.maximumReprojectionErrorPixels ?? 2;
  if (contract?.schema !== 'morphloom.camera-pose-evidence/0.1') blockers.push('unsupported camera-pose evidence schema');
  if (views.length < 3 || views.length > MAX_VIEWS) blockers.push(`camera-pose evidence requires 3-${MAX_VIEWS} views`);
  if (!Number.isFinite(maximumReprojectionErrorPixels) || maximumReprojectionErrorPixels <= 0
    || maximumReprojectionErrorPixels > 100) {
    throw new Error('Camera-pose reprojection threshold is outside safe bounds.');
  }

  const ids = new Set<string>();
  for (const view of views) {
    if (!SAFE_ID.test(view?.id ?? '') || ids.has(view.id)) blockers.push(`invalid or duplicate camera-pose view: ${view?.id ?? 'missing'}`);
    ids.add(view?.id);
    if (!SHA256.test(view?.sourceFingerprint ?? '') || !SHA256.test(view?.derivationReceiptFingerprint ?? '')
      || !['dataset-turntable-metadata', 'calibrated-3d-2d-correspondences', 'candidate-silhouette-fit',
        'manual-semantic-label', 'unknown'].includes(view?.derivation)) {
      blockers.push(`invalid camera-pose provenance: ${view?.id ?? 'missing'}`);
    }
    const expectedFingerprint = expectedSourceFingerprints[view?.id];
    if (expectedFingerprint !== undefined && expectedFingerprint !== view?.sourceFingerprint) {
      blockers.push(`camera-pose source fingerprint mismatch: ${view?.id ?? 'missing'}`);
    }
    if (view?.derivation === 'candidate-silhouette-fit' && view.usesCandidateGeometry !== true) {
      blockers.push(`candidate camera fit hides candidate dependency: ${view.id}`);
    }
    if ((view?.derivation === 'dataset-turntable-metadata' || view?.derivation === 'calibrated-3d-2d-correspondences')
      && view.usesCandidateGeometry) {
      blockers.push(`independent camera provenance depends on candidate geometry: ${view.id}`);
    }
    if (view?.absolutePose !== undefined && !validAbsolutePose(view.absolutePose)) {
      blockers.push(`invalid absolute camera-pose receipt: ${view?.id ?? 'missing'}`);
    }
  }

  const sequence = contract?.turntableSequence;
  let relativePoseVerified = false;
  let expectedStepDegrees: number[] = [];
  if (sequence !== undefined) {
    if (!SAFE_ID.test(sequence.id) || !Number.isInteger(sequence.frameCount) || sequence.frameCount < 3
      || sequence.frameCount > 3_600 || !Number.isFinite(sequence.degreesPerStep) || sequence.degreesPerStep <= 0
      || sequence.degreesPerStep > 120 || Math.abs(sequence.degreesPerStep * sequence.frameCount - 360) > 1e-6
      || (sequence.direction !== 'clockwise' && sequence.direction !== 'counterclockwise')
      || !safeHttpsUrl(sequence.metadataSourceUrl) || !SHA256.test(sequence.metadataRecordFingerprint)) {
      blockers.push('invalid turntable-sequence evidence');
    } else {
      const indices = new Set<number>();
      let sequenceValid = true;
      for (const view of views) {
        if (view.derivation !== 'dataset-turntable-metadata' || view.usesCandidateGeometry
          || !Number.isInteger(view.sequenceIndex) || view.sequenceIndex! < 0 || view.sequenceIndex! >= sequence.frameCount
          || !Number.isFinite(view.relativeAzimuthDegrees) || view.relativeAzimuthDegrees! < 0
          || view.relativeAzimuthDegrees! >= 360 || indices.has(view.sequenceIndex!)) {
          sequenceValid = false;
          blockers.push(`invalid turntable view evidence: ${view.id}`);
          continue;
        }
        indices.add(view.sequenceIndex!);
      }
      if (sequenceValid && views.length >= 3) {
        expectedStepDegrees = views.map((view, index) => circularDelta(
          view.sequenceIndex!, views[(index + 1) % views.length]!.sequenceIndex!, sequence.frameCount, sequence.direction,
        ) * sequence.degreesPerStep);
        const declaredRelative = views.map((view) => normalizedDegrees(view.relativeAzimuthDegrees!));
        const declaredSteps = declaredRelative.map((angle, index) => normalizedDegrees(
          declaredRelative[(index + 1) % declaredRelative.length]! - angle,
        ));
        if (expectedStepDegrees.some((step, index) => step <= 0 || Math.abs(step - declaredSteps[index]!) > 1e-6)
          || Math.abs(expectedStepDegrees.reduce((sum, step) => sum + step, 0) - 360) > 1e-6) {
          blockers.push('turntable indices, relative azimuths, or cycle closure disagree');
        } else relativePoseVerified = true;
      }
    }
  } else warnings.push('no turntable sequence is available to verify relative camera rotation');

  const absolutePoseVerified = views.length >= 3 && views.every((view) => view.derivation === 'calibrated-3d-2d-correspondences'
    && !view.usesCandidateGeometry && validAbsolutePose(view.absolutePose)
    && view.absolutePose!.anchorSource !== 'candidate-output'
    && view.absolutePose!.reprojectionErrorPixels <= maximumReprojectionErrorPixels);
  const intrinsicsVerified = absolutePoseVerified && views.every((view) => SHA256.test(view.absolutePose!.intrinsicsReceiptFingerprint));
  const sameCameraVisualClaimAllowed = blockers.length === 0 && absolutePoseVerified && intrinsicsVerified;
  if (!absolutePoseVerified) claimBlockers.push('absolute object-frame camera pose is not independently calibrated');
  if (!intrinsicsVerified) claimBlockers.push('camera intrinsics are not independently calibrated');
  if (views.some((view) => view.usesCandidateGeometry || view.derivation === 'candidate-silhouette-fit')) {
    claimBlockers.push('candidate-optimized camera evidence cannot support a same-camera quality claim');
  }
  if (relativePoseVerified && !sameCameraVisualClaimAllowed) {
    warnings.push('relative turntable rotation is verified, but absolute pose and lens parameters remain unverified');
  }
  return {
    schema: 'morphloom.camera-pose-evidence-audit/0.1',
    pass: blockers.length === 0,
    relativePoseVerified,
    absolutePoseVerified,
    intrinsicsVerified,
    sameCameraVisualClaimAllowed,
    expectedStepDegrees,
    blockers: [...new Set(blockers)],
    claimBlockers: [...new Set(claimBlockers)],
    warnings: [...new Set(warnings)],
  };
}
