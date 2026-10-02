import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import os from 'node:os';
import * as THREE from 'three';import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {generateSpurGearProject,gearPack,GEAR_PACK_REVISION} from '../src/engine/gear-pack';
import {bearingPack} from '../src/engine/bearing-pack';import {createElementDomainRegistry} from '../src/engine/element-domain-packs';
import {gearProfile,gearDimensions,extractToothGeometry} from '../src/engine/spur-gear';
import {editPart,serializeProject,parseProject,ElementHistory} from '../src/engine/element-project';
import {exportSelectedScene,ELEMENT_RENDERER_REVISION} from '../src/engine/element-renderer';import {analyzeTopology} from '../src/engine/topology';
import {appendWorkspaceAsset,generateWorkspaceAsset,buildWorkspaceScene,editWorkspacePart,type ElementWorkspace} from '../src/engine/element-workspace';
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob):void{void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:Reader});const out=path.resolve(process.argv[2]??'outputs/spur-gear-20261002/current');fs.mkdirSync(out,{recursive:true});
const sha=(v:Uint8Array|string):string=>createHash('sha256').update(v).digest('hex'),outputs:Record<string,unknown>={};
function write(name:string,v:Uint8Array|string):void{fs.writeFileSync(path.join(out,name),v);outputs[name]={sha256:sha(v),bytes:Buffer.byteLength(v)};}
function meshHash(m:THREE.Mesh):string{const h=createHash('sha256'),mat=m.material as THREE.MeshStandardMaterial;h.update(JSON.stringify([m.name,m.parent?.name,m.matrixWorld.toArray(),mat.color.toArray(),mat.roughness,mat.metalness]));for(const key of Object.keys(m.geometry.attributes).sort()){const a=m.geometry.getAttribute(key).array;h.update(key);h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}const a=m.geometry.index?.array;if(a)h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));return h.digest('hex');}
async function binary(name:string,scene:ReturnType<typeof exportSelectedScene>):Promise<void>{try{assert.equal(analyzeTopology(scene.root).pass,true);const b=await new GLTFExporter().parseAsync(scene.root,{binary:true,onlyVisible:false});write(name,new Uint8Array(b as ArrayBuffer));}finally{scene.dispose();}}
async function main():Promise<void>{
  const before=generateSpurGearProject({}),g=before.parts[0].geometry!;if(g.op!=='spur-gear')throw new Error('gear expected');
  const edited=editPart(before,'spur_gear',{geometry:{...g,toothOverrides:{tooth_0003:{addendumScale:0.9}}}}),history=new ElementHistory(before);history.commit(edited);
  assert.equal(serializeProject(history.undo()),serializeProject(before));assert.equal(serializeProject(history.redo()),serializeProject(edited));assert.deepEqual(parseProject(serializeProject(edited)),edited);
  write('gear-before.elements.json',serializeProject(before));write('gear-after.elements.json',serializeProject(edited));
  await binary('gear-before.glb',exportSelectedScene(before,['spur_gear']));await binary('gear-after.glb',exportSelectedScene(edited,['spur_gear']));
  const piece=structuredClone(edited);piece.parts[0].geometry=extractToothGeometry(edited.parts[0].geometry as typeof g,'tooth_0003');const scene=exportSelectedScene(piece,['spur_gear']);
  scene.root.getObjectByName('spur_gear')!.name='spur_gear/tooth_0003';scene.root.userData.extraction={sourceFeatureId:'spur_gear/tooth_0003',kind:'diagnostic-sector-cut',detachable:false};await binary('tooth.glb',scene);
  const r=createElementDomainRegistry();r.register(bearingPack);r.register(gearPack);let w:ElementWorkspace={schema:'morphloom.workspace/0.1',units:'mm',coordinates:'right-handed-y-up',assets:[]};
  for(const [id,packId,x] of [['bearing',bearingPack.metadata.id,-40],['gear',gearPack.metadata.id,40]] as const)w=appendWorkspaceAsset(w,generateWorkspaceAsset(r,{id,packId,input:{},requiredCapabilities:['semantic-part-editing'],positionMm:[x,0,0],rotationRad:[0,0,0]}));
  const next=editWorkspacePart(w,'gear','spur_gear',{geometry:edited.parts[0].geometry}),a=buildWorkspaceScene(w,'detail',true),b=buildWorkspaceScene(next,'detail',true),fingerprints:Record<string,string>={};
  try{a.root.updateMatrixWorld(true);b.root.updateMatrixWorld(true);for(const part of w.assets[0].source.parts){const name=`bearing::${part.id}`,left=a.root.getObjectByName(name) as THREE.Mesh,right=b.root.getObjectByName(name) as THREE.Mesh;fingerprints[name]=meshHash(left);assert.equal(meshHash(right),fingerprints[name]);}}finally{a.dispose();b.dispose();}
  await binary('mixed.glb',buildWorkspaceScene(next,'detail',true));
  const sources=['src/engine/spur-gear.ts','src/engine/gear-pack.ts','src/engine/part-geometry.ts','src/engine/element-project.ts','src/engine/element-domain-packs.ts','src/engine/element-renderer.ts','src/PartInspector.tsx','src/ElementEditor.tsx','src/WorkspaceEditor.tsx','schemas/element-project-v3.schema.json','schemas/element-workspace.schema.json','tests/spur-gear.test.ts','scripts/spur-gear-evidence.ts'];
  const report={schema:'morphloom.spur-gear-evidence/0.1',status:'passed',packRevision:GEAR_PACK_REVISION,rendererRevision:ELEMENT_RENDERER_REVISION,environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model},sourceHashes:Object.fromEntries(sources.map(s=>[s,sha(fs.readFileSync(s))])),outputs,dimensions:gearDimensions(g),maximumFlankChordErrorMm:gearProfile(g).maximumFlankChordErrorMm,features:gearProfile(g).features.map(f=>({id:`spur_gear/${f.id}`,points:f.points.length,detachable:false})),nonTargetFingerprints:fingerprints,checks:{undo:true,redo:true,reopen:true,nonTargetGeometryUvPbrHierarchy:true},limitations:['radial root approximation, not trochoid','no manufacturing or meshing dynamics certification','no textures or tangent-space normal maps','no independent expert evaluation']};
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
