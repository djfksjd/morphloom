import { Canvas, ImageData } from '@napi-rs/canvas';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {createHash} from 'node:crypto';
import {parseProject,serializeProject,migrateElementProjectToV6,editPart} from '../src/engine/element-project';import {exportSelectedScene,ELEMENT_RENDERER_REVISION} from '../src/engine/element-renderer';import {inspectSharedSurfaceCache} from '../src/engine/surface-system';
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      queueMicrotask(() => this.onloadend?.());
    });
  }
}

class NodeOffscreenCanvas extends Canvas {
  toBlob(callback: (blob: Blob) => void, type = 'image/png'): void {
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    const bytes = this.encodeSync(format);
    callback(new Blob([new Uint8Array(bytes)], { type }));
  }

  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    // GLTFExporter assigns image buffer views when encoding promises settle.
    // Native parallel encoders can finish in a different order, producing
    // byte-different (but semantically equal) GLBs. Synchronous encoding keeps
    // fixture order stable so a source hash is meaningful across clean runs.
    const bytes = this.encodeSync(format);
    return new Blob([new Uint8Array(bytes)], { type });
  }
}

Object.assign(globalThis, {
  FileReader: NodeFileReader,
  OffscreenCanvas: NodeOffscreenCanvas,
  ImageData,
});


import {createElementDomainRegistry} from '../src/engine/element-domain-packs';
import {surfaceGearPack} from '../examples/domain-packs/surface-gear-pack';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {generateWorkspaceAsset,appendWorkspaceAsset,buildWorkspaceScene,editWorkspacePart,WorkspaceHistory,serializeWorkspace,parseWorkspace,type ElementWorkspace} from '../src/engine/element-workspace';
import {validateGlbStandard} from '../src/engine/gltf-standard-validation';
const out=process.argv[2]??'outputs/domain-pack-v4-20261002/native';fs.mkdirSync(out,{recursive:true});const r=createElementDomainRegistry();r.register(surfaceGearPack);const rows=[];
async function save(name:string,root:T.Group,source:string){const data=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false}) as ArrayBuffer;fs.writeFileSync(`${out}/${name}.glb`,new Uint8Array(data));fs.writeFileSync(`${out}/${name}.json`,source);const standard=await validateGlbStandard(data);assert.equal(standard.errors,0);const receipt={outputFingerprint:createHash('sha256').update(new Uint8Array(data)).digest('hex'),standard,actualUvGate:'not-run in Node; browser fixture validates actual exported UV'};fs.writeFileSync(`${out}/${name}.receipt.json`,JSON.stringify(receipt));return {name,sourceSha256:createHash('sha256').update(source).digest('hex'),outputSha256:receipt.outputFingerprint,standard:receipt.standard};}
for(const [name,input] of [['default',{}],['small',{moduleMm:.7,toothCount:28,faceWidthMm:6,boreDiameterMm:4}],['large',{moduleMm:2,toothCount:32,faceWidthMm:12,boreDiameterMm:8}]] as const){const p=r.generate(surfaceGearPack.metadata.id,input,['authored-roughness-surface']),old=migrateElementProjectToV6(generateSpurGearProject(input)),a=exportSelectedScene(old,old.parts.map(p=>p.id)),b=exportSelectedScene(p,p.parts.map(p=>p.id));try{const x=a.root.getObjectByName(p.parts[0].id) as T.Mesh,y=b.root.getObjectByName(p.parts[0].id) as T.Mesh;for(const k of ['position','normal'])assert.deepEqual(x.geometry.getAttribute(k).array,y.geometry.getAttribute(k).array);assert.deepEqual(x.geometry.index?.array,y.geometry.index?.array);const u=x.geometry.getAttribute('uv').array,v=y.geometry.getAttribute('uv').array;for(let i=0;i<u.length;i++)assert.equal(v[i],Math.fround(u[i]*100));const m=y.material as T.MeshPhysicalMaterial;assert.equal(m.normalMap,null);assert.ok(m.roughnessMap);rows.push(await save(name,b.root,serializeProject(p)));}finally{a.dispose();b.dispose();}}
let w:ElementWorkspace={schema:'morphloom.workspace/0.1',units:'mm',coordinates:'right-handed-y-up',assets:[]};for(const [id,packId,input,positionMm] of [['animal','morphloom.fur',{seed:17},[-100,0,0]],['gear',surfaceGearPack.metadata.id,{seed:42},[100,0,0]]] as const)w=appendWorkspaceAsset(w,generateWorkspaceAsset(r,{id,packId,input,positionMm:[...positionMm],rotationRad:[0,0,0],requiredCapabilities:['semantic-part-editing','selected-scene-export']}));const original=serializeWorkspace(w),history=new WorkspaceHistory(w),part=w.assets[1].source.parts[0];w=editWorkspacePart(w,'gear',part.id,{material:{...part.material!,roughness:.52}});history.commit(w);assert.equal(serializeWorkspace(history.undo()),original);assert.equal(serializeWorkspace(history.redo()),serializeWorkspace(w));assert.deepEqual(parseWorkspace(serializeWorkspace(w)),w);assert.deepEqual(w.assets[0],parseWorkspace(original).assets[0]);const before=buildWorkspaceScene(parseWorkspace(original),'detail',true),after=buildWorkspaceScene(w,'detail',true);try{before.root.traverse(o=>{if(!(o instanceof T.Mesh))return;const q=after.root.getObjectByName(o.name) as T.Mesh;for(const k of ['position','normal','uv'])assert.deepEqual(o.geometry.getAttribute(k)?.array,q.geometry.getAttribute(k)?.array);assert.deepEqual(o.geometry.index?.array,q.geometry.index?.array);assert.deepEqual(o.matrix.toArray(),q.matrix.toArray());if(o.name!=='gear::spur_gear'){const a=o.material as T.MeshPhysicalMaterial,b=q.material as T.MeshPhysicalMaterial;assert.equal(a.roughness,b.roughness);assert.equal(a.metalness,b.metalness);assert.deepEqual(a.color.toArray(),b.color.toArray());}});rows.push(await save('mixed-before',before.root,original));rows.push(await save('mixed-after',after.root,serializeWorkspace(w)));}finally{before.dispose();after.dispose();}
fs.writeFileSync(`${out}/evidence.json`,JSON.stringify({rendererRevision:ELEMENT_RENDERER_REVISION,api:'0.4',rows},null,2));console.log(rows.map(x=>({name:x.name,source:x.sourceSha256,output:x.outputSha256})));
