import {generateBearingProject} from '../src/engine/bearing-pack';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {describe,it,expect} from 'vitest';
import {BufferGeometry,Float32BufferAttribute} from 'three';
import {parseProject,migrateElementProjectToV4,migrateElementProjectToV3,editPart,serializeProject,ElementHistory} from '../src/engine/element-project';
import {exportSelectedScene} from '../src/engine/element-renderer';
import {applyPartUvScale} from '../src/engine/part-uv';
const fixture=(name='bearing')=>name==='bearing'?generateBearingProject({}):generateSpurGearProject({});
describe('opt-in native UV scalar',()=>{
 it('migrates losslessly; rejects old versions, invalid ranges and downgrade',()=>{
  const old=fixture(),p=migrateElementProjectToV4(old);expect({...p,schema:old.schema}).toEqual(old);expect(old.schema).not.toBe(p.schema);
  expect(()=>editPart(old,old.parts[0].id,{uvScale:100})).toThrow();
  for(const v of [0,-1,NaN,Infinity,.0009,1001])expect(()=>editPart(p,p.parts[0].id,{uvScale:v})).toThrow();
  expect(()=>migrateElementProjectToV3(editPart(p,p.parts[0].id,{uvScale:100}))).toThrow();
  expect(()=>editPart({...p,parts:p.parts.map(x=>({...x,locked:true}))},p.parts[0].id,{uvScale:100})).toThrow(/locked/);
  expect(parseProject(serializeProject(editPart(p,p.parts[0].id,{uvScale:100}))).parts[0].uvScale).toBe(100);
 });
 it('changes only selected UV data; preserves all other buffers and parts; history restores',()=>{
  const p=migrateElementProjectToV4(fixture()),q=editPart(p,p.parts[2].id,{uvScale:100}),a=exportSelectedScene(p,p.parts.map(x=>x.id)),b=exportSelectedScene(q,q.parts.map(x=>x.id));
  try{for(const part of p.parts){const x=a.root.getObjectByName(part.id) as import('three').Mesh,y=b.root.getObjectByName(part.id) as import('three').Mesh;
   for(const key of ['position','normal'])expect(Array.from(y.geometry.getAttribute(key).array)).toEqual(Array.from(x.geometry.getAttribute(key).array));
   expect(y.geometry.index?.array).toEqual(x.geometry.index?.array);expect(y.matrix.toArray()).toEqual(x.matrix.toArray());
   const u=x.geometry.getAttribute('uv'),v=y.geometry.getAttribute('uv');for(let i=0;i<u.array.length;i++)expect(v.array[i]).toBe(Math.fround(u.array[i]*(part.id===p.parts[2].id?100:1)));
   expect((y.material as import('three').MeshStandardMaterial).roughness).toBe((x.material as import('three').MeshStandardMaterial).roughness);
  }}finally{a.dispose();b.dispose();}
  const h=new ElementHistory(p);h.commit(q);expect(h.undo()).toEqual(p);expect(h.redo()).toEqual(q);
 });
 it('rejects missing/nonfinite UV atomically and preserves no-op buffers',()=>{
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([0,0,0],3));expect(()=>applyPartUvScale(g,100)).toThrow(/uv/);
  g.setAttribute('uv',new Float32BufferAttribute([.2,NaN],2));const original=g.getAttribute('uv');expect(()=>applyPartUvScale(g,100)).toThrow();expect(g.getAttribute('uv')).toBe(original);
 });
});
