import { describe, expect, it } from 'vitest';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs';
import { bearingPack } from '../src/engine/bearing-pack';
import { editPart, resolveElements, serializeProject } from '../src/engine/element-project';
import { appendWorkspaceAsset, buildWorkspaceScene, editWorkspacePart, generateWorkspaceAsset, parseWorkspace, serializeWorkspace, validateWorkspace, type ElementWorkspace } from '../src/engine/element-workspace';

const empty = (): ElementWorkspace => ({ schema:'morphloom.workspace/0.1', units:'mm', coordinates:'right-handed-y-up', assets:[] });
const registry = () => { const r=createElementDomainRegistry();r.register(bearingPack);return r; };
const combined = () => {
  const r=registry();
  return appendWorkspaceAsset(appendWorkspaceAsset(empty(),generateWorkspaceAsset(r,{id:'bird',packId:'morphloom.fur',input:{seed:17},requiredCapabilities:['semantic-part-editing'],positionMm:[-150,0,0],rotationRad:[0,0,0]})),
    generateWorkspaceAsset(r,{id:'bearing',packId:'mechanical.bearing.visual',input:{seed:91},requiredCapabilities:['selected-scene-export'],positionMm:[150,0,0],rotationRad:[0,0,0]}));
};

describe('source-preserving mixed workspace',()=>{
  it('retains independent seeds, IDs, edits and resolved distributions on append and reload',()=>{
    const p=combined(), bird=p.assets[0].source, before=serializeProject(bird);
    const next=editWorkspacePart(p,'bearing','ball_0000',{color:'#aabbcc'});
    expect(serializeProject(next.assets[0].source)).toBe(before);
    expect(resolveElements(next.assets[0].source)).toEqual(resolveElements(bird));
    expect(next.assets.map(a=>a.source.seed)).toEqual([17,91]);
    expect(p.assets[1].source.parts.find(a=>a.id==='ball_0000')!.color).not.toBe('#aabbcc');
    expect(parseWorkspace(serializeWorkspace(next))).toEqual(next);
  });
  it('derives one scene with separate datum transforms and scoped names, leaving IR intact',()=>{
    const p=combined(), before=serializeWorkspace(p), scene=buildWorkspaceScene(p,'detail');
    try {
      expect(scene.root.children.map(c=>c.name)).toEqual(['bird','bearing']);
      expect(scene.root.getObjectByName('bearing::ball_0000')!.parent!.name).toBe('bearing::bearing_assembly');
      expect(scene.root.children[1].position.x).toBe(0.15);
      expect(scene.stats.triangles).toBeLessThan(100_000);
      expect(serializeWorkspace(p)).toBe(before);
    } finally {scene.dispose();}
  });
  it('rejects duplicate instances, unknown fields, unit/coordinate/representation conflicts atomically',()=>{
    const p=combined(), before=serializeWorkspace(p);
    expect(()=>appendWorkspaceAsset(p,p.assets[0])).toThrow();
    for(const patch of [{units:'cm'},{coordinates:'z-up'},{schema:'morphloom.workspace/9'},{execute:'anything'}])
      expect(()=>validateWorkspace({...p,...patch})).toThrow();
    const broken=structuredClone(p);(broken.assets[0].source as unknown as {schema:string}).schema='nurbs/1';
    expect(()=>validateWorkspace(broken)).toThrow();
    expect(serializeWorkspace(p)).toBe(before);
  });
  it('rejects absent capabilities/provider failure without changing an existing asset',()=>{
    const p=combined(), before=serializeWorkspace(p), r=registry();
    expect(()=>generateWorkspaceAsset(r,{id:'unsupported',packId:'morphloom.bird',input:{},requiredCapabilities:['solid-brep'],positionMm:[0,0,0],rotationRad:[0,0,0]})).toThrow();
    const m=r.list().find(m=>m.id==='mechanical.bearing.visual')!;
    r.register({metadata:{...m,id:'throwing.provider'},generate(){throw new Error('private');}});
    expect(()=>generateWorkspaceAsset(r,{id:'broken',packId:'throwing.provider',input:{},requiredCapabilities:[],positionMm:[0,0,0],rotationRad:[0,0,0]})).toThrow('provider-error');
    expect(serializeWorkspace(p)).toBe(before);
  });
  it('exports duplicate local IDs under unique scoped names and rejects aggregate object excess',()=>{
    const p=combined();p.assets[0].source=editPart(p.assets[1].source,'ball_0000',{color:'#ff0000'});
    const scene=buildWorkspaceScene(p,'detail',true);
    try {
      expect(scene.root.getObjectByName('bird::ball_0000')).toBeDefined();
      expect(scene.root.getObjectByName('bearing::ball_0000')).toBeDefined();
      expect(scene.root.userData.sourceSpec.schema).toBe('morphloom.workspace/0.1');
    } finally {scene.dispose();}
    const large=combined();const third=structuredClone(large.assets[0]);third.id='third';large.assets.push(third,{...structuredClone(third),id:'fourth'});
    expect(()=>buildWorkspaceScene(large,'detail',true)).toThrow('export-object-budget');
  });
});
