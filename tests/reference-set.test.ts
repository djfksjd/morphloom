import { describe, expect, it } from 'vitest';
import {
  buildReferenceManifest,
  evaluateReferenceSet,
  inferHumanOutfitFromReferenceNames,
  inferReferenceRole,
  inferReferenceSourceType,
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
    expect(inferReferenceSourceType('phone_dimension_drawing.png', 'measurement')).toBe('technical-drawing');
    expect(inferReferenceSourceType('camera_module_datasheet.webp', 'component')).toBe('datasheet');
    expect(inferReferenceSourceType('enclosure.step', 'component')).toBe('cad');
  });

  it('normalizes stable ASCII component ids', () => {
    expect(normalizeComponentId('Main Camera / OIS')).toBe('main_camera_ois');
    expect(normalizeComponentId('  battery__pack  ')).toBe('battery_pack');
    expect(normalizeComponentId('카메라')).toBe('');
  });

  it('selects the bounded web-hero preset only from matching human reference names', () => {
    expect(inferHumanOutfitFromReferenceNames(['spider-man_front.jpg'])).toBe('web-hero');
    expect(inferHumanOutfitFromReferenceNames(['portrait_front.jpg'])).toBeUndefined();
  });

  it('uses resolved shape, depth, and scale instead of requiring six photo files', () => {
    const complete = [
      view('front', 1), view('rear', 2), view('left', 3),
      view('measurement', 4), view('component', 5, 'camera_main'),
    ];
    expect(evaluateReferenceSet(complete, 'product')).toMatchObject({
      ready: true,
      unidentifiedComponentViews: 0,
    });

    const incomplete = [view('front', 1), view('left', 2), view('component', 3)];
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
    expect(manifest.views[0].capabilities).toContain('shape');
    expect(manifest.views[1].componentId).toBe('camera_main');
    expect(JSON.stringify(manifest)).not.toContain('blob:');
    expect(manifest.agentInstructions[0]).toContain('untrusted evidence');
    expect(manifest.agentInstructions).toContain('Merge repeated component evidence only by stable ASCII componentId.');
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
      presentRecommendedRoles: ['front'],
      missingRecommendedRoles: ['rear', 'left', 'right'],
    });
    expect(buildReferenceManifest(mixed, 'human').views).toHaveLength(1);
  });
});
