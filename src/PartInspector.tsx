import React, { useState } from 'react';
import type { Part, Vec3 } from './engine/element-project';
import {gearChamferMaximum} from './engine/gear-chamfer';
import { toothIds } from './engine/spur-gear';

export function PartInspector({part, version2, version4=false, version5=false, version6=false, apply, action,featureId='',onFeatureSelect,exportFeature}: {
  part:Part; version2:boolean; version4?:boolean; version5?:boolean; version6?:boolean; apply:(patch:Partial<Part>)=>void; action:(kind:'visibility'|'lock'|'detach')=>void;featureId?:string;onFeatureSelect?:(id:string)=>void;exportFeature?:(id:string)=>void
}): React.JSX.Element {
  const [draft,setDraft]=useState(()=>structuredClone(part));
  const number=(label:string,value:number,change:(n:number)=>void,min=-1_000_000,max=1_000_000,step=0.1):React.JSX.Element=>
    <label style={{display:'block'}}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={value}
      onChange={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n))change(n);}} disabled={part.locked}/></label>;
  const vector=(key:'position'|'rotation'|'scale',label:string,unit:string):React.JSX.Element=>
    <fieldset><legend>{label} ({unit})</legend>{draft[key].map((v,i)=><React.Fragment key={i}>{number(`${label} ${['X','Y','Z'][i]}`,v,n=>setDraft(p=>{
      const next=[...p[key]] as Vec3;next[i]=n;return {...p,[key]:next};
    }),key==='scale'?0.01:key==='rotation'?-Math.PI*2:-1_000_000,key==='scale'?(part.geometry?100:100_000):key==='rotation'?Math.PI*2:1_000_000)}</React.Fragment>)}</fieldset>;
  const dirty=JSON.stringify(draft)!==JSON.stringify(part);
  return <>
    <p>{part.assemblyId ? `Assembly: ${part.assemblyId} · identity datum` : part.home?.assemblyId ? `Extracted from ${part.home.assemblyId}` : 'Independent part'}</p>
    {vector('position','Position','mm')}{vector('scale','Scale',part.geometry?'multiplier':'mm')}{vector('rotation','Rotation','rad')}
    <label>Color<input aria-label="Color" type="color" value={draft.color} disabled={part.locked} onChange={e=>setDraft(p=>({...p,color:e.target.value}))}/></label>
    {version2 && <fieldset><legend>PBR appearance</legend>
      {number('Part roughness',draft.material?.roughness??0.8,n=>setDraft(p=>({...p,material:{roughness:n,metalness:p.material?.metalness??0}})),0,1,0.01)}
      {number('Part metalness',draft.material?.metalness??0,n=>setDraft(p=>({...p,material:{roughness:p.material?.roughness??0.8,metalness:n}})),0,1,0.01)}
    </fieldset>}
    {version6 && <fieldset><legend>Authored surface appearance</legend><label>Roughness surface finish<select aria-label="Roughness surface finish" value={draft.material?.surface?.finish??'none'} disabled={part.locked} onChange={e=>setDraft(p=>{const material={roughness:p.material?.roughness??.8,metalness:p.material?.metalness??0,...p.material};if(e.target.value==='none'){delete material.surface;return {...p,material};}return {...p,material:{...material,surface:{finish:e.target.value as 'brushed-metal'|'bead-blasted-metal'|'anodized-metal',channels:'roughness-only',repeat:p.material?.surface?.repeat??[8,8]}}};})}><option value="none">No procedural surface</option><option value="brushed-metal">Directional roughness (brushed-metal recipe)</option><option value="bead-blasted-metal">Bead-blasted roughness recipe</option><option value="anodized-metal">Anodized roughness recipe</option></select></label>
    {draft.material?.surface&&(['U','V'] as const).map((axis,i)=><React.Fragment key={axis}>{number(`Surface repeat ${axis}`,draft.material!.surface!.repeat[i],n=>setDraft(p=>{if(!p.material?.surface)return p;const repeat=[...p.material.surface.repeat] as [number,number];repeat[i]=n;return {...p,material:{...p.material,surface:{...p.material.surface,repeat}}};}),.125,1024,.125)}</React.Fragment>)}<p>Actual 64px roughness map only. Normal/tangent, anisotropy and photo projection are unsupported here. Repeat is per native UV tile; physical scale depends on UV mapping. Authored appearance, not measured material properties.</p></fieldset>}
    {version4 && <fieldset><legend>Native UV scale</legend>{number('UV scalar (dimensionless)',draft.uvScale??1,n=>setDraft(p=>({...p,uvScale:n})),.001,1000,.1)}<p>Multiplies native UV coordinates only. 1 restores native mapping; no atlas, padding or texel density guarantee.</p></fieldset>}
    {draft.geometry?.op==='sphere' && <fieldset><legend>Sphere geometry</legend>
      {number('Ball radius (mm)',draft.geometry.radius,n=>setDraft(p=>p.geometry?.op==='sphere'?{...p,geometry:{...p.geometry,radius:n}}:p),0.01,10_000,0.01)}
    </fieldset>}
    {draft.geometry?.op==='lathe' && <details><summary>Lathe profile (radius / Y in mm)</summary>
      <p>Closed profile; endpoints stay linked. Invalid edits are rejected on Apply.</p>
      {draft.geometry.profile.map((point,i)=><fieldset key={i}><legend>Point {i}</legend>{point.map((v,j)=><React.Fragment key={j}>{number(`Profile ${i} ${j===0?'radius':'Y'} (mm)`,v,n=>setDraft(p=>{
        if(p.geometry?.op!=='lathe')return p;const profile=p.geometry.profile.map(q=>[...q] as [number,number]);profile[i][j]=n;
        if(i===0)profile[profile.length-1]=[...profile[0]];if(i===profile.length-1)profile[0]=[...profile[i]];
        return {...p,geometry:{...p.geometry,profile}};
      }),j===0?0.01:-10_000,10_000,0.01)}</React.Fragment>)}</fieldset>)}
    </details>}
    {draft.geometry?.op==='extrude' && <p>Declared extrude: {draft.geometry.holes?.length??0} real through holes. Pockets regenerate from the Domain Pack inputs.</p>}
    {version5 && draft.geometry?.op==='spur-gear' && <fieldset><legend>Axial chamfer (mm)</legend>{number('Gear axial chamfer (mm)',draft.axialChamferMm??0,n=>setDraft(p=>({...p,axialChamferMm:n})),0,gearChamferMaximum(draft.geometry),.001)}<p>0 restores sharp geometry. Positive minimum 0.001 mm; maximum {gearChamferMaximum(draft.geometry).toPrecision(4)} mm. Actual topology failure rejects Apply. Source visualization; no manufacturing approval.</p></fieldset>}
    {draft.geometry?.op==='spur-gear' && <fieldset><legend>Spur gear parameters</legend>
      {(['moduleMm','toothCount','pressureAngleDeg','faceWidthMm','boreDiameterMm'] as const).map(key=><React.Fragment key={key}>{number(`Gear ${key}`,draft.geometry?.op==='spur-gear'?draft.geometry[key]:0,n=>setDraft(p=>p.geometry?.op==='spur-gear'?{...p,geometry:{...p.geometry,[key]:n}}:p),key==='toothCount'?18:key==='pressureAngleDeg'?20:0,key==='toothCount'?64:key==='pressureAngleDeg'?25:key==='moduleMm'?5:300,key==='toothCount'?1:0.1)}</React.Fragment>)}
      <p>Connected tooth features; radial root approximation. Nonstandard local tooth edits are for visualization, not meshing approval.</p>
      <label>Connected feature ID<select aria-label="Connected feature ID" value={featureId} onChange={e=>onFeatureSelect?.(e.target.value)}><option value="">Select a feature</option>{toothIds(draft.geometry).map(id=><option key={id} value={id}>{part.id}/{id}</option>)}</select></label>
      {featureId && toothIds(draft.geometry).includes(featureId) && number('Tooth addendum multiplier',draft.geometry.toothOverrides?.[featureId]?.addendumScale??1,n=>setDraft(p=>p.geometry?.op==='spur-gear'?{...p,geometry:{...p.geometry,toothOverrides:{...p.geometry.toothOverrides,[featureId]:{addendumScale:n}}}}:p),0.9,1.1,0.01)}
      <button disabled={!!part.axialChamferMm||!featureId||dirty||!toothIds(draft.geometry).includes(featureId)} onClick={()=>exportFeature?.(featureId)}>Export diagnostic tooth cut</button><p>{part.axialChamferMm?'Chamfered diagnostic tooth cuts are unsupported; set chamfer to 0 or export the whole gear. ':''}Exports a closed sector copy; does not detach or remove the tooth. Apply pending edits before export.</p>
    </fieldset>}
    <p>{dirty?'Pending part changes':'No pending changes'}</p>
    <button disabled={!dirty||part.locked} onClick={()=>apply({position:draft.position,rotation:draft.rotation,scale:draft.scale,color:draft.color,
      ...(draft.axialChamferMm!==undefined?{axialChamferMm:draft.axialChamferMm}:{}),...(draft.uvScale!==undefined?{uvScale:draft.uvScale}:{}),...(draft.geometry?{geometry:draft.geometry}:{}),...(draft.material?{material:draft.material}:{})})}>Apply part edit</button>
    <button disabled={!dirty} onClick={()=>setDraft(structuredClone(part))}>Cancel edit</button>
    <button onClick={()=>action('visibility')}>{part.visible?'Hide':'Show'}</button>
    <button onClick={()=>action('lock')}>{part.locked?'Unlock':'Lock'}</button>
    <button disabled={part.locked} onClick={()=>action('detach')}>{part.home?'Restore part':'Extract part'}</button>
    {part.home && <p>Restore recovers the saved assembly position and membership. Detached position/rotation edits are discarded; geometry and PBR edits stay.</p>}
  </>;
}
