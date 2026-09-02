import { describe, expect, it } from 'vitest';
import { auditNeutralRenderPair, auditNeutralRenderSet, validateNeutralRenderReport } from '../src/engine/neutral-render-proof';

function report(candidate: 'morphloom' | 'img2threejs') {
  const digest = candidate === 'morphloom' ? 'a'.repeat(64) : 'b'.repeat(64);
  return {
    schema: 'morphloom.neutral-glb-render/0.2',
    protocol: 'morphloom-neutral-glb-v1',
    viewId: 'front',
    blenderVersion: '5.2.1 LTS',
    source: `${candidate}.glb`,
    sourceBytes: 100,
    sourceSha256: digest,
    render: `${candidate}.png`,
    renderBytes: 200,
    renderSha256: candidate === 'morphloom' ? 'c'.repeat(64) : 'd'.repeat(64),
    meshes: 2,
    materials: 3,
    normalization: {
      method: 'broadside-xz-max-extent',
      targetExtent: 2,
      sourceBounds: { min: [-1, -0.1, -0.5], max: [1, 0.1, 0.5], size: [2, 0.2, 1] },
      scale: 1,
      normalizedBounds: { min: [-1, -0.1, -0.5], max: [1, 0.1, 0.5], size: [2, 0.2, 1] },
    },
    camera: { projection: 'orthographic', position: [0, -4, 0], target: [0, 0, 0], up: [0, 0, 1], orthographicHeight: 2.35 },
    renderSettings: { engine: 'BLENDER_EEVEE', width: 1024, height: 512, transparent: true, viewTransform: 'AgX', look: 'AgX - Medium High Contrast' },
    studio: {
      world: { color: [0.12, 0.12, 0.12, 1], strength: 0.28 },
      lights: [
        { name: 'Neutral key', location: [-2.5, -3, 3.5], energy: 900, size: 4 },
        { name: 'Neutral fill', location: [3, -2, 1.2], energy: 500, size: 3 },
        { name: 'Neutral rim', location: [0.5, 2.5, 2.5], energy: 700, size: 2.5 },
      ],
    },
  };
}

describe('neutral GLB render proof', () => {
  it('accepts distinct candidates rendered under one locked protocol', () => {
    const audit = auditNeutralRenderPair(report('morphloom'), report('img2threejs'));
    expect(audit).toMatchObject({ status: 'pass', viewId: 'front', blockers: [] });
  });

  it('rejects stale bounds and unsafe names', () => {
    const stale = report('morphloom');
    stale.normalization.normalizedBounds.size[0] = 1.9;
    expect(() => validateNeutralRenderReport(stale)).toThrow(/size does not match|min\/max/);
    const escaped = report('morphloom');
    escaped.source = '../model.glb';
    expect(() => validateNeutralRenderReport(escaped)).toThrow(/name is invalid/);
  });

  it('blocks camera, renderer and studio mismatches', () => {
    const camera = report('img2threejs');
    camera.camera.orthographicHeight = 3;
    expect(auditNeutralRenderPair(report('morphloom'), camera).blockers[0]).toMatch(/camera does not match/);
    const studio = report('img2threejs');
    studio.studio.lights[0]!.energy = 500;
    expect(auditNeutralRenderPair(report('morphloom'), studio).blockers[0]).toMatch(/studio contract changed/);
  });

  it('blocks attempts to compare one source or one render against itself', () => {
    const sameSource = report('img2threejs');
    sameSource.sourceSha256 = 'a'.repeat(64);
    sameSource.renderSha256 = 'c'.repeat(64);
    const audit = auditNeutralRenderPair(report('morphloom'), sameSource);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers).toEqual(expect.arrayContaining([
      'Candidates use the same source GLB.',
      'Candidates produced byte-identical renders.',
    ]));
  });

  it('locks one source GLB while requiring distinct multi-view renders', () => {
    const views = ['front', 'rear', 'iso'] as const;
    const morphloom = views.map((viewId, index) => ({
      ...report('morphloom'),
      viewId,
      renderSha256: `${index + 1}`.repeat(64),
      camera: {
        ...report('morphloom').camera,
        position: index === 1 ? [0, 4, 0] : index === 2 ? [2.8, -3.4, 1.8] : [0, -4, 0],
        orthographicHeight: index === 2 ? 2.55 : 2.35,
      },
    }));
    const competitor = views.map((viewId, index) => ({
      ...report('img2threejs'),
      viewId,
      renderSha256: `${index + 4}`.repeat(64),
      camera: {
        ...report('img2threejs').camera,
        position: index === 1 ? [0, 4, 0] : index === 2 ? [2.8, -3.4, 1.8] : [0, -4, 0],
        orthographicHeight: index === 2 ? 2.55 : 2.35,
      },
    }));
    expect(auditNeutralRenderSet(morphloom, competitor)).toMatchObject({ status: 'pass', views: ['front', 'rear', 'iso'] });
    competitor[1]!.sourceSha256 = 'e'.repeat(64);
    expect(auditNeutralRenderSet(morphloom, competitor).blockers).toContain('img2threejs source GLB changed across views.');
  });
});
