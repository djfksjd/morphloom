import { describe, expect, it } from 'vitest';
import type { DeliveryAudit } from '../src/engine/delivery-validation';
import {
  createBrowserRoundTripAssetReceipt,
  createBrowserRoundTripReport,
} from '../src/engine/browser-proof-recorder';

const audit: DeliveryAudit = {
  status: 'pass',
  score: 100,
  buildFingerprint: '1111111111111111',
  fingerprint: '2222222222222222',
  inputFingerprint: '3333333333333333',
  glbBytes: 4096,
  durationMs: 12,
  meshParity: true,
  triangleParity: true,
  morphTargetPayloadParity: true,
  texturePayloadParity: true,
  materialPayloadParity: true,
  namedNodeCoverage: 1,
  boundsErrorMm: 0,
  standardValidation: {
    status: 'pass', errors: 0, warnings: 0, issueCodes: [], messages: [],
    independentRead: { status: 'pass', errors: [] },
  },
  blockers: [],
  warnings: [],
  platformNotes: {
    gltf20: 'khronos-validator-pass',
    blender: 'application-import-not-run',
    unity: 'application-import-not-run',
    unreal: 'application-import-not-run',
    fusion360: 'mesh-import-only',
    figma: 'svg-reference-only',
  },
};

describe('browser proof recorder', () => {
  it('binds a browser receipt to the input, build, prepared scene and payload parity', () => {
    const receipt = createBrowserRoundTripAssetReceipt({
      id: 'test-asset', scope: 'test', qualityReleaseReady: true,
    }, audit);
    expect(receipt).toMatchObject({
      id: 'test-asset', status: 'pass', inputFingerprint: '3333333333333333',
      buildFingerprint: '1111111111111111', sceneFingerprint: '2222222222222222',
      morphTargetPayloadParity: true, texturePayloadParity: true,
      materialPayloadParity: true, qualityReleaseReady: true,
      validatorErrors: 0, validatorWarnings: 0,
    });
  });

  it('emits the current schema revisions and preserves real console evidence', () => {
    const receipt = createBrowserRoundTripAssetReceipt({
      id: 'test-asset', scope: 'test', qualityReleaseReady: true,
    }, audit);
    const report = createBrowserRoundTripReport([receipt], {
      errors: 1, warnings: 2, samples: ['ERROR · example'],
    }, '2026-09-02T00:00:00.000Z');
    expect(report.schema).toBe('morphloom.browser-roundtrip/0.4');
    expect(report.compilerRevision).toBe('morphloom-compiler/0.28.0');
    expect(report.fingerprintRevision).toBe('morphloom-scene-fingerprint/0.5.0');
    expect(report.console).toEqual({ errors: 1, warnings: 2, samples: ['ERROR · example'] });
    expect(report.assets).toHaveLength(1);
  });
});
