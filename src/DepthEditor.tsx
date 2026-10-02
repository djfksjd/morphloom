import {useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {compileDepthSurface, validateDepthSurfaceSource, type DepthSurfaceSource} from './engine/depth-surface';
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
 const [draft,setDraft]=useState({frame:'',camera:'',stride:'2'});
 const current=history[cursor],active=useRef(current),diagnosticRef=useRef(diagnostic),mounted=useRef(true),loadToken=useRef(0);active.current=current;diagnosticRef.current=diagnostic;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadToken.current++;};},[]);
 useEffect(()=>{if(current)setDraft({frame:current.camera.frameMm.join(', '),camera:String(current.camera.cameraZMm),stride:String(current.stride)});},[current]);
 const compiled=useMemo(()=>{if(!current)return undefined;try{return compileDepthSurface(current,{diagnostic});}catch(e){return {error:e instanceof Error?e.message:'Invalid depth source'};}},[current,diagnostic]);
 useEffect(()=>()=>{if(compiled&&'geometry' in compiled)compiled.geometry.dispose();},[compiled]);
 const load=async(file:File)=>{
  const token=++loadToken.current;
  try{if(file.size<1||file.size>8*1024*1024)throw new Error('Depth JSON must be 1 byte..8MiB.');const input:unknown=JSON.parse(await file.text());validateDepthSurfaceSource(input);
   if(!mounted.current||token!==loadToken.current)return;setHistory([input]);setCursor(0);setDiagnostic(false);setError('');
  }catch(e){if(mounted.current&&token===loadToken.current)setError(e instanceof Error?e.message:'Invalid depth JSON');}
 };
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
   if(audit.status!=='pass')throw new Error('Actual diagnostic GLB standard validation failed.');if(mounted.current&&active.current===before&&(compiled.report.calibrationPass||diagnosticRef.current))download(new Blob([bytes],{type:'model/gltf-binary'}),`${current.id}.diagnostic.glb`);
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
   <label><input type="checkbox" checked={diagnostic} onChange={e=>setDiagnostic(e.target.checked)}/> 실패 결과를 진단용으로만 보기</label>
   <label>표시<select value={mode} onChange={e=>setMode(e.target.value)}><option value="clay">Clay</option><option value="wire">Wireframe</option><option value="checker">UV checker</option></select></label>
   <label>시점<select value={view} onChange={e=>setView(e.target.value)}><option value="front">정면</option><option value="iso">등각 · 구조 검수</option></select></label>
   {compiled&&'report' in compiled&&<p role="status">{compiled.report.calibrationPass?'검증점 깊이 통과 · 경계 품질 미검증':'검증점 깊이 실패'} · normalized MAE {compiled.report.validation.normalizedMae.toFixed(4)} · {compiled.report.triangles} triangles · releaseAllowed:false</p>}
   {compiled&&'error' in compiled&&<p role="alert">{compiled.error}</p>}
   <ViewportErrorBoundary resetKey={`${current.id}:${cursor}:${diagnostic}`}><Preview geometry={compiled&&'geometry' in compiled?compiled.geometry:undefined} mode={mode} view={view}/></ViewportErrorBoundary>
   <button onClick={()=>download(new Blob([JSON.stringify(current)],{type:'application/json'}),`${current.id}.depth.json`)}>원본 필드 + 편집 상태 저장</button>
   <button disabled={busy||!compiled||!('geometry' in compiled)} onClick={()=>void exportDiagnostic()}>진단 GLB 내보내기</button>
  </>}
  {error&&<p role="alert">{error}</p>}
  <small>GLB는 표시용 파생 메시입니다. 원본 상대 깊이/카메라/검증점은 네이티브 JSON을 함께 보존하세요.</small>
 </main>;
}
