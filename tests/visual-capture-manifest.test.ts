import { describe, expect, it } from 'vitest';
import {
  canonicalCameraCalibration,
  validateBrowserCaptureReceipt,
  validateVisualCaptureSetManifest,
} from '../src/engine/visual-capture-manifest';

function manifest() {
  const view = (viewId: string, offset: number) => ({
    viewId,
    camera: {
      projection: 'perspective',
      position: [offset, 0.2, 1.4],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDegrees: 31,
    },
    reference: `${viewId}-reference.png`,
    morphloom: `${viewId}-morphloom.png`,
    img2threejs: `${viewId}-img2threejs.png`,
    sceneArtifacts: {
      morphloom: 'morphloom-scene.glb',
      img2threejs: 'img2threejs-scene.glb',
    },
    captureReceipts: {
      morphloom: `${viewId}-morphloom-receipt.json`,
      img2threejs: `${viewId}-img2threejs-receipt.json`,
    },
    referenceOrigin: 'admitted-local-reference',
    thresholds: { img2threejs: 48 },
    regions: [
      { featureId: 'silhouette', x: 0, y: 0, width: 512, height: 256 },
      { featureId: 'primary', x: 0, y: 0, width: 256, height: 256 },
      { featureId: 'secondary', x: 256, y: 0, width: 256, height: 256 },
    ],
    materialExpectation: { family: 'metal', roughness: 0.3, surfaceCharacter: 'directional' },
  });
  return {
    schema: 'morphloom.visual-capture-set/0.3',
    id: 'two-view-product-proof',
    domain: 'industrial-design',
    rendererVersions: { morphloom: '0.21.0', img2threejs: 'pinned-commit' },
    views: [view('front', 0), view('oblique', 0.6)],
  };
}

describe('multi-view capture manifest', () => {
  it('admits distinct local captures with explicit calibrated cameras', () => {
    const parsed = validateVisualCaptureSetManifest(manifest());
    expect(parsed.views).toHaveLength(2);
    expect(parsed.views[0]).toMatchObject({ viewId: 'front', referenceOrigin: 'admitted-local-reference' });
    expect(canonicalCameraCalibration(parsed.views[0]!.camera)).toBe(
      '{"projection":"perspective","position":[0,0.2,1.4],"target":[0,0,0],"up":[0,1,0],"fovDegrees":31}',
    );
  });

  it('rejects reused view files and remote references', () => {
    const reused = manifest();
    reused.views[1]!.morphloom = reused.views[0]!.morphloom;
    expect(() => validateVisualCaptureSetManifest(reused)).toThrow(/reused/);
    const remote = manifest();
    remote.views[0]!.reference = 'https://example.com/reference.png';
    expect(() => validateVisualCaptureSetManifest(remote)).toThrow(/manifest-relative path/);
  });

  it('rejects uncalibrated cameras and regions outside the normalized frame', () => {
    const camera = manifest();
    camera.views[0]!.camera.position = [0, 0, 0];
    expect(() => validateVisualCaptureSetManifest(camera)).toThrow(/must differ/);
    const region = manifest();
    region.views[0]!.regions[0]!.width = 513;
    expect(() => validateVisualCaptureSetManifest(region)).toThrow(/exceeds/);
  });

  it('rejects unsafe thresholds and duplicate feature ids', () => {
    const threshold = manifest();
    threshold.views[0]!.thresholds.img2threejs = 255;
    expect(() => validateVisualCaptureSetManifest(threshold)).toThrow(/1\.\.254/);
    const duplicate = manifest();
    duplicate.views[0]!.regions[1]!.featureId = 'silhouette';
    expect(() => validateVisualCaptureSetManifest(duplicate)).toThrow(/duplicated/);
  });

  it('requires one stable local scene artifact across calibrated views', () => {
    const missing = manifest();
    delete (missing.views[0] as Partial<(typeof missing.views)[number]>).sceneArtifacts;
    expect(() => validateVisualCaptureSetManifest(missing)).toThrow(/sceneArtifacts/);
    const changed = manifest();
    changed.views[1]!.sceneArtifacts.morphloom = 'different-scene.glb';
    expect(() => validateVisualCaptureSetManifest(changed)).toThrow(/scene artifact changed/);
    const screenshot = manifest();
    screenshot.views[0]!.sceneArtifacts.morphloom = 'render.png';
    expect(() => validateVisualCaptureSetManifest(screenshot)).toThrow(/GLB, glTF, or scene JSON/);
  });

  it('confines all evidence to manifest-relative paths and requires unique receipts', () => {
    const escaped = manifest();
    escaped.views[0]!.reference = '../outside.png';
    expect(() => validateVisualCaptureSetManifest(escaped)).toThrow(/manifest-relative/);
    const absolute = manifest();
    absolute.views[0]!.sceneArtifacts.morphloom = '/tmp/scene.glb';
    expect(() => validateVisualCaptureSetManifest(absolute)).toThrow(/manifest-relative/);
    const reused = manifest();
    reused.views[1]!.captureReceipts.morphloom = reused.views[0]!.captureReceipts.morphloom;
    expect(() => validateVisualCaptureSetManifest(reused)).toThrow(/receipt was reused/);
  });

  it('binds a browser receipt to the exact candidate, input, scene, camera, reference and render', () => {
    const digest = (value: string) => value.repeat(64);
    const expected = {
      candidateId: 'morphloom' as const,
      viewId: 'front',
      rendererVersion: '0.4.0',
      inputFingerprint: digest('a'),
      sceneSha256: digest('b'),
      cameraFingerprint: digest('c'),
      referenceSha256: digest('d'),
      renderSha256: digest('e'),
    };
    const receipt = {
      schema: 'morphloom.browser-capture-receipt/0.1',
      captureMethod: 'browser-webgl-canvas',
      ...expected,
      canvas: { width: 1024, height: 1024, pixelRatio: 2 },
      renderSettingsFingerprint: digest('f'),
    };
    expect(validateBrowserCaptureReceipt(receipt, expected).canvas.pixelRatio).toBe(2);
    expect(() => validateBrowserCaptureReceipt({ ...receipt, renderSha256: digest('0') }, expected)).toThrow(/renderSha256/);
    expect(() => validateBrowserCaptureReceipt({ ...receipt, canvas: { width: 1, height: 1, pixelRatio: 1 } }, expected)).toThrow(/safe render bounds/);
  });
});
