import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import * as THREE from 'three';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {compileDepthSurface,type DepthSurfaceSource} from '../src/engine/depth-surface';import {sphereFrontConstraintFromAssembly} from '../src/engine/depth-boundary';
import {analyzeTopology} from '../src/engine/topology';import {inspectExportedUv} from '../src/engine/uv-delivery';import {validateGlbStandard} from '../src/engine/gltf-standard-validation';
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob){void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}Object.assign(globalThis,{FileReader:Reader});
const out=path.resolve(process.argv[2]??'outputs/depth-boundary-20261003'),hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),rows=[];
const originalProjectPath='outputs/texel-density-20261002/browser/bearing.elements.json';
const projectPath=fs.existsSync(originalProjectPath)?originalProjectPath:path.join(out,'bearing.elements.json');
const beforeProject=fs.readFileSync(projectPath),project=JSON.parse(beforeProject.toString()),ball=project.parts.find((p:{id:string})=>p.id==='ball_0000');assert(ball.geometry.op==='sphere'&&ball.geometry.radius===3);
for(const file of fs.readdirSync(path.join(out,'fixtures')).filter(n=>n.endsWith('.depth.json')).sort()){
 const input:DepthSurfaceSource=JSON.parse(fs.readFileSync(path.join(out,'fixtures',file),'utf8'));let rawBlocked=false;
 try{const c=compileDepthSurface(input);c.geometry.dispose();}catch{rawBlocked=true;}assert(rawBlocked);
 if(input.id==='ball_0000')assert.deepEqual(input.primaryForm,sphereFrontConstraintFromAssembly(ball.geometry,[0,0,0],'authored-fixture',.001));
 const raw=compileDepthSurface(input,{diagnostic:true});
 const legacy={...input,schema:'morphloom.depth-surface/0.1' as const};delete legacy.quality;delete legacy.primaryForm;delete legacy.preview;
 const old=compileDepthSurface(legacy,{diagnostic:true});for(const key of ['position','normal','uv'])assert.deepEqual(raw.geometry.attributes[key]!.array,old.geometry.attributes[key]!.array);assert.deepEqual(raw.geometry.index!.array,old.geometry.index!.array);old.geometry.dispose();
 for(const mode of input.primaryForm?['raw','candidate']:['raw']){
  const source={...input,...(mode==='candidate'?{preview:'declared-sphere-front' as const}:{})},compiled=mode==='candidate'?compileDepthSurface(source,{diagnostic:true}):raw;
  const name=input.id+'.'+mode,root=new THREE.Group();root.name='depth-reference';root.userData={purpose:'diagnostic',releaseAllowed:false,originalRepresentation:'relative-depth-field'};
  const material=new THREE.MeshStandardMaterial({color:'#a7a7a7',roughness:.75,side:THREE.DoubleSide});const mesh=new THREE.Mesh(compiled.geometry,material);mesh.name=input.id;root.add(mesh);
  try{
   let vertexMaeMm=0,vertexMaxMm=0;
   if(input.primaryForm){const [cx,cy,cz]=input.primaryForm.centerMm,r=input.primaryForm.radiusMm,p=compiled.geometry.attributes.position!;
    for(let i=0;i<p.count;i++){const x=p.getX(i)*1000,y=p.getY(i)*1000,expected=cz+Math.sqrt(Math.max(0,r*r-(x-cx)**2-(y-cy)**2)),error=Math.abs(p.getZ(i)*1000-expected);vertexMaeMm+=error;vertexMaxMm=Math.max(vertexMaxMm,error);}vertexMaeMm/=p.count;
    if(mode==='candidate'){assert(vertexMaxMm<.001);assert(compiled.report.candidate?.validationPass);assert.equal(compiled.report.quality.pass,false);assert.deepEqual(compiled.geometry.attributes.uv!.array,raw.geometry.attributes.uv!.array);assert.deepEqual(compiled.geometry.index!.array,raw.geometry.index!.array);assert.deepEqual(compiled.sourcePixels,raw.sourcePixels);for(let i=0;i<p.count;i++){assert.equal(p.getX(i),raw.geometry.attributes.position!.getX(i));assert.equal(p.getY(i),raw.geometry.attributes.position!.getY(i));}}
   }
   const topology=analyzeTopology(root);assert.equal(topology.degenerateTriangles,0);assert.equal(topology.nonManifoldEdges,0);assert.equal(topology.selfIntersections,0);assert(topology.selfIntersectionComplete);
   const bytes=await new GLTFExporter().parseAsync(root,{binary:true}) as ArrayBuffer,standard=await validateGlbStandard(bytes),sourceJson=JSON.stringify(source),uv=await inspectExportedUv(bytes,sourceJson);assert.equal(standard.status,'pass');assert(uv.report.integrityPass);for(const m of uv.report.meshes)delete m.triangles;
   fs.writeFileSync(path.join(out,name+'.glb'),new Uint8Array(bytes));fs.writeFileSync(path.join(out,name+'.depth.json'),sourceJson);
   rows.push({name,id:input.id,mode,sourceSha256:hash(sourceJson),outputSha256:hash(new Uint8Array(bytes)),rawBlocked,rawPreserved:true,vertexMaeMm,vertexMaxMm,report:compiled.report,topology,standard,uv});console.log(JSON.stringify({name,vertexMaeMm,vertexMaxMm,rawBlocked,quality:compiled.report.quality.pass,candidate:compiled.report.candidate?.validationPass}));
  }finally{material.dispose();if(mode==='candidate')compiled.geometry.dispose();}
 }
 if(!input.primaryForm){const torus={...input,primaryForm:sphereFrontConstraintFromAssembly({op:'sphere',radius:64},[0,0,0],'authored-fixture',.001)};assert.throws(()=>compileDepthSurface(torus,{diagnostic:true,candidate:'declared-sphere-front'}),/silhouette/);}
 raw.geometry.dispose();
}
assert(beforeProject.equals(fs.readFileSync(projectPath)));fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({schema:'morphloom.depth-boundary-evidence/0.1',priorProjectSha256:hash(beforeProject),priorProjectUnchanged:true,rows},null,2));
