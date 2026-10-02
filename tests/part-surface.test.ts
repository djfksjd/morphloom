import {it,expect} from 'vitest';import * as T from 'three';
import {generateSpurGearProject} from '../src/engine/gear-pack';import {migrateElementProjectToV6,migrateElementProjectToV5,editPart,serializeProject,parseProject} from '../src/engine/element-project';import {exportSelectedScene} from '../src/engine/element-renderer';
const surface={finish:'brushed-metal' as const,channels:'roughness-only' as const,repeat:[8,8] as [number,number]};
it('migrates losslessly and rejects old versions, unsupported channels and invalid repeat',()=>{
 const old=generateSpurGearProject({}),p=migrateElementProjectToV6(old);expect({...p,schema:old.schema}).toEqual(old);const material={...old.parts[0].material!,surface};expect(()=>editPart(old,old.parts[0].id,{material})).toThrow();
 for(const s of [{...surface,channels:'full'},{...surface,finish:'unknown'},{...surface,repeat:[0,8]},{...surface,repeat:[8,1025]}])expect(()=>editPart(p,p.parts[0].id,{material:{...material,surface:s} as never})).toThrow();
 const withChamfer={...p,parts:p.parts.map(x=>({...x,axialChamferMm:.05}))};expect(migrateElementProjectToV6(withChamfer)).toEqual(withChamfer);expect(()=>migrateElementProjectToV5(editPart(p,p.parts[0].id,{material}))).toThrow();
 expect(()=>editPart({...p,parts:p.parts.map(x=>({...x,locked:true}))},p.parts[0].id,{material})).toThrow(/locked/);
 expect(parseProject(serializeProject(editPart(p,p.parts[0].id,{material}))).parts[0].material?.surface).toEqual(surface);
});
it('changes real roughness pixels while preserving geometry/UV and scalar appearance',()=>{
 const p=migrateElementProjectToV6(generateSpurGearProject({})),q=editPart(p,p.parts[0].id,{material:{...p.parts[0].material!,surface}}),ids=p.parts.map(p=>p.id),a=exportSelectedScene(p,ids),b=exportSelectedScene(q,ids);
 try{const x=a.root.getObjectByName(ids[0]) as T.Mesh,y=b.root.getObjectByName(ids[0]) as T.Mesh;for(const k of ['position','normal','uv'])expect(y.geometry.getAttribute(k).array).toEqual(x.geometry.getAttribute(k).array);const m=y.material as T.MeshPhysicalMaterial,old=x.material as T.MeshStandardMaterial;expect(m.normalMap).toBeNull();expect(m.anisotropy).toBe(0);expect(m.roughness).toBe(old.roughness);expect(m.metalness).toBe(old.metalness);expect(m.color.toArray()).toEqual(old.color.toArray());expect(m.roughnessMap).toBe(m.metalnessMap);expect(m.roughnessMap?.repeat.toArray()).toEqual([8,8]);const image=m.roughnessMap!.image as {data:Uint8Array;width:number;height:number};expect([image.width,image.height]).toEqual([64,64]);expect(new Set(Array.from(image.data).filter((_,i)=>i%4===1)).size).toBeGreaterThan(3);for(let i=0;i<image.data.length;i+=4){expect(image.data[i]).toBe(255);expect(image.data[i+2]).toBe(255);}}
 finally{a.dispose();b.dispose();}
});

it('keeps shared textures alive when one scene is disposed',()=>{
 const p=migrateElementProjectToV6(generateSpurGearProject({})),q=editPart(p,p.parts[0].id,{material:{...p.parts[0].material!,surface}}),ids=q.parts.map(p=>p.id),a=exportSelectedScene(q,ids),b=exportSelectedScene(q,ids);const ma=(a.root.getObjectByName(ids[0]) as T.Mesh).material as T.MeshPhysicalMaterial,mb=(b.root.getObjectByName(ids[0]) as T.Mesh).material as T.MeshPhysicalMaterial;expect(ma.roughnessMap).toBe(mb.roughnessMap);let textureDisposes=0,materialDisposes=0;ma.roughnessMap!.addEventListener('dispose',()=>textureDisposes++);ma.addEventListener('dispose',()=>materialDisposes++);a.dispose();expect(materialDisposes).toBe(1);expect(textureDisposes).toBe(0);expect((mb.roughnessMap!.image as {data:Uint8Array}).data.length).toBe(16384);b.dispose();expect(textureDisposes).toBe(0);
});
