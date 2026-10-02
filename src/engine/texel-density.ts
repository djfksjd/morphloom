import * as THREE from 'three';
export type TexelDensitySummary={status:'measured'|'partial'|'not-run';reason?:string;rangeTexelsPerMm:[number,number]|null;measuredTriangles:number;unmeasuredTriangles:number;imageSize?:[number,number];textureTransform?:number[];wrapModes?:[number,number];sampling?:'local-before-wrap';channel:'metallic-roughness';features:{id:string;rangeTexelsPerMm:[number,number]|null;measuredTriangles:number;unmeasuredTriangles:number}[]};
function uvMatrix(map:THREE.Texture):THREE.Matrix3{return map.matrixAutoUpdate?new THREE.Matrix3().setUvTransform(map.offset.x,map.offset.y,map.repeat.x,map.repeat.y,map.rotation,map.center.x,map.center.y):map.matrix.clone();}
export function textureDensityContext(mesh:THREE.Mesh):{summary:TexelDensitySummary;matrix?:number[]}{
 const summary:TexelDensitySummary={status:'not-run',rangeTexelsPerMm:null,measuredTriangles:0,unmeasuredTriangles:0,channel:'metallic-roughness',features:[]};
 if(Array.isArray(mesh.material)){summary.reason='Multiple material groups require separate texture attribution';return {summary};}
 const m=mesh.material as THREE.MeshStandardMaterial,map=m.roughnessMap??m.metalnessMap;
 if(!map){summary.reason='No metallic-roughness texture';return {summary};}
 if(m.roughnessMap&&m.metalnessMap&&(m.roughnessMap.image!==m.metalnessMap.image||m.roughnessMap.channel!==m.metalnessMap.channel||m.roughnessMap.wrapS!==m.metalnessMap.wrapS||m.roughnessMap.wrapT!==m.metalnessMap.wrapT||!uvMatrix(m.roughnessMap).equals(uvMatrix(m.metalnessMap)))){summary.reason='Separate roughness and metalness maps require separate channel reports';return {summary};}
 if(map.channel!==0){summary.reason='Only UV channel 0 is supported';return {summary};}
 const image=map.image as {width?:number;height?:number}|undefined,w=image?.width,h=image?.height;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||!w||!h||w>16384||h>16384){summary.reason='Actual image resolution unavailable or exceeds 16384';return {summary};}
 // Clone: inspection must not mutate the source texture matrix.
 const matrix=uvMatrix(map);
 const e=matrix.elements;if(!e.every(Number.isFinite)||Math.abs(e[0]*e[4]-e[1]*e[3])<=1e-14){summary.reason='Texture transform is singular or invalid';return {summary};}
 summary.imageSize=[w,h];summary.textureTransform=[...e];summary.wrapModes=[map.wrapS,map.wrapT];summary.sampling='local-before-wrap';return {summary,matrix:e};
}
/** Pixel-space UV Jacobian singular values divided by 1000: texels per mm. */
export function triangleTexelRange(ju:number,jv:number,ku:number,kv:number,m:number[],size:[number,number]):[number,number]|null{
 const [w,h]=size,a=w*(m[0]*ju+m[3]*jv),b=h*(m[1]*ju+m[4]*jv),c=w*(m[0]*ku+m[3]*kv),d=h*(m[1]*ku+m[4]*kv),trace=a*a+b*b+c*c+d*d,det=a*d-b*c,max=Math.sqrt((trace+Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2),min=max>0?Math.abs(det)/max:0;
 return min>0&&Number.isFinite(max)?[min/1000,max/1000]:null;
}
export function addTexelMeasurement(s:TexelDensitySummary,range:[number,number]|null,featureId?:string):void{
 const update=(r:{rangeTexelsPerMm:[number,number]|null;measuredTriangles:number;unmeasuredTriangles:number})=>{if(range){r.measuredTriangles++;r.rangeTexelsPerMm=r.rangeTexelsPerMm?[Math.min(r.rangeTexelsPerMm[0],range[0]),Math.max(r.rangeTexelsPerMm[1],range[1])]:[...range];}else r.unmeasuredTriangles++;};update(s);
 if(featureId){let f=s.features.find(f=>f.id===featureId);if(!f){f={id:featureId,rangeTexelsPerMm:null,measuredTriangles:0,unmeasuredTriangles:0};s.features.push(f);}update(f);}
}
