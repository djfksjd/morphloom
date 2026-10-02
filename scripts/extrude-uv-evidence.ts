import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {parseProject,serializeProject} from '../src/engine/element-project';
import {exportSelectedScene,ELEMENT_RENDERER_REVISION} from '../src/engine/element-renderer';
import {analyzeTopology} from '../src/engine/topology';import {EXTRUDE_UV_REVISION} from '../src/engine/extrude-uv';
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob):void{void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:Reader});
async function main():Promise<void>{
 const out=path.resolve(process.argv[2]??'outputs/extrude-uv-20261002/current');fs.mkdirSync(out,{recursive:true});
 const bearing=parseProject(fs.readFileSync('outputs/bearing-slice-20261002/replay/bearing-before.elements.json','utf8'));
 const extrude=generateSpurGearProject({});extrude.parts[0].geometry={op:'extrude',points:[[-8,-4],[8,-4],[8,4],[-8,4]],depth:4,bevelSize:0.2,bevelThickness:0.2,bevelSegments:3};
 const fixtures={gear:generateSpurGearProject({}),small:generateSpurGearProject({moduleMm:0.2,toothCount:18,pressureAngleDeg:20,faceWidthMm:2,boreDiameterMm:1}),large:generateSpurGearProject({moduleMm:2,toothCount:40,pressureAngleDeg:25,faceWidthMm:12,boreDiameterMm:10}),bearing,extrude};
 const outputs:Record<string,unknown>={};for(const [name,p]of Object.entries(fixtures)){
  const source=serializeProject(p);fs.writeFileSync(path.join(out,`${name}.elements.json`),source);const scene=exportSelectedScene(p,p.parts.map(v=>v.id));
  try{assert.equal(analyzeTopology(scene.root).pass,true);const bytes=new Uint8Array(await new GLTFExporter().parseAsync(scene.root,{binary:true,onlyVisible:false}) as ArrayBuffer);fs.writeFileSync(path.join(out,`${name}.glb`),bytes);outputs[name]={sourceSha256:createHash('sha256').update(source).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,triangles:scene.stats.triangles,topology:true};}finally{scene.dispose();}
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({schema:'morphloom.extrude-uv-evidence/0.1',uvRevision:EXTRUDE_UV_REVISION,rendererRevision:ELEMENT_RENDERER_REVISION,outputs},null,2)+'\n');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
