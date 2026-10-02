import { Canvas, ImageData } from '@napi-rs/canvas';import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {createHash} from 'node:crypto';
import {createSurfaceMaterial,inspectSharedSurfaceCache,surfaceMapAllocationBytes} from '../src/engine/surface-system';
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


const out=process.argv[2];const filled=process.argv[3]==='filled';fs.mkdirSync(out,{recursive:true});
const materials:T.MeshPhysicalMaterial[]=[];const make=(scale:number)=>{const m=createSurfaceMaterial({color:'#555555',surface:'asphalt',textureScale:[scale,scale]},{mode:'beauty',category:'surface',materialName:'asphalt'});materials.push(m);return m;};
if(filled)for(let i=1;i<=32;i++)make(i);
const m=make(100),warm=make(100);const root=new T.Group();const geometry=new T.BoxGeometry(.1,.01,.1);const mesh=new T.Mesh(geometry,m);mesh.name='cache_fixture';root.add(mesh);root.updateMatrixWorld(true);
const glb=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false}) as ArrayBuffer;fs.writeFileSync(`${out}/fixture.glb`,new Uint8Array(glb));
const textures=new Set<T.Texture>();for(const material of materials)for(const t of [material.map,material.normalMap,material.roughnessMap])if(t?.userData.morphloomShared)textures.add(t);
let cpu=0,gpu=0;for(const t of textures){const image=t.image as {data:Uint8Array;width:number;height:number};cpu+=image.data.byteLength;let w=image.width,h=image.height;while(true){gpu+=w*h*4;if(w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}}
const image=m.roughnessMap!.image as {data:Uint8Array};assert.deepEqual(image.data,(warm.roughnessMap!.image as {data:Uint8Array}).data);let sharedDisposes=0,ownedDisposes=0;for(const t of textures)t.addEventListener('dispose',()=>sharedDisposes++);const owned=new Set<T.Texture>();for(const material of materials)for(const t of [material.map,material.normalMap,material.roughnessMap])if(t&&!t.userData.morphloomShared)owned.add(t);for(const t of owned)t.addEventListener('dispose',()=>ownedDisposes++);// This standalone fixture owns its materials; editor scene cleanup is tested separately.
for(const t of owned)t.dispose();for(const material of materials)material.dispose();geometry.dispose();
const result={filled,cache:inspectSharedSurfaceCache(),cpuPayloadBytes:cpu,gpuMipBytes:gpu,combinedBytes:cpu+gpu,allocation256:surfaceMapAllocationBytes(256),targetShared:m.roughnessMap!.userData.morphloomShared,warmIdentity:m.roughnessMap===warm.roughnessMap,sharedDisposes,ownedTextures:owned.size,ownedDisposes,pixelSha256:createHash('sha256').update(image.data).digest('hex'),glbSha256:createHash('sha256').update(new Uint8Array(glb)).digest('hex')};fs.writeFileSync(`${out}/evidence.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
assert.equal(sharedDisposes,0);assert.equal(ownedDisposes,owned.size);assert.ok(cpu+gpu<=result.cache.maximumBytes,'actual CPU + GPU mip payload exceeds cache budget');
