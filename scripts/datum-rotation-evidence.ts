import fs from 'node:fs';import assert from 'node:assert/strict';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';import {parseWorkspace,serializeWorkspace,buildWorkspaceScene,WORKSPACE_REVISION} from '../src/engine/element-workspace';import {inspectExportedUv} from '../src/engine/uv-delivery';import {ELEMENT_RENDERER_REVISION} from '../src/engine/element-renderer';
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob):void{void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}Object.assign(globalThis,{FileReader:Reader});
const out=process.argv[2]??'outputs/datum-rotation-20261002/current';fs.mkdirSync(out,{recursive:true});const baseline=parseWorkspace(fs.readFileSync('outputs/gear-chamfer-20261002/workspace-after.json','utf8')),rows=[];
for(const name of ['workspace','signed','boundary','compound']){
 const p=structuredClone(baseline),gear=p.assets.find(a=>a.id==='gear')!;
 if(name==='signed'){gear.rotationRad=[-2.3,1.7,-.4];gear.source.parts[0].rotation=[-.2,.4,.9];}
 if(name==='boundary'){gear.rotationRad=[2*Math.PI,-2*Math.PI,Math.PI];gear.source.parts[0].rotation=[Math.PI/2,-Math.PI/2,2*Math.PI];gear.positionMm=[1e6,-1e6,1e6];}
 if(name==='compound'){gear.rotationRad=[-Math.PI,.3333333333333333,1.23456789012345];gear.source.parts[0].rotation=[-.34,.59,2.83];p.assets[0].rotationRad=[-.1,.3,.05];}
 const source=serializeWorkspace(p),scene=buildWorkspaceScene(p,'detail',true);
 try{const bytes=await new GLTFExporter().parseAsync(scene.root,{binary:true,onlyVisible:false}) as ArrayBuffer,r=await inspectExportedUv(bytes,source);assert(r.report.integrityPass);fs.writeFileSync(`${out}/${name}.json`,source);fs.writeFileSync(`${out}/${name}.glb`,new Uint8Array(bytes));fs.writeFileSync(`${out}/${name}.uv.json`,JSON.stringify(r,null,2));rows.push({name,source:r.sourceFingerprint,output:r.outputFingerprint,stats:scene.stats});}finally{scene.dispose();}
}
assert.equal(fs.readFileSync(`${out}/workspace.json`,'utf8'),serializeWorkspace(baseline));fs.writeFileSync(`${out}/evidence.json`,JSON.stringify({workspaceRevision:WORKSPACE_REVISION,rendererRevision:ELEMENT_RENDERER_REVISION,rows},null,2));
