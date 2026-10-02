import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { bearingPack, generateBearingProject, BEARING_PACK_REVISION } from '../src/engine/bearing-pack';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs';
import { buildElementScene, exportSelectedScene, ELEMENT_RENDERER_REVISION } from '../src/engine/element-renderer';
import { editPart, detachPart, restorePart, serializeProject, parseProject, ElementHistory } from '../src/engine/element-project';
import { analyzeTopology } from '../src/engine/topology';

class NodeFileReader {
  result:ArrayBuffer|null=null;
  onloadend:(()=>void)|null=null;
  onerror:((error:unknown)=>void)|null=null;
  readAsArrayBuffer(blob:Blob):void { void blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();},error=>this.onerror?.(error)); }
}
Object.assign(globalThis,{FileReader:NodeFileReader});
const out=path.resolve(process.argv[2]??'outputs/bearing-slice-20261002/current');
fs.mkdirSync(out,{recursive:true});
const sha=(value:Uint8Array|string):string=>createHash('sha256').update(value).digest('hex');
const outputs:Record<string,unknown>={},checks:Record<string,boolean>={};
const report:Record<string,unknown>={status:'failed',schema:'morphloom.bearing-slice-evidence/0.1',packRevision:BEARING_PACK_REVISION,rendererRevision:ELEMENT_RENDERER_REVISION,
  environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model},outputs,checks};
function check(name:string,value:unknown):void { checks[name]=Boolean(value);assert.ok(value,name); }
function write(name:string,value:Uint8Array|string):void { fs.writeFileSync(path.join(out,name),value);outputs[name]={sha256:sha(value),bytes:Buffer.byteLength(value)}; }
function meshHash(mesh:THREE.Mesh):string {
  const h=createHash('sha256'),m=mesh.material as THREE.MeshStandardMaterial;
  h.update(JSON.stringify([mesh.name,mesh.parent?.name,mesh.matrixWorld.toArray(),m.color.toArray(),m.roughness,m.metalness]));
  for(const key of Object.keys(mesh.geometry.attributes).sort()) { const a=mesh.geometry.getAttribute(key).array;h.update(key);h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)); }
  const a=mesh.geometry.index?.array;if(a)h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
  return h.digest('hex');
}
async function main():Promise<void> {
  const registry=createElementDomainRegistry();registry.register(bearingPack);
  const original=registry.generate('mechanical.bearing.visual',{},['semantic-part-editing','selected-scene-export']);
  write('bearing-before.elements.json',serializeProject(original));
  const edited=editPart(original,'ball_0000',{geometry:{op:'sphere',radius:2.8,widthSegments:48,heightSegments:32},color:'#9daebb',material:{roughness:0.32,metalness:0.9}});
  const history=new ElementHistory(original);history.commit(edited);
  check('undo',serializeProject(history.undo())===serializeProject(original));check('redo',serializeProject(history.redo())===serializeProject(edited));
  const extracted=detachPart(edited,'ball_0000');write('bearing-extracted.elements.json',serializeProject(extracted));
  const reopened=parseProject(serializeProject(extracted));const restored=restorePart(reopened,'ball_0000');
  check('restore-membership-position-and-retain-shape-material',serializeProject(restored)===serializeProject(edited));
  write('bearing-after.elements.json',serializeProject(restored));
  const before=buildElementScene(original,'detail'),after=buildElementScene(restored,'detail');
  try {
    before.root.updateMatrixWorld(true);after.root.updateMatrixWorld(true);
    const nonTargets:Record<string,string>={};
    for(const p of original.parts) if(p.id!=='ball_0000') {
      const a=before.root.getObjectByName(p.id) as THREE.Mesh,b=after.root.getObjectByName(p.id) as THREE.Mesh;
      const fingerprint=meshHash(a);check(`preserved:${p.id}`,fingerprint===meshHash(b));nonTargets[p.id]=fingerprint;
    }
    report.nonTargetFingerprints=nonTargets;
    check('changed-target-mesh',meshHash(before.root.getObjectByName('ball_0000') as THREE.Mesh)!==meshHash(after.root.getObjectByName('ball_0000') as THREE.Mesh));
    const metric:Record<string,unknown>={};
    for(const id of ['inner_race','outer_race','cage','ball_0000']) {
      const mesh=before.root.getObjectByName(id) as THREE.Mesh;const g=mesh.geometry;g.computeBoundingBox();
      const size=g.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(1000).toArray();metric[id]={sizeMm:size,triangles:(g.index?.count??g.getAttribute('position').count)/3};
      if(id==='outer_race')check('outer-diameter-and-width',Math.abs(size[0]-40)<=0.01 && Math.abs(size[1]-12)<=0.01);
      if(id==='ball_0000')check('ball-diameter',size.every(x=>Math.abs(x-6)<=0.01));
      if(id==='inner_race') {
        const p=g.getAttribute('position');let minR=Infinity;
        for(let i=0;i<p.count;i++)minR=Math.min(minR,Math.hypot(p.getX(i),p.getZ(i))*1000);
        check('bore-diameter',Math.abs(minR*2-20)<=0.01);
      }
    }
    const cage=before.root.getObjectByName('cage') as THREE.Mesh;
    for(const p of original.parts.filter(p=>p.id.startsWith('ball_'))) {
      const ray=new THREE.Raycaster(new THREE.Vector3(p.position[0]/1000,0.05,p.position[2]/1000),new THREE.Vector3(0,-1,0));
      check(`actual-cage-pocket:${p.id}`,ray.intersectObject(cage,false).length===0);
    }
    const empty=new THREE.Raycaster(new THREE.Vector3(0,0.05,0),new THREE.Vector3(0,-1,0));check('actual-center-bore',empty.intersectObject(before.root,true).length===0);
    report.dimensions=metric;report.stats={before:before.stats,after:after.stats};
    const topology=analyzeTopology(after.root);check('topology',topology.pass);report.topology=topology;
    check('triangle-budget',after.stats.triangles<=100_000);
  } finally {before.dispose();after.dispose();}
  const variants=[];
  for(const input of [{boreDiameterMm:12,outerDiameterMm:30,widthMm:10,ballDiameterMm:5,ballCount:7},{boreDiameterMm:40,outerDiameterMm:80,widthMm:24,ballDiameterMm:12,ballCount:12}]) {
    const scene=buildElementScene(generateBearingProject(input),'detail');
    try {const topology=analyzeTopology(scene.root);check(`variant:${input.outerDiameterMm}mm`,topology.pass&&scene.stats.triangles<=100_000);variants.push({input,stats:scene.stats,topology});}
    finally {scene.dispose();}
  }
  report.variants=variants;
  for(const [name,project,ids] of [
    ['bearing-before.glb',original,original.parts.map(p=>p.id)],['bearing-after.glb',restored,restored.parts.map(p=>p.id)],
    ['selected-ball.glb',restored,['ball_0000']],['inner-race.glb',restored,['inner_race']],['cage.glb',restored,['cage']]
  ] as const) {
    const scene=exportSelectedScene(project,[...ids]);
    try {check(`export-topology:${name}`,analyzeTopology(scene.root).pass);const bytes=await new GLTFExporter().parseAsync(scene.root,{binary:true,onlyVisible:false});
      check(`export-binary:${name}`,bytes instanceof ArrayBuffer);write(name,new Uint8Array(bytes as ArrayBuffer));}
    finally {scene.dispose();}
  }
  const sources=['src/engine/element-project.ts','src/engine/element-domain-packs.ts','src/engine/element-renderer.ts','src/engine/part-geometry.ts','src/engine/assembly-compiler.ts','src/engine/bearing-pack.ts','src/ElementEditor.tsx','src/PartInspector.tsx','scripts/bearing-slice-evidence.ts'];
  report.sourceHashes=Object.fromEntries(sources.map(file=>[file,sha(fs.readFileSync(file))]));
  report.scope={evidence:'authored conceptual visualization',preserved:['stable names','baked geometry','UV','PBR factors','identity assembly hierarchy','original editable parameters in companion JSON'],lostFromGlb:['native procedural operations'],notVerified:['manufacturing clearances','load ratings','kinematics','independent human expert review','texture/tangent-space normal-map delivery']};
  report.status='passed';
}
try {await main();}
catch(error) {report.error=String(error);process.exitCode=1;}
finally {fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,checks,outputs}));}
