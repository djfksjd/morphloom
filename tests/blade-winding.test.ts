import * as THREE from 'three';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {compileAssemblyGeometry,compileAssemblyIR} from '../src/engine/assembly-compiler';
import {analyzeTopology} from '../src/engine/topology';
import {migrateBladeSideWinding} from '../src/engine/blade-side-winding';
import {applyAssemblyComponentPatch,fingerprintAssemblyIR} from '../src/engine/assembly-edit';
import {createOrnateKnifeIR} from '../src/engine/knife';
import {DEFAULT_KNIFE_SPEC} from '../src/types';
import type {AssemblyIR} from '../src/engine/assembly-ir';
const blade=()=>({op:'bladeLoft' as const,sections:[[0,18],[90,23],[180,2]] as [number,number][],thickness:5,apexThickness:.2,grindCurve:[.1,.5,1,.8,.2]});
const hash=(a:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
it.each([.1,1,10])('preserves positions/count/UV while making side triangle normals outward at scale %s',scale=>{
 const src=blade();src.sections=src.sections.map(([y,w])=>[y*scale,w*scale]);src.thickness*=scale;src.apexThickness*=scale;
 const legacy=compileAssemblyGeometry(src),g=compileAssemblyGeometry(migrateBladeSideWinding(src,true)),m=new THREE.MeshBasicMaterial(),root=new THREE.Group();root.add(new THREE.Mesh(g,m));
 try{
  const report=analyzeTopology(root);expect(report.inconsistentWindingEdges).toBe(0);expect(report.boundaryEdges+report.nonManifoldEdges+report.degenerateTriangles).toBe(0);
  const p=g.getAttribute('position'),old=legacy.getAttribute('position'),uv=g.getAttribute('uv'),oldUv=legacy.getAttribute('uv');expect(p.count).toBe(old.count);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let volume=0,changed=0;
  const point=(attr:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,i:number)=>[attr.getX(i),attr.getY(i),attr.getZ(i)];
  for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);volume+=a.dot(b.clone().cross(c))/6;
   const swapped=JSON.stringify(point(p,i+1))!==JSON.stringify(point(old,i+1));const map=swapped?[0,2,1]:[0,1,2];
   for(let j=0;j<3;j++){expect(point(p,i+j)).toEqual(point(old,i+map[j]!));expect([uv.getX(i+j),uv.getY(i+j)]).toEqual([oldUv.getX(i+map[j]!),oldUv.getY(i+map[j]!)]);}
   if(swapped){changed++;const n=b.clone().sub(a).cross(c.clone().sub(a));expect(n.x*Math.sign(a.x)).toBeGreaterThan(0);}
  }
  expect(changed).toBe(4*(src.sections.length-1));expect(volume).toBeGreaterThan(0);expect(Array.from(g.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
 }finally{g.dispose();legacy.dispose();m.dispose();}
});
it('supports two and512 rows but rejects collapsed generated Float32 faces',()=>{
 for(const rows of [2,512]){const src=blade();src.sections=Array.from({length:rows},(_,i)=>[i,10]);const g=compileAssemblyGeometry(migrateBladeSideWinding(src,true));expect(g.getAttribute('position').count).toBeGreaterThan(0);g.dispose();}
 const src=blade();src.sections=[[99999,10],[99999+1e-8,10]];expect(()=>migrateBladeSideWinding(src,true)).toThrow(/Float32/);
 expect(()=>compileAssemblyGeometry({...src,sideWinding:{schema:'morphloom.blade-side-winding/0.1',direction:'outward'}})).toThrow(/Float32/);
});
it('rejects unsupported version, direction, op, unsafe bounds and malformed profiles only in opted-in path',()=>{
 const winding={schema:'morphloom.blade-side-winding/0.1',direction:'outward'};
 for(const edits of [{sections:[[0,2]]},{sections:[[0,2],[0,3]]},{sections:[[2,2],[1,3]]},{sections:[[0,0],[1,3]]},{sections:Array.from({length:513},(_,i)=>[i,2])},{thickness:NaN},{thickness:100001},{apexThickness:0},{apexThickness:10},{grindCurve:[1,1]},{grindCurve:[1,1,1,1,2]},{sideWinding:{...winding,schema:'unknown'}},{sideWinding:{...winding,direction:'inward'}},{sideWinding:{...winding,extra:true}}])expect(()=>compileAssemblyGeometry({...blade(),sideWinding:winding,...edits} as never)).toThrow();
 expect(()=>compileAssemblyGeometry({op:'sphere',radius:2,sideWinding:winding} as never)).toThrow();
 const legacy={...blade(),apexThickness:0};const g=compileAssemblyGeometry(legacy);g.dispose();expect(()=>migrateBladeSideWinding(legacy,true)).toThrow();
});
it('deep-copy migration and atomic set/clear preserve source and non-targets; stale/action/schema reject',async()=>{
 const source:AssemblyIR={schema:'morphloom.assembly/0.1',units:'mm',name:'authored blade',components:['target','other'].map(id=>({id,name:id,category:'mechanical',materialName:'steel',detail:'authored',geometry:blade(),material:{color:'#333333'}}))},original=structuredClone(source);
 const patch={schema:'morphloom.component-patch/0.2' as const,operationId:'side',componentId:'target',expectedInputFingerprint:await fingerprintAssemblyIR(source),geometry:{operation:'blade-side-winding' as const,action:'set' as const}};
 const applied=await applyAssemblyComponentPatch(source,patch);expect(applied.receipt.unaffectedComponentsPreserved).toBe(true);expect(applied.ir.components[1]).toEqual(source.components[1]);expect(source).toEqual(original);
 const cleared=await applyAssemblyComponentPatch(applied.ir,{...patch,expectedInputFingerprint:await fingerprintAssemblyIR(applied.ir),geometry:{operation:'blade-side-winding',action:'clear'}});expect(cleared.ir).toEqual(source);
 for(const changed of [{schema:'morphloom.component-patch/0.1'},{expectedInputFingerprint:'0'.repeat(64)},{geometry:{operation:'blade-side-winding',action:'flip'}},{geometry:{operation:'blade-side-winding',action:'set',extra:true}}])await expect(applyAssemblyComponentPatch(source,{...patch,...changed} as never)).rejects.toThrow();
 await expect(applyAssemblyComponentPatch(applied.ir,{...patch,expectedInputFingerprint:await fingerprintAssemblyIR(applied.ir),geometry:{operation:'blade-section-deltas',deltas:[{pointIndex:1,deltaMm:[-90,0]}]}})).rejects.toThrow();
});
it('preserves actual historical no-option buffers and fixes new preset without non-target changes',()=>{
 const old=JSON.parse(readFileSync(new URL('../benchmarks/modeling-slices-20261003/blade-winding/before.assembly.json',import.meta.url),'utf8')) as AssemblyIR;
 const golden=JSON.parse(readFileSync(new URL('../benchmarks/modeling-slices-20261003/blade-winding/before-buffers.json',import.meta.url),'utf8'));
 const b=compileAssemblyIR(old,'beauty'),n=compileAssemblyIR(createOrnateKnifeIR(DEFAULT_KNIFE_SPEC),'beauty');
 const modified=['blade_core','guard_scroll_left','guard_scroll_right','grip_wrap','blade_engraving'];
 try{expect(b.metrics.topology.inconsistentWindingEdges).toBe(122);expect(n.metrics.topology.inconsistentWindingEdges).toBe(0);expect(n.metrics.triangles).toBe(b.metrics.triangles);expect(n.metrics.bounds.equals(b.metrics.bounds)).toBe(true);
  b.root.traverse(obj=>{if(obj instanceof THREE.Mesh){for(const [key,a] of Object.entries(obj.geometry.attributes))expect(hash(a.array),obj.name+'/'+key).toBe(golden[obj.name].attributes[key]);expect(obj.geometry.index?hash(obj.geometry.index.array):null).toBe(golden[obj.name].index);}});
  n.root.traverse(obj=>{if(obj instanceof THREE.Mesh&&!modified.includes(obj.name)){for(const [key,a] of Object.entries(obj.geometry.attributes))expect(hash(a.array),obj.name+'/'+key).toBe(golden[obj.name].attributes[key]);expect(obj.geometry.index?hash(obj.geometry.index.array):null).toBe(golden[obj.name].index);}});
 }finally{for(const build of [b,n])build.root.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});}
});

it('allows two-section clear/compile in both runtime and published schema',()=>{const source=blade();source.sections=[[0,10],[1,10]];const next=migrateBladeSideWinding(source,true),cleared=migrateBladeSideWinding(next,false);expect(cleared).toEqual(source);for(const g of [next,cleared])compileAssemblyGeometry(g).dispose();const schema=JSON.parse(readFileSync(new URL('../schemas/assembly-ir.schema.json',import.meta.url),'utf8'));expect(schema.$defs.bladeLoft.properties.sections.minItems).toBe(2);expect(schema.$defs.bladeLoft.allOf[0].else).toBeUndefined();});
