import {deterministicEulerXYZ} from './deterministic-rotation';
import * as THREE from 'three';
import { type ElementDomainRegistry } from './element-domain-packs';
import { editPart, resolveElements, validateProject, type ElementProject, type Part, type Vec3 } from './element-project';
import { buildElementScene, exportSelectedScene } from './element-renderer';

export const WORKSPACE_REVISION='morphloom.workspace-engine/0.3';
export type WorkspaceAsset={id:string;packId:string;requiredCapabilities:string[];source:ElementProject;positionMm:Vec3;rotationRad:Vec3};
export type ElementWorkspace={schema:'morphloom.workspace/0.1';units:'mm';coordinates:'right-handed-y-up';assets:WorkspaceAsset[]};
export type WorkspaceRequest=Omit<WorkspaceAsset,'source'> & {input:unknown};
function fail(code:string):never{throw new Error(`workspace:${code}`);}
const plain=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
function keys(v:unknown, expected:string[]):asserts v is Record<string,unknown>{
  if(!plain(v)||Object.keys(v).length!==expected.length||expected.some(k=>!Object.hasOwn(v,k)))fail('fields');
}
function vector(v:unknown,max:number):void{
  if(!Array.isArray(v)||v.length!==3||v.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>max))fail('transform');
}
function descriptor(a:Record<string,unknown>):void{
  if(typeof a.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(a.id)||typeof a.packId!=='string'||a.packId.length<1||a.packId.length>128)fail('id');
  if(!Array.isArray(a.requiredCapabilities)||a.requiredCapabilities.length>32||new Set(a.requiredCapabilities).size!==a.requiredCapabilities.length||a.requiredCapabilities.some(c=>typeof c!=='string'||c.length<1||c.length>128))fail('capabilities');
  vector(a.positionMm,1_000_000);vector(a.rotationRad,2*Math.PI);
}
/** Validates stored provenance, not a claim that a currently installed provider verified it. */
export function validateWorkspace(value:unknown):ElementWorkspace{
  keys(value,['schema','units','coordinates','assets']);
  if(value.schema!=='morphloom.workspace/0.1'||value.units!=='mm'||value.coordinates!=='right-handed-y-up')fail('contract');
  if(!Array.isArray(value.assets)||value.assets.length>16)fail('asset-budget');
  const ids=new Set<string>();let parts=0,elements=0;
  for(const asset of value.assets){
    keys(asset,['id','packId','requiredCapabilities','source','positionMm','rotationRad']);descriptor(asset);
    if(ids.has(asset.id as string))fail('duplicate-asset');ids.add(asset.id as string);
    const source=validateProject(asset.source);
    parts+=source.parts.length;elements+=source.groups.reduce((n,g)=>n+g.count,0)+source.elements.filter(e=>!e.original).length;
  }
  if(parts>256||elements>5000)fail('aggregate-budget');
  // This is also a bounded embedded-source container, not an unlimited scene database.
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>2_000_000)fail('json-budget');
  return value as unknown as ElementWorkspace;
}
export function generateWorkspaceAsset(registry:ElementDomainRegistry,request:WorkspaceRequest):WorkspaceAsset{
  keys(request,['id','packId','requiredCapabilities','input','positionMm','rotationRad']);descriptor(request);
  const {input,...meta}=structuredClone(request);
  const source=registry.generate(meta.packId,input,meta.requiredCapabilities);
  return validateWorkspace({schema:'morphloom.workspace/0.1',units:'mm',coordinates:'right-handed-y-up',assets:[{...meta,source}]}).assets[0];
}
export function appendWorkspaceAsset(workspace:ElementWorkspace,asset:WorkspaceAsset):ElementWorkspace{
  validateWorkspace(workspace);
  return validateWorkspace({...structuredClone(workspace),assets:[...structuredClone(workspace.assets),structuredClone(asset)]});
}
export function editWorkspacePart(workspace:ElementWorkspace,assetId:string,partId:string,patch:Partial<Part>):ElementWorkspace{
  validateWorkspace(workspace);const next=structuredClone(workspace), asset=next.assets.find(a=>a.id===assetId);
  if(!asset)fail('missing-asset');asset.source=editPart(asset.source,partId,patch);return validateWorkspace(next);
}
export function serializeWorkspace(workspace:ElementWorkspace):string{
  validateWorkspace(workspace);
  const text=JSON.stringify(workspace,(_key,value:unknown)=>plain(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value,2);
  if(new TextEncoder().encode(text).byteLength>2_000_000)fail('json-budget');
  return text;
}
export function parseWorkspace(text:string):ElementWorkspace{
  if(new TextEncoder().encode(text).byteLength>2_000_000)fail('json-budget');return validateWorkspace(JSON.parse(text));
}

/** Budget measures encoded snapshots; runtime object and renderer memory are separate. */
export class WorkspaceHistory{
  private states:{text:string;bytes:number}[];
  private index=0;
  constructor(initial:ElementWorkspace){const text=serializeWorkspace(initial);this.states=[{text,bytes:new TextEncoder().encode(text).byteLength}];}
  get current():ElementWorkspace{return parseWorkspace(this.states[this.index].text);}
  get canUndo():boolean{return this.index>0;}
  get canRedo():boolean{return this.index<this.states.length-1;}
  get retainedStates():number{return this.states.length;}
  get retainedBytes():number{return this.states.reduce((n,s)=>n+s.bytes,0);}
  commit(workspace:ElementWorkspace):void{
    // Serialization and all failure checks precede mutation, including branch removal.
    const text=serializeWorkspace(workspace);if(text===this.states[this.index].text)return;
    const next=this.states.slice(0,this.index+1);next.push({text,bytes:new TextEncoder().encode(text).byteLength});
    let bytes=next.reduce((n,s)=>n+s.bytes,0);
    while(next.length>30||bytes>8*1024*1024)bytes-=next.shift()!.bytes;
    this.states=next;this.index=next.length-1;
  }
  undo():ElementWorkspace{if(this.canUndo)this.index--;return this.current;}
  redo():ElementWorkspace{if(this.canRedo)this.index++;return this.current;}
}

/** Original IR remains separate; datum transforms belong only to the derived scene. */
export function buildWorkspaceScene(workspace:ElementWorkspace,lod:'low'|'detail',delivery=false):ReturnType<typeof buildElementScene>{
  validateWorkspace(workspace);
  if(delivery&&workspace.assets.reduce((n,a)=>n+a.source.parts.length+resolveElements(a.source).length,0)>128)fail('export-object-budget');
  const start=performance.now(),root=new THREE.Group(),built:{id:string;scene:ReturnType<typeof buildElementScene>}[]=[];
  const stats={elements:0,visibleElements:0,triangles:0,drawCallsEstimate:0,geometryBytes:0,generationMs:0};
  root.name='Morphloom workspace';root.userData={representation:'source-preserving workspace',workspaceRevision:WORKSPACE_REVISION,sourceSpec:structuredClone(workspace)};
  let disposed=false;
  const dispose=():void=>{if(disposed)return;disposed=true;for(const b of built)b.scene.dispose();root.clear();};
  try{
    for(const a of workspace.assets){
      const scene=delivery?exportSelectedScene(a.source,[...a.source.parts.map(p=>p.id),...resolveElements(a.source).map(e=>e.id)]):buildElementScene(a.source,lod);
      built.push({id:a.id,scene});
      scene.root.traverse(o=>{if(o!==scene.root&&o.name){o.userData={...o.userData,sourceLocalName:o.name,assetId:a.id};o.name=`${a.id}::${o.name}`;}});
      scene.root.name=a.id;scene.root.position.set(...a.positionMm.map(n=>n/1000) as Vec3);scene.root.quaternion.copy(deterministicEulerXYZ(a.rotationRad));root.add(scene.root);
      for(const key of ['elements','visibleElements','triangles','drawCallsEstimate','geometryBytes'] as const)stats[key]+=scene.stats[key];
      if(stats.triangles>2_000_000||stats.drawCallsEstimate>128)fail('render-budget');
    }
    stats.generationMs=performance.now()-start;
    return {root,stats,dispose,pickId(hit){for(const b of built){let parent:THREE.Object3D|null=hit.object;while(parent&&parent!==b.scene.root)parent=parent.parent;if(parent){const local=b.scene.pickId(hit);return local?`${b.id}::${local}`:undefined;}}return undefined;}};
  }catch(error){dispose();throw error;}
}
