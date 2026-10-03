import { surfaceGearPack } from '../examples/domain-packs/surface-gear-pack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {inspectMeshExport} from './engine/mesh-export-policy';
import ElementEditor from './ElementEditor';
import { bearingPack } from './engine/bearing-pack';
import { gearPack } from './engine/gear-pack';
import { createElementDomainRegistry } from './engine/element-domain-packs';
import { serializeProject, type ElementProject, type Vec3 } from './engine/element-project';
import { appendWorkspaceAsset, buildWorkspaceScene, generateWorkspaceAsset, parseWorkspace, serializeWorkspace, validateWorkspace, WorkspaceHistory, type ElementWorkspace } from './engine/element-workspace';
import { analyzeTopology } from './engine/topology';

const registry=createElementDomainRegistry();registry.register(bearingPack);registry.register(gearPack);registry.register(surfaceGearPack);
const empty=():ElementWorkspace=>({schema:'morphloom.workspace/0.1',units:'mm',coordinates:'right-handed-y-up',assets:[]});
function initial():ElementWorkspace{
  return appendWorkspaceAsset(empty(),generateWorkspaceAsset(registry,{id:'animal',packId:'morphloom.fur',input:{seed:17},requiredCapabilities:['semantic-part-editing','selected-scene-export'],positionMm:[-100,0,0],rotationRad:[0,0,0]}));
}
function download(data:Blob,name:string):void{const url=URL.createObjectURL(data);const a=document.createElement('a');a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function WorkspaceEditor():React.JSX.Element{
  const [workspace,setWorkspace]=useState(initial),[activeId,setActiveId]=useState('animal'),[loadRevision,setLoadRevision]=useState(0);
  const [initialHistory]=useState(()=>new WorkspaceHistory(workspace));const history=useRef(initialHistory);
  const [pack,setPack]=useState('mechanical.bearing.visual'),[instanceId,setInstanceId]=useState('bearing'),[inputs,setInputs]=useState<Record<string,number>>({});
  const [position,setPosition]=useState<Vec3>([100,0,0]),[rotation,setRotation]=useState<Vec3>([0,0,0]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const current=useRef(workspace);current.current=workspace;
  const exportBusy=useRef(false),loadTicket=useRef(0),mounted=useRef(true);
  useEffect(() => { mounted.current=true; return () => { mounted.current=false;loadTicket.current++; }; }, []);
  const pickAsset=useCallback((id:string):void=>{loadTicket.current++;setActiveId(id);},[]);
  const meta=registry.list().find(p=>p.id===pack)!,active=workspace.assets.find(a=>a.id===activeId);
  const receive=useCallback((source:ElementProject):void=>{
    try{
      const w=current.current,old=w.assets.find(a=>a.id===activeId);if(!old||serializeProject(old.source)===serializeProject(source))return;
      const next=validateWorkspace({...w,assets:w.assets.map(a=>a.id===activeId?{...a,source:structuredClone(source)}:a)});
      loadTicket.current++;history.current.commit(next);current.current=next;setWorkspace(next);setError('');
    }catch(e){setError(`Workspace update rejected: ${String(e)}`);setLoadRevision(n=>n+1);}
  },[activeId]);
  const append=():void=>{try{
    const a=generateWorkspaceAsset(registry,{id:instanceId,packId:pack,input:inputs,requiredCapabilities:['semantic-part-editing','selected-scene-export'],positionMm:position,rotationRad:rotation});
    const next=appendWorkspaceAsset(current.current,a);history.current.commit(next);current.current=next;setWorkspace(next);setActiveId(a.id);setError('');loadTicket.current++;
  }catch(e){setError(String(e));}};
  const travel=(kind:'undo'|'redo'):void=>{try{
    const next=history.current[kind]();current.current=next;setWorkspace(next);
    if(!next.assets.some(a=>a.id===activeId))setActiveId(next.assets[0]?.id??'');
    loadTicket.current++;setLoadRevision(n=>n+1);setError('');
  }catch(e){setError(String(e));}};
  const exportAll=async(diagnostic=false):Promise<void>=>{
    if(exportBusy.current)return;exportBusy.current=true;setBusy(true);const captured=current.current;
    let built:ReturnType<typeof buildWorkspaceScene>|undefined;
    try{
      built=buildWorkspaceScene(captured,'detail',true);if(!analyzeTopology(built.root).pass)throw new Error('Topology gate failed');
      const sourceJson=serializeWorkspace(captured);
      const data=await new GLTFExporter().parseAsync(built.root,{binary:true,onlyVisible:false});
      const uvReceipt=await inspectMeshExport(data as ArrayBuffer,sourceJson,diagnostic?'diagnostic':'editable-mesh');const uvJson=JSON.stringify(uvReceipt);if(new Blob([uvJson]).size>20_000_000)throw new Error('UV report exceeds 20 MB budget');
      if(!mounted.current||current.current!==captured)return;
      download(new Blob([data as ArrayBuffer],{type:'model/gltf-binary'}),diagnostic?'morphloom-workspace-uv-diagnostic.glb':'morphloom-workspace.glb');
      download(new Blob([sourceJson],{type:'application/json'}),'morphloom-workspace.json');
      download(new Blob([uvJson],{type:'application/json'}),'morphloom-workspace-uv-quality.json');setError('');
    }catch(e){if(mounted.current&&current.current===captured)setError(String(e));}finally{built?.dispose();exportBusy.current=false;if(mounted.current)setBusy(false);}
  };
  const vector=(label:string,value:Vec3,change:(v:Vec3)=>void):React.JSX.Element=><fieldset><legend>{label}</legend>{value.map((v,i)=><label key={i}>{['X','Y','Z'][i]}<input aria-label={`${label} ${['X','Y','Z'][i]}`} type="number" step="0.1" value={v} onChange={e=>{const next=[...value] as Vec3;next[i]=e.currentTarget.valueAsNumber;change(next);}}/></label>)}</fieldset>;
  return <div onClickCapture={e => { if (e.target instanceof Element && e.target.closest('button')) loadTicket.current++; }} onChangeCapture={e => { if (!(e.target instanceof HTMLInputElement && e.target.type === 'file')) loadTicket.current++; }}><section style={{padding:16,font:'14px system-ui'}} aria-label="Workspace actions">
    <h1>Mixed workspace · experimental</h1><p>Sources keep their own seed, IDs and edits. Explicit mm / right-handed Y-up datums affect the derived viewport and combined GLB. Workspace history spans assets; each source editor has a separate local undo session.</p>
    <button disabled={!history.current.canUndo} onClick={()=>travel('undo')}>Undo workspace</button><button disabled={!history.current.canRedo} onClick={()=>travel('redo')}>Redo workspace</button>
    <p>History: {history.current.retainedStates}/30 states · {history.current.retainedBytes} / 8388608 UTF-8 snapshot bytes. Reopening JSON starts a new history.</p>
    <label>Workspace asset<select aria-label="Workspace asset" value={activeId} onChange={e=>setActiveId(e.target.value)}>{workspace.assets.map(a=><option key={a.id} value={a.id}>{a.id} · {a.packId}</option>)}</select></label>
    <label>Append Domain Pack<select aria-label="Append Domain Pack" value={pack} onChange={e=>{setPack(e.target.value);setInputs({});}}>{registry.list().map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></label>
    <label>Instance ID<input aria-label="Instance ID" value={instanceId} onChange={e=>setInstanceId(e.target.value)}/></label>
    {Object.entries(meta.parameters.dimensions).map(([key,b])=><label key={key}>{key}<input aria-label={`Append ${key}`} type="number" min={b.min} max={b.max} value={inputs[key]??b.default} onChange={e=>setInputs(p=>({...p,[key]:e.currentTarget.valueAsNumber}))}/></label>)}
    {vector('New asset position (mm)',position,setPosition)}{vector('New asset rotation (rad)',rotation,setRotation)}
    <button onClick={append}>Append asset</button><button onClick={()=>{try{download(new Blob([serializeWorkspace(workspace)],{type:'application/json'}),'morphloom-workspace.json');}catch(e){setError(String(e));}}}>Save workspace JSON</button>
    <label>Load workspace JSON<input aria-label="Load workspace JSON" type="file" accept=".json" onChange={async e=>{
      const el=e.currentTarget,ticket=++loadTicket.current;try{const f=el.files?.[0];el.value='';if(!f)return;if(f.size>2_000_000)throw new Error('File exceeds 2 MB');const next=parseWorkspace(await f.text());if(ticket!==loadTicket.current)return;history.current=new WorkspaceHistory(next);current.current=next;setWorkspace(next);setActiveId(next.assets[0]?.id??'');setLoadRevision(n=>n+1);setError('');}catch(err){if(ticket===loadTicket.current)setError(String(err));}
    }}/></label><button disabled={busy||!workspace.assets.length} onClick={()=>{void exportAll();}}>Export workspace GLB + JSON</button>
    <p role="alert">{error}</p>
  <button disabled={busy} onClick={()=>{void exportAll(true);}}>Export workspace UV diagnostic GLB + source JSON</button>
</section>{active&&<ElementEditor key={`${loadRevision}:${active.id}`} initialProject={active.source} workspace={workspace} activeAsset={active.id} onAssetPick={pickAsset} onProjectChange={receive}/>}</div>;
}
