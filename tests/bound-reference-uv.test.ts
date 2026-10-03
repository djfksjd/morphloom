import {expect,it,vi}from'vitest';
import * as THREE from'three';
import{GLTFExporter}from'three/addons/exporters/GLTFExporter.js';
import{generateSpurGearProject}from'../src/engine/gear-pack';
import{exportSelectedScene}from'../src/engine/element-renderer';
import{inspectUvQuality,sha256}from'../src/engine/uv-quality';
import{inspectExportedUv}from'../src/engine/uv-delivery';
import{inspectBoundReferenceUv}from'../src/engine/bound-reference-uv';
function unpack(bytes:ArrayBuffer){const v=new DataView(bytes),n=v.getUint32(12,true);return{document:JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,n))),bin:new Uint8Array(bytes,20+n).slice()};}
function pack(document:unknown,bin:Uint8Array){const text=new TextEncoder().encode(JSON.stringify(document)),n=Math.ceil(text.length/4)*4,bytes=new ArrayBuffer(20+n+bin.length),view=new DataView(bytes);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.byteLength,true);view.setUint32(12,n,true);view.setUint32(16,0x4e4f534a,true);new Uint8Array(bytes,20,n).fill(32);new Uint8Array(bytes,20,text.length).set(text);new Uint8Array(bytes,20+n).set(bin);return bytes;}
async function fixture(damaged=false){
 class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
 vi.stubGlobal('FileReader',Reader);
 const scene=exportSelectedScene(generateSpurGearProject({moduleMm:2,toothCount:40,pressureAngleDeg:25,faceWidthMm:12,boreDiameterMm:10}),['spur_gear']);
 try{
  if(damaged){const report=await inspectUvQuality(scene.root,{includeTriangles:true}),uv=(scene.root.getObjectByName('spur_gear')as THREE.Mesh).geometry.getAttribute('uv');for(const t of report.meshes[0].triangles!.filter(t=>t.connectedFeatureId==='spur_gear/tooth_0003'&&!t.legacyDegenerate).slice(0,12))for(let k=0;k<3;k++)uv.setXY(t.index*3+k,0,0);}
  const original=await new GLTFExporter().parseAsync(scene.root,{binary:true})as ArrayBuffer;
  const{document,bin}=unpack(original),target=document.nodes.findIndex((n:any)=>n.name==='spur_gear'),references:number[]=[];
  document.nodes[target].translation=[.002,0,0];
  document.nodes.forEach((n:any,i:number)=>{if(n.extras?.sourceSpec){n.extras.morphloomSourceSpecReference={schema:'morphloom.source-spec-reference/0.1',state:'before-edit-reference',sourceSha256:'',sourceSpec:n.extras.sourceSpec};delete n.extras.sourceSpec;references.push(i);}});
  const fingerprint=await sha256(new Uint8Array(original));for(const i of references)document.nodes[i].extras.morphloomSourceSpecReference.sourceSha256=fingerprint;
  document.asset.extras={morphloomBakedTransform:{schema:'morphloom.baked-transform/0.1',sourceSha256:fingerprint,node:'spur_gear',translationMm:[2,0,0],coordinates:'glTF right-handed Y-up world, millimeters',currentEditableIRAvailable:false,sourceSpecState:'before-edit-reference',referenceNodes:references}};
  return{original,current:pack(document,bin)};
 }finally{scene.dispose();vi.unstubAllGlobals();}
}
it('restores actual tooth UV checks only after exact file binding and never mutates the reference artifact',async()=>{
 const{original,current}=await fixture(),fingerprint=await sha256(new Uint8Array(current));
 expect((await inspectExportedUv(current,'reference')).report.integrityPass).toBe(false);
 const receipt=await inspectBoundReferenceUv(original,current);
 expect(receipt.currentEditableIRAvailable).toBe(false);expect(receipt.sourceMetadataState).toBe('before-edit-reference');expect(receipt.report.integrityPass).toBe(true);expect(receipt.report.meshes[0].features).toHaveLength(40);expect(receipt.report.meshes[0].criticalFeatures).toBe('pass');
 expect(await sha256(new Uint8Array(current))).toBe(fingerprint);
 expect((await inspectExportedUv(current,'reference')).report.integrityPass).toBe(false);
});
it('keeps one damaged tooth failed even below the unchanged aggregate UV threshold',async()=>{
 const{original,current}=await fixture(true),receipt=await inspectBoundReferenceUv(original,current),mesh=receipt.report.meshes[0];
 expect(mesh.degenerateUvTriangles/mesh.eligibleUvTriangles).toBeLessThanOrEqual(.05);expect(mesh.features.find(f=>f.id==='spur_gear/tooth_0003')?.integrityPass).toBe(false);expect(mesh.criticalFeatures).toBe('fail');expect(receipt.report.integrityPass).toBe(false);
});
it('rejects a wrong original and changed BIN/accessor/material/translation/version',async()=>{
 const{original,current}=await fixture(),wrong=unpack(original);wrong.document.asset.generator='wrong';await expect(inspectBoundReferenceUv(pack(wrong.document,wrong.bin),current)).rejects.toThrow('SHA');
 const changed=unpack(current);changed.bin[changed.bin.length-1]^=1;await expect(inspectBoundReferenceUv(original,pack(changed.document,changed.bin))).rejects.toThrow('BIN');
 for(const mutate of [(v:any)=>{v.accessors[0].byteOffset=(v.accessors[0].byteOffset??0)+4;},(v:any)=>{v.materials[0].name='changed';},(v:any)=>{v.nodes.find((n:any)=>n.name==='spur_gear').translation=[.003,0,0];},(v:any)=>{v.asset.extras.morphloomBakedTransform.schema='unknown';}]){
  const data=unpack(current);mutate(data.document);await expect(inspectBoundReferenceUv(original,pack(data.document,data.bin))).rejects.toThrow();
 }
});

it('rejects invalid connected-feature parameters rather than falling back to aggregate approval',async()=>{
 const data=await fixture(),before=unpack(data.original),after=unpack(data.current);
 const owner=before.document.nodes.find((n:any)=>n.extras?.sourceSpec);owner.extras.sourceSpec.parts[0].geometry.toothCount=0;
 const original=pack(before.document,before.bin),fingerprint=await sha256(new Uint8Array(original));
 after.document.asset.extras.morphloomBakedTransform.sourceSha256=fingerprint;
 for(const i of after.document.asset.extras.morphloomBakedTransform.referenceNodes){const reference=after.document.nodes[i].extras.morphloomSourceSpecReference;reference.sourceSha256=fingerprint;reference.sourceSpec=before.document.nodes[i].extras.sourceSpec;}
 await expect(inspectBoundReferenceUv(original,pack(after.document,after.bin))).rejects.toThrow();
});
