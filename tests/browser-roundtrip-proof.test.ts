import { describe, expect, it } from 'vitest';
import {
  auditBrowserRoundTripProof,
  browserProofAssetPassed,
  type BrowserRoundTripProofExpectation,
} from '../src/engine/browser-roundtrip-proof';

const revision = 'morphloom-compiler/test';
const expectation: BrowserRoundTripProofExpectation = {
  id: 'measured-product',
  inputFingerprint: '1'.repeat(16),
  buildFingerprint: '2'.repeat(16),
  preparedSceneFingerprint: '3'.repeat(16),
  qualityReleaseReady: true,
};

function report() {
  return {
    schema: 'morphloom.browser-roundtrip/0.2',
    compilerRevision: revision,
    console: { errors: 0, warnings: 0 },
    assets: [{
      id: expectation.id,
      status: 'pass',
      inputFingerprint: expectation.inputFingerprint,
      buildFingerprint: expectation.buildFingerprint,
      sceneFingerprint: expectation.preparedSceneFingerprint,
      boundsErrorMm: 0,
      namedNodeCoverage: 1,
      morphTargetPayloadParity: true,
      qualityReleaseReady: true,
    }],
  };
}

describe('browser round-trip proof binding', () => {
  it('accepts one receipt bound to the current input, build and prepared scene', () => {
    const audit = auditBrowserRoundTripProof(report(), revision, [expectation], { requireExactAssetSet: true });
    expect(audit.pass).toBe(true);
    expect(audit.verifiedAssets).toBe(1);
    expect(browserProofAssetPassed(audit, expectation.id)).toBe(true);
  });

  it.each([
    ['inputFingerprint', '4'.repeat(16), /input fingerprint/],
    ['buildFingerprint', '4'.repeat(16), /build fingerprint/],
    ['sceneFingerprint', '4'.repeat(16), /prepared-scene fingerprint/],
    ['boundsErrorMm', 0.101, /bounds error/],
    ['namedNodeCoverage', 0.94, /named-node coverage/],
    ['morphTargetPayloadParity', false, /morph-target payload/],
    ['qualityReleaseReady', false, /release decision/],
  ])('rejects a stale or incomplete %s receipt', (field, value, message) => {
    const changed = report();
    Object.assign(changed.assets[0]!, { [field]: value });
    const audit = auditBrowserRoundTripProof(changed, revision, [expectation]);
    expect(audit.pass).toBe(false);
    expect(audit.assets[0]?.blockers.join(' ')).toMatch(message);
  });

  it('rejects duplicate receipts and unexpected assets in strict mode', () => {
    const changed = report();
    changed.assets.push({ ...changed.assets[0]! });
    changed.assets.push({ ...changed.assets[0]!, id: 'unbound-asset' });
    const audit = auditBrowserRoundTripProof(changed, revision, [expectation], { requireExactAssetSet: true });
    expect(audit.pass).toBe(false);
    expect(audit.duplicateAssetIds).toEqual(['measured-product']);
    expect(audit.unexpectedAssetIds).toEqual(['unbound-asset']);
    expect(audit.blockers.join(' ')).toMatch(/duplicate|unexpected/);
  });

  it('rejects a report from another compiler revision even when asset hashes look valid', () => {
    const audit = auditBrowserRoundTripProof(report(), 'morphloom-compiler/new', [expectation]);
    expect(audit.pass).toBe(false);
    expect(audit.blockers.join(' ')).toMatch(/compiler revision/);
  });
});
