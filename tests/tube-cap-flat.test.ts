import * as THREE from 'three';
import {describe,expect,it} from 'vitest';
import {applyAssemblyComponentPatch,fingerprintAssemblyIR} from '../src/engine/assembly-edit';
import {migrateTubeCapFinish} from '../src/engine/tube-quadratic-curve';
import {compileAssemblyGeometry} from '../src/engine/assembly-compiler';
import {analyzeTopology} from '../src/engine/topology';
import type {AssemblyGeometryIR} from '../src/engine/assembly-ir';
type Tube=Extract<AssemblyGeometryIR,{op:'tube'}>;
const fixture=(kind:string,scale:number):Tube=>{const points=(kind==='multi'?[[0,0,0],[80,20,20],[180,60,80]]:[[0,0,0],[180,60,80]]).map(p=>p.map(v=>v*scale) as [number,number,number]);return {op:'tube',points,radius:2*scale,tubularSegments:32,radialSegments:12,capWinding:'outward',...(kind==='bezier'?{curve:{schema:'morphloom.tube-quadratic-bezier/0.1',controlPointMm:[80*scale,50*scale,30*scale]}}:{})};};
describe('explicit flat tube end caps',()=>{
 it.each(['straight','multi','bezier'].flatMap(kind=>[.5,1,2].map(scale=>({kind,scale}))))('preserves side geometry and creates planar caps for $kind at $scale',({kind,scale})=>{
  const source=fixture(kind,scale),old=compileAssemblyGeometry(source),flat=compileAssemblyGeometry({...source,capFinish:'flat-outward'} as AssemblyGeometryIR);
  const material=new THREE.MeshBasicMaterial(),root=new THREE.Group();root.add(new THREE.Mesh(flat,material));
  try{
   const n=old.getAttribute('position').count,p=flat.getAttribute('position'),normal=flat.getAttribute('normal'),uv=flat.getAttribute('uv'),index=flat.index!,side=index.count-72;
   expect(p.count).toBe(n+26);expect(index.count).toBe(old.index!.count);
   for(const key of ['position','normal','uv'])expect(Array.from(flat.getAttribute(key).array).slice(0,old.getAttribute(key).array.length)).toEqual(Array.from(old.getAttribute(key).array));
   expect(Array.from(index.array).slice(0,side)).toEqual(Array.from(old.index!.array).slice(0,side));
   for(let k=side;k<index.count;k+=3){const vertices=[index.getX(k),index.getX(k+1),index.getX(k+2)];const [a,b,c]=vertices.map(i=>new THREE.Vector3().fromBufferAttribute(p,i));const face=b!.sub(a!).cross(c!.sub(a!)).normalize();for(const i of vertices){expect(new THREE.Vector3().fromBufferAttribute(normal,i).dot(face)).toBeGreaterThan(.99999);expect(uv.getX(i)).toBeGreaterThanOrEqual(0);expect(uv.getX(i)).toBeLessThanOrEqual(1);expect(uv.getY(i)).toBeGreaterThanOrEqual(0);expect(uv.getY(i)).toBeLessThanOrEqual(1);}}
   for(let k=side;k<index.count;k+=3){const vertices=[index.getX(k),index.getX(k+1),index.getX(k+2)];for(let j=0;j<3;j++){const a=vertices[j]!,b=vertices[(j+1)%3]!;const distance=new THREE.Vector3().fromBufferAttribute(p,a).distanceTo(new THREE.Vector3().fromBufferAttribute(p,b));const uvDistance=Math.hypot(uv.getX(a)-uv.getX(b),uv.getY(a)-uv.getY(b));expect(Math.abs(uvDistance/distance*2*source.radius/1000-1)).toBeLessThan(.0001);}}
   expect(analyzeTopology(root).pass).toBe(true);flat.computeBoundingBox();old.computeBoundingBox();expect(flat.boundingBox).toEqual(old.boundingBox);
  }finally{old.dispose();flat.dispose();material.dispose();}
 });
 it('promotes cap indices crossing the 16-bit vertex boundary',()=>{const g=compileAssemblyGeometry({...fixture('straight',1),tubularSegments:503,radialSegments:129,capFinish:'flat-outward'});try{expect(g.index!.array).toBeInstanceOf(Uint32Array);expect(g.getAttribute('position').count).toBeGreaterThan(65535);}finally{g.dispose();}});
 it('migrates and reverses the cap-only patch with no source mutation',async()=>{
  const geometry=fixture('multi',1),source={schema:'morphloom.assembly/0.1' as const,units:'mm' as const,name:'flat cap patch',components:[{id:'tube',name:'tube',category:'mechanical' as const,materialName:'steel',detail:'authored',geometry,material:{color:'#999999'}}]};
  const snapshot=structuredClone(source),hash=await fingerprintAssemblyIR(source),base={schema:'morphloom.component-patch/0.2' as const,operationId:'flat',componentId:'tube',expectedInputFingerprint:hash};
  const next=await applyAssemblyComponentPatch(source,{...base,geometry:{operation:'tube-cap-finish',action:'set'}});expect(next.ir.components[0]!.geometry).toMatchObject({capFinish:'flat-outward'});expect(source).toEqual(snapshot);
  const clear=await applyAssemblyComponentPatch(next.ir,{...base,expectedInputFingerprint:await fingerprintAssemblyIR(next.ir),geometry:{operation:'tube-cap-finish',action:'clear'}});expect(clear.ir).toEqual(source);
  expect(migrateTubeCapFinish(migrateTubeCapFinish(geometry,true),false)).toEqual(geometry);
  await expect(applyAssemblyComponentPatch(source,{...base,schema:'morphloom.component-patch/0.1',geometry:{operation:'tube-cap-finish',action:'set'}})).rejects.toThrow();
  for(const patch of [{operation:'tube-cap-finish',action:'smooth'},{operation:'tube-cap-finish',action:'set',extra:true}])await expect(applyAssemblyComponentPatch(source,{...base,geometry:patch} as never)).rejects.toThrow();
 });
 it('rejects unknown and closed finish declarations',()=>{expect(()=>compileAssemblyGeometry({...fixture('straight',1),capFinish:'smooth'} as never)).toThrow();expect(()=>compileAssemblyGeometry({...fixture('straight',1),closed:true,capFinish:'flat-outward'} as never)).toThrow();});
});
