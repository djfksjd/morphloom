/** Actual GLB regression proof: a reference-only gear must never pass by losing tooth checks. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectUvQuality} from '../src/engine/uv-quality';
const [beforeFile, afterFile, output] = process.argv.slice(2);
assert(beforeFile && afterFile && output && !fs.existsSync(output));
const hash = (bytes: Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
const owned:T.Object3D[]=[];
async function read(file:string) {
  const bytes=fs.readFileSync(file);
  assert(bytes.length<=256000000 && bytes.length>=28 && bytes.subarray(0,4).toString()==='glTF');
  assert(bytes.readUInt32LE(4)===2 && bytes.readUInt32LE(8)===bytes.length);
  const size=bytes.readUInt32LE(12);assert(size<=16000000 && 20+size<=bytes.length);
  const document=JSON.parse(bytes.subarray(20,20+size).toString());
  assert(!(document.buffers??[]).some((v:{uri?:string})=>v.uri) && !(document.images??[]).some((v:{uri?:string})=>v.uri));
  assert((document.nodes?.length??0)<=10000 && (document.meshes?.length??0)<=128);
  const gltf=await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'');owned.push(...gltf.scenes);
  const report=await inspectUvQuality(gltf.scene);
  return {sha256:hash(bytes),binSha256:hash(bytes.subarray(20+size)),report};
}
try {
  const before=await read(beforeFile),after=await read(afterFile);
  assert(before.binSha256===after.binSha256,'Geometry/normal/UV/index/image bytes changed');
  assert.deepEqual(before.report.meshes.map(m=>m.id).sort(),after.report.meshes.map(m=>m.id).sort());
  const connected=before.report.meshes.filter(m=>m.features.length);
  assert(connected.length>0,'This proof requires a source with existing connected-feature checks');
  const rows=connected.map(m=>{
    const current=after.report.meshes.find(row=>row.id===m.id)!;
    assert(m.criticalFeatures==='pass' && m.integrityPass,'Baseline must be healthy');
    assert(!current.integrityPass && current.criticalFeatures==='fail' && current.blocked,'Reference cannot silently drop critical checks and pass');
    return {id:m.id,beforeFeatures:m.features.length,beforeIntegrity:m.integrityPass,afterFeatures:current.features.length,afterIntegrity:current.integrityPass,afterCriticalFeatures:current.criticalFeatures,reason:current.blocked};
  });
  fs.writeFileSync(output,JSON.stringify({pass:true,revision:after.report.revision,beforeSha256:before.sha256,afterSha256:after.sha256,binExact:true,rows,scope:'Actual sourceSpec relocation is safe only with explicit critical-feature BLOCKED; delivery and reference-to-geometry binding remain unsupported'},null,2)+'\n');
  console.log('PASS actual critical feature loss is blocked; no average-only approval');
} finally {
  const gs=new Set<T.BufferGeometry>(),ms=new Set<T.Material>(),ts=new Set<T.Texture>();
  for(const root of owned)root.traverse(o=>{if(o instanceof T.Mesh){gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){ms.add(m);for(const v of Object.values(m))if(v instanceof T.Texture)ts.add(v);}}});
  for(const g of gs)g.dispose();for(const m of ms)m.dispose();for(const t of ts)t.dispose();
}
