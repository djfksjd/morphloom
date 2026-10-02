import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {parseProject,serializeProject,migrateElementProjectToV5,editPart} from '../src/engine/element-project';
import {exportSelectedScene,ELEMENT_RENDERER_REVISION} from '../src/engine/element-renderer';import {inspectExportedUv} from '../src/engine/uv-delivery';import {analyzeTopology} from '../src/engine/topology';
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob):void{void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:Reader});
const out=path.resolve(process.argv[2]??'outputs/gear-chamfer-20261002/current');fs.mkdirSync(out,{recursive:true});const rows=[];
for(const name of ['gear','small','large','gear-before']){
 const old=parseProject(fs.readFileSync(`outputs/extrude-uv-20261002/current/${name==='gear-before'?'gear':name}.elements.json`,'utf8'));const p=editPart(migrateElementProjectToV5(old),old.parts[0].id,{uvScale:100,axialChamferMm:name==='gear-before'?0:(old.parts[0].geometry!.op==='spur-gear'?old.parts[0].geometry.moduleMm:1)*.05});
 const source=serializeProject(p),scene=exportSelectedScene(p,p.parts.map(p=>p.id));
 try{assert(analyzeTopology(scene.root).pass);const bytes=await new GLTFExporter().parseAsync(scene.root,{binary:true,onlyVisible:false}) as ArrayBuffer,receipt=await inspectExportedUv(bytes,source);assert(receipt.report.integrityPass);assert(receipt.report.meshes.every(m=>m.features.every(f=>f.integrityPass)));fs.writeFileSync(path.join(out,`${name}.glb`),new Uint8Array(bytes));fs.writeFileSync(path.join(out,`${name}.elements.json`),source);fs.writeFileSync(path.join(out,`${name}.uv.json`),JSON.stringify(receipt,null,2));rows.push({name,source:receipt.sourceFingerprint,output:receipt.outputFingerprint,integrityPass:true,topology:true,stats:scene.stats});}finally{scene.dispose();}
}
fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({rendererRevision:ELEMENT_RENDERER_REVISION,rows},null,2));
