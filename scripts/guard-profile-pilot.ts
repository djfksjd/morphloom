/** Explicit fan fixture, not an ID branch in the compiler. Dimensions remain estimated. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { applyAssemblyComponentBatchPatch, fingerprintAssemblyIR, type AssemblyComponentBatchPatch } from '../src/engine/assembly-edit';
import { compileAssemblyGeometry, validateAssemblyIR } from '../src/engine/assembly-compiler';
import { createTubePath } from '../src/engine/tube-quadratic-curve';
import type { AssemblyIR } from '../src/engine/assembly-ir';
const input=resolve(process.argv[2] ?? 'outputs/product-photo-20261003/fan-negative.assembly.json');
const out=resolve(process.argv[3] ?? 'outputs/guard-profile-20261003');mkdirSync(out,{recursive:true});
const source=JSON.parse(readFileSync(input,'utf8')) as AssemblyIR;validateAssemblyIR(source);
const ringIds=Array.from({length:18},(_,i)=>`cage-front-ring-${i+1}`),spokeIds=Array.from({length:12},(_,i)=>`cage-front-spoke-${i+1}`);
const targets=[...ringIds,...spokeIds,'front-hub-cap'],inputFingerprint=await fingerprintAssemblyIR(source);
const radiusMm=216,riseMm=30,frame=new THREE.Matrix4().makeRotationX(-4*Math.PI/180).setPosition(0,44,0),inverse=frame.clone().invert();
const outward=new THREE.Vector3(0,0,-1).transformDirection(frame),deform=(v:THREE.Vector3)=>{const p=v.clone().applyMatrix4(inverse);p.z-=riseMm*(1-(p.x*p.x+p.y*p.y)/(radiusMm*radiusMm));return p.applyMatrix4(frame);};
const first:AssemblyComponentBatchPatch['edits']=[],second:AssemblyComponentBatchPatch['edits']=[];
const part=(id:string)=>{const c=source.components.find(c=>c.id===id);if(!c)throw new Error('Missing fixture component '+id);return c;};
for(const id of ringIds){const c=part(id);if(c.geometry.op!=='torus'||!c.position)throw new Error('Expected declared ring');const delta=outward.clone().multiplyScalar(riseMm*(1-(c.geometry.radius/radiusMm)**2));first.push({componentId:id,translateMm:delta.toArray() as [number,number,number]});}
for(const id of spokeIds){const c=part(id);if(c.geometry.op!=='tube'||c.geometry.points.length!==2||c.position||c.rotation||c.scale||c.geometry.curve)throw new Error('Fixture spokes must use two world-frame endpoints with no previous curve');
 const before=c.geometry.points.map(p=>new THREE.Vector3(...p)),after=before.map(deform),mid=deform(before[0]!.clone().lerp(before[1]!,.5));
 const control=mid.multiplyScalar(2).sub(after[0]!.clone().add(after[1]!).multiplyScalar(.5));
 first.push({componentId:id,geometry:{operation:'tube-point-deltas',deltas:after.map((p,i)=>({pointIndex:i,deltaMm:p.clone().sub(before[i]!).toArray() as [number,number,number]}))}});
 second.push({componentId:id,geometry:{operation:'tube-quadratic-control',action:'set',curve:{schema:'morphloom.tube-quadratic-bezier/0.1',controlPointMm:control.toArray() as [number,number,number]}}});
}
first.push({componentId:'front-hub-cap',translateMm:outward.clone().multiplyScalar(riseMm).toArray() as [number,number,number]});
const a=await applyAssemblyComponentBatchPatch(source,{schema:'morphloom.component-batch-patch/0.1',operationId:'front-guard-profile-endpoints',expectedInputFingerprint:inputFingerprint,edits:first});
const b=await applyAssemblyComponentBatchPatch(a.ir,{schema:'morphloom.component-batch-patch/0.2',operationId:'front-guard-profile-curves',expectedInputFingerprint:a.receipt.outputFingerprint,edits:second});
const domed=b.ir;validateAssemblyIR(domed);
for(const c of source.components.filter(c=>!targets.includes(c.id)))if(JSON.stringify(c)!==JSON.stringify(partFrom(domed,c.id)))throw new Error('Unrelated component changed');
function partFrom(ir:AssemblyIR,id:string){return ir.components.find(c=>c.id===id)!;}
let maximumCenterlineErrorMm=0;
for(const id of spokeIds){const c=partFrom(domed,id);if(c.geometry.op!=='tube')throw new Error('Spoke changed operation');const path=createTubePath(c.geometry);for(let i=0;i<=100;i++){const p=path.getPoint(i/100).multiplyScalar(1000).applyMatrix4(inverse);maximumCenterlineErrorMm=Math.max(maximumCenterlineErrorMm,Math.abs(p.z-(-42-riseMm*(1-(p.x*p.x+p.y*p.y)/(radiusMm*radiusMm)))));}const g=compileAssemblyGeometry(c.geometry);g.dispose();}
if(maximumCenterlineErrorMm>.1)throw new Error('Spoke centerline profile tolerance exceeded');
const half=structuredClone(domed);for(const c of half.components){c.position=(c.position??[0,0,0]).map(x=>x*.5) as [number,number,number];c.scale=(c.scale??[1,1,1]).map(x=>x*.5) as [number,number,number];if(c.material.referenceProjection)c.material.referenceProjection.boundsMm=c.material.referenceProjection.boundsMm.map(x=>x*.5) as [number,number,number,number];}
const alternate:AssemblyIR={schema:'morphloom.assembly/0.1',units:'mm',name:'authored rotated cable curve',components:[{id:'cable',name:'test cable',category:'interconnect',materialName:'rubber',detail:'authored conformance case, not a measured product',position:[25,-13,8],rotation:[.3,.5,.7],geometry:{op:'tube',points:[[-50,0,0],[90,80,25]],radius:1.3,tubularSegments:40,radialSegments:10,curve:{schema:'morphloom.tube-quadratic-bezier/0.1',controlPointMm:[20,60,40]}},material:{color:'#222222',surface:'rubber'}}]};
for(const [name,ir]of [['flat',source],['domed',domed],['half-domed',half],['alternate',alternate]] as const){validateAssemblyIR(ir);writeFileSync(resolve(out,name+'.assembly.json'),JSON.stringify(ir,null,2)+'\n');}
writeFileSync(resolve(out,'profile-receipt.json'),JSON.stringify({schema:'morphloom.guard-profile-pilot/0.1',inputFingerprint,outputFingerprint:await fingerprintAssemblyIR(domed),radiusMm,riseMm,evidenceStatus:'estimated',sourceGeometryAccuracy:'not-verified',targets,unaffectedComponents:70,maximumCenterlineErrorMm,operations:[a.receipt,b.receipt]},null,2)+'\n');
console.log(JSON.stringify({targets:targets.length,unaffected:70,maximumCenterlineErrorMm,inputFingerprint,outputFingerprint:await fingerprintAssemblyIR(domed)}));
