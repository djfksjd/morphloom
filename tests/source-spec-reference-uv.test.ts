import {expect, it} from 'vitest';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {exportSelectedScene} from '../src/engine/element-renderer';
import {inspectUvQuality} from '../src/engine/uv-quality';

it('blocks connected feature approval when the source is a before-edit reference, without changing buffers or thresholds', async () => {
  const scene = exportSelectedScene(generateSpurGearProject({moduleMm:2,toothCount:40,pressureAngleDeg:25,faceWidthMm:12,boreDiameterMm:10}), ['spur_gear']);
  try {
    const before = await inspectUvQuality(scene.root);
    expect(before.integrityPass).toBe(true);
    expect(before.meshes[0].features).toHaveLength(40);
    scene.root.userData.morphloomSourceSpecReference = {schema:'morphloom.source-spec-reference/0.1',state:'before-edit-reference',sourceSha256:'0'.repeat(64),sourceSpec:scene.root.userData.sourceSpec};
    delete scene.root.userData.sourceSpec;
    const after = await inspectUvQuality(scene.root);
    expect(after.geometryFingerprint).toBe(before.geometryFingerprint);
    expect(after.integrityPass).toBe(false);
    expect(after.meshes[0].criticalFeatures).toBe('fail');
    expect(after.meshes[0].blocked).toContain('reference');
    expect(after.fingerprintCoverage).toBe('partial-blocked');
  } finally {scene.dispose();}
});

it('does not approve conflicting active and referenced connected-feature sources', async () => {
  const scene = exportSelectedScene(generateSpurGearProject({moduleMm:2,toothCount:40,pressureAngleDeg:25,faceWidthMm:12,boreDiameterMm:10}), ['spur_gear']);
  try {
    scene.root.userData.morphloomSourceSpecReference = {schema:'unknown',sourceSpec:scene.root.userData.sourceSpec};
    const after = await inspectUvQuality(scene.root);
    expect(after.integrityPass).toBe(false);
    expect(after.meshes[0].criticalFeatures).toBe('fail');
  } finally {scene.dispose();}
});
