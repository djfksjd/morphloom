import {it,expect} from 'vitest';
import {Vector3} from 'three';
import {compileAssemblyGeometry} from '../src/engine/assembly-compiler';
const declaration={schema:'morphloom.lathe-normals/0.1',creaseAngleRad:Math.PI/6,weighting:'corner-angle'};
const geometry=(segments=32)=>({op:'lathe' as const,profile:[[8,-6],[8,6],[14,6],[14,-6],[8,-6]] as [number,number][],segments});
const error=(g:ReturnType<typeof compileAssemblyGeometry>)=>{
 const x=g.index?g.toNonIndexed():g,p=x.getAttribute('position'),n=x.getAttribute('normal');let worst=0;
 for(let i=0;i<p.count;i+=3){const a=new Vector3().fromBufferAttribute(p,i),b=new Vector3().fromBufferAttribute(p,i+1),c=new Vector3().fromBufferAttribute(p,i+2);const face=b.sub(a).cross(c.sub(a)).normalize();
  for(let k=i;k<i+3;k++){const q=new Vector3().fromBufferAttribute(p,k),expected=Math.abs(face.y)>.99?new Vector3(0,Math.sign(face.y),0):new Vector3(q.x,0,q.z).normalize().multiplyScalar(face.dot(new Vector3(q.x,0,q.z))<0?-1:1),actual=new Vector3().fromBufferAttribute(n,k).normalize();worst=Math.max(worst,Math.acos(Math.max(-1,Math.min(1,actual.dot(expected))))*180/Math.PI)}}
 if(x!==g)x.dispose();return worst;
};
it('keeps lathe caps planar and cylindrical side normals radial under the explicit declaration',()=>{
 for(const segments of [16,32,128]){const g=compileAssemblyGeometry({...geometry(segments),normalPolicy:declaration} as never);try{expect(error(g)).toBeLessThanOrEqual(.01)}finally{g.dispose()}}
});
it('rejects malformed or unsupported lathe normal declarations',()=>{
 for(const normalPolicy of [{...declaration,schema:'future'}, {...declaration,creaseAngleRad:NaN},{...declaration,creaseAngleRad:-1},{...declaration,weighting:'magic'},{...declaration,extra:true}])expect(()=>compileAssemblyGeometry({...geometry(),normalPolicy} as never)).toThrow();
 expect(()=>compileAssemblyGeometry({op:'sphere',radius:1,normalPolicy:declaration} as never)).toThrow();
});

import {Mesh} from 'three';
import {createHash} from 'node:crypto';
import {validateAssemblyIR,compileAssemblyIR} from '../src/engine/assembly-compiler';
import {applyAssemblyComponentPatch,fingerprintAssemblyIR,applyAssemblyComponentBatchPatch} from '../src/engine/assembly-edit';
import {migrateLatheNormalPolicy} from '../src/engine/lathe-normal-policy';
import {analyzeTopology} from '../src/engine/topology';
import type {AssemblyIR} from '../src/engine/assembly-ir';
const ir=():AssemblyIR=>({schema:'morphloom.assembly/0.1',name:'Authored bushing',units:'mm',components:[{id:'bushing',name:'Bushing',category:'mechanical',materialName:'raw metal',detail:'Authored diagnostic, no manufacturer measurements',geometry:geometry(),material:{color:'#888888',roughness:.3,metalness:.8}},{id:'preserved',name:'Preserved sphere',category:'mechanical',materialName:'raw',detail:'Independent sentinel',geometry:{op:'sphere',radius:2},position:[25,0,0],material:{color:'#bb8844'}}]});
const hash=(a:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
it('keeps exact legacy normal bytes and clears the opt-in without inserting defaults',()=>{
 const old=geometry(),g=compileAssemblyGeometry(old),clear=compileAssemblyGeometry(migrateLatheNormalPolicy(migrateLatheNormalPolicy(old,declaration as never),undefined));
 try{const expanded=g.index?g.toNonIndexed():g;try{expect(hash(expanded.getAttribute('normal').array)).toBe('9265c867e12299e764126e0a616fce69a9fdabaf10ee5a4179775e1f73a416d5')}finally{if(expanded!==g)expanded.dispose()};for(const key of ['position','normal','uv'])expect(clear.getAttribute(key).array).toEqual(g.getAttribute(key).array);expect(clear.index?.array).toEqual(g.index?.array)}finally{g.dispose();clear.dispose()}
 expect(old).not.toHaveProperty('normalPolicy');
});
it('preserves actual expanded position/UV, dimensions and topology while changing normals',()=>{
 for(const segments of [16,32,128]){const a=compileAssemblyGeometry(geometry(segments)),b=compileAssemblyGeometry({...geometry(segments),normalPolicy:declaration} as never),expanded=a.toNonIndexed();try{for(const key of ['position','uv'])expect(b.getAttribute(key).array).toEqual(expanded.getAttribute(key).array);expect(b.getAttribute('normal').array).not.toEqual(expanded.getAttribute('normal').array);a.computeBoundingBox();b.computeBoundingBox();expect(b.boundingBox).toEqual(a.boundingBox);expect(analyzeTopology(new Mesh(b)).pass).toBe(true)}finally{a.dispose();b.dispose();expanded.dispose()}}
});
it('sets and clears through existing fingerprinted patches and reopens saved IR',async()=>{
 const source=ir(),snapshot=structuredClone(source),patch={schema:'morphloom.component-patch/0.2' as const,operationId:'shading',componentId:'bushing',expectedInputFingerprint:await fingerprintAssemblyIR(source),geometry:{operation:'lathe-normal-policy' as const,action:'set' as const,policy:declaration as never}};
 const next=await applyAssemblyComponentPatch(source,patch);expect(next.receipt.unaffectedComponentsPreserved).toBe(true);expect(source).toEqual(snapshot);expect(next.ir.components[1]).toEqual(source.components[1]);const reopened=JSON.parse(JSON.stringify(next.ir));validateAssemblyIR(reopened);expect(reopened).toEqual(next.ir);
 const a=compileAssemblyIR(source,'beauty'),b=compileAssemblyIR(reopened,'beauty');try{const x=a.root.getObjectByName('preserved') as Mesh,y=b.root.getObjectByName('preserved') as Mesh;for(const key of ['position','normal','uv'])expect(y.geometry.getAttribute(key).array).toEqual(x.geometry.getAttribute(key).array);expect(y.position.toArray()).toEqual(x.position.toArray())}finally{a.root.traverse(x=>{if(x instanceof Mesh){x.geometry.dispose();(x.material as any).dispose()}});b.root.traverse(x=>{if(x instanceof Mesh){x.geometry.dispose();(x.material as any).dispose()}})}
 const cleared=await applyAssemblyComponentPatch(next.ir,{...patch,operationId:'clear',expectedInputFingerprint:next.receipt.outputFingerprint,geometry:{operation:'lathe-normal-policy',action:'clear'}});expect(cleared.ir).toEqual(source);
 await expect(applyAssemblyComponentPatch(next.ir,patch)).rejects.toThrow(/stale/);
 await expect(applyAssemblyComponentPatch(source,{...patch,schema:'morphloom.component-patch/0.1'})).rejects.toThrow(/0.2/);
 await expect(applyAssemblyComponentPatch(source,{...patch,componentId:'preserved'})).rejects.toThrow(/lathe/);
});
it('rejects an invalid later batch edit atomically and enforces the opted-in budget',async()=>{
 const source=ir(),snapshot=structuredClone(source);
 await expect(applyAssemblyComponentBatchPatch(source,{schema:'morphloom.component-batch-patch/0.2',operationId:'atomic',expectedInputFingerprint:await fingerprintAssemblyIR(source),edits:[{componentId:'bushing',geometry:{operation:'lathe-normal-policy',action:'set',policy:declaration as never}},{componentId:'preserved',geometry:{operation:'lathe-normal-policy',action:'set',policy:declaration as never}}]})).rejects.toThrow(/lathe/);expect(source).toEqual(snapshot);
 expect(()=>compileAssemblyGeometry({op:'lathe',segments:512,profile:Array.from({length:102},(_,i)=>[8+i*.1,i]),normalPolicy:declaration} as never)).toThrow(/budget/);
});
