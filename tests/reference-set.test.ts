import { describe, expect, it } from 'vitest';
import {
  buildReferenceManifest,
  evaluateReferenceSet,
  inferReferenceRole,
  normalizeComponentId,
  type ReferenceRole,
  type ReferenceView,
} from '../src/engine/reference-set';

function view(role: ReferenceRole, index: number, componentId?: string, assetKind: ReferenceView['assetKind'] = 'product'): ReferenceView {
  return {
    id: `runtime-${index}`,
    assetKind,
    url: `blob:local-${index}`,
    fileName: `${role}-${index}.png`,
    fileSize: 1024 + index,
    mimeType: 'image/png',
    lastModified: index,
    role,
    componentId,
    evidence: {
      fileName: `${role}-${index}.png`,
      width: 1800,
      height: 1200,
      averageColor: '#778899',
      brightness: 0.54,
      portraitSuitability: 92,
      notes: ['good'],
    },
  };
}

describe('multi-view evidence set', () => {
  it('infers common Korean and English view names', () => {
    expect(inferReferenceRole('phone_front.png')).toBe('front');
    expect(inferReferenceRole('제품_후면.jpg')).toBe('rear');
    expect(inferReferenceRole('mainboard_PCB_closeup.webp', 3)).toBe('component');
    expect(inferReferenceRole('surface_texture.png', 4)).toBe('material');
  });

  it('normalizes stable ASCII component ids', () => {
    expect(normalizeComponentId('Main Camera / OIS')).toBe('main_camera_ois');
    expect(normalizeComponentId('  battery__pack  ')).toBe('battery_pack');
    expect(normalizeComponentId('카메라')).toBe('');
  });

  it('requires six product views and identified component evidence', () => {
    const complete = [
      view('front', 1), view('rear', 2), view('left', 3),
      view('right', 4), view('top', 5), view('bottom', 6),
      view('component', 7, 'camera_main'),
    ];
    expect(evaluateReferenceSet(complete, 'product')).toMatchObject({
      ready: true,
      score: 98,
      missingRequiredRoles: [],
      unidentifiedComponentViews: 0,
    });

    const incomplete = [...complete.slice(0, 6), view('component', 8)];
    expect(evaluateReferenceSet(incomplete, 'product')).toMatchObject({
      ready: false,
      unidentifiedComponentViews: 1,
    });
  });

  it('exports a deterministic agent manifest without local blob URLs', () => {
    const views = [view('front', 1), view('component', 2, 'Camera Main')];
    const manifest = buildReferenceManifest(views, 'product');
    expect(manifest.schema).toBe('morphloom.evidence/0.1');
    expect(manifest.views[0].id).toBe('view_01');
    expect(manifest.views[1].componentId).toBe('camera_main');
    expect(JSON.stringify(manifest)).not.toContain('blob:');
    expect(manifest.agentInstructions[0]).toContain('untrusted evidence');
    expect(manifest.agentInstructions).toContain('Merge repeated component photos only by stable ASCII componentId.');
  });

  it('does not mix product and human evidence when the mode changes', () => {
    const mixed = [
      view('front', 1, undefined, 'human'),
      view('rear', 2),
      view('left', 3),
      view('right', 4),
    ];
    expect(evaluateReferenceSet(mixed, 'human')).toMatchObject({
      ready: false,
      presentRequiredRoles: ['front'],
      missingRequiredRoles: ['rear', 'left', 'right'],
    });
    expect(buildReferenceManifest(mixed, 'human').views).toHaveLength(1);
  });
});
