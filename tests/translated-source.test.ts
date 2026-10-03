import {expect,it,vi} from 'vitest';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {exportSelectedScene} from '../src/engine/element-renderer';
import {sha256} from '../src/engine/uv-quality';
import {migrateElementProjectToV4} from '../src/engine/element-project';
import {reconstructTranslatedSource} from '../src/engine/translated-source';
import {buildWorkspaceScene,type ElementWorkspace} from '../src/engine/element-workspace';
function unpack(b:ArrayBuffer){const n=new DataView(b).getUint32(12,true);return {d:JSON.parse(new TextDecoder().decode(new Uint8Array(b,20,n))),bin:new Uint8Array(b,20+n).slice()};}
function pack(d:any,bin:Uint8Array){const text=new TextEncoder().encode(JSON.stringify(d)),n=Math.ceil(text.length/4)*4,b=new ArrayBuffer(20+n+bin.length),v=new DataView(b);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.byteLength,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);new Uint8Array(b,20,n).fill(32);new Uint8Array(b,20,text.length).set(text);new Uint8Array(b,20+n).set(bin);return b;}
async function fixture(locked=false,alterNormals=false,indexed=false){
 class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
 vi.stubGlobal('FileReader',Reader);
 const project=migrateElementProjectToV4(generateSpurGearProject({}));project.parts[0].uvScale=100;project.parts[0].locked=locked;
 if(indexed){project.parts[0].geometry={op:'sphere',radius:10,widthSegments:32,heightSegments:24};delete project.parts[0].creaseAngle;}
 const built=exportSelectedScene(project,['spur_gear']);
 try{
  let original=await new GLTFExporter().parseAsync(built.root,{binary:true}) as ArrayBuffer;
  if(alterNormals){const {d,bin}=unpack(original),a=d.accessors[d.meshes[0].primitives[0].attributes.NORMAL],offset=8+(d.bufferViews[a.bufferView].byteOffset??0)+(a.byteOffset??0);new DataView(bin.buffer,bin.byteOffset).setFloat32(offset,.25,true);original=pack(d,bin);}
  const {d,bin}=unpack(original),sourceFingerprint=await sha256(new Uint8Array(original));
  const owner=d.nodes.find((n:any)=>n.extras?.sourceSpec),ownerIndex=d.nodes.indexOf(owner),target=d.nodes.find((n:any)=>n.name==='spur_gear');
  // Match the supported adapter: preserve the original transform representation.
  if(target.matrix) target.matrix[12]+=.002;
  else target.translation=[(target.translation?.[0]??0)+.002,target.translation?.[1]??0,target.translation?.[2]??0];
  owner.extras.morphloomSourceSpecReference={schema:'morphloom.source-spec-reference/0.1',state:'before-edit-reference',sourceSha256:sourceFingerprint,sourceSpec:owner.extras.sourceSpec};delete owner.extras.sourceSpec;
  d.asset.extras={morphloomBakedTransform:{schema:'morphloom.baked-transform/0.1',sourceSha256:sourceFingerprint,node:'spur_gear',translationMm:[2,0,0],coordinates:'glTF right-handed Y-up world, millimeters',currentEditableIRAvailable:false,sourceSpecState:'before-edit-reference',referenceNodes:[ownerIndex]}};
  return {project,original,current:pack(d,bin)};
 }finally{built.dispose();}
}
it('regenerates a separate edited native source, preserves inputs and all other source fields',async()=>{
 try{const f=await fixture(),before=await sha256(new Uint8Array(f.current)),result=await reconstructTranslatedSource(f.original,f.current),expected=structuredClone(f.project);expected.parts[0].position=[2,0,0];expect(result.project).toEqual(expected);expect(result.receipt.currentEditableSourceAvailable).toBe(true);expect(result.receipt.inputGlbEditableIrAvailable).toBe(false);expect(await sha256(new Uint8Array(f.current))).toBe(before);}finally{vi.unstubAllGlobals();}
});
it('rejects authentic bound bytes that cannot be regenerated from the original IR',async()=>{
 try{const f=await fixture(false,true);await expect(reconstructTranslatedSource(f.original,f.current)).rejects.toThrow('original regenerated BIN differs');}finally{vi.unstubAllGlobals();}
});
it('preserves the existing locked-part edit refusal',async()=>{
 try{const f=await fixture(true);await expect(reconstructTranslatedSource(f.original,f.current)).rejects.toThrow('locked');}finally{vi.unstubAllGlobals();}
});

it('rejects matrix representation injection, wrong provenance and undeclared translation',async()=>{
 try{
  const f=await fixture();
  for(const mutate of [(d:any)=>{const n=d.nodes.find((n:any)=>n.name==='spur_gear');delete n.translation;n.matrix=[1,0,0,0,0,1,0,0,0,0,1,0,.002,0,0,1];},(d:any)=>{d.asset.extras.morphloomBakedTransform.sourceSha256='0'.repeat(64);},(d:any)=>{d.nodes.find((n:any)=>n.name==='spur_gear').translation=[.003,0,0];}]){
   const {d,bin}=unpack(f.current);mutate(d);await expect(reconstructTranslatedSource(f.original,pack(d,bin))).rejects.toThrow();
  }
 }finally{vi.unstubAllGlobals();}
});

it('rejects changes to each actual geometry attribute, index, PBR and hierarchy without partial reconstruction',async()=>{
 try{
  const f=await fixture(false,false,true),before=await sha256(new Uint8Array(f.current));
  expect((await reconstructTranslatedSource(f.original,f.current)).receipt.currentEditableSourceAvailable).toBe(true);
  const d=unpack(f.current).d,primitive=d.meshes[0].primitives[0];
  for(const accessor of [primitive.attributes.POSITION,primitive.attributes.NORMAL,primitive.attributes.TEXCOORD_0,primitive.indices]){
   expect(accessor).toBeTypeOf('number');const data=unpack(f.current),a=data.d.accessors[accessor],offset=8+(data.d.bufferViews[a.bufferView].byteOffset??0)+(a.byteOffset??0);data.bin[offset]^=1;
   await expect(reconstructTranslatedSource(f.original,pack(data.d,data.bin))).rejects.toThrow('BIN');
  }
  for(const mutate of [(v:any)=>{v.materials[0].pbrMetallicRoughness.roughnessFactor=.77;},(v:any)=>{v.nodes.find((n:any)=>n.children)?.children.reverse();v.nodes[0].name='tampered hierarchy';},(v:any)=>{v.asset.extras.morphloomBakedTransform.coordinates='Blender Z-up';},(v:any)=>{v.asset.extras.morphloomBakedTransform.translationMm=[1,0,0];},(v:any)=>{v.nodes.find((n:any)=>n.name==='spur_gear').scale=[0,1,1];}]){
   const data=unpack(f.current);mutate(data.d);await expect(reconstructTranslatedSource(f.original,pack(data.d,data.bin))).rejects.toThrow();
  }
  expect(await sha256(new Uint8Array(f.current))).toBe(before);
 }finally{vi.unstubAllGlobals();}
});

it('rejects a coherently bound rotated parent, unsupported source schema and texture URI',async()=>{
 try{
  const f=await fixture();
  for(const kind of ['rotated-parent','unsupported-source','texture-uri']){
   const before=unpack(f.original),after=unpack(f.current);
   const owner=before.d.nodes.find((n:any)=>n.extras?.sourceSpec),ownerIndex=before.d.nodes.indexOf(owner);
   if(kind==='rotated-parent'){
    const targetIndex=before.d.nodes.findIndex((n:any)=>n.name==='spur_gear'),parent=before.d.nodes.findIndex((n:any)=>n.children?.includes(targetIndex));expect(parent).toBeGreaterThanOrEqual(0);
    before.d.nodes[parent].rotation=[0,0,1,0];after.d.nodes[parent].rotation=[0,0,1,0];after.d.nodes[targetIndex].translation=[-.002,0,0];
   }else if(kind==='unsupported-source')owner.extras.sourceSpec.schema='unsupported/9';
   else {before.d.images=[{uri:'https://invalid.example/never-fetch.png'}];after.d.images=before.d.images;}
   const original=pack(before.d,before.bin),fingerprint=await sha256(new Uint8Array(original));after.d.asset.extras.morphloomBakedTransform.sourceSha256=fingerprint;
   after.d.nodes[ownerIndex].extras.morphloomSourceSpecReference.sourceSha256=fingerprint;after.d.nodes[ownerIndex].extras.morphloomSourceSpecReference.sourceSpec=owner.extras.sourceSpec;
   await expect(reconstructTranslatedSource(original,pack(after.d,after.bin))).rejects.toThrow();
  }
 }finally{vi.unstubAllGlobals();}
});

it('rejects an actual combined workspace export instead of creating a partial native source',async()=>{
 try{
  const f=await fixture(),workspace:ElementWorkspace={schema:'morphloom.workspace/0.1',units:'mm',coordinates:'right-handed-y-up',assets:['a','b'].map(id=>({id,packId:'mechanical.spur-gear.visual',requiredCapabilities:[],source:structuredClone(f.project),positionMm:[0,0,0],rotationRad:[0,0,0]}))};
  const built=buildWorkspaceScene(workspace,'detail',true);
  try{
   const original=await new GLTFExporter().parseAsync(built.root,{binary:true}) as ArrayBuffer,{d,bin}=unpack(original),fingerprint=await sha256(new Uint8Array(original)),target=d.nodes.findIndex((n:any)=>n.name==='a::spur_gear');
   d.nodes[target].translation=[.002,0,0];const parents=new Map<number,number>();d.nodes.forEach((n:any,i:number)=>(n.children??[]).forEach((c:number)=>parents.set(c,i)));const references:number[]=[];let index:number|undefined=target;
   while(index!==undefined){const extras=d.nodes[index].extras;if(extras?.sourceSpec){references.push(index);extras.morphloomSourceSpecReference={schema:'morphloom.source-spec-reference/0.1',state:'before-edit-reference',sourceSha256:fingerprint,sourceSpec:extras.sourceSpec};delete extras.sourceSpec;}index=parents.get(index);}
   references.sort((a,b)=>a-b);d.asset.extras={morphloomBakedTransform:{schema:'morphloom.baked-transform/0.1',sourceSha256:fingerprint,node:'a::spur_gear',translationMm:[2,0,0],coordinates:'glTF right-handed Y-up world, millimeters',currentEditableIRAvailable:false,sourceSpecState:'before-edit-reference',referenceNodes:references}};
   await expect(reconstructTranslatedSource(original,pack(d,bin))).rejects.toThrow();
  }finally{built.dispose();}
 }finally{vi.unstubAllGlobals();}
});
