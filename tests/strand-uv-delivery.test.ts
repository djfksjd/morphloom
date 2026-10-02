import {it,expect} from 'vitest';
import * as T from 'three';
import {createFurProject,createBirdProject} from '../src/engine/bird-element-demo';
import {resolveElements} from '../src/engine/element-project';
import {exportSelectedScene} from '../src/engine/element-renderer';
import {inspectUvQuality} from '../src/engine/uv-quality';
import {analyzeTopology} from '../src/engine/topology';
it.each([createFurProject,createBirdProject])('exports closed tapered sections with usable UVs and no microscopic end-cap triangles',async make=>{
 const p=make(),id=resolveElements(p)[0].id,s=exportSelectedScene(p,[id]);try{expect(analyzeTopology(s.root).pass).toBe(true);const report=await inspectUvQuality(s.root);expect(report.integrityPass).toBe(true);expect(report.meshes[0].invalidWorldTriangles).toBe(0);expect(report.meshes[0].degenerateUvTriangles).toBe(0);const mesh=s.root.getObjectByName(id) as T.Mesh,g=mesh.geometry;for(const k of ['position','normal','uv'])expect(Array.from(g.getAttribute(k).array).every(Number.isFinite)).toBe(true);}finally{s.dispose();}
});
it('keeps tapered section outward winding and seamless normals across the UV cut',()=>{
 const p=createFurProject(),id=resolveElements(p)[0].id,s=exportSelectedScene(p,[id]);try{const g=(s.root.getObjectByName(id) as T.Mesh).geometry,pos=g.getAttribute('position'),normal=g.getAttribute('normal'),uv=g.getAttribute('uv'),index=g.index!;let sixVolume=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();for(let i=0;i<index.count;i+=3){a.fromBufferAttribute(pos,index.getX(i));b.fromBufferAttribute(pos,index.getX(i+1));c.fromBufferAttribute(pos,index.getX(i+2));sixVolume+=a.dot(b.cross(c));}expect(sixVolume).toBeGreaterThan(0);
 const starts=new Map<number,number>();for(let i=0;i<uv.count;i++){if(uv.getX(i)===0)starts.set(uv.getY(i),i);if(uv.getX(i)===1){const first=starts.get(uv.getY(i))!;expect([pos.getX(i),pos.getY(i),pos.getZ(i)]).toEqual([pos.getX(first),pos.getY(first),pos.getZ(first)]);expect([normal.getX(i),normal.getY(i),normal.getZ(i)]).toEqual([normal.getX(first),normal.getY(first),normal.getZ(first)]);}}
 }finally{s.dispose();}
});
