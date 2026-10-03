import {deterministicCornerAngle} from '../src/engine/deterministic-corner-angle';
import * as THREE from 'three';
import {compileAssemblyGeometry,compileDerivedGearGeometry} from '../src/engine/assembly-compiler';
import {creasePartNormals} from '../src/engine/part-geometry';
import {exportSelectedScene} from '../src/engine/element-renderer';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {sha256} from '../src/engine/uv-quality';
const encode=(array:ArrayBufferView)=>{const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
export async function normalBoundary(project:any) {
 const p=project.parts.find((p:any)=>p.id==='inner_race')??project.parts[0],raw=p.geometry.op==='spur-gear'?compileDerivedGearGeometry(p.geometry):compileAssemblyGeometry(p.geometry),arrays=(g:THREE.BufferGeometry)=>Object.fromEntries([...Object.entries(g.attributes),...(g.index?[['index',g.index]as const]:[])].map(([key,a])=>[key,{type:a.array.constructor.name,base64:encode(a.array)}]));
 const rawData=arrays(raw),samples=[];
 const position=raw.index?raw.toNonIndexed():raw.clone(),attribute=position.getAttribute('position');
 for(let i=0;i<attribute.count;i+=3)for(let j=0;j<3;j++){
  const center=new THREE.Vector3().fromBufferAttribute(attribute,i+j),u=new THREE.Vector3().fromBufferAttribute(attribute,i+(j+1)%3).sub(center).normalize(),v=new THREE.Vector3().fromBufferAttribute(attribute,i+(j+2)%3).sub(center).normalize();
  samples.push(deterministicCornerAngle(new THREE.Vector3().crossVectors(u,v).length(),u.dot(v)));
 }
 const normal=creasePartNormals(raw,p.creaseAngle,p.normalWeighting),normalData=arrays(normal);
 const built=exportSelectedScene(project,project.parts.map((p:any)=>p.id));
 try {
  const bytes=await new GLTFExporter().parseAsync(built.root,{binary:true}) as ArrayBuffer;
  return {raw:rawData,cornerWeights:{type:'Float64Array',base64:encode(new Float64Array(samples))},postNormal:normalData,exportSha:await sha256(new Uint8Array(bytes)),binSha:await sha256(new Uint8Array(bytes,20+new DataView(bytes).getUint32(12,true)))};
 }finally{built.dispose();position.dispose();normal.dispose();if(normal!==raw)raw.dispose();}
}
