import {it,expect} from 'vitest';
import * as T from 'three';
import {createSurfaceMaterial,inspectSharedSurfaceCache,MAX_SHARED_SURFACE_BYTES} from '../src/engine/surface-system';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {editPart,migrateElementProjectToV6} from '../src/engine/element-project';
import {exportSelectedScene} from '../src/engine/element-renderer';
it('bounds actual retained CPU payload plus every GPU mip level, then preserves overflow ownership and pixels',()=>{
 const textures=new Set<T.Texture>();const materials:T.Material[]=[];
 for(let i=1;i<=32;i++){
  const m=createSurfaceMaterial({color:'#555555',surface:'asphalt',textureScale:[i,i]},{mode:'beauty',category:'surface',materialName:'asphalt'});materials.push(m);
  for(const t of [m.map,m.normalMap,m.roughnessMap])if(t?.userData.morphloomShared)textures.add(t);
 }
 let bytes=0;for(const t of textures){const image=t.image as {data:Uint8Array;width:number;height:number};bytes+=image.data.byteLength;let w=image.width,h=image.height;while(true){bytes+=w*h*4;if(w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}}
 expect(bytes).toBeLessThanOrEqual(MAX_SHARED_SURFACE_BYTES);expect(inspectSharedSurfaceCache().estimatedBytes).toBeGreaterThanOrEqual(bytes);
 // Fill smaller entries to exercise the unchanged entry limit and real editor disposer.
 for(let i=1;i<=96;i++)materials.push(createSurfaceMaterial({color:'#888888',surface:'brushed-metal',textureScale:[i,i]},{mode:'beauty',category:'surface',materialName:'metal',surfaceChannels:'roughness-only',periodicDirectional:true}));
 expect(inspectSharedSurfaceCache().entries).toBeLessThanOrEqual(96);
 const old=migrateElementProjectToV6(generateSpurGearProject({})),id=old.parts[0].id;
 const p=editPart(old,id,{material:{...old.parts[0].material!,surface:{finish:'brushed-metal',channels:'roughness-only',repeat:[100,100]}}});
 const a=exportSelectedScene(p,[id]),b=exportSelectedScene(p,[id]);const ma=(a.root.getObjectByName(id) as T.Mesh).material as T.MeshPhysicalMaterial,mb=(b.root.getObjectByName(id) as T.Mesh).material as T.MeshPhysicalMaterial;
 expect(ma.roughnessMap!.userData.morphloomShared).toBe(false);expect(ma.roughnessMap).not.toBe(mb.roughnessMap);expect(ma.roughnessMap!.image.data).toEqual(mb.roughnessMap!.image.data);
 let disposed=0;ma.roughnessMap!.addEventListener('dispose',()=>disposed++);a.dispose();expect(disposed).toBe(1);expect(mb.roughnessMap!.image.data.byteLength).toBe(16384);b.dispose();
 for(const m of materials){const owned=new Set<T.Texture>();for(const value of Object.values(m))if(value instanceof T.Texture&&!value.userData.morphloomShared)owned.add(value);for(const t of owned)t.dispose();m.dispose();}
});
