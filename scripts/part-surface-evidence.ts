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


const out=process.argv[2]??'outputs/part-surface-20261002/current';fs.mkdirSync(out,{recursive:true});const rows=[];
for(const [name,fixture,finish,index] of [['gear','outputs/gear-chamfer-20261002/current/gear.elements.json','brushed-metal',0],['small','outputs/gear-chamfer-20261002/current/small.elements.json','anodized-metal',0],['bearing','outputs/uv-scale-20261002/current/bearing.elements.json','bead-blasted-metal',2],['ball','outputs/uv-scale-20261002/current/bearing.elements.json','brushed-metal',3]] as const){
 const old=parseProject(fs.readFileSync(fixture,'utf8')),p=migrateElementProjectToV6(old),target=p.parts[index].id,q=editPart(p,target,{material:{roughness:p.parts[index].material!.roughness,metalness:p.parts[index].material!.metalness,surface:{finish,channels:'roughness-only',repeat:[8,8]}}});
 fs.writeFileSync(`${out}/${name}-before.elements.json`,serializeProject(p));fs.writeFileSync(`${out}/${name}.elements.json`,serializeProject(q));const a=exportSelectedScene(p,p.parts.map(p=>p.id)),b=exportSelectedScene(q,q.parts.map(p=>p.id));
 try{for(const [suffix,scene] of [['-before',a],['',b]] as const){const bytes=await new GLTFExporter().parseAsync(scene.root,{binary:true,onlyVisible:false}) as ArrayBuffer;fs.writeFileSync(`${out}/${name}${suffix}.glb`,new Uint8Array(bytes));}for(const part of p.parts){const x=a.root.getObjectByName(part.id) as T.Mesh,y=b.root.getObjectByName(part.id) as T.Mesh;for(const key of ['position','normal','uv'])assert.deepEqual(x.geometry.getAttribute(key).array,y.geometry.getAttribute(key).array);assert.deepEqual(x.matrix.toArray(),y.matrix.toArray());if(part.id!==target){assert.equal((x.material as T.MeshStandardMaterial).roughness,(y.material as T.MeshStandardMaterial).roughness);assert.deepEqual((x.material as T.MeshStandardMaterial).color.toArray(),(y.material as T.MeshStandardMaterial).color.toArray());}}
 const m=(b.root.getObjectByName(target) as T.Mesh).material as T.MeshPhysicalMaterial;assert.equal(m.normalMap,null);const image=m.roughnessMap!.image as {data:Uint8Array;width:number;height:number};fs.writeFileSync(`${out}/${name}.rgba`,image.data);rows.push({name,target,finish,pixelSha256:createHash('sha256').update(image.data).digest('hex'),size:[image.width,image.height],repeat:m.roughnessMap!.repeat.toArray(),stats:b.stats,cache:inspectSharedSurfaceCache()});
 }finally{a.dispose();b.dispose();}
}
fs.writeFileSync(`${out}/evidence.json`,JSON.stringify({rendererRevision:ELEMENT_RENDERER_REVISION,rows},null,2));
