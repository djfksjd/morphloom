import { surfaceGearPack } from '../examples/domain-packs/surface-gear-pack';
import './element-editor.css';
import {attachUvChecker} from './engine/uv-checker';
import { PartInspector } from './PartInspector';
import { buildWorkspaceScene, type ElementWorkspace } from './engine/element-workspace';
import { bearingPack } from './engine/bearing-pack';
import { gearPack } from './engine/gear-pack';
import { extractToothGeometry, gearProfile, toothIds } from './engine/spur-gear';
import { pickGearTooth } from './engine/gear-picking';
import { analyzeTopology } from './engine/topology';
import {LatestUvInspection,type UvInspectionReceipt} from './engine/uv-quality';
import {inspectMeshExport} from './engine/mesh-export-policy';
import { fitPerspectiveCameraToBounds } from './engine/camera-framing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createBirdProject } from './engine/bird-element-demo.js';
import { migrateElementProjectToV7,migrateElementProjectToV6,migrateElementProjectToV5,migrateElementProjectToV4, ElementHistory, deleteElement, detachElement, detachPart, duplicateElement, editElement, editGroup, editPart, parseProject, resolveElements, restoreElement, restorePart, serializeProject, type ElementProject, type Params, type Vec3 } from './engine/element-project.js';
import { buildElementScene, exportSelectedScene } from './engine/element-renderer.js';

import { createElementDomainRegistry } from './engine/element-domain-packs';
import { minimalPack } from '../examples/domain-packs/minimal-pack';
const domainRegistry = createElementDomainRegistry();
domainRegistry.register(minimalPack);
domainRegistry.register(bearingPack);
domainRegistry.register(gearPack);
domainRegistry.register(surfaceGearPack);

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ElementEditor({initialProject,workspace,activeAsset,onAssetPick,onProjectChange,initialSelection,onSelectionChange}: {initialProject?:ElementProject;workspace?:ElementWorkspace;activeAsset?:string;onAssetPick?:(id:string)=>void;onProjectChange?:(project:ElementProject)=>void;initialSelection?:string;onSelectionChange?:(id:string)=>void} = {}): React.JSX.Element {
  const [project, setProject] = useState<ElementProject>(() => initialProject ? structuredClone(initialProject) : createBirdProject());
  useEffect(()=>{onProjectChange?.(project);},[project,onProjectChange]);
  const [initialHistory] = useState(() => new ElementHistory(project));
  const history = useRef(initialHistory);
  const [selection, setSelection] = useState(initialSelection ?? '');
  useEffect(()=>{onSelectionChange?.(selection);},[selection,onSelectionChange]);
  const [featureId,setFeatureId]=useState('');
  const uvInspector=useRef(new LatestUvInspection());
  const [uvState,setUvState]=useState<{project:ElementProject;status:'checking'|'ready'|'error';receipt?:UvInspectionReceipt;error?:string}|null>(null);
  const uvReceipt=uvState?.project===project&&uvState.status==='ready'?uvState.receipt??null:null;
  const uvError=uvState?.project===project&&uvState.status==='error'?uvState.error??'UV inspection failed':'';
  const uvPending=uvState?.project!==project||uvState.status==='checking';
  const select=(id:string):void=>{loadTicket.current++;setSelection(id);setFeatureId('');};
  const [checker,setChecker]=useState(false);
  const [lod, setLod] = useState<'low' | 'detail'>('detail');
  const [isolate, setIsolate] = useState(false), [explode, setExplode] = useState(false);
  const [error, setError] = useState(''), [metrics, setMetrics] = useState(''), [pickMs, setPickMs] = useState(0), [glbBytes, setGlbBytes] = useState(0);
  const exportBusy = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const pose = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const loadTicket = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadTicket.current++; }; }, []);
  const resetPose = useRef(false);
  const [receiptNote, setReceiptNote] = useState('');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [targetId, setTargetId] = useState('');
  const [packChoice, setPackChoice] = useState(initialProject ? '' : 'morphloom.bird');
  const [packInputs, setPackInputs] = useState<Record<string, number>>({});
  const packMetadata = domainRegistry.list().find(p => p.id === packChoice);
  const switchPack = (id: string, input: Record<string, number> = {}): void => { try { const p = domainRegistry.generate(id, input, ['semantic-part-editing', 'selected-scene-export']); resetPose.current = true; loadTicket.current++; history.current = new ElementHistory(p); setProject(p); setPackChoice(id); setPackInputs(input); select(''); setError(''); } catch (e) { setError(String(e)); } };
  const [actualCalls, setActualCalls] = useState(0);
  const elements = useMemo(() => resolveElements(project), [project]);
  const sceneRef = useRef<ReturnType<typeof buildElementScene> | null>(null);
  const run = (fn: () => ElementProject): void => { loadTicket.current++; try { const next = fn(); history.current.commit(next); setProject(next); setError(''); } catch (e) { setError(String(e)); } };
  const selected = elements.find(e => e.id === selection);
  const part = project.parts.find(p => p.id === selection);
  const group = project.groups.find(g => g.id === selection);
  const explicit = project.elements.find(e => e.id === selection);
  useEffect(() => {
    const el = host.current; if (!el) return;
    if (resetPose.current) { pose.current = null; resetPose.current = false; }
    let renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined, frame = 0, observer: ResizeObserver | undefined;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#20252b');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x535e6c, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(1, 2, 3); scene.add(light);
    let built: ReturnType<typeof buildElementScene> | undefined;
    let restoreChecker:(()=>void)|undefined;
    let down: [number, number] | undefined;
    const pointerDown = (ev: PointerEvent): void => { down = [ev.clientX, ev.clientY]; };
    const pointer = (ev: PointerEvent): void => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return;
      if (!renderer || !built) return;
      const t = performance.now(), box = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((ev.clientX - box.left) / box.width * 2 - 1, 1 - (ev.clientY - box.top) / box.height * 2), camera);
      setFeatureId(''); // A blank/bore click clears only the transient feature selection.
      for (const hit of ray.intersectObject(built.root, true)) {
        const id = built.pickId(hit); if (!id) continue;
        const [asset,local]=workspace?id.split('::'):['',id];
        if(workspace&&asset!==activeAsset){onAssetPick?.(asset);break;}
        select(local);
        const picked=project.parts.find(p=>p.id===local);
        if(picked?.geometry?.op==='spur-gear'){
          const point=hit.object.worldToLocal(hit.point.clone()).multiplyScalar(1000);
          setFeatureId(pickGearTooth(picked.geometry,point.toArray())??'');
        }
        break;
      }
      setPickMs(performance.now() - t);
    };
    try {
      built = workspace ? buildWorkspaceScene({...workspace,assets:workspace.assets.map(a=>a.id===activeAsset?{...a,source:project}:a)},lod,false,isolate&&selection&&activeAsset?{isolate:{assetId:activeAsset,ids:[selection]}}:{}) : buildElementScene(project, lod, { isolateIds: isolate && selection ? group ? elements.filter(e => e.groupId === group.id).map(e => e.id) : [selection] : undefined, explodeMm: explode ? 30 : 0 });
      if(checker)restoreChecker=attachUvChecker(built.root);
      scene.add(built.root); sceneRef.current = built;
      renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
      const box = new THREE.Box3().setFromObject(built.root);
      const bounds = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.15, -0.15, -0.15), new THREE.Vector3(0.15, 0.15, 0.15)) : box;
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.5, 0.001);
      let needsInitialFit = !pose.current;
      if (pose.current) { camera.position.copy(pose.current.position); controls.target.copy(pose.current.target); }
      camera.near = Math.max(0.000001, radius / 1000);
      camera.far = Math.max(10, radius * 20, camera.position.distanceTo(center) + radius * 8);
      const resize = (): void => {
        if (!renderer || !controls) return;
        const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
        renderer.setSize(w, h); camera.aspect = w / h;
        if (needsInitialFit) {
          const fit = fitPerspectiveCameraToBounds({ bounds, direction: new THREE.Vector3(1, 0.55, 1), up: camera.up, verticalFovDegrees: camera.fov, aspect: camera.aspect, padding: 1.22 });
          camera.position.copy(fit.center).addScaledVector(fit.direction, fit.distance);
          controls.target.copy(fit.center);
          needsInitialFit = false;
        }
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize); observer.observe(el); resize();
      renderer.domElement.addEventListener('pointerdown', pointerDown);
      renderer.domElement.addEventListener('pointerup', pointer);
      let lastCalls = -1;
      const tick = (): void => { controls?.update(); renderer?.render(scene, camera); if (renderer && renderer.info.render.calls !== lastCalls) { lastCalls = renderer.info.render.calls; setActualCalls(lastCalls); } frame = requestAnimationFrame(tick); };
      tick();
      setActualCalls(renderer.info.render.calls);
      setMetrics(`${built.stats.visibleElements}/${built.stats.elements} elements · ${built.stats.triangles} triangles · ${built.stats.geometryBytes} geometry-buffer bytes · ${built.stats.generationMs.toFixed(1)} ms build · ${built.stats.drawCallsEstimate} estimated calls`);
      setError('');
    } catch (e) { setError(String(e)); built?.dispose(); }
    return () => { if (!resetPose.current) pose.current = controls ? { position: camera.position.clone(), target: controls.target.clone() } : null; cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose(); if (renderer) { renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointer); renderer.forceContextLoss(); renderer.dispose(); renderer.domElement.remove(); } restoreChecker?.(); built?.dispose(); if (sceneRef.current === built) sceneRef.current = null; };
  }, [project, workspace, activeAsset, lod, isolate, explode, isolate ? selection : '', cameraRevision,checker]);
  useEffect(() => {
    const root = sceneRef.current?.root;
    if (!root || !selection || group) return;
    let helper: THREE.Box3Helper | undefined;
    try {
      const selectedScene = exportSelectedScene(project, [selection]);
      const box = new THREE.Box3().setFromObject(selectedScene.root);
      if(workspace&&activeAsset){root.updateMatrixWorld(true);const datum=root.getObjectByName(activeAsset);if(datum)box.applyMatrix4(datum.matrixWorld);}
      const ownerId = selected?.partId ?? part?.id;
      if (explode && ownerId) box.translate(new THREE.Vector3(0.03 * (1 + project.parts.findIndex(p => p.id === ownerId)), 0, 0));
      selectedScene.dispose();
      helper = new THREE.Box3Helper(box, new THREE.Color('#8dc9ff'));
      root.add(helper);
    } catch { /* Deleted selection has no highlight. */ }
    return () => { if (helper) { root.remove(helper); helper.geometry.dispose(); (helper.material as THREE.Material).dispose(); } };
  }, [project, workspace, activeAsset, selection, lod, isolate, explode, cameraRevision, checker]);
  useEffect(()=>{
    if(featureId&&(!part||part.geometry?.op!=='spur-gear'||!toothIds(part.geometry).includes(featureId)))setFeatureId('');
  },[part,featureId]);
  useEffect(()=>{
    const root=sceneRef.current?.root;
    if(!root||part?.geometry?.op!=='spur-gear'||!featureId)return;
    const contour=gearProfile(part.geometry).features.find(f=>f.id===featureId)?.points;
    const mesh=root.getObjectByName(workspace?`${activeAsset}::${part.id}`:part.id);
    if(!contour||!mesh)return;
    const positions:number[]=[],half=part.geometry.faceWidthMm/2000-(part.axialChamferMm??0)/1000;
    for(const z of [-half,half])for(let i=1;i<contour.length;i++)positions.push(contour[i-1][0]/1000,contour[i-1][1]/1000,z,contour[i][0]/1000,contour[i][1]/1000,z);
    for(const i of [0,contour.length-1])positions.push(contour[i][0]/1000,contour[i][1]/1000,-half,contour[i][0]/1000,contour[i][1]/1000,half);
    const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const material=new THREE.LineBasicMaterial({color:0xffd86b,depthTest:false});
    const lines=new THREE.LineSegments(geometry,material);lines.name='feature-selection-overlay';lines.raycast=()=>{};lines.renderOrder=10;mesh.add(lines);
    return()=>{mesh.remove(lines);geometry.dispose();material.dispose();};
  },[project,workspace,activeAsset,part,featureId,selection,lod,isolate,explode,cameraRevision,checker]);
  useEffect(()=>{
    let active=true,built:ReturnType<typeof exportSelectedScene>|undefined;
    setUvState({project,status:'checking'});
    try{
      built=exportSelectedScene(project,[...project.parts.map(p=>p.id),...elements.map(e=>e.id)]);
      void uvInspector.current.run(built.root,serializeProject(project)).then(receipt=>{if(active&&receipt)setUvState({project,status:'ready',receipt});}).catch(e=>{if(active)setUvState({project,status:'error',error:String(e)});}).finally(()=>{built?.dispose();});
    }catch(e){built?.dispose();setUvState({project,status:'error',error:String(e)});}
    return()=>{active=false;uvInspector.current.cancel();};
  },[project,elements]);
  const numberField = (label: string, value: number, update: (v: number) => void, step = 0.1): React.JSX.Element =>
    <label style={{ display: 'block' }}>{label} <input aria-label={label} type="number" step={step} value={value} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) update(n); }} /></label>;
  const colorField = (value: string, update: (v: string) => void): React.JSX.Element => <label>Color <input aria-label="Color" type="color" value={value} onChange={e => update(e.target.value)} /></label>;
  const vecFields = (label: string, value: Vec3, update: (v: Vec3) => void, unit = 'mm'): React.JSX.Element => <fieldset><legend>{label} ({unit})</legend>{value.map((v, i) => <React.Fragment key={i}>{numberField(`${label} ${['X','Y','Z'][i]}`, v, n => { const next = [...value] as Vec3; next[i] = n; update(next); })}</React.Fragment>)}</fieldset>;
  const paramFields = (params: Params, update: (key: keyof Params, value: number | string) => void): React.JSX.Element => <>{(['length','width','thickness','curvature','twist','roughness'] as const).map(k => <React.Fragment key={k}>{numberField(k, params[k], n => update(k, n))}</React.Fragment>)}{colorField(params.color, v => update('color', v))}</>;
  const currentProject = useRef(project);
  currentProject.current = project;
  const savedProject = (): ElementProject => ({ ...project, selection: selection ? [selection] : [] });
  const exportGlb = async (wholeProject = false,diagnosticChecker=false,diagnosticUv=false): Promise<void> => {
    if (exportBusy.current) return;
    exportBusy.current = true;
    let built: ReturnType<typeof exportSelectedScene> | undefined;
    let restoreChecker:(()=>void)|undefined;
    try {
      const ids = wholeProject ? [...project.parts.map(p=>p.id),...elements.map(e=>e.id)] : group ? elements.filter(e => e.groupId === group.id).map(e => e.id) : selection ? [selection] : [];
      if (!ids.length) throw new Error('Select an element or body part first');
      built = exportSelectedScene(project, ids);
      const legacyDiagnostic=project.schema==='morphloom.elements/0.1'&&(diagnosticChecker||diagnosticUv);
      if (!legacyDiagnostic&&!analyzeTopology(built.root).pass) throw new Error('Export blocked: topology gate failed');
      if(diagnosticChecker){restoreChecker=attachUvChecker(built.root);built.root.userData.diagnosticAppearance='synthetic-checker; original PBR retained in source IR';}
      const sourceJson=serializeProject(savedProject());
      const data = await new GLTFExporter().parseAsync(built.root, { binary: true });
      const uvDelivery=await inspectMeshExport(data as ArrayBuffer,sourceJson,diagnosticChecker||diagnosticUv?'diagnostic':'editable-mesh');
      const uvJson=JSON.stringify({...uvDelivery,topologyInspection:legacyDiagnostic?{status:'not-run',reason:'Legacy 0.1 diagnostic retains prior export compatibility; not certified closed topology'}:{status:'pass',scope:'Current native volumetric generators only; intentional open representations unsupported'}});if(new Blob([uvJson]).size>20_000_000)throw new Error('UV report exceeds 20 MB budget');
      if (!mounted.current || currentProject.current !== project) return; // discard an export from a superseded project
      const blob = new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' });
      download(blob, diagnosticChecker ? 'morphloom-checker-diagnostic.glb' : diagnosticUv ? 'morphloom-uv-diagnostic.glb' : wholeProject ? 'morphloom-project.glb' : 'morphloom-selection.glb'); setGlbBytes(blob.size);
      download(new Blob([sourceJson], { type: 'application/json' }), 'morphloom-source.json');
      download(new Blob([uvJson],{type:'application/json'}),'morphloom-uv-quality.json');
      setError('');
    } catch (e) { if (mounted.current && currentProject.current === project) setError(String(e)); } finally { restoreChecker?.(); built?.dispose(); exportBusy.current = false; }
  };
  const exportTooth=async(id:string):Promise<void>=>{
    if(exportBusy.current)return;exportBusy.current=true;let built:ReturnType<typeof exportSelectedScene>|undefined;
    try{
      if(part?.axialChamferMm)throw new Error('Chamfered diagnostic tooth cuts are unsupported; export whole gear or set chamfer to 0');
      if(part?.geometry?.op!=='spur-gear')throw new Error('Select a spur gear');
      const copy=structuredClone(project),piece=copy.parts.find(p=>p.id===part.id)!;
      piece.geometry=extractToothGeometry(part.geometry,id);delete piece.assemblyId;delete piece.home;delete piece.axialChamferMm;
      copy.parts=[piece];copy.regions=[];copy.groups=[];copy.elements=[];copy.assemblies=[];
      built=exportSelectedScene(copy,[piece.id]);const mesh=built.root.getObjectByName(piece.id)!;
      mesh.name=`${part.id}/${id}`;mesh.userData={...mesh.userData,connectedSourceFeatureId:`${part.id}/${id}`,extraction:'diagnostic-sector-cut',detachable:false};
      if(!analyzeTopology(built.root).pass)throw new Error('Diagnostic feature topology failed');
      const sourceJson=serializeProject(project);
      const data=await new GLTFExporter().parseAsync(built.root,{binary:true});
      const uvDelivery=await inspectMeshExport(data as ArrayBuffer,sourceJson,'diagnostic');const uvJson=JSON.stringify(uvDelivery);if(new Blob([uvJson]).size>20_000_000)throw new Error('UV report exceeds 20 MB budget');
      if(!mounted.current||currentProject.current!==project)return;
      download(new Blob([data as ArrayBuffer],{type:'model/gltf-binary'}),`${part.id}-${id}-diagnostic.glb`);
      download(new Blob([sourceJson],{type:'application/json'}),'morphloom-gear-source.json');
      download(new Blob([uvJson],{type:'application/json'}),'morphloom-tooth-uv-quality.json');setError('');
    }catch(e){if(mounted.current&&currentProject.current===project)setError(String(e));}finally{built?.dispose();exportBusy.current=false;}
  };
  const button = (text: string, action: () => void): React.JSX.Element => <button type="button" onClick={action}>{text}</button>;
  return <main className="element-editor" onClickCapture={e => { if (e.target instanceof Element && e.target.closest('button')) loadTicket.current++; }} onChangeCapture={e => { if (!(e.target instanceof HTMLInputElement && e.target.type === 'file')) loadTicket.current++; }} style={{ font: '14px system-ui', color: '#eee', background: '#292d33', minHeight: '100vh', padding: 12 }}>
    <h1>Element editor</h1><label>Domain Pack <select value={packChoice} onChange={e => switchPack(e.target.value)}><option value="" disabled>Loaded project · generator association unknown</option>{domainRegistry.list().map(p => <option key={p.id} value={p.id}>{p.id} · {p.domain} · {p.status}</option>)}</select></label>{Object.entries(packMetadata?.parameters.dimensions ?? {}).map(([key, bounds]) => <label key={key}>{key}<input type="number" min={bounds.min} max={bounds.max} value={packInputs[key] ?? bounds.default} onChange={e => setPackInputs(v => ({ ...v, [key]: Number(e.target.value) }))} /></label>)}{packMetadata?.parameterNotes?.map(note=><p key={note}>{note}</p>)}<button disabled={!packChoice} onClick={() => switchPack(packChoice, packInputs)}>Generate pack</button><p>Authored visualization. Bearing clearances are design choices, not manufacturer tolerances; no load or kinematics certification. Bird/fur use representation B; no barbs or groom simulation.</p>
    <nav aria-label="Project actions">{button('Bird example', () => switchPack('morphloom.bird'))}{button('Fur example', () => switchPack('morphloom.fur'))}
      {button('Undo', () => { loadTicket.current++; setProject(history.current.undo()); })}{button('Redo', () => { loadTicket.current++; setProject(history.current.redo()); })}
      {button('Save project JSON', () => { try { download(new Blob([serializeProject(savedProject())], { type: 'application/json' }), 'morphloom-elements.json'); } catch (e) { setError(String(e)); } })}
      <label>Load JSON (max 2 MB) <input type="file" accept=".json,application/json" onChange={async e => { const input = e.currentTarget; const ticket = ++loadTicket.current; try { const f = input.files?.[0]; input.value = ''; if (!f) return; if (f.size > 2_000_000) throw new Error('File exceeds 2 MB'); const p = parseProject(await f.text()); const savedSelection = p.selection?.[0] ?? ''; delete p.selection; if (ticket !== loadTicket.current) return; resetPose.current = true; history.current = new ElementHistory(p); setProject(p); setPackChoice(''); setPackInputs({}); setSelection(savedSelection); setFeatureId(''); setError(''); } catch (err) { if (ticket === loadTicket.current) setError(String(err)); } }} /></label>
      {button('Export selected GLB + source JSON', () => { void exportGlb(); })}{button('Export project GLB + source JSON', () => { void exportGlb(true); })}{button('Export project UV diagnostic GLB + source JSON', () => { void exportGlb(true,false,true); })}</nav>
    <p>GLB contains independently named baked meshes in meters, not a native procedural groom. Companion JSON preserves the editable source.</p>
    {button('Fit view', () => { resetPose.current = true; setCameraRevision(n => n + 1); })}<form onSubmit={e => { e.preventDefault(); if (project.parts.some(p => p.id === targetId) || project.groups.some(g => g.id === targetId) || elements.some(x => x.id === targetId)) { select(targetId); setError(''); } else setError(`Unknown element ID: ${targetId}`); }}><label>Select by ID <input value={targetId} onChange={e => setTargetId(e.target.value)} /></label><button type="submit">Select</button></form><label>LOD <select value={lod} onChange={e => setLod(e.target.value as 'low' | 'detail')}><option value="detail">Detail</option><option value="low">Low</option></select></label>
    <label><input type="checkbox" disabled={!!workspace&&!selection} title={workspace&&!selection?'Select a part, element or group to isolate':undefined} checked={isolate} onChange={e => setIsolate(e.target.checked)} /> Isolate selection</label>
    <label><input type="checkbox" checked={checker} onChange={e=>setChecker(e.target.checked)}/> Synthetic UV checker preview</label><p>64px / 8 cells per UV tile. Diagnostic appearance; normal exports retain source PBR.</p>
    {button('Export checker diagnostic GLB',()=>{void exportGlb(true,true);})}
    {project.schema!=='morphloom.elements/0.4'&&project.schema!=='morphloom.elements/0.5'&&project.schema!=='morphloom.elements/0.6'&&project.schema!=='morphloom.elements/0.7' && button('Enable UV editing (schema 0.4)',()=>run(()=>migrateElementProjectToV4(project)))}
    {project.schema!=='morphloom.elements/0.5'&&project.schema!=='morphloom.elements/0.6'&&project.schema!=='morphloom.elements/0.7'&&button('Enable chamfer editing (schema 0.5)',()=>run(()=>migrateElementProjectToV5(project)))}
    {project.schema!=='morphloom.elements/0.7'&&button('Enable normal weighting (schema 0.7)',()=>run(()=>migrateElementProjectToV7(project)))}
    {project.schema!=='morphloom.elements/0.6'&&project.schema!=='morphloom.elements/0.7'&&button('Enable surface editing (schema 0.6)',()=>run(()=>migrateElementProjectToV6(project)))}
    <label><input type="checkbox" disabled={!!workspace} checked={explode} onChange={e => setExplode(e.target.checked)} /> Explode preview</label>
    {workspace&&<p>Isolate selection shows the active part, element or group at its assembly placement. Explode across assets is unavailable. Source JSON/GLB actions below apply to the active asset; use workspace actions for combined delivery.</p>}
    <p role="status">{error || `${metrics} · ${actualCalls} measured render calls · ${pickMs.toFixed(1)} ms last pick · ${glbBytes} bytes last GLB · ${sceneRef.current ? 'viewport ready' : 'viewport unavailable'}`}</p>
    <details aria-label="UV quality"><summary>UV quality: {uvPending?'checking':uvError?'blocked':uvReceipt?.report.integrityPass?'integrity PASS':'integrity FAIL'}</summary>
      <p>Inspection uses baked source geometry; isolate/explode preview does not alter it. {workspace&&'This panel covers the active source asset; workspace export reports the combined scene.'} An integrity pass does not verify an atlas or texel density. Exports include a UV report and may still fail production readiness.</p>
      {uvError&&<p role="alert">{uvError}</p>}
      {uvReceipt&&<><p>Source SHA256: <code>{uvReceipt.sourceFingerprint}</code><br/>Geometry SHA256: <code>{uvReceipt.report.geometryFingerprint}</code> · coverage {uvReceipt.report.fingerprintCoverage}</p>
        <p>Texel density: {uvReceipt.report.texelDensity.status} (metallic-roughness channel; measurement is not quality approval). Atlas/padding/mip bleeding: not-run. Declared projection intent does not approve overlaps for a texture.</p>
        <p>{uvReceipt.report.cost.milliseconds.toFixed(1)} ms · {uvReceipt.report.cost.overlapPairBudgetPerMesh} overlap comparisons/mesh budget</p>
        <ul>{uvReceipt.report.meshes.map((m,i)=><li key={`${m.id}/${i}`}><strong>{m.id}: {m.blocked?'blocked':m.integrityPass?'integrity PASS':'integrity FAIL'}</strong> · UV degenerate {m.degenerateUvTriangles}/{m.eligibleUvTriangles} · invalid UV {m.invalidUvVertices} · world area {m.worldAreaM2.toExponential(4)} m² · UV area {m.uvArea.toExponential(4)} · negative UV orientation {m.negativeUvTriangles} · max anisotropy {m.maximumAnisotropy?.toFixed(3)??'singular/unmeasured'} · UV units/m {m.uvUnitsPerMeterRange?.map(n=>n.toPrecision(4)).join('–')??'unmeasured'}<br/>Texels/mm: {m.texelDensity.rangeTexelsPerMm?.map(n=>n.toPrecision(4)).join('–')??'unmeasured'} · {m.texelDensity.status} · measured {m.texelDensity.measuredTriangles}/{m.triangleCount} · {m.texelDensity.reason}<br/>Overlap: {m.overlap.complete?'complete':'incomplete, remaining pairs unknown'} · positive pairs {m.overlap.positiveAreaPairs} · {m.overlap.intent} · within-mesh only · connected feature integrity: {m.criticalFeatures} {m.features.length>0&&<details><summary>Connected tooth UV (centroid attribution)</summary><ul>{m.features.map(f=><li key={f.id}>{f.id}: {f.integrityPass?'PASS':'FAIL'} · {f.degenerateUvTriangles}/{f.triangles} degenerate · texels/mm {m.texelDensity.features.find(d=>d.id===f.id)?.rangeTexelsPerMm?.map(n=>n.toPrecision(4)).join('–')??'unmeasured'} · density omissions {m.texelDensity.features.find(d=>d.id===f.id)?.unmeasuredTriangles??f.triangles}</li>)}</ul></details>} {m.blocked&&<span>{m.blocked}</span>}</li>)}</ul>
        <button type="button" onClick={()=>download(new Blob([JSON.stringify(uvReceipt,null,2)],{type:'application/json'}),'morphloom-current-uv-summary.json')}>Save current UV summary</button></>}
    </details>
    <div className="element-columns" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(300px,3fr) minmax(220px,1fr)', gap: 10, height: '65vh' }}>
      <aside aria-label="Element tree" style={{ overflow: 'auto' }}><h2>Parts and regions</h2>{project.assemblies?.map(a=><details key={a.id} open><summary>{a.name} · {a.id}</summary><p>Rotation axis [{a.axis.join(", ")}] · identity datum</p>{project.parts.filter(p=>p.assemblyId===a.id).map(p=><button key={p.id} onClick={()=>select(p.id)}>{p.id}</button>)}</details>)}{project.parts.map(p => <details key={p.id}><summary><button onClick={() => select(p.id)}>{p.name}</button></summary>{project.regions.filter(r => r.partId === p.id).map(r => <details key={r.id}><summary>{r.name}</summary>{project.groups.filter(g => g.regionId === r.id).map(g => <details key={g.id}><summary><button onClick={() => select(g.id)}>{g.id} ({g.count})</button></summary><p>First 100 shown</p>{elements.filter(x => x.groupId === g.id).slice(0, 100).map(x => <div key={x.id}><button onClick={() => select(x.id)}>{x.id}</button></div>)}</details>)}</details>)}{project.elements.filter(e => e.partId === p.id && !e.groupId).slice(0, 100).map(e => <div key={e.id}><button onClick={() => select(e.id)}>{e.id}</button></div>)}</details>)}</aside>
      <div className="element-viewport" ref={host} aria-label="3D viewport; click to select" style={{ minWidth: 0, minHeight: 200 }} />
      <aside aria-label="Inspector" style={{ overflow: 'auto' }}><h2>Inspector</h2><p>{selection || 'Select a part, group or element'}</p>
        {part && <PartInspector key={JSON.stringify(part)} part={part} version2={project.schema!=='morphloom.elements/0.1'} version4={project.schema==='morphloom.elements/0.4'||project.schema==='morphloom.elements/0.5'||(project.schema==='morphloom.elements/0.6'||project.schema==='morphloom.elements/0.7')} version5={project.schema==='morphloom.elements/0.5'||(project.schema==='morphloom.elements/0.6'||project.schema==='morphloom.elements/0.7')} version6={(project.schema==='morphloom.elements/0.6'||project.schema==='morphloom.elements/0.7')} version7={project.schema==='morphloom.elements/0.7'} featureId={featureId} onFeatureSelect={setFeatureId} exportFeature={id=>{void exportTooth(id);}} apply={patch=>run(()=>editPart(project,part.id,patch))} action={kind=>run(()=>kind==='visibility'?editPart(project,part.id,{visible:!part.visible}):kind==='lock'?editPart(project,part.id,{locked:!part.locked}):part.home?restorePart(project,part.id):detachPart(project,part.id))}/>}
        {group && <><h3>Group defaults</h3><p>Individual overrides win over group defaults. Count reduction deletes removed slots and overrides; Undo recovers them. Growing the count creates fresh slots.</p><p>{receiptNote}</p>{numberField('Count', group.count, n => run(() => { const result = editGroup(project, group.id, { count: n }); setReceiptNote(`Added: ${result.receipt.added.length}; deleted: ${result.receipt.deleted.length}; remapped: 0`); return result.project; }), 1)}{paramFields(group.params, (k, v) => run(() => editGroup(project, group.id, { params: { [k]: v } }).project))}</>}
        {selected && <><h3>Individual effective values</h3><p>{selected.source === 'generated' ? 'Position: owner local; Rotation: local delta' : 'Position/Rotation: world'}</p>{vecFields('Position', selected.source === 'generated' ? project.groups.find(g => g.id === selected.groupId)?.overrides[selected.id]?.position ?? (() => { const owner = project.parts.find(p => p.id === selected.partId)!; const v = new THREE.Vector3(...selected.position).sub(new THREE.Vector3(...owner.position)).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...owner.rotation)).invert()); return [v.x, v.y, v.z] as Vec3; })() : selected.position, v => run(() => editElement(project, selected.id, { position: v })))}{vecFields('Rotation', selected.source === 'generated' ? project.groups.find(g => g.id === selected.groupId)?.overrides[selected.id]?.rotation ?? [0,0,0] : selected.rotation, v => run(() => editElement(project, selected.id, { rotation: v })), 'rad')}{paramFields(selected.params, (k, v) => run(() => editElement(project, selected.id, { params: { [k]: v } })))}
          {button(selected.visible ? 'Hide' : 'Show', () => run(() => editElement(project, selected.id, { visible: !selected.visible })))}{button(selected.locked ? 'Unlock' : 'Lock', () => run(() => editElement(project, selected.id, { locked: !selected.locked })))}
          {button('Delete', () => run(() => { const p = deleteElement(project, selected.id); select(''); return p; }))}
          {button('Duplicate', () => run(() => { let i = 1; while (elements.some(e => e.id === `copy_${i}`)) i++; return duplicateElement(project, selected.id, `copy_${i}`); }))}
          {selected.source === 'generated' && button('Detach element', () => run(() => detachElement(project, selected.id)))}
          {explicit?.original && <p>Restore returns to the original attachment and discards detached world position/rotation edits; shape and material edits remain.</p>}{explicit?.original && button('Restore element', () => run(() => restoreElement(project, selected.id)))}</>}
      </aside></div></main>;
}
