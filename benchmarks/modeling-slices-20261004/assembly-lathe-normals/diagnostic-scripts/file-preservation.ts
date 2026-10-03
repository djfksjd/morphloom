import {WebIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out='/Users/danny/Documents/morphloom/outputs/lathe-shading-goal-20261004';
const hash=(a:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const rows=[];
for(const id of ['small','default','large','solid']){
 const io=new WebIO().registerExtensions(ALL_EXTENSIONS),a=await io.readBinary(new Uint8Array(readFileSync(`${out}/verified/${id}-before.glb`))),b=await io.readBinary(new Uint8Array(readFileSync(`${out}/verified/${id}-after.glb`)));
 const snapshot=(d:typeof a)=>d.getRoot().listNodes().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName(),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale(),primitives:n.getMesh()?.listPrimitives().map(p=>({mode:p.getMode(),index:p.getIndices()?hash(p.getIndices()!.getArray()!):null,material:p.getMaterial()?.getName(),attributes:Object.fromEntries(p.listSemantics().map(s=>[s,hash(p.getAttribute(s)!.getArray()!)]))}))}));
 const sa=snapshot(a),sb=snapshot(b);let changed=0;
 for(let i=0;i<sa.length;i++)if(sa[i].name==='bushing')for(let j=0;j<(sa[i].primitives?.length??0);j++){assert.notEqual(sa[i].primitives![j].attributes.NORMAL,sb[i].primitives![j].attributes.NORMAL);sb[i].primitives![j].attributes.NORMAL=sa[i].primitives![j].attributes.NORMAL;changed++;}
 assert.equal(changed,1);assert.deepEqual(sb,sa);
 const raw=(name:string)=>{const buf=readFileSync(`${out}/verified/${id}-${name}.glb`);return JSON.parse(buf.subarray(20,20+buf.readUInt32LE(12)).toString());};assert.deepEqual(raw('before').materials,raw('after').materials);
 const material=(d:typeof a)=>d.getRoot().listMaterials().map(m=>({name:m.getName(),color:m.getBaseColorFactor(),metalness:m.getMetallicFactor(),roughness:m.getRoughnessFactor(),doubleSided:m.getDoubleSided(),alpha:m.getAlphaMode(),emissive:m.getEmissiveFactor()}));assert.deepEqual(material(a),material(b));
 rows.push({id,pass:true,scope:'Independent WebIO actual accessor bytes, index, material values, named hierarchy and transforms; only target NORMAL differs',nodes:sa});
}
writeFileSync(out+'/file-preservation.json',JSON.stringify(rows,null,2));console.log(rows.map(r=>({id:r.id,pass:r.pass})));
