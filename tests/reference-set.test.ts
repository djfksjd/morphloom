import { describe, expect, it } from 'vitest';
import {
  buildReferenceManifest,
  validateReferenceProvenance,
  migrateReferenceManifestProvenance,
  restoreReferenceManifest,
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

// Generated/unknown views cannot replace actual source evidence.
describe('reference provenance', () => {
  it('excludes synthetic and unknown depth/scale even when sourceType is CAD', () => {
    const sources = [view('front', 1),
      { ...view('left', 2), sourceType: 'cad' as const, provenance: { schema: 'morphloom.reference-provenance/0.1', kind: 'synthetic' } },
      { ...view('measurement', 3), provenance: { schema: 'morphloom.reference-provenance/0.1', kind: 'unknown' } }];
    expect(evaluateReferenceSet(sources as ReferenceView[], 'product')).toMatchObject({ready:false, presentRecommendedRoles:['front']});
    expect(evaluateReferenceSet(sources as ReferenceView[], 'product').warnings.join(' ')).toContain('depth');
  });
  it('keeps candidates and remaps lineage to exported stable source IDs', () => {
    const sources = [view('front', 1), { ...view('rear', 2), provenance: {
      schema: 'morphloom.reference-provenance/0.1', kind: 'synthetic', sourceViewIds:['runtime-1'], model:'test-model', revision:'fixed', seed:17,
    }}];
    const manifest=buildReferenceManifest(sources as ReferenceView[], 'product');
    expect(manifest.schema).toBe('morphloom.evidence/0.2');
    expect(manifest.views[1]).toMatchObject({capabilities:[],provenance:{kind:'synthetic',sourceViewIds:['view_01'],seed:17}});
    expect(JSON.stringify(manifest)).not.toContain('runtime-1');
  });
  it('rejects missing or cyclic lineage rather than silently inventing a source', () => {
    const a={...view('front', 1),provenance:{schema:'morphloom.reference-provenance/0.1',kind:'synthetic',sourceViewIds:['missing']}};
    expect(()=>buildReferenceManifest([a] as ReferenceView[],'product')).toThrow();
    a.provenance.sourceViewIds=['runtime-2'];
    const b={...view('rear',2),provenance:{schema:'morphloom.reference-provenance/0.1',kind:'synthetic',sourceViewIds:['runtime-1']}};
    expect(()=>buildReferenceManifest([a,b] as ReferenceView[],'product')).toThrow();
  });
});

describe('provenance boundary and legacy migration', () => {
  it.each([
    {schema:'wrong',kind:'synthetic'},
    {schema:'morphloom.reference-provenance/0.1',kind:'observed',model:'spoof'},
    {schema:'morphloom.reference-provenance/0.1',kind:'synthetic',seed:-1},
    {schema:'morphloom.reference-provenance/0.1',kind:'synthetic',model:'x'.repeat(257)},
    {schema:'morphloom.reference-provenance/0.1',kind:'synthetic',sourceViewIds:['a','a']},
    {schema:'morphloom.reference-provenance/0.1',kind:'measured'},
  ])('rejects invalid parameters %#', bad => expect(()=>validateReferenceProvenance(bad)).toThrow());
  it('keeps legacy bytes and scoring semantics without inventing observed provenance on migration', () => {
    const legacy=buildReferenceManifest([view('front',1),view('left',2),view('measurement',3)],'product');
    const before=JSON.stringify(legacy);
    const migrated=migrateReferenceManifestProvenance(legacy);
    expect(legacy.schema).toBe('morphloom.evidence/0.1');
    expect(migrated.schema).toBe('morphloom.evidence/0.2');
    expect(migrated.views).toEqual(legacy.views);
    expect(migrated.coverage).toEqual(legacy.coverage);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(migrated.views.every(v=>v.provenance===undefined)).toBe(true);
  });
});

describe('local image evidence reopen', () => {
  it('restores provenance to new runtime IDs and leaves input pixels/analysis and unrelated assets untouched', () => {
    const sources:ReferenceView[]=[view('front',1),{...view('rear',2),provenance:{schema:'morphloom.reference-provenance/0.1',kind:'synthetic',sourceViewIds:['runtime-1'],seed:17}}];
    const manifest=JSON.parse(JSON.stringify(buildReferenceManifest(sources,'product')));
    const fresh=sources.map(v=>({...v,id:'fresh-'+v.id,provenance:undefined}));
    const unrelated=view('front',3,undefined,'human');
    const restored=restoreReferenceManifest([...fresh,unrelated],manifest,'product');
    expect(restored[1].provenance?.sourceViewIds).toEqual(['fresh-runtime-1']);
    expect(restored[0].url).toBe(fresh[0].url);
    expect(restored[0].evidence).toBe(fresh[0].evidence);
    expect(restored[2]).toBe(unrelated);
    expect(buildReferenceManifest(restored,'product')).toEqual(manifest);
    manifest.views[0].fileSize++;
    expect(()=>restoreReferenceManifest(fresh,manifest,'product')).toThrow();
    expect(fresh.every(v=>!v.provenance)).toBe(true);
  });
});

it('requires exact content fingerprint when reattaching new image metadata',()=>{
  const sources=[{...view('front',1),fingerprint:'a'.repeat(64),provenance:{schema:'morphloom.reference-provenance/0.1' as const,kind:'observed' as const}}];
  const manifest=buildReferenceManifest(sources,'product');
  expect(()=>restoreReferenceManifest([{...sources[0],fingerprint:'b'.repeat(64)}],manifest,'product')).toThrow();
  expect(restoreReferenceManifest(sources,manifest,'product')[0].fingerprint).toBe('a'.repeat(64));
});
