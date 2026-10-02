import { describe, expect, it } from 'vitest';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs';
import { bearingPack } from '../src/engine/bearing-pack';
import { appendWorkspaceAsset, editWorkspacePart, generateWorkspaceAsset, serializeWorkspace, WorkspaceHistory, type ElementWorkspace } from '../src/engine/element-workspace';

function fixture():ElementWorkspace{
  const r=createElementDomainRegistry();r.register(bearingPack);
  const a=generateWorkspaceAsset(r,{id:'animal',packId:'morphloom.fur',input:{seed:17},requiredCapabilities:['semantic-part-editing'],positionMm:[-100,0,0],rotationRad:[0,0,0]});
  return {schema:'morphloom.workspace/0.1',units:'mm',coordinates:'right-handed-y-up',assets:[a]};
}
describe('workspace-wide bounded history',()=>{
  it('undoes append and edits across assets without rewriting seeds, IDs or datums',()=>{
    const a=fixture(),r=createElementDomainRegistry();r.register(bearingPack);
    const b=appendWorkspaceAsset(a,generateWorkspaceAsset(r,{id:'bearing',packId:'mechanical.bearing.visual',input:{seed:91},requiredCapabilities:['semantic-part-editing'],positionMm:[100,0,0],rotationRad:[0,0,0]}));
    const c=editWorkspacePart(b,'bearing','ball_0000',{color:'#abcdef'}),d=editWorkspacePart(c,'animal','animal_body',{color:'#112233'});
    const h=new WorkspaceHistory(a);h.commit(b);h.commit(c);h.commit(d);
    for(const state of [c,b,a])expect(serializeWorkspace(h.undo())).toBe(serializeWorkspace(state));
    for(const state of [b,c,d])expect(serializeWorkspace(h.redo())).toBe(serializeWorkspace(state));
  });
  it('discards redo on branching, ignores identical commits, and does not expose mutable history',()=>{
    const a=fixture(),h=new WorkspaceHistory(a);h.commit(editWorkspacePart(a,'animal','animal_body',{color:'#123456'}));h.undo();
    h.commit(editWorkspacePart(a,'animal','animal_body',{color:'#654321'}));
    expect(h.canRedo).toBe(false);const before=h.retainedStates;h.commit(h.current);expect(h.retainedStates).toBe(before);
    const exposed=h.current;exposed.assets[0].source.seed=999;expect(h.current.assets[0].source.seed).toBe(17);
  });
  it('bounds state count and UTF-8 snapshot bytes, retaining the newest valid state',()=>{
    const a=fixture(),h=new WorkspaceHistory(a);
    for(let i=0;i<40;i++)h.commit(editWorkspacePart(a,'animal','animal_body',{position:[i,0,0]}));
    expect(h.retainedStates).toBeLessThanOrEqual(30);expect(h.retainedBytes).toBeLessThanOrEqual(8*1024*1024);
    expect(h.current.assets[0].source.parts[0].position[0]).toBe(39);
  });
  it('rejects a failed commit before mutating the current state or redo branch',()=>{
    const a=fixture(),h=new WorkspaceHistory(a);h.commit(editWorkspacePart(a,'animal','animal_body',{color:'#123456'}));h.undo();
    const broken=structuredClone(a);broken.assets.push(structuredClone(a.assets[0]));
    expect(()=>h.commit(broken)).toThrow('duplicate-asset');expect(h.canRedo).toBe(true);expect(h.current).toEqual(a);
  });
  it('evicts snapshots by bytes before reaching the state count cap',()=>{
    const a=fixture(),g=a.assets[0].source.groups[0];g.count=3000;
    g.overrides=Object.fromEntries(Array.from({length:3000},(_,i)=>[`${g.id}/${String(i).padStart(6,'0')}`,{params:{color:'#aabbcc'},position:[i/100,0,0]}]));
    const h=new WorkspaceHistory(a);
    for(let i=0;i<20;i++)h.commit(editWorkspacePart(a,'animal','animal_body',{position:[i,0,0]}));
    expect(h.retainedStates).toBeLessThan(20);expect(h.retainedBytes).toBeLessThanOrEqual(8*1024*1024);
    expect(h.current.assets[0].source.groups[0].overrides).toEqual(g.overrides);
  });
});
