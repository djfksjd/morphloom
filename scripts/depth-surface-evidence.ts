import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import * as THREE from 'three';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {compileDepthSurface} from '../src/engine/depth-surface';import {analyzeTopology} from '../src/engine/topology';
import {inspectExportedUv} from '../src/engine/uv-delivery';import {validateGlbStandard} from '../src/engine/gltf-standard-validation';
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob){void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:Reader});
const out=path.resolve(process.argv[2]??'outputs/depth-surface-20261003'),rows=[];
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
for(const file of fs.readdirSync(path.join(out,'fixtures')).filter(f=>f.endsWith('.depth.json')).sort()){
 const source=fs.readFileSync(path.join(out,'fixtures',file),'utf8'),input=JSON.parse(source);let generationBlocked=false;
 try{const trial=compileDepthSurface(input);trial.geometry.dispose();}catch{generationBlocked=true;}
 const a=compileDepthSurface(input,{diagnostic:true}),b=compileDepthSurface(input,{diagnostic:true});
 const geometryBytes=(g:THREE.BufferGeometry)=>Buffer.concat(['position','normal','uv'].map(k=>{const a=g.getAttribute(k).array;return Buffer.from(a.buffer,a.byteOffset,a.byteLength);}).concat([Buffer.from(g.index!.array.buffer,g.index!.array.byteOffset,g.index!.array.byteLength)]));
 assert(geometryBytes(a.geometry).equals(geometryBytes(b.geometry)));b.geometry.dispose();
 const root=new THREE.Group();root.name='depth-reference';root.userData={purpose:'diagnostic',releaseAllowed:false,originalRepresentation:'relative-depth-field'};
 const material=new THREE.MeshStandardMaterial({color:'#a7a7a7',roughness:.75,side:THREE.DoubleSide});const mesh=new THREE.Mesh(a.geometry,material);mesh.name=input.id;root.add(mesh);
 try{
  const topology=analyzeTopology(root);assert.equal(topology.degenerateTriangles,0);assert.equal(topology.nonManifoldEdges,0);assert.equal(topology.selfIntersections,0);assert(topology.boundaryEdges>0);
  const bytes=await new GLTFExporter().parseAsync(root,{binary:true}) as ArrayBuffer,standard=await validateGlbStandard(bytes),uv=await inspectExportedUv(bytes,source);assert.equal(standard.status,'pass');assert(uv.report.integrityPass);
  fs.writeFileSync(path.join(out,input.id+'.diagnostic.glb'),new Uint8Array(bytes));
  const row={id:input.id,sourceSha256:hash(source),outputSha256:hash(new Uint8Array(bytes)),geometrySha256:hash(geometryBytes(a.geometry)),generationBlocked,report:a.report,topology,standard,uv};rows.push(row);
  fs.writeFileSync(path.join(out,input.id+'.report.json'),JSON.stringify(row,null,2));console.log(JSON.stringify({id:row.id,generationBlocked,mae:a.report.validation.normalizedMae,max:a.report.validation.maximumNormalizedError,triangles:a.report.triangles}));
 }finally{a.geometry.dispose();material.dispose();}
}
fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({schema:'morphloom.depth-surface-evidence/0.1',rows},null,2));
