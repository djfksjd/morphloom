/** Feasibility probe only: compares newly generated payload against actual source. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {parseProject,editPart} from '../src/engine/element-project';
import {exportSelectedScene} from '../src/engine/element-renderer';
const [manifestPath,output]=process.argv.slice(2);assert(manifestPath&&output&&!fs.existsSync(output));
class Reader {result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:Reader});
function read(b:Uint8Array){const v=new DataView(b.buffer,b.byteOffset,b.byteLength),n=v.getUint32(12,true);return {json:JSON.parse(new TextDecoder().decode(b.subarray(20,20+n))),bin:b.slice(20+n)};}
const cases=JSON.parse(fs.readFileSync(manifestPath,'utf8')),rows=[];
for(const c of cases){
 const original=read(fs.readFileSync(c.source)),owners=original.json.nodes.filter((n:any)=>n.extras?.sourceSpec);
 if(owners.length!==1||!owners[0].extras.selectedIds){rows.push({id:c.id,status:'unsupported',reason:'One native source with selected IDs required'});continue;}
 const project=parseProject(JSON.stringify(owners[0].extras.sourceSpec)),ids=owners[0].extras.selectedIds;
 const part=project.parts.find(p=>p.id===c.node);if(!part){rows.push({id:c.id,status:'unsupported',reason:'Target source part unavailable'});continue;}
 const delta=c.translationMm??[2,0,0],edited=editPart(project,part.id,{position:part.position.map((v,i)=>v+delta[i]) as [number,number,number]});
 const build=exportSelectedScene(edited,ids);
 try {
  const regenerated=read(new Uint8Array(await new GLTFExporter().parseAsync(build.root,{binary:true}) as ArrayBuffer));
  const normalDifferences=[];
  for(let meshIndex=0;meshIndex<original.json.meshes.length;meshIndex++){
    const ai=original.json.meshes[meshIndex].primitives[0].attributes.NORMAL,bi=regenerated.json.meshes[meshIndex].primitives[0].attributes.NORMAL;
    const a=original.json.accessors[ai],b=regenerated.json.accessors[bi],av=original.json.bufferViews[a.bufferView],bv=regenerated.json.bufferViews[b.bufferView];
    const da=new DataView(original.bin.buffer,original.bin.byteOffset),db=new DataView(regenerated.bin.buffer,regenerated.bin.byteOffset);let changed=0,maxDifference=0;let first:any=null;
    for(let i=0;i<a.count*3;i++){const va=da.getFloat32(8+(av.byteOffset??0)+(a.byteOffset??0)+i*4,true),vb=db.getFloat32(8+(bv.byteOffset??0)+(b.byteOffset??0)+i*4,true);if(va!==vb){changed++;maxDifference=Math.max(maxDifference,Math.abs(va-vb));first??={index:i,a:va,b:vb};}}
    normalDifferences.push({meshIndex,accessorLayoutExact:JSON.stringify(a)===JSON.stringify(b)&&JSON.stringify(av)===JSON.stringify(bv),changed,maxDifference,first});
  }
  const diffs=[];for(let i=8;i<Math.min(original.bin.length,regenerated.bin.length);i++)if(original.bin[i]!==regenerated.bin[i]){if(diffs.length<10)diffs.push(i-8);}
  const affected=original.json.accessors.map((a:any,i:number)=>{const v=original.json.bufferViews[a.bufferView],start=(v.byteOffset??0)+(a.byteOffset??0),end=(v.byteOffset??0)+v.byteLength;return diffs.some(p=>p>=start&&p<end)?{accessor:i,type:a.type,componentType:a.componentType,count:a.count}:null;}).filter(Boolean);
  rows.push({id:c.id,status:'probe',binExact:Buffer.from(regenerated.bin).equals(original.bin),originalBinBytes:original.bin.length,newBinBytes:regenerated.bin.length,parts:project.parts.length,firstDifferentOffsets:diffs,affectedAccessors:affected,normalDifferences});
 }finally{build.dispose();}
}
fs.writeFileSync(output,JSON.stringify({scope:'Feasibility only; no editable source delivery claim',rows},null,2)+'\n');console.log(JSON.stringify(rows));
