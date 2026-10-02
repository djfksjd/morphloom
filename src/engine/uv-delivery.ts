import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectUvQuality,sha256,type UvInspectionReceipt} from './uv-quality';
/** Re-open the actual generated GLB bytes. Own and release loader-created resources. */
export async function inspectExportedUv(bytes:ArrayBuffer,sourceJson:string):Promise<UvInspectionReceipt&{outputFingerprint:string}>{
 const loaded=await new GLTFLoader().parseAsync(bytes,'');
 try{return {schema:'morphloom.uv-inspection-receipt/0.1',sourceFingerprint:await sha256(sourceJson),outputFingerprint:await sha256(new Uint8Array(bytes)),report:await inspectUvQuality(loaded.scene,{includeTriangles:true})};}
 finally{
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  for(const scene of loaded.scenes)scene.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v instanceof THREE.Texture)textures.add(v);}}});
  for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures){t.dispose();if(typeof ImageBitmap!=='undefined'&&t.image instanceof ImageBitmap)t.image.close();}
 }
}
