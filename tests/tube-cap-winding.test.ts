import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { migrateTubeCapWinding } from '../src/engine/tube-quadratic-curve';
import { analyzeTopology } from '../src/engine/topology';
import { compileAssemblyGeometry } from '../src/engine/assembly-compiler';
import { applyAssemblyComponentPatch, fingerprintAssemblyIR } from '../src/engine/assembly-edit';
import type { AssemblyGeometryIR, AssemblyIR } from '../src/engine/assembly-ir';
const tube=()=>({op:'tube' as const,points:[[1,2,3],[90,80,40],[180,100,130]] as [number,number,number][],radius:2,tubularSegments:32,radialSegments:12});
const ir=():AssemblyIR=>({schema:'morphloom.assembly/0.1',units:'mm',name:'cap migration',components:['target','other'].map(id=>({id,name:id,category:'mechanical',materialName:'steel',detail:'authored',geometry:tube(),material:{color:'#333333'}}))});
describe('explicit outward tube caps',()=>{
 it('deep-copy migration preserves source and clear semantics',()=>{const source=tube(),snapshot=structuredClone(source),next=migrateTubeCapWinding(source,true);expect(source).toEqual(snapshot);expect(next.points).not.toBe(source.points);expect(migrateTubeCapWinding(next,false)).toEqual(source);expect(()=>migrateTubeCapWinding({...source,closed:true},false)).toThrow();});
 it.each([2,3].flatMap(points=>[.5,1,2].map(scale=>({points,scale}))))('changes only cap indices for $points points at scale $scale',({points,scale})=>{
  const source=tube();if(points===2)source.points=[source.points[0]!,source.points[2]!];source.points=source.points.map(p=>p.map(v=>v*scale) as [number,number,number]);source.radius*=scale;
  const legacy=compileAssemblyGeometry(source),g=compileAssemblyGeometry({...source,capWinding:'outward'} as AssemblyGeometryIR);
  try {
   for(const key of ['position','normal','uv'])expect(Array.from(g.getAttribute(key).array)).toEqual(Array.from(legacy.getAttribute(key).array));
   const root=new THREE.Group(),material=new THREE.MeshBasicMaterial();root.add(new THREE.Mesh(g,material));try{expect(analyzeTopology(root).pass).toBe(true);}finally{material.dispose();}
   const index=g.index!,p=g.getAttribute('position'),n=g.getAttribute('normal'),side=index.count-24*3;
   expect(Array.from(index.array).slice(0,side)).toEqual(Array.from(legacy.index!.array).slice(0,side));
   for(let k=side;k<index.count;k+=3){const a=new THREE.Vector3().fromBufferAttribute(p,index.getX(k)),b=new THREE.Vector3().fromBufferAttribute(p,index.getX(k+1)),c=new THREE.Vector3().fromBufferAttribute(p,index.getX(k+2));const outward=new THREE.Vector3().fromBufferAttribute(n,index.getX(k));expect(b.sub(a).cross(c.sub(a)).normalize().dot(outward)).toBeGreaterThan(.99);}
  } finally {g.dispose();legacy.dispose();}
 });
 it('supports atomic opt-in/clear patches without changing other components',async()=>{
  const source=ir(),original=structuredClone(source);
  const patch={schema:'morphloom.component-patch/0.2' as const,operationId:'cap',componentId:'target',expectedInputFingerprint:await fingerprintAssemblyIR(source),geometry:{operation:'tube-cap-winding',action:'set'}};
  const result=await applyAssemblyComponentPatch(source,patch as never);
  expect(result.ir.components[0]!.geometry).toMatchObject({capWinding:'outward'});expect(result.ir.components[1]).toEqual(source.components[1]);expect(source).toEqual(original);
  const cleared=await applyAssemblyComponentPatch(result.ir,{...patch,expectedInputFingerprint:await fingerprintAssemblyIR(result.ir),geometry:{operation:'tube-cap-winding',action:'clear'}} as never);expect(cleared.ir).toEqual(source);
  await expect(applyAssemblyComponentPatch(source,{...patch,schema:'morphloom.component-patch/0.1'} as never)).rejects.toThrow();
 });
 it('keeps existing Bezier buffers unchanged through cap set and clear',()=>{
  const source={...tube(),points:[[0,0,0],[200,0,0]] as [number,number,number][],curve:{schema:'morphloom.tube-quadratic-bezier/0.1' as const,controlPointMm:[100,40,0] as [number,number,number]}};
  const a=compileAssemblyGeometry(source),b=compileAssemblyGeometry(migrateTubeCapWinding(source,true));try{for(const key of ['position','normal','uv'])expect(Array.from(a.getAttribute(key).array)).toEqual(Array.from(b.getAttribute(key).array));expect(Array.from(a.index!.array)).toEqual(Array.from(b.index!.array));}finally{a.dispose();b.dispose();}
 });
 it('rejects malformed actions, extra keys and stale cap patch inputs',async()=>{
  const source=ir(),hash=await fingerprintAssemblyIR(source),base={schema:'morphloom.component-patch/0.2',operationId:'invalid',componentId:'target',expectedInputFingerprint:hash};
  for(const geometry of [{operation:'tube-cap-winding',action:'flip'},{operation:'tube-cap-winding',action:'set',extra:true}])await expect(applyAssemblyComponentPatch(source,{...base,geometry} as never)).rejects.toThrow();
  await expect(applyAssemblyComponentPatch(source,{...base,expectedInputFingerprint:'0'.repeat(64),geometry:{operation:'tube-cap-winding',action:'set'}} as never)).rejects.toThrow();expect(source).toEqual(ir());
 });
 it('rejects unknown winding and closed-path opt-in',()=>{
  expect(()=>compileAssemblyGeometry({...tube(),capWinding:'outside'} as never)).toThrow();
  expect(()=>compileAssemblyGeometry({...tube(),closed:true,capWinding:'outward'} as never)).toThrow();
  expect(()=>compileAssemblyGeometry({op:'sphere',radius:2,capWinding:'outward'} as never)).toThrow();
 });
});
