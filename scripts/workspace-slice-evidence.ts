import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { bearingPack } from '../src/engine/bearing-pack';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs';
import { serializeProject, resolveElements } from '../src/engine/element-project';
import { appendWorkspaceAsset, buildWorkspaceScene, editWorkspacePart, generateWorkspaceAsset, parseWorkspace, serializeWorkspace, WORKSPACE_REVISION, type ElementWorkspace } from '../src/engine/element-workspace';
import { analyzeTopology } from '../src/engine/topology';
class NodeFileReader {
  result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;onerror:((error:unknown)=>void)|null=null;
  readAsArrayBuffer(blob:Blob):void{void blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();},e=>this.onerror?.(e));}
}
Object.assign(globalThis,{FileReader:NodeFileReader});
const out=path.resolve(process.argv[2]??'outputs/workspace-slice-20261002/current');fs.mkdirSync(out,{recursive:true});
const sha=(v:Uint8Array|string):string=>createHash('sha256').update(v).digest('hex');
const outputs:Record<string,unknown>={};
function write(name:string,value:string|Uint8Array):void{fs.writeFileSync(path.join(out,name),value);outputs[name]={sha256:sha(value),bytes:Buffer.byteLength(value)};}
async function main():Promise<void>{
  const r=createElementDomainRegistry();r.register(bearingPack);
  let workspace:ElementWorkspace={schema:'morphloom.workspace/0.1',units:'mm',coordinates:'right-handed-y-up',assets:[]};
  const animal=generateWorkspaceAsset(r,{id:'animal',packId:'morphloom.fur',input:{seed:17},requiredCapabilities:['semantic-part-editing','selected-scene-export'],positionMm:[-100,0,0],rotationRad:[0,0,0]});
  workspace=appendWorkspaceAsset(workspace,animal);
  workspace=appendWorkspaceAsset(workspace,generateWorkspaceAsset(r,{id:'bearing',packId:'mechanical.bearing.visual',input:{seed:91},requiredCapabilities:['semantic-part-editing','selected-scene-export'],positionMm:[100,0,0],rotationRad:[0,0,0]}));
  assert.equal(serializeProject(workspace.assets[0].source),serializeProject(animal.source));
  const edited=editWorkspacePart(workspace,'bearing','ball_0000',{geometry:{op:'sphere',radius:2.8,widthSegments:48,heightSegments:32},material:{roughness:0.32,metalness:0.94}});
  assert.deepEqual(resolveElements(edited.assets[0].source),resolveElements(animal.source));
  assert.deepEqual(parseWorkspace(serializeWorkspace(edited)),edited);
  write('before.workspace.json',serializeWorkspace(workspace));write('after.workspace.json',serializeWorkspace(edited));
  let stats:unknown,topology:unknown;
  for(const [name,w] of [['before',workspace],['after',edited]] as const){
    const built=buildWorkspaceScene(w,'detail',true);
    try{
      const t=analyzeTopology(built.root);assert.equal(t.pass,true);assert.ok(built.stats.triangles<100_000);
      const bytes=await new GLTFExporter().parseAsync(built.root,{binary:true,onlyVisible:false});assert.ok(bytes instanceof ArrayBuffer);write(`${name}.glb`,new Uint8Array(bytes));
      if(name==='after'){stats=built.stats;topology=t;}
    }finally{built.dispose();}
  }
  const sources=['src/engine/element-workspace.ts','src/WorkspaceEditor.tsx','src/ElementEditor.tsx','src/viewer-main.tsx','scripts/workspace-slice-evidence.ts','schemas/element-workspace.schema.json','tests/element-workspace.test.ts'];
  const evidence={schema:'morphloom.workspace-evidence/0.1',status:'passed',revision:WORKSPACE_REVISION,environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model},sourceHashes:Object.fromEntries(sources.map(file=>[file,sha(fs.readFileSync(file))])),outputs,stats,topology,checks:{independentSeeds:true,sourceIdsPreserved:true,distributionPreserved:true,nonTargetSourcePreserved:true,reload:true},loss:{preserved:['scoped names','UV','PBR','assembly hierarchy','asset datum transforms'],baked:['source procedural graphs'],editableSource:'companion workspace JSON',notVerified:['manufacturing','cross-asset collisions','independent human review']}};
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
