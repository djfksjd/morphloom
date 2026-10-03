import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectUvQuality, sha256} from './uv-quality';
import {validateSpurGear} from './spur-gear';

function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function canonical(value: unknown, depth=0): string {
  requireValue(depth<=64, 'Reference JSON depth budget exceeded');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+canonical(record[k],depth+1)).join(',')+'}';
}
function read(bytes:ArrayBuffer) {
  requireValue(bytes.byteLength>=28 && bytes.byteLength<=256000000,'Embedded GLB budget');
  const view=new DataView(bytes);
  requireValue(view.getUint32(0,true)===0x46546c67 && view.getUint32(4,true)===2 && view.getUint32(8,true)===bytes.byteLength,'Invalid GLB framing');
  const length=view.getUint32(12,true);
  requireValue(view.getUint32(16,true)===0x4e4f534a && length<=16000000 && 28+length<=bytes.byteLength,'Invalid JSON chunk');
  const document=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
  canonical(document);
  const bin=20+length;
  requireValue(view.getUint32(bin+4,true)===0x004e4942 && bin+8+view.getUint32(bin,true)===bytes.byteLength,'One embedded BIN required');
  requireValue(Array.isArray(document.nodes) && document.nodes.length<=10000 && Array.isArray(document.meshes) && document.meshes.length<=128 && (document.accessors?.length??0)<=1024,'Scene budget');
  requireValue(!(document.buffers??[]).some((v:{uri?:string})=>v.uri) && !(document.images??[]).some((v:{uri?:string})=>v.uri),'External URI unsupported');
  requireValue(!(document.animations??[]).length && !(document.extensionsRequired??[]).length && !document.nodes.some((v:{skin?:number;extensions?:unknown})=>v.skin!==undefined || v.extensions),'Static non-instanced source only');
  requireValue(!document.meshes.some((m:{primitives:{targets?:unknown[];extensions?:unknown;mode?:number}[]})=>m.primitives.some(p=>p.targets?.length || p.extensions || (p.mode??4)!==4)),'Morph/primitive extension unsupported');
  const parents=new Map<number,number>();
  document.nodes.forEach((node:any,i:number)=>(node.children??[]).forEach((child:number)=>{
    requireValue(Number.isInteger(child)&&child>=0&&child<document.nodes.length&&!parents.has(child),'Invalid/multiple source parent');parents.set(child,i);
  }));
  document.nodes.forEach((_node:unknown,i:number)=>{
    const seen=new Set<number>();let current:number|undefined=i;
    while(current!==undefined){requireValue(!seen.has(current)&&seen.size<64,'Hierarchy cycle/depth budget');seen.add(current);current=parents.get(current);}
  });
  return {document,bin:new Uint8Array(bytes,bin)};
}
function world(nodes:any[],index:number):THREE.Matrix4 {
  const parents=new Map<number,number>();
  nodes.forEach((n,i)=>(n.children??[]).forEach((child:number)=>{
    requireValue(Number.isInteger(child)&&child>=0&&child<nodes.length&&!parents.has(child),'Invalid/multiple parent');parents.set(child,i);
  }));
  const visit=(i:number,path:Set<number>):THREE.Matrix4=>{
    requireValue(!path.has(i),'Hierarchy cycle');path.add(i);
    const n=nodes[i];let matrix:THREE.Matrix4;
    if(n.matrix){requireValue(n.matrix.length===16&&!n.translation&&!n.rotation&&!n.scale,'Invalid matrix/TRS');matrix=new THREE.Matrix4().fromArray(n.matrix);}
    else matrix=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(n.translation??[0,0,0]),new THREE.Quaternion().fromArray(n.rotation??[0,0,0,1]),new THREE.Vector3().fromArray(n.scale??[1,1,1]));
    requireValue(matrix.elements.every(Number.isFinite),'Nonfinite transform');
    return parents.has(i)?visit(parents.get(i)!,path).multiply(matrix):matrix;
  };
  return visit(index,new Set());
}

/** Inspect current bytes using original local-geometry context only after exact binding.
 * No scene/IR is returned or serialized. Unbound reference inspection remains blocked.
 */
export async function inspectBoundReferenceUv(originalBytes:ArrayBuffer,currentBytes:ArrayBuffer) {
  const original=read(originalBytes),current=read(currentBytes);
  const sourceFingerprint=await sha256(new Uint8Array(originalBytes)),outputFingerprint=await sha256(new Uint8Array(currentBytes));
  requireValue(original.bin.length===current.bin.length && original.bin.every((v,i)=>v===current.bin[i]),'Original/current BIN differs: geometry/UV/index/material binding rejected');
  const proof=current.document.asset?.extras?.morphloomBakedTransform;
  requireValue(proof && canonical(Object.keys(proof).sort())===canonical(['schema','sourceSha256','node','translationMm','coordinates','currentEditableIRAvailable','sourceSpecState','referenceNodes'].sort()),'Unknown provenance fields');
  requireValue(proof.schema==='morphloom.baked-transform/0.1' && proof.sourceSha256===sourceFingerprint && proof.currentEditableIRAvailable===false && proof.sourceSpecState==='before-edit-reference' && proof.coordinates==='glTF right-handed Y-up world, millimeters','Original SHA/provenance mismatch');
  requireValue(Array.isArray(proof.translationMm)&&proof.translationMm.length===3&&proof.translationMm.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1000),'Invalid declared translation');
  const target=current.document.nodes.findIndex((n:{name?:string})=>n.name===proof.node);
  requireValue(target>=0 && current.document.nodes.filter((n:{name?:string})=>n.name===proof.node).length===1 && original.document.nodes[target]?.name===proof.node && current.document.nodes[target].mesh!==undefined && !current.document.nodes[target].children?.length,'Unique leaf target mismatch');
  const normalized=structuredClone(current.document);
  delete normalized.asset.extras.morphloomBakedTransform;
  if(!original.document.asset.extras && !Object.keys(normalized.asset.extras).length)delete normalized.asset.extras;
  requireValue(Array.isArray(proof.referenceNodes)&&proof.referenceNodes.length<=10000&&proof.referenceNodes.every((i:unknown)=>Number.isInteger(i)&&Number(i)>=0&&Number(i)<normalized.nodes.length)&&new Set(proof.referenceNodes).size===proof.referenceNodes.length,'Invalid reference node list');
  const expectedReferences:number[]=[];const parents=new Map<number,number>();
  current.document.nodes.forEach((n:any,i:number)=>(n.children??[]).forEach((c:number)=>{requireValue(!parents.has(c),'Multiple parent');parents.set(c,i);}));
  const seen=new Set<number>();let ancestor:number|undefined=target;
  while(ancestor!==undefined){requireValue(!seen.has(ancestor),'Ancestor cycle');seen.add(ancestor);if(Object.hasOwn(original.document.nodes[ancestor]?.extras??{},'sourceSpec'))expectedReferences.push(ancestor);ancestor=parents.get(ancestor);}
  requireValue(canonical(expectedReferences)===canonical(proof.referenceNodes),'Source reference ancestry mismatch');
  for(const i of proof.referenceNodes){
    const extra=normalized.nodes[i].extras,reference=extra?.morphloomSourceSpecReference;
    requireValue(reference && !Object.hasOwn(extra,'sourceSpec') && canonical(reference)===canonical({schema:'morphloom.source-spec-reference/0.1',state:'before-edit-reference',sourceSha256:sourceFingerprint,sourceSpec:original.document.nodes[i].extras.sourceSpec}),'Reference contents/state mismatch');
    delete extra.morphloomSourceSpecReference;extra.sourceSpec=reference.sourceSpec;
  }
  const beforeNode=original.document.nodes[target],afterNode=normalized.nodes[target];
  if(beforeNode.matrix){requireValue(Array.isArray(afterNode.matrix)&&afterNode.matrix.length===16&&afterNode.matrix.every((v:number,i:number)=>[12,13,14].includes(i)||v===beforeNode.matrix[i]),'Target linear transform changed');afterNode.matrix=beforeNode.matrix;}
  else if(Object.hasOwn(beforeNode,'translation'))afterNode.translation=beforeNode.translation;
  else delete afterNode.translation;
  requireValue(canonical(original.document)===canonical(normalized),'JSON changed outside declared transform/reference metadata');
  const beforeWorld=world(original.document.nodes,target),afterWorld=world(current.document.nodes,target);
  requireValue(beforeWorld.elements.every((v,i)=>[12,13,14].includes(i)||Math.abs(v-afterWorld.elements[i])<=1e-10),'World linear transform changed');
  const error=Math.max(...proof.translationMm.map((v:number,i:number)=>Math.abs(afterWorld.elements[12+i]-beforeWorld.elements[12+i]-v*.001)));
  requireValue(error<=1e-6,'Declared world translation mismatch');
  const loaded=await new GLTFLoader().parseAsync(currentBytes,'');
  try {
    // Owned inspection-only context. The actual file and reference remain unchanged.
    loaded.scene.traverse(object=>{
      const i=loaded.parser.associations.get(object)?.nodes;
      if(i===undefined || !proof.referenceNodes.includes(i))return;
      const source=original.document.nodes[i].extras.sourceSpec;
      if(Array.isArray(source?.parts) && source.parts.some((p:any)=>p.geometry?.op==='spur-gear')){
        requireValue(typeof source.schema==='string' && /^morphloom\.elements\/0\.[1-7]$/.test(source.schema),'Unsupported connected-feature source schema');
        for(const p of source.parts)if(p.geometry?.op==='spur-gear')validateSpurGear(p.geometry);
      }
      delete object.userData.morphloomSourceSpecReference;
      if(Array.isArray(source?.parts))object.userData.sourceSpec={parts:source.parts.map((p:any)=>({id:p.id,geometry:p.geometry}))};
    });
    return {schema:'morphloom.bound-reference-uv-receipt/0.1' as const,sourceFingerprint,outputFingerprint,preservedBinFingerprint:await sha256(current.bin),currentEditableIRAvailable:false as const,sourceMetadataState:'before-edit-reference' as const,worldTranslationErrorMeters:error,bindingScope:'Exact original/current local geometry/UV/index/material semantics plus declared translation; inspection-only context',report:await inspectUvQuality(loaded.scene,{includeTriangles:true})};
  } finally {
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
    for(const scene of loaded.scenes)scene.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v instanceof THREE.Texture)textures.add(v);}}});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures){t.dispose();if(typeof ImageBitmap!=='undefined'&&t.image instanceof ImageBitmap)t.image.close();}
  }
}
