import { describe, expect, it } from 'vitest';
import {
  canonicalCameraCalibration,
  canonicalVisualRenderProtocol,
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
    schema: 'morphloom.visual-capture-set/0.4',
    id: 'two-view-product-proof',
    domain: 'industrial-design',
    rendererVersions: { morphloom: '0.21.0', img2threejs: 'pinned-commit' },
    renderProtocol: {
      canvas: { width: 1024, height: 1024, pixelRatio: 2 },
      outputColorSpace: 'srgb',
      toneMapping: 'aces-filmic',
      exposure: 1,
      backgroundRgba: [255, 255, 255, 0],
      lightingRigArtifact: 'render/light-rig.json',
      lightingRigSha256: 'a'.repeat(64),
      environmentArtifact: 'none',
      environmentSha256: 'none',
      shadows: 'on',
    },
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
    const duplicateRectangle = manifest();
    duplicateRectangle.views[0]!.regions[1] = { ...duplicateRectangle.views[0]!.regions[0], featureId: 'renamed-copy' };
    expect(() => validateVisualCaptureSetManifest(duplicateRectangle)).toThrow(/duplicates another region rectangle/);
  });

  it('locks bounded render settings shared by both candidates', () => {
    const parsed = validateVisualCaptureSetManifest(manifest());
    expect(canonicalVisualRenderProtocol(parsed.renderProtocol)).toContain('aces-filmic');
    expect(canonicalVisualRenderProtocol(parsed.renderProtocol)).not.toContain('light-rig.json');
    const oversized = manifest();
    oversized.renderProtocol.canvas = { width: 5000, height: 5000, pixelRatio: 1 };
    expect(() => validateVisualCaptureSetManifest(oversized)).toThrow(/safe render bounds/);
    const legacy = manifest();
    legacy.schema = 'morphloom.visual-capture-set/0.3';
    expect(() => validateVisualCaptureSetManifest(legacy)).toThrow(/unsupported/);
    const incompleteEnvironment = manifest();
    incompleteEnvironment.renderProtocol.environmentArtifact = 'render/studio.hdr';
    expect(() => validateVisualCaptureSetManifest(incompleteEnvironment)).toThrow(/environment artifact and SHA-256/);
    const escapedLighting = manifest();
    escapedLighting.renderProtocol.lightingRigArtifact = '../light-rig.json';
    expect(() => validateVisualCaptureSetManifest(escapedLighting)).toThrow(/manifest-relative/);
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
      schema: 'morphloom.browser-capture-receipt/0.2',
      captureMethod: 'browser-webgl-canvas',
      ...expected,
      canvas: { width: 1024, height: 1024, pixelRatio: 2 },
      renderSettingsFingerprint: digest('f'),
    };
    const locked = { ...expected, canvas: receipt.canvas, renderSettingsFingerprint: receipt.renderSettingsFingerprint };
    expect(validateBrowserCaptureReceipt(receipt, locked).canvas.pixelRatio).toBe(2);
    expect(() => validateBrowserCaptureReceipt({ ...receipt, renderSha256: digest('0') }, locked)).toThrow(/renderSha256/);
    expect(() => validateBrowserCaptureReceipt({ ...receipt, canvas: { width: 1, height: 1, pixelRatio: 1 } }, locked)).toThrow(/safe render bounds/);
    expect(() => validateBrowserCaptureReceipt(receipt, { ...locked, canvas: { ...locked.canvas, pixelRatio: 1 } })).toThrow(/locked render protocol/);
    expect(() => validateBrowserCaptureReceipt(receipt, { ...locked, renderSettingsFingerprint: digest('0') })).toThrow(/renderSettingsFingerprint/);
  });
});
