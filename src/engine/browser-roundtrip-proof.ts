import { SCENE_FINGERPRINT_REVISION } from './delivery-validation';

export const BROWSER_ROUNDTRIP_PROOF_SCHEMA = 'morphloom.browser-roundtrip/0.3';

const FINGERPRINT = /^[a-f0-9]{16}$/;
const SAFE_ASSET_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export interface BrowserRoundTripProofExpectation {
  id: string;
  inputFingerprint: string;
  buildFingerprint: string;
  preparedSceneFingerprint: string;
  qualityReleaseReady?: boolean;
}

export interface BrowserRoundTripAssetProofAudit {
  id: string;
  pass: boolean;
  blockers: string[];
}

export interface BrowserRoundTripProofAudit {
  schema: 'morphloom.browser-roundtrip-proof-audit/0.1';
  pass: boolean;
  expectedAssets: number;
  verifiedAssets: number;
  duplicateAssetIds: string[];
  unexpectedAssetIds: string[];
  blockers: string[];
  assets: BrowserRoundTripAssetProofAudit[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function exactFingerprint(value: unknown, expected: string, label: string, blockers: string[]): void {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) {
    blockers.push(`${label} is missing or malformed`);
  } else if (value !== expected) {
    blockers.push(`${label} does not match the current deterministic build`);
  }
}

/**
 * Binds a browser round-trip receipt to the current normalized input, the
 * pre-export build and the exact tangent-prepared scene. A compiler revision
 * and a plausible-looking hexadecimal value are not sufficient evidence.
 */
export function auditBrowserRoundTripProof(
  reportValue: unknown,
  compilerRevision: string,
  expectations: readonly BrowserRoundTripProofExpectation[],
  options: { requireExactAssetSet?: boolean } = {},
): BrowserRoundTripProofAudit {
  const blockers: string[] = [];
  const report = record(reportValue);
  if (!report) blockers.push('browser proof report is not an object');
  if (report?.schema !== BROWSER_ROUNDTRIP_PROOF_SCHEMA) blockers.push('browser proof schema mismatch');
  if (report?.compilerRevision !== compilerRevision) blockers.push('browser proof compiler revision mismatch');
  if (report?.fingerprintRevision !== SCENE_FINGERPRINT_REVISION) blockers.push('browser proof scene-fingerprint revision mismatch');
  const consoleEvidence = record(report?.console);
  if (consoleEvidence?.errors !== 0 || consoleEvidence?.warnings !== 0) {
    blockers.push('browser console is not clean');
  }
  const rawAssets = Array.isArray(report?.assets) ? report.assets : [];
  if (!Array.isArray(report?.assets)) blockers.push('browser proof assets are missing');
  const assets = rawAssets.map(record).filter((value): value is UnknownRecord => value !== undefined);
  if (assets.length !== rawAssets.length) blockers.push('browser proof contains a non-object asset');
  const ids = assets.map((asset) => typeof asset.id === 'string' ? asset.id : '');
  const duplicateAssetIds = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))].sort();
  if (duplicateAssetIds.length > 0) blockers.push(`duplicate browser proof assets: ${duplicateAssetIds.join(', ')}`);
  if (ids.some((id) => !SAFE_ASSET_ID.test(id))) blockers.push('browser proof contains an unsafe or missing asset id');
  const expectedIds = new Set(expectations.map((expectation) => expectation.id));
  const unexpectedAssetIds = [...new Set(ids.filter((id) => id && !expectedIds.has(id)))].sort();
  if (options.requireExactAssetSet && unexpectedAssetIds.length > 0) {
    blockers.push(`unexpected browser proof assets: ${unexpectedAssetIds.join(', ')}`);
  }
  const assetAudits = expectations.map((expectation): BrowserRoundTripAssetProofAudit => {
    const assetBlockers: string[] = [];
    if (!SAFE_ASSET_ID.test(expectation.id)) assetBlockers.push('expected asset id is unsafe');
    for (const [label, value] of [
      ['expected input fingerprint', expectation.inputFingerprint],
      ['expected build fingerprint', expectation.buildFingerprint],
      ['expected prepared-scene fingerprint', expectation.preparedSceneFingerprint],
    ] as const) {
      if (!FINGERPRINT.test(value)) assetBlockers.push(`${label} is malformed`);
    }
    const matches = assets.filter((asset) => asset.id === expectation.id);
    if (matches.length !== 1) {
      assetBlockers.push(matches.length === 0 ? 'asset receipt is missing' : 'asset receipt is duplicated');
      return { id: expectation.id, pass: false, blockers: assetBlockers };
    }
    const asset = matches[0]!;
    if (asset.status !== 'pass') assetBlockers.push('browser round-trip status is not pass');
    exactFingerprint(asset.inputFingerprint, expectation.inputFingerprint, 'input fingerprint', assetBlockers);
    exactFingerprint(asset.buildFingerprint, expectation.buildFingerprint, 'build fingerprint', assetBlockers);
    exactFingerprint(asset.sceneFingerprint, expectation.preparedSceneFingerprint, 'prepared-scene fingerprint', assetBlockers);
    if (asset.morphTargetPayloadParity !== true) assetBlockers.push('morph-target payload parity is not proven');
    if (asset.texturePayloadParity !== true) assetBlockers.push('texture-payload parity is not proven');
    if (typeof asset.boundsErrorMm !== 'number' || !Number.isFinite(asset.boundsErrorMm)
      || asset.boundsErrorMm < 0 || asset.boundsErrorMm > 0.1) {
      assetBlockers.push('round-trip bounds error is missing or exceeds 0.1 mm');
    }
    if (typeof asset.namedNodeCoverage !== 'number' || !Number.isFinite(asset.namedNodeCoverage)
      || asset.namedNodeCoverage < 0.95 || asset.namedNodeCoverage > 1) {
      assetBlockers.push('named-node coverage is missing or below 95%');
    }
    if (expectation.qualityReleaseReady !== undefined
      && asset.qualityReleaseReady !== expectation.qualityReleaseReady) {
      assetBlockers.push('quality release decision does not match the expected decision');
    }
    return { id: expectation.id, pass: assetBlockers.length === 0, blockers: assetBlockers };
  });
  const verifiedAssets = assetAudits.filter((asset) => asset.pass).length;
  return {
    schema: 'morphloom.browser-roundtrip-proof-audit/0.1',
    pass: blockers.length === 0 && verifiedAssets === expectations.length,
    expectedAssets: expectations.length,
    verifiedAssets,
    duplicateAssetIds,
    unexpectedAssetIds,
    blockers,
    assets: assetAudits,
  };
}

export function browserProofAssetPassed(audit: BrowserRoundTripProofAudit, id: string): boolean {
  return audit.assets.some((asset) => asset.id === id && asset.pass);
}
