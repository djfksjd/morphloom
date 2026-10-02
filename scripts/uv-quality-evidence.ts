import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {parseProject,serializeProject} from '../src/engine/element-project';import {exportSelectedScene,ELEMENT_RENDERER_REVISION} from '../src/engine/element-renderer';import {auditDomainReadiness} from '../src/engine/domain-readiness';import {inspectExportedUv} from '../src/engine/uv-delivery';import {sha256} from '../src/engine/uv-quality';
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob):void{void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:Reader});
const out=path.resolve(process.argv[2]??'outputs/uv-quality-20261002/current');fs.mkdirSync(out,{recursive:true});const baseline=JSON.parse(fs.readFileSync('outputs/uv-quality-20261002/baseline.json','utf8')),evidence:Record<string,unknown>={};
for(const name of ['gear','small','large','bearing','extrude']){
 const source=serializeProject(parseProject(fs.readFileSync(`outputs/extrude-uv-20261002/current/${name}.elements.json`,'utf8'))),p=parseProject(source),scene=exportSelectedScene(p,p.parts.map(p=>p.id));
 try{
  const bytes=await new GLTFExporter().parseAsync(scene.root,{binary:true,onlyVisible:false}) as ArrayBuffer;
  fs.writeFileSync(path.join(out,`${name}.glb`),new Uint8Array(bytes));fs.writeFileSync(path.join(out,`${name}.elements.json`),source);
  const loaded=await new GLTFLoader().parseAsync(bytes,'');const legacy=auditDomainReadiness({domain:'industrial-design',root:loaded.scene,evidenceScore:0,deterministic:true,browserGlbRoundTrip:true});
  assert.equal(legacy.metrics.degenerateUvTriangleFraction,baseline[name].report.metrics.degenerateUvTriangleFraction);assert.equal(legacy.metrics.uvFiniteCoverage,baseline[name].report.metrics.uvFiniteCoverage);
  loaded.scene.traverse(o=>{if('geometry' in o)(o.geometry as {dispose:()=>void}).dispose();});
  const receipt=await inspectExportedUv(bytes,source);fs.writeFileSync(path.join(out,`${name}.uv.json`),JSON.stringify(receipt,null,2)+'\n');
  assert.equal(receipt.outputFingerprint,await sha256(new Uint8Array(bytes)));assert.equal(receipt.sourceFingerprint,await sha256(source));
  evidence[name]={sourceFingerprint:receipt.sourceFingerprint,outputFingerprint:receipt.outputFingerprint,integrityPass:receipt.report.integrityPass,legacyAggregateUvPass:legacy.checks.find(c=>c.id==='design-uv')!.pass,legacyDegenerateFraction:legacy.metrics.degenerateUvTriangleFraction,meshes:receipt.report.meshes.map(m=>({id:m.id,criticalFeatures:m.criticalFeatures,degenerate:m.degenerateUvTriangles,eligible:m.eligibleUvTriangles,overlap:m.overlap})),cost:receipt.report.cost};
 }finally{scene.dispose();}
}
fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({schema:'morphloom.uv-quality-evidence/0.1',rendererRevision:ELEMENT_RENDERER_REVISION,evidence},null,2)+'\n');
