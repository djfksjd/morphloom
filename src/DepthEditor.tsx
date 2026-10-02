import {useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {compileDepthSurface, migrateDepthSurface, migrateDepthSurfaceMeshing, validateDepthSurfaceSource, type DepthSurfaceSource} from './engine/depth-surface';
import {validateGlbStandard} from './engine/gltf-standard-validation';
import {ViewportErrorBoundary} from './components/ViewportErrorBoundary';
import './depth-editor.css';

function download(data:Blob,name:string) {
 const url=URL.createObjectURL(data),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Preview({geometry,mode,view}:{geometry?:THREE.BufferGeometry;mode:string;view:string}) {
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const target=host.current;if(!target||!geometry)return;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#dededb');
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));target.append(renderer.domElement);
  const pixels=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4,grey=(Math.floor(x/8)+Math.floor(y/8))%2?60:230;pixels.set([grey,grey,grey,255],i);}
  const checker=new THREE.DataTexture(pixels,64,64);checker.needsUpdate=true;checker.magFilter=THREE.NearestFilter;checker.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshStandardMaterial({color:mode==='checker'?'#ffffff':'#a7a7a7',roughness:.75,metalness:0,
   side:THREE.DoubleSide,wireframe:mode==='wire',map:mode==='checker'?checker:null});
  const owned=geometry.clone(),mesh=new THREE.Mesh(owned,material);scene.add(mesh,new THREE.HemisphereLight(0xffffff,0x777777,2));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-1,2,3);scene.add(light);
  const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3()),extent=Math.max(...box.getSize(new THREE.Vector3()).toArray(),.001);
  const camera=new THREE.PerspectiveCamera(35,1,.0001,Math.max(20,extent*20));
  camera.position.copy(center).add(new THREE.Vector3(view==='iso'?extent:0,view==='iso'?extent*.6:0,extent*2.8));
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(center);controls.update();
  const render=()=>renderer.render(scene,camera);
  const resize=()=>{const w=target.clientWidth,h=target.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();};
  controls.addEventListener('change',render);const observer=new ResizeObserver(resize);observer.observe(target);resize();
  return()=>{observer.disconnect();controls.removeEventListener('change',render);controls.dispose();owned.dispose();material.dispose();checker.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 },[geometry,mode,view]);
 return <div className="depth-canvas" ref={host} aria-label="Inferred open surface preview"/>;
}
export default function DepthEditor() {
 const [history,setHistory]=useState<DepthSurfaceSource[]>([]),[cursor,setCursor]=useState(0),[error,setError]=useState('');
 const [diagnostic,setDiagnostic]=useState(false),[mode,setMode]=useState('clay'),[view,setView]=useState('front'),[busy,setBusy]=useState(false);
 const [qualityDraft,setQualityDraft]=useState({near:'',far:'',envelopeTolerance:'',band:'2',boundaryTolerance:'',anchors:'',basis:'user-measured'});
 const [meshTolerance,setMeshTolerance]=useState('.02');
 const [draft,setDraft]=useState({frame:'',camera:'',stride:'2'});
 const current=history[cursor],active=useRef(current),diagnosticRef=useRef(diagnostic),mounted=useRef(true),loadToken=useRef(0);active.current=current;diagnosticRef.current=diagnostic;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadToken.current++;};},[]);
 useEffect(()=>{if(current)setMeshTolerance(String(current.meshing?.maxSagittaMm??Math.min(.02,(current.primaryForm?.radiusMm??60)/3000)));},[current]);
 useEffect(()=>{if(!current)return;const e=current.quality?.depthEnvelope,b=current.quality?.boundary;
  setQualityDraft({near:e?.status==='declared'?String(e.nearMm):'',far:e?.status==='declared'?String(e.farMm):'',envelopeTolerance:e?.status==='declared'?String(e.toleranceMm):'',band:b?.status==='declared'?String(b.bandPixels):'2',boundaryTolerance:b?.status==='declared'?String(b.toleranceMm):'',anchors:b?.status==='declared'?b.anchors.map(a=>`${a.pixel%current.width},${Math.floor(a.pixel/current.width)},${a.depthMm}`).join('\n'):'',basis:e?.status==='declared'?e.basis:'user-measured'});
 },[current]);
 useEffect(()=>{if(current)setDraft({frame:current.camera.frameMm.join(', '),camera:String(current.camera.cameraZMm),stride:String(current.stride)});},[current]);
 const compiled=useMemo(()=>{if(!current)return undefined;try{return compileDepthSurface(current,{diagnostic});}catch(e){return {error:e instanceof Error?e.message:'Invalid depth source'};}},[current,diagnostic]);
 useEffect(()=>()=>{if(compiled&&'geometry' in compiled)compiled.geometry.dispose();},[compiled]);
 const load=async(file:File)=>{
  const token=++loadToken.current;
  try{if(file.size<1||file.size>8*1024*1024)throw new Error('Depth JSON must be 1 byte..8MiB.');const input:unknown=JSON.parse(await file.text());validateDepthSurfaceSource(input);
   if(!mounted.current||token!==loadToken.current)return;setHistory([input]);setCursor(0);setDiagnostic(input.preview==='declared-sphere-front');setError('');
  }catch(e){if(mounted.current&&token===loadToken.current)setError(e instanceof Error?e.message:'Invalid depth JSON');}
 };
 const commit=(next:DepthSurfaceSource)=>{const items=[...history.slice(0,cursor+1),next].slice(-16);setHistory(items);setCursor(items.length-1);};
 const declareQuality=()=>{if(!current||current.schema==='morphloom.depth-surface/0.1')return;try{
  const q=qualityDraft;if([q.near,q.far,q.envelopeTolerance,q.band,q.boundaryTolerance,q.anchors].some(v=>!v.trim()))throw new Error('Enter confirmed mm range, tolerances and independent boundary anchors.');
  const lines=q.anchors.trim().split('\n');if(lines.length>512)throw new Error('Maximum 512 boundary anchors.');
  const anchors=lines.map((line,i)=>{const fields=line.split(',');if(fields.length!==3||fields.some(v=>!v.trim()))throw new Error('Boundary CSV requires x,y,depthMm.');const [x,y,depthMm]=fields.map(Number);if(!Number.isInteger(x)||!Number.isInteger(y)||x!<0||x!>=current.width||y!<0||y!>=current.height)throw new Error('Boundary pixel coordinates are outside source image.');return {id:`boundary-user-${i}`,pixel:y!*current.width+x!,depthMm:depthMm!};});
  const basis=q.basis as 'user-measured'|'authored-fixture';const next:DepthSurfaceSource={...current,quality:{depthEnvelope:{status:'declared',nearMm:Number(q.near),farMm:Number(q.far),toleranceMm:Number(q.envelopeTolerance),basis},boundary:{status:'declared',bandPixels:Number(q.band),toleranceMm:Number(q.boundaryTolerance),basis,anchors}}};
  validateDepthSurfaceSource(next);commit(next);setDiagnostic(true);setError('');
 }catch(e){setError(e instanceof Error?e.message:'Invalid depth declaration');}};
 const applyContinuous=(enabled:boolean)=>{if(!current)return;try{
  if(!enabled){const next={...current};delete next.meshing;commit(next);setError('');return;}
  if(!meshTolerance.trim())throw new Error('Enter an explicit curvature tolerance in mm.');
  const next=migrateDepthSurfaceMeshing(current);next.preview='declared-sphere-front';next.meshing={schema:'morphloom.depth-meshing/0.1',mode:'declared-sphere-front',maxSagittaMm:Number(meshTolerance)};
  const check=compileDepthSurface(next,{diagnostic:true});check.geometry.dispose();if(!check.report.meshing?.validationPass)throw new Error('실제 메시 깊이/전경 coverage 검증 실패: 기존 격자 상태를 보존합니다.');commit(next);setDiagnostic(true);setError('');
 }catch(e){setError(e instanceof Error?e.message:'Invalid continuous boundary');}};
 const apply=()=>{if(!current)return;try{
  if(!draft.camera.trim()||!draft.stride.trim()||draft.frame.split(',').some(n=>!n.trim()))throw new Error('Enter explicit numeric camera parameters.');
  const frame=draft.frame.split(',').map(Number);if(frame.length!==4)throw new Error('Frame requires left,right,bottom,top in mm.');
  const next={...current,camera:{...current.camera,frameMm:frame as [number,number,number,number],cameraZMm:Number(draft.camera)},stride:Number(draft.stride)};
  const check=compileDepthSurface(next,{diagnostic});check.geometry.dispose();const nextHistory=[...history.slice(0,cursor+1),next].slice(-16);setHistory(nextHistory);setCursor(nextHistory.length-1);setError('');
 }catch(e){setError(e instanceof Error?e.message:'Invalid edit');}};
 const exportDiagnostic=async()=>{
  if(!current||busy||!compiled||!('geometry' in compiled))return;setBusy(true);const before=current;
  const root=new THREE.Group();root.name='depth-reference';root.userData={purpose:'diagnostic',releaseAllowed:false,originalRepresentation:'relative-depth-field'};
  const material=new THREE.MeshStandardMaterial({color:'#a7a7a7',roughness:.75,side:THREE.DoubleSide});const geometry=compiled.geometry.clone(),mesh=new THREE.Mesh(geometry,material);mesh.name=current.id;root.add(mesh);
  try{const bytes=await new GLTFExporter().parseAsync(root,{binary:true}) as ArrayBuffer;const audit=await validateGlbStandard(bytes);
   if(audit.status!=='pass')throw new Error('Actual diagnostic GLB standard validation failed.');if(mounted.current&&active.current===before&&((compiled.report.calibrationPass&&(compiled.report.quality.pass||compiled.report.quality.envelope.status==='not-run')&&!compiled.report.candidate)||diagnosticRef.current))download(new Blob([bytes],{type:'model/gltf-binary'}),`${current.id}.diagnostic.glb`);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Diagnostic export failed');}finally{geometry.dispose();material.dispose();if(mounted.current)setBusy(false);}
 };
 return <main className="depth-editor">
  <header><b>MORPHLOOM · DEPTH REFERENCE</b><a href="/?editor=evidence">사진 근거</a><a href="/">검수 뷰어</a></header>
  <p>보정한 가시 표면 · 실측 인증 없음 · 후면/내부 없음 · 일반 납품 승인 없음</p>
  <label>네이티브 깊이 JSON <input type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void load(f);e.target.value='';}}/></label>
  {current&&<><p>{current.id} · {current.width}×{current.height} · 보정 근거: {current.calibration.basis}</p>
   <div className="depth-tools">
    <label>카메라 frame mm (left,right,bottom,top)<input value={draft.frame} onChange={e=>setDraft({...draft,frame:e.target.value})}/></label>
    <label>카메라 Z mm<input type="number" value={draft.camera} onChange={e=>setDraft({...draft,camera:e.target.value})}/></label>
    <label>샘플 stride (1–8)<input type="number" min="1" max="8" value={draft.stride} onChange={e=>setDraft({...draft,stride:e.target.value})}/></label>
    <button onClick={apply}>적용</button><button onClick={()=>setDraft({frame:current.camera.frameMm.join(', '),camera:String(current.camera.cameraZMm),stride:String(current.stride)})}>취소</button>
    <button disabled={cursor===0} onClick={()=>setCursor(cursor-1)}>Undo</button><button disabled={cursor>=history.length-1} onClick={()=>setCursor(cursor+1)}>Redo</button>
   </div>
   <button disabled={current.schema!=='morphloom.depth-surface/0.1'} onClick={()=>{commit(migrateDepthSurface(current));setDiagnostic(true);}}>경계 계약0.2로 무손실 이전</button>
   {current.schema!=='morphloom.depth-surface/0.1'&&<details><summary>확인한 깊이 범위·경계 검증점 선언</summary>
    <small>원본 이미지 픽셀 좌표와 독립 mm 자료를 입력하세요. 이 선언은 실측 인증을 대신하지 않습니다.</small>
    <div className="depth-tools">{([['near','가장 가까운 깊이 mm'],['far','가장 먼 깊이 mm'],['envelopeTolerance','범위 허용오차 mm'],['band','경계 밴드 pixels'],['boundaryTolerance','경계 허용오차 mm']] as const).map(([key,label])=><label key={key}>{label}<input type="number" value={qualityDraft[key]} onChange={e=>setQualityDraft({...qualityDraft,[key]:e.target.value})}/></label>)}</div>
    <label>검증 자료 유형<select value={qualityDraft.basis} onChange={e=>setQualityDraft({...qualityDraft,basis:e.target.value})}><option value="user-measured">사용자가 확인한 치수</option><option value="authored-fixture">작성한 검증 fixture</option></select></label>
    <label>경계 CSV: x,y,depthMm<textarea rows={6} maxLength={60000} value={qualityDraft.anchors} onChange={e=>setQualityDraft({...qualityDraft,anchors:e.target.value})}/></label>
    <button onClick={declareQuality}>경계 계약 적용</button>
   </details>}
   <label><input type="checkbox" disabled={!current.primaryForm} checked={current.preview==='declared-sphere-front'} onChange={e=>{const next={...current,preview:e.target.checked?'declared-sphere-front' as const:'raw-depth' as const};if(!e.target.checked)delete next.meshing;commit(next);if(e.target.checked)setDiagnostic(true);}}/> 선언된 IR 구면으로 가시 표면 후보</label>
   <details><summary>선택적 연속 구면 경계 · native0.3</summary>
    <small>선언된 구면 전면만 생성합니다. 선택한 대상의 topology·UV·index가 바뀌며 원본 필드와 기존 격자 경로는 보존됩니다.</small>
    <label>구면 chord 허용오차 mm<input type="number" min="0.00001" max="10" value={meshTolerance} onChange={e=>setMeshTolerance(e.target.value)}/></label>
    <label><input type="checkbox" disabled={!current.primaryForm} checked={Boolean(current.meshing)} onChange={e=>applyContinuous(e.target.checked)}/> 연속 구면 전면 (대상 topology·UV 변경)</label>
    <button disabled={!current.primaryForm} onClick={()=>applyContinuous(true)}>연속 경계 적용</button>
    <button onClick={()=>setMeshTolerance(String(current.meshing?.maxSagittaMm??Math.min(.02,(current.primaryForm?.radiusMm??60)/3000)))}>연속 경계 입력 취소</button>
   </details>
   {!current.primaryForm&&<small>구면 반지름·중심 선언이 없어 후보 연산을 사용할 수 없습니다.</small>}
   <label><input type="checkbox" checked={diagnostic} onChange={e=>setDiagnostic(e.target.checked)}/> 실패 결과를 진단용으로만 보기</label>
   <label>표시<select value={mode} onChange={e=>setMode(e.target.value)}><option value="clay">Clay</option><option value="wire">Wireframe</option><option value="checker">UV checker</option></select></label>
   <label>시점<select value={view} onChange={e=>setView(e.target.value)}><option value="front">정면</option><option value="iso">등각 · 구조 검수</option></select></label>
   {compiled&&'report' in compiled&&<p role="status">{compiled.report.calibrationPass?'기존 깊이 검증점 통과':'검증점 깊이 실패'} · normalized MAE {compiled.report.validation.normalizedMae.toFixed(4)} · {compiled.report.triangles} triangles · releaseAllowed:false</p>}
   {compiled&&'report' in compiled&&<div role="status">원본 경계 계약: {compiled.report.quality.pass?'통과':compiled.report.quality.envelope.status==='not-run'?'미검증':'실패/미확정'} · 범위 위반 {compiled.report.quality.envelope.violations} samples · 경계 최대오차 {compiled.report.quality.boundary.maximumErrorMm.toFixed(4)}mm
    {compiled.report.meshing&&<p>연속 전면: 최대 chord 편차 {compiled.report.meshing.maximumChordDeviationMm.toFixed(6)}mm · 실제 메시 깊이 {compiled.report.meshing.validationPass?'통과':'실패'} · 전경 누락 {compiled.report.meshing.missingForegroundPixels} pixels · 선언된 파라메트릭 정점</p>}
    {compiled.report.candidate&&<p>선언된 구면 후보: {compiled.report.candidate.validationPass?'검증 통과':'검증 실패'} · 관측 가능한 전면만 · 실측 승인 없음</p>}
    <details><summary>현재 실패 원인 · 최대32개 표시</summary>{compiled.report.blockers.slice(0,32).map((b,i)=><p key={i}>{b}</p>)}</details>
   </div>}
   {compiled&&'error' in compiled&&<p role="alert">{compiled.error}</p>}
   <ViewportErrorBoundary resetKey={`${current.id}:${cursor}:${diagnostic}`}><Preview geometry={compiled&&'geometry' in compiled?compiled.geometry:undefined} mode={mode} view={view}/></ViewportErrorBoundary>
   <button onClick={()=>download(new Blob([JSON.stringify(current)],{type:'application/json'}),`${current.id}.depth.json`)}>원본 필드 + 편집 상태 저장</button>
   <button disabled={busy||!compiled||!('geometry' in compiled)} onClick={()=>void exportDiagnostic()}>진단 GLB 내보내기</button>
  </>}
  {error&&<p role="alert">{error}</p>}
  <small>GLB는 표시용 파생 메시입니다. 원본 상대 깊이/카메라/검증점은 네이티브 JSON을 함께 보존하세요.</small>
 </main>;
}
