import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {inspectBoundReferenceUv} from './bound-reference-uv';
import {parseProject,serializeProject,editPart,type Vec3} from './element-project';
import {exportSelectedScene,ELEMENT_RENDERER_REVISION} from './element-renderer';
import {sha256} from './uv-quality';

function requireValue(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
function unpack(bytes:ArrayBuffer) {
  const n=new DataView(bytes).getUint32(12,true);
  return {document:JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,n))),bin:new Uint8Array(bytes,20+n)};
}
function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+canonical(record[k])).join(',')+'}';
}
function payload(document:any):unknown {
  // Only source bookkeeping differs. All actual scene/material/accessor semantics remain checked.
  const copy=structuredClone(document);
  if(copy.asset?.extras?.morphloomBakedTransform){delete copy.asset.extras.morphloomBakedTransform;if(!Object.keys(copy.asset.extras).length)delete copy.asset.extras;}
  for(const node of copy.nodes){
    if(node.extras)for(const key of ['sourceSpec','morphloomSourceSpecReference','rendererRevision'])delete node.extras[key];
    for(const key of ['matrix','translation','rotation','scale'])delete node[key];
  }
  return copy;
}

function transformsMatch(generated:any,expected:any):boolean {
  const matrix=(node:any)=>node.matrix?new THREE.Matrix4().fromArray(node.matrix):new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.translation??[0,0,0]),new THREE.Quaternion().fromArray(node.rotation??[0,0,0,1]),new THREE.Vector3().fromArray(node.scale??[1,1,1]));
  return generated.nodes.length===expected.nodes.length&&generated.nodes.every((node:any,i:number)=>{
    const a=matrix(node),b=matrix(expected.nodes[i]);
    // Existing bound-reference limits: 0.001 mm translation, 1e-10 linear terms.
    return a.elements.every((v,k)=>Number.isFinite(v)&&Number.isFinite(b.elements[k])&&Math.abs(v-b.elements[k])<=([12,13,14].includes(k)?1e-6:1e-10));
  });
}

/** Reconstruct a separate native source only when both original and edited exports match exactly.
 * Never changes the input GLB or promotes its before-edit source reference.
 */
export async function reconstructTranslatedSource(originalBytes:ArrayBuffer,currentBytes:ArrayBuffer) {
  const binding=await inspectBoundReferenceUv(originalBytes,currentBytes);
  requireValue(binding.report.integrityPass,'Source reconstruction blocked: bound UV integrity failed');
  const original=unpack(originalBytes),current=unpack(currentBytes);
  const owners=original.document.nodes.filter((n:any)=>n.extras?.sourceSpec);
  requireValue(owners.length===1&&Array.isArray(owners[0].extras.selectedIds),'Source reconstruction requires one native selected source; mixed workspace unsupported');
  const owner=owners[0],project=parseProject(JSON.stringify(owner.extras.sourceSpec));
  requireValue(project.units==='mm'&&project.coordinates==='right-handed-y-up','Native source must declare mm/right-handed-y-up');
  const parents=new Map<number,number>();original.document.nodes.forEach((n:any,i:number)=>(n.children??[]).forEach((c:number)=>parents.set(c,i)));
  let ancestor=parents.get(original.document.nodes.findIndex((n:any)=>n.name===current.document.asset.extras.morphloomBakedTransform.node));
  while(ancestor!==undefined){
    const n=original.document.nodes[ancestor];
    const identity=n.matrix?canonical(n.matrix)===canonical(new THREE.Matrix4().elements):(!n.translation||n.translation.every((v:number)=>v===0))&&(!n.rotation||canonical(n.rotation)===canonical([0,0,0,1]))&&(!n.scale||n.scale.every((v:number)=>v===1));
    requireValue(identity,'Parent transform is not a native identity datum; rotated/scaled/translated parents unsupported');ancestor=parents.get(ancestor);
  }

  requireValue(project.elements.length===0&&project.groups.length===0,'Generated elements/groups source reconstruction unsupported');
  requireValue(!original.document.images?.length&&!original.document.textures?.length,'Textured source reconstruction unsupported');
  const proof=current.document.asset.extras.morphloomBakedTransform;
  const target=project.parts.find(part=>part.id===proof.node);
  requireValue(target,'Target is not a native source part');
  const selected:string[]=owner.extras.selectedIds;
  requireValue(selected.length>0&&selected.length<=128&&new Set(selected).size===selected.length&&selected.every(id=>typeof id==='string'&&project.parts.some(p=>p.id===id)),'Unsupported source selection');
  const edited=editPart(project,target.id,{position:target.position.map((v,i)=>v+proof.translationMm[i]) as Vec3});
  for(const [source,expected,label] of [[project,original,'original'],[edited,current,'edited']] as const){
    const built=exportSelectedScene(source,selected);
    try {
      const generated=unpack(await new GLTFExporter().parseAsync(built.root,{binary:true}) as ArrayBuffer);
      requireValue(generated.bin.length===expected.bin.length&&generated.bin.every((v,i)=>v===expected.bin[i]),`Source reconstruction blocked: ${label} regenerated BIN differs (input renderer ${owner.extras.rendererRevision??'unknown'}, current ${ELEMENT_RENDERER_REVISION})`);
      requireValue(transformsMatch(generated.document,expected.document)&&canonical(payload(generated.document))===canonical(payload(expected.document)),`Source reconstruction blocked: ${label} regenerated scene semantics differ`);
    }finally{built.dispose();}
  }
  const sourceJson=serializeProject(edited);
  requireValue(new TextEncoder().encode(sourceJson).length<=2_000_000,'Modified source exceeds 2 MB');
  return {binding,project:edited,sourceJson,receipt:{schema:'morphloom.translated-source-receipt/0.1' as const,engineRevision:ELEMENT_RENDERER_REVISION,originalFingerprint:binding.sourceFingerprint,currentFingerprint:binding.outputFingerprint,sourceFingerprint:await sha256(new TextEncoder().encode(sourceJson)),target:target.id,translationMm:proof.translationMm as Vec3,verification:'Regenerated BIN/non-transform scene semantics exact; local translation <=1e-6m and linear terms <=1e-10',currentEditableSourceAvailable:true as const,inputGlbEditableIrAvailable:false as const,scope:'Separate native source for declared translation; not arbitrary DCC edits, manufacturing or production approval'}};
}
