import {useEffect,useRef,useState} from 'react';
import type {AssemblyIR,AssemblyComponentIR} from './engine/assembly-ir';
import {applyAssemblyComponentPatch,fingerprintAssemblyIR,type AssemblyComponentPatch} from './engine/assembly-edit';
import {validateAssemblyIR} from './engine/assembly-compiler';
import {inferSurfaceFinish,SURFACE_LIBRARY} from './engine/surface-system';
import {migrateReferenceProjectionOrientation} from './engine/reference-projection-orientation';
interface Draft {position:string[];scale:string[];roughness:string;metalness:string;direction:'legacy'|'positive'|'negative';flipU:boolean;capFlat:boolean;capOutward:boolean;curveEnabled:boolean;controlPoint:string[]}
function draftFor(c:AssemblyComponentIR):Draft {
 const tube=c.geometry.op==='tube'?c.geometry:undefined;
 const control=tube?.curve?.controlPointMm??(tube?.points.length===2?tube.points[0]!.map((v,i)=>(v+tube.points[1]![i]!)/2):[0,0,0]);
 const recipe=SURFACE_LIBRARY[inferSurfaceFinish(c.materialName,c.material.surface)],orientation=c.material.referenceProjection?.orientation;
 return {capFlat:tube?.capFinish==='flat-outward',capOutward:tube?.capWinding==='outward',curveEnabled:Boolean(tube?.curve),controlPoint:control.map(String),position:(c.position??[0,0,0]).map(String),scale:(c.scale??[1,1,1]).map(String),roughness:String(c.material.roughness??recipe.roughness),metalness:String(c.material.metalness??recipe.metalness),direction:orientation?.direction??'legacy',flipU:orientation?.flipU??false};
}
export default function AssemblyComponentEditor({ir,selectedId,onCommit}:{ir:AssemblyIR;selectedId?:string;onCommit:(next:AssemblyIR)=>void}) {
 const component=ir.components.find(c=>c.id===selectedId),latest=useRef(ir),alive=useRef(true),expected=useRef(ir),inFlight=useRef(false),selected=useRef(selectedId),history=useRef<AssemblyIR[]>([ir]),cursor=useRef(0);
 latest.current=ir;selected.current=selectedId;
 const draftSource=useRef<{ir:AssemblyIR;id?:string}>({ir, id:undefined});
 const [draft,setDraft]=useState<Draft>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[,refresh]=useState(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(ir!==expected.current){history.current=[ir];cursor.current=0;expected.current=ir;}draftSource.current={ir,id:component?.id};setDraft(component?draftFor(component):undefined);setError('');},[ir,component]);
 const commit=(next:AssemblyIR)=>{expected.current=next;history.current=history.current.slice(0,cursor.current+1);history.current.push(next);if(history.current.length>33)history.current.shift();cursor.current=history.current.length-1;onCommit(next);refresh(n=>n+1);};
 const move=(step:number)=>{const index=cursor.current+step;if(busy||index<0||index>=history.current.length)return;cursor.current=index;expected.current=history.current[index]!;onCommit(expected.current);refresh(n=>n+1);};
 const apply=async()=>{
  if(!component||!draft||inFlight.current)return;
  if(draftSource.current.ir!==ir||draftSource.current.id!==component.id){setError('초안의 원본/선택이 바뀌었습니다. 현재 부품을 다시 확인하세요.');return;}
  inFlight.current=true;const source=ir,initial=draftFor(component);setBusy(true);setError('');
  try{
   const number=(value:string,min:number,max:number)=>{const n=Number(value);if(!value.trim()||!Number.isFinite(n)||n<min||n>max)throw new Error(`숫자는 ${min}..${max} 범위여야 합니다.`);return n;};
   const position=draft.position.map(n=>number(n,-100000,100000)) as [number,number,number],scale=draft.scale.map(n=>number(n,.01,100)) as [number,number,number];
   const material:NonNullable<AssemblyComponentPatch['material']>={};if(draft.roughness!==initial.roughness)material.roughness=number(draft.roughness,0,1);if(draft.metalness!==initial.metalness)material.metalness=number(draft.metalness,0,1);
   const translate=position.map((n,i)=>n-(component.position??[0,0,0])[i]!) as [number,number,number],multiply=scale.map((n,i)=>n/(component.scale??[1,1,1])[i]!) as [number,number,number];
   const curveChanged=draft.curveEnabled!==initial.curveEnabled||(draft.curveEnabled&&JSON.stringify(draft.controlPoint)!==JSON.stringify(initial.controlPoint));
   const geometry:AssemblyComponentPatch['geometry']=curveChanged?(draft.curveEnabled?{operation:'tube-quadratic-control',action:'set',curve:{schema:'morphloom.tube-quadratic-bezier/0.1',controlPointMm:draft.controlPoint.map(n=>number(n,-100000,100000)) as [number,number,number]}}:{operation:'tube-quadratic-control',action:'clear'}):undefined;
   const patch:AssemblyComponentPatch={schema:geometry?'morphloom.component-patch/0.2':'morphloom.component-patch/0.1',...(geometry?{geometry}:{}),operationId:'ui-'+component.id,componentId:component.id,expectedInputFingerprint:await fingerprintAssemblyIR(source),...(translate.some(n=>n!==0)?{translateMm:translate}:{}),...(multiply.some(n=>n!==1)?{scaleMultiplier:multiply}:{}),...(Object.keys(material).length?{material}:{})};
   const scalarChange=patch.translateMm||patch.scaleMultiplier||patch.material||patch.geometry;
   let next=scalarChange?(await applyAssemblyComponentPatch(source,patch)).ir:source;
   if(draft.capOutward!==initial.capOutward){
    next=(await applyAssemblyComponentPatch(next,{schema:'morphloom.component-patch/0.2',operationId:'ui-cap-'+component.id,componentId:component.id,expectedInputFingerprint:await fingerprintAssemblyIR(next),geometry:{operation:'tube-cap-winding',action:draft.capOutward?'set':'clear'}})).ir;
   }
   if(draft.capFlat!==initial.capFlat){
    next=(await applyAssemblyComponentPatch(next,{schema:'morphloom.component-patch/0.2',operationId:'ui-flat-cap-'+component.id,componentId:component.id,expectedInputFingerprint:await fingerprintAssemblyIR(next),geometry:{operation:'tube-cap-finish',action:draft.capFlat?'set':'clear'}})).ir;
   }
   if(component.material.referenceProjection&&(draft.direction!==initial.direction||draft.flipU!==initial.flipU)){
    const projection=structuredClone(component.material.referenceProjection);if(draft.direction==='legacy')delete projection.orientation;
    const declared=draft.direction==='legacy'?projection:migrateReferenceProjectionOrientation(projection,draft.direction,draft.flipU);
    next={...next,components:next.components.map(c=>c.id===component.id?{...c,material:{...c.material,referenceProjection:declared}}:c)};
   }
   validateAssemblyIR(next);
   if(!alive.current)return;if(latest.current!==source||selected.current!==component.id)throw new Error('다른 파일/수정본이 로드되었습니다. 오래된 적용 결과를 버렸습니다.');
   if(next!==source)commit(next);
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Component edit failed');}finally{inFlight.current=false;if(alive.current)setBusy(false);}
 };
 const dirty=component&&draft&&JSON.stringify(draft)!==JSON.stringify(draftFor(component));
 return <section className="selected-part-card" aria-label="Assembly component editor"><span className="eyebrow">COMPONENT EDIT · MM</span>
 <button disabled={busy||cursor.current===0} onClick={()=>move(-1)}>Undo component edit</button><button disabled={busy||cursor.current>=history.current.length-1} onClick={()=>move(1)}>Redo component edit</button>
 {!component||!draft?<p>부품을 선택하면 수치와 사진 투영 방향을 편집할 수 있습니다.</p>:<><p>Stable ID: <b>{component.id}</b></p>
 {(['position','scale'] as const).map(key=><fieldset key={key}><legend>{key==='position'?'위치 (mm)':'크기 배율 (원래 부품 기준)'}</legend>{['X','Y','Z'].map((axis,i)=><label key={axis}>{key} {axis}<input aria-label={`Component ${key} ${axis}`} type="number" step={key==='position'?1:.01} value={draft[key][i]} disabled={busy} onChange={e=>setDraft(d=>d?{...d,[key]:d[key].map((n,j)=>i===j?e.target.value:n)}:d)}/></label>)}</fieldset>)}
 {(['roughness','metalness'] as const).map(key=><label key={key}>{key} (추정 appearance)<input aria-label={`Component ${key}`} type="number" min="0" max="1" step="0.01" disabled={busy} value={draft[key]} onChange={e=>setDraft(d=>d?{...d,[key]:e.target.value}:d)}/></label>)}
 {component.geometry.op==='tube'&&component.geometry.points.length===2&&!component.geometry.closed&&<fieldset><legend>Wire 곡선 · 부품 로컬 좌표 (mm)</legend><label><input aria-label="Enable quadratic tube curve" type="checkbox" checked={draft.curveEnabled} disabled={busy} onChange={e=>setDraft(d=>d?{...d,curveEnabled:e.target.checked}:d)}/>2차 Bezier 곡선 사용</label>{draft.curveEnabled&&['X','Y','Z'].map((axis,i)=><label key={axis}>제어점 {axis}<input aria-label={`Tube control ${axis} mm`} type="number" step="0.1" disabled={busy} value={draft.controlPoint[i]} onChange={e=>setDraft(d=>d?{...d,controlPoint:d.controlPoint.map((v,j)=>i===j?e.target.value:v)}:d)}/></label>)}<p>양 끝점은 유지됩니다. 제어점은 곡선이 통과하는 점이 아닙니다. 연결된 링·부품은 자동 이동하지 않습니다.</p></fieldset>}
 {component.geometry.op==='tube'&&!component.geometry.closed&&<fieldset><legend>Tube cap winding</legend><label><input aria-label="Explicit outward tube caps" type="checkbox" checked={draft.capOutward} disabled={busy} onChange={e=>setDraft(d=>d?{...d,capOutward:e.target.checked}:d)}/>Explicit outward caps</label><p>Positions and UV stay unchanged. Clearing restores existing path behavior. Bezier caps are already outward. Flat finish also uses outward faces while enabled.</p><label><input aria-label="Flat tube cap finish" type="checkbox" checked={draft.capFlat} disabled={busy} onChange={e=>setDraft(d=>d?{...d,capFlat:e.target.checked}:d)}/>Flat end normals and planar UV</label><p>Only cap rim vertices split. Cap UV charts intentionally overlap; this is not an atlas.</p></fieldset>}
 {component.material.referenceProjection&&<fieldset><legend>사진 투영 · 평면 대응은 추정</legend><label>Source-facing direction<select aria-label="Projection source direction" value={draft.direction} disabled={busy} onChange={e=>setDraft(d=>d?{...d,direction:e.target.value as Draft['direction']}:d)}><option value="legacy">기존 +축 · orientation 없음</option><option value="positive">명시적 +축</option><option value="negative">명시적 −축</option></select></label><label><input aria-label="Reflect source UV U" type="checkbox" disabled={busy||draft.direction==='legacy'} checked={draft.flipU} onChange={e=>setDraft(d=>d?{...d,flipU:e.target.checked}:d)}/>사진 면 U 반전 · 숨은 면 UV 보존</label><p>적용 시 선택 부품의 사진 면·UV가 변경됩니다. 원본 사진이나 다른 부품은 변경하지 않습니다.</p></fieldset>}
 <p>연결 부품/치수 계약은 자동으로 맞추지 않습니다. 적용 후 기존 품질 검사를 다시 확인하세요. Undo는 최대32단계이며 새 IR 로드 시 초기화됩니다.</p>
 <button disabled={busy||!dirty} onClick={()=>void apply()}>Apply component edit</button><button disabled={busy||!dirty} onClick={()=>{setDraft(draftFor(component));setError('');}}>Cancel component edit</button></>}
 {error&&<p role="alert">{error}</p>}</section>;
}
