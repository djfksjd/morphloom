import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Canvas,ImageData} from '@napi-rs/canvas';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {compileAssemblyIR} from '../src/engine/assembly-compiler';
import {COOLING_ASSEMBLY_IR} from '../src/engine/cooling-assembly';

import {createPortableGltfExportInput,preparePortableGltfGeometry} from '../src/engine/gltf-export-preparation';
import {canonicalizeGlbBufferViews} from '../src/engine/glb-canonicalization';
import {validateGlbStandard} from '../src/engine/gltf-standard-validation';
import {DELIVERY_PIPELINE_REVISION} from '../src/engine/delivery-validation';
import type {AssemblyIR} from '../src/engine/assembly-ir';
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


const out=resolve(process.argv[2]??'outputs/wire-cap-finish');mkdirSync(out,{recursive:true});
const old=JSON.parse(readFileSync(new URL('../benchmarks/modeling-slices-20261003/wire-cap-finish/before.assembly.json',import.meta.url),'utf8')) as AssemblyIR;
const rows=[];
for(const [id,ir] of [['legacy',old],['corrected',COOLING_ASSEMBLY_IR]] as const){
 const hashes:string[]=[];let row:unknown;
 for(let repeat=0;repeat<2;repeat++){
  const b=compileAssemblyIR(ir,'beauty');
  try{
   preparePortableGltfGeometry(b.root);
   const result=await new GLTFExporter().parseAsync(createPortableGltfExportInput(b.root),{binary:true,onlyVisible:true,includeCustomExtensions:true,animations:b.root.animations});
   if(!(result instanceof ArrayBuffer))throw Error('Binary output missing');
   const bytes=canonicalizeGlbBufferViews(result),validation=await validateGlbStandard(bytes);
   if(validation.status!=='pass')throw Error('Actual Khronos bytes rejected: '+JSON.stringify(validation));
   hashes.push(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
   if(repeat===0){writeFileSync(resolve(out,id+'.glb'),Buffer.from(bytes));writeFileSync(resolve(out,id+'.assembly.json'),JSON.stringify(ir,null,2));row={id,sha256:hashes[0],bytes:bytes.byteLength,topology:b.metrics.topology,validation,bounds:{min:b.metrics.bounds.min.toArray(),max:b.metrics.bounds.max.toArray()},triangles:b.metrics.triangles};}
  }finally{b.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
 }
 if(hashes[0]!==hashes[1])throw Error('Non-deterministic output');rows.push({...(row as object),repeatSha256:hashes[1]});
}
writeFileSync(resolve(out,'geometry-and-glb.json'),JSON.stringify({compiler:DELIVERY_PIPELINE_REVISION,rows},null,2));console.log(JSON.stringify({compiler:DELIVERY_PIPELINE_REVISION,rows},null,2));
