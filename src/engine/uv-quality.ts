import * as THREE from 'three';
import {textureDensityContext,triangleTexelRange,addTexelMeasurement,type TexelDensitySummary} from './texel-density';
import {makeGearToothPicker} from './gear-picking';
import {toothIds,type SpurGearGeometry} from './spur-gear';
export const UV_QUALITY_REVISION='morphloom.uv-quality/0.2';
export const UV_DOUBLE_AREA_EPSILON=1e-10; // Existing domain-readiness threshold; unchanged.
export const WORLD_DOUBLE_AREA_EPSILON=1e-14;
type Attribute=THREE.BufferAttribute|THREE.InterleavedBufferAttribute;
export function inspectUvAttribute(positionCount:number,uv?:Attribute):{valid:boolean;vertices:number;invalidVertices:number}{
 if(!uv)return {valid:false,vertices:0,invalidVertices:0};
 if(uv.itemSize<2||uv.count!==positionCount)return {valid:false,vertices:positionCount,invalidVertices:positionCount};
 let invalidVertices=0;for(let i=0;i<uv.count;i++)if(!Number.isFinite(uv.getX(i))||!Number.isFinite(uv.getY(i)))invalidVertices++;
 return {valid:true,vertices:uv.count,invalidVertices};
}
export function signedUvDoubleArea(uv:Attribute,a:number,b:number,c:number):number{
 return (uv.getX(b)-uv.getX(a))*(uv.getY(c)-uv.getY(a))-(uv.getY(b)-uv.getY(a))*(uv.getX(c)-uv.getX(a));
}
/** Correlation signature of delivered float32 UVs, not a security/authenticity check. */
export function uvAttributeSignature(g:THREE.BufferGeometry):string{
 const uv=g.getAttribute('uv');if(!uv)return 'missing';let h=2166136261;const f=new Float32Array(1),bytes=new Uint8Array(f.buffer);
 for(let i=0;i<uv.count;i++)for(const n of [uv.getX(i),uv.getY(i)]){f[0]=n;for(const b of bytes)h=Math.imul(h^b,16777619);}
 return `${uv.count}:${uv.itemSize}:${(h>>>0).toString(16)}`;
}
export async function sha256(data:string|Uint8Array):Promise<string>{
 const bytes=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data);
 return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export type UvTriangle={texelsPerMm?:[number,number]|null;index:number;worldAreaM2:number|null;signedUvArea:number|null;legacyDegenerate:boolean;connectedFeatureId?:string;anisotropy:number|null;uvUnitsPerMeter:number|null};
type Point=[number,number];type Candidate={index:number;points:Point[];area:number;minX:number;maxX:number;minY:number;maxY:number};
export type UvMeshReport={texelDensity:TexelDensitySummary;id:string;nodeName:string;parent:string;blocked?:string;integrityPass:boolean;criticalFeatures:'not-run'|'pass'|'fail';features:{id:string;triangles:number;degenerateUvTriangles:number;integrityPass:boolean}[];triangles?:UvTriangle[];triangleSamples:UvTriangle[];triangleCount:number;eligibleUvTriangles:number;degenerateUvTriangles:number;invalidUvVertices:number;uvVertices:number;uvAttributeValid:boolean;invalidWorldTriangles:number;negativeUvTriangles:number;zeroUvTriangles:number;worldAreaM2:number;uvArea:number;maximumAnisotropy:number|null;uvUnitsPerMeterRange:[number,number]|null;overlap:{complete:boolean;consideredPairs:number;narrowPhasePairs:number;positiveAreaPairs:number;pairSamples:[number,number][];intent:'declared-planar-overlap'|'declared-periodic-mapping'|'unverified';scope:'within-mesh';relativeAreaTolerance:number};};
export type UvQualityReport={revision:string;geometryFingerprint:string;fingerprintCoverage:'complete'|'partial-blocked';integrityPass:boolean;meshes:UvMeshReport[];texelDensity:{status:'measured'|'partial'|'not-run';reason:string};atlas:{status:'not-run';reason:string};cost:{milliseconds:number;overlapPairBudgetPerMesh:number};};
function intersectionArea(a:Point[],b:Point[]):number{
 let polygon=a.map(p=>[...p] as Point);const cross=(p:Point,q:Point,r:Point)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 const sign=Math.sign(cross(b[0],b[1],b[2]));if(!sign)return 0;
 for(let i=0;i<3&&polygon.length;i++){
  const p=b[i],q=b[(i+1)%3],next:Point[]=[];
  for(let j=0;j<polygon.length;j++){
   const s=polygon[j],e=polygon[(j+1)%polygon.length],ds=sign*cross(p,q,s),de=sign*cross(p,q,e);
   if(ds>=0)next.push(s);if((ds>=0)!==(de>=0)){const t=ds/(ds-de);next.push([s[0]+(e[0]-s[0])*t,s[1]+(e[1]-s[1])*t]);}
  }polygon=next;
 }
 if(polygon.length<3)return 0;const origin=polygon[0];let twice=0;
 for(let i=1;i<polygon.length-1;i++)twice+=cross(origin,polygon[i],polygon[i+1]);return Math.abs(twice)/2;
}
function overlaps(candidates:Candidate[],budget:number):UvMeshReport['overlap']{
 const r:UvMeshReport['overlap']={complete:true,consideredPairs:0,narrowPhasePairs:0,positiveAreaPairs:0,pairSamples:[],intent:'unverified',scope:'within-mesh',relativeAreaTolerance:1e-8};
 candidates.sort((a,b)=>a.minX-b.minX||a.index-b.index);
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length&&candidates[j].minX<=candidates[i].maxX;j++){
  if(r.consideredPairs>=budget){r.complete=false;return r;}r.consideredPairs++;
  const a=candidates[i],b=candidates[j];if(a.maxY<b.minY||b.maxY<a.minY)continue;r.narrowPhasePairs++;
  if(intersectionArea(a.points,b.points)>Math.max(a.area,b.area)*r.relativeAreaTolerance){r.positiveAreaPairs++;if(r.pairSamples.length<32)r.pairSamples.push([a.index,b.index]);}
 }return r;
}
function mappingIntent(mesh:THREE.Mesh):UvMeshReport['overlap']['intent']{
 const m=mesh.userData.uvMapping;if(m?.revision!=='morphloom.native-uv/0.1'||m.uvSignature!==uvAttributeSignature(mesh.geometry))return 'unverified';
 if(m.kind==='planar-projection')return 'declared-planar-overlap';
 return ['spherical','cylindrical-strip'].includes(m.kind)?'declared-periodic-mapping':'unverified';
}
function nativeId(object:THREE.Object3D,fallback:string):string{
 const feature=object.userData.extraction==='diagnostic-sector-cut'?object.userData.connectedSourceFeatureId:undefined;
 const local=feature??object.userData.sourceId??object.userData.sourceLocalName,asset=object.userData.assetId;
 return typeof local==='string'&&local?typeof asset==='string'&&asset?`${asset}::${local}`:local:fallback;
}
function authoredGear(mesh:THREE.Mesh):SpurGearGeometry|undefined{
 let owner:THREE.Object3D|null=mesh;
 while(owner){const spec=owner.userData.sourceSpec;if(Array.isArray(spec?.parts)){
  const p=spec.parts.find((p:{id?:unknown})=>p.id===(mesh.userData.sourceId??mesh.name));
  if(p?.geometry?.op==='spur-gear')return p.geometry as SpurGearGeometry;
 }owner=owner.parent;}return undefined;
}
function canonicalAttribute(a:Attribute):Uint8Array{
 const values=new Float64Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)values[i*a.itemSize+c]=a.getComponent(i,c);
 return new Uint8Array(values.buffer);
}
export async function inspectUvQuality(root:THREE.Object3D,options:{includeTriangles?:boolean;overlapPairBudget?:number}={}):Promise<UvQualityReport>{
 const started=performance.now(),budget=options.overlapPairBudget??20_000;
 if(!Number.isInteger(budget)||budget<0||budget>200_000)throw new Error('UV overlap budget must be 0..200000 per mesh');
 let sceneTriangles=0;
 const meshes:UvMeshReport[]=[],fingerprintParts:Uint8Array[]=[];root.updateMatrixWorld(true);
 root.traverseVisible(object=>{
  if(!(object instanceof THREE.Mesh))return;const geometry=object.geometry,p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  const id=nativeId(object,object.name||`mesh_${meshes.length}`),parent=object.parent?nativeId(object.parent,object.parent.name):'';
  const density=textureDensityContext(object);const r:UvMeshReport={texelDensity:density.summary,id,nodeName:object.name,parent,integrityPass:false,criticalFeatures:'not-run',features:[],triangleSamples:[],triangleCount:0,eligibleUvTriangles:0,degenerateUvTriangles:0,invalidUvVertices:0,uvVertices:0,uvAttributeValid:false,invalidWorldTriangles:0,negativeUvTriangles:0,zeroUvTriangles:0,worldAreaM2:0,uvArea:0,maximumAnisotropy:null,uvUnitsPerMeterRange:null,overlap:overlaps([],budget)};meshes.push(r);
  if(!p||p.itemSize<3||p.count>300_000||(geometry.index?.count??p.count)>300_000||sceneTriangles+(geometry.index?.count??p.count)/3>300_000||['position','uv','normal'].some(k=>{const a=geometry.getAttribute(k);return a&&(a.count>300_000||a.itemSize>4);})||object instanceof THREE.InstancedMesh||object instanceof THREE.SkinnedMesh){r.blocked='Requires bounded static non-instanced mesh (100000 triangles per mesh / 300000 per scene; attribute size<=4)' ;r.overlap.complete=false;r.texelDensity.reason=r.blocked;fingerprintParts.push(new TextEncoder().encode(JSON.stringify({id,parent,blocked:r.blocked})));return;}
  sceneTriangles+=(geometry.index?.count??p.count)/3;
  const attr=inspectUvAttribute(p.count,uv);r.uvAttributeValid=attr.valid;r.uvVertices=attr.vertices;r.invalidUvVertices=attr.invalidVertices;
  const metadata={id,parent,matrix:object.matrixWorld.toArray(),attributes:Object.keys(geometry.attributes).filter(k=>['position','uv','normal'].includes(k)).sort().map(k=>({name:k,count:geometry.getAttribute(k).count,size:geometry.getAttribute(k).itemSize})),indices:geometry.index?.count??0};
  fingerprintParts.push(new TextEncoder().encode(JSON.stringify(metadata)));
  for(const k of ['position','uv','normal']){const a=geometry.getAttribute(k);if(a&&a.count<=300_000)fingerprintParts.push(canonicalAttribute(a));}
  if(geometry.index)fingerprintParts.push(canonicalAttribute(geometry.index));
  let featurePicker:ReturnType<typeof makeGearToothPicker>|undefined;
  const gear=authoredGear(object);if(gear){try{featurePicker=makeGearToothPicker(gear);r.features=toothIds(gear).map(id=>({id:`${r.id}/${id}`,triangles:0,degenerateUvTriangles:0,integrityPass:false}));}catch{ /* Unknown/invalid native source cannot certify a connected feature. */ }}
  const rows:UvTriangle[]=[],candidates:Candidate[]=[];let minScale=Infinity,maxScale=0,maxAnisotropy=0,singular=false,anisotropyMeasurements=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),e1=new THREE.Vector3(),e2=new THREE.Vector3(),cross=new THREE.Vector3();
  const count=geometry.index?.count??p.count;r.triangleCount=Math.floor(count/3);
  for(let i=0;i+2<count;i+=3){
   const indices=[0,1,2].map(k=>geometry.index?geometry.index.getX(i+k):i+k),[ia,ib,ic]=indices;
   const t:UvTriangle={index:i/3,worldAreaM2:null,signedUvArea:null,legacyDegenerate:true,anisotropy:null,uvUnitsPerMeter:null};rows.push(t);
   if(!indices.every(n=>Number.isInteger(n)&&n>=0&&n<p.count)){r.invalidWorldTriangles++;continue;}
   a.fromBufferAttribute(p,ia).applyMatrix4(object.matrixWorld);b.fromBufferAttribute(p,ib).applyMatrix4(object.matrixWorld);c.fromBufferAttribute(p,ic).applyMatrix4(object.matrixWorld);
   e1.copy(b).sub(a);e2.copy(c).sub(a);const doubled=cross.crossVectors(e1,e2).length();
   if(!Number.isFinite(doubled)||doubled<=WORLD_DOUBLE_AREA_EPSILON){r.invalidWorldTriangles++;continue;}
   t.worldAreaM2=doubled/2;r.worldAreaM2+=t.worldAreaM2;
   if(!attr.valid||!uv)continue;r.eligibleUvTriangles++;const signed=signedUvDoubleArea(uv,ia,ib,ic);
   t.legacyDegenerate=!Number.isFinite(signed)||Math.abs(signed)<=UV_DOUBLE_AREA_EPSILON;if(t.legacyDegenerate)r.degenerateUvTriangles++;
   if(featurePicker){const local=[(p.getX(ia)+p.getX(ib)+p.getX(ic))*1000/3,(p.getY(ia)+p.getY(ib)+p.getY(ic))*1000/3,(p.getZ(ia)+p.getZ(ib)+p.getZ(ic))*1000/3],id=featurePicker(local);
    if(id){t.connectedFeatureId=`${r.id}/${id}`;const f=r.features.find(f=>f.id===t.connectedFeatureId)!;f.triangles++;if(t.legacyDegenerate)f.degenerateUvTriangles++;}
   }
   if(!Number.isFinite(signed))continue;t.signedUvArea=signed/2;r.uvArea+=Math.abs(signed)/2;if(signed<0)r.negativeUvTriangles++;if(signed===0){r.zeroUvTriangles++;singular=true;continue;}
   const length=e1.length(),dot=e1.dot(e2)/length,height=doubled/length;
   const ju=(uv.getX(ib)-uv.getX(ia))/length,jv=(uv.getY(ib)-uv.getY(ia))/length,ku=(uv.getX(ic)-uv.getX(ia)-ju*dot)/height,kv=(uv.getY(ic)-uv.getY(ia)-jv*dot)/height;
   if(density.matrix&&density.summary.imageSize){t.texelsPerMm=triangleTexelRange(ju,jv,ku,kv,density.matrix,density.summary.imageSize);addTexelMeasurement(r.texelDensity,t.texelsPerMm,t.connectedFeatureId);}
   const trace=ju*ju+jv*jv+ku*ku+kv*kv,det=ju*kv-jv*ku,max=Math.sqrt((trace+Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2),min=max>0?Math.abs(det)/max:0;
   const scale=Math.sqrt(Math.abs(signed)/doubled);if(Number.isFinite(scale)){t.uvUnitsPerMeter=scale;minScale=Math.min(minScale,scale);maxScale=Math.max(maxScale,scale);}
   if(min>0&&Number.isFinite(max/min)){t.anisotropy=max/min;anisotropyMeasurements++;maxAnisotropy=Math.max(maxAnisotropy,t.anisotropy);}else singular=true;
   const points:Point[]=indices.map(n=>[uv.getX(n),uv.getY(n)]);candidates.push({index:i/3,points,area:Math.abs(signed)/2,minX:Math.min(...points.map(v=>v[0])),maxX:Math.max(...points.map(v=>v[0])),minY:Math.min(...points.map(v=>v[1])),maxY:Math.max(...points.map(v=>v[1]))});
  }
  r.texelDensity.unmeasuredTriangles=r.triangleCount-r.texelDensity.measuredTriangles;if(r.texelDensity.measuredTriangles){r.texelDensity.status=r.texelDensity.unmeasuredTriangles?'partial':'measured';if(r.texelDensity.unmeasuredTriangles)r.texelDensity.reason='Some invalid or singular triangles have no density';}for(const f of r.features){let d=r.texelDensity.features.find(d=>d.id===f.id);if(!d){d={id:f.id,rangeTexelsPerMm:null,measuredTriangles:0,unmeasuredTriangles:f.triangles};r.texelDensity.features.push(d);}else d.unmeasuredTriangles=f.triangles-d.measuredTriangles;}
  r.maximumAnisotropy=singular||!anisotropyMeasurements?null:maxAnisotropy;r.uvUnitsPerMeterRange=Number.isFinite(minScale)?[minScale,maxScale]:null;
  r.overlap=overlaps(candidates,budget);r.overlap.intent=mappingIntent(object);
  if(count%3!==0)r.invalidWorldTriangles++;
  r.integrityPass=attr.valid&&r.invalidUvVertices===0&&r.invalidWorldTriangles===0&&r.eligibleUvTriangles>0&&r.degenerateUvTriangles/r.eligibleUvTriangles<=0.05;
  if(r.features.length){for(const f of r.features)f.integrityPass=f.triangles>0&&f.degenerateUvTriangles/f.triangles<=0.05;r.criticalFeatures=r.features.every(f=>f.integrityPass)?'pass':'fail';r.integrityPass=r.integrityPass&&r.criticalFeatures==='pass';}
  r.triangleSamples=[...rows].sort((a,b)=>Number(b.legacyDegenerate)-Number(a.legacyDegenerate)||(b.anisotropy??Infinity)-(a.anisotropy??Infinity)||a.index-b.index).slice(0,32);
  if(options.includeTriangles)r.triangles=rows;
 });
 const size=fingerprintParts.reduce((n,a)=>n+a.byteLength,0);if(size>80_000_000)throw new Error('UV fingerprint buffer budget exceeded');
 const bytes=new Uint8Array(size);let offset=0;for(const part of fingerprintParts){bytes.set(part,offset);offset+=part.byteLength;}
 const geometryFingerprint=await sha256(bytes);
 return {revision:UV_QUALITY_REVISION,geometryFingerprint,fingerprintCoverage:meshes.some(m=>m.blocked)?'partial-blocked':'complete',integrityPass:meshes.length>0&&meshes.every(m=>m.integrityPass),meshes,texelDensity:{status:meshes.some(m=>m.texelDensity.measuredTriangles)?meshes.every(m=>m.texelDensity.status==='measured')?'measured':'partial':'not-run',reason:'Metallic-roughness image resolution and UV0 transform only; inspect per-mesh omissions. Density is a measurement, not atlas or quality approval'},atlas:{status:'not-run',reason:'Native projections may overlap; no packed atlas, padding, mip bleeding or cross-mesh shared-texture verification'},cost:{milliseconds:performance.now()-started,overlapPairBudgetPerMesh:budget}};
}
export type UvInspectionReceipt={schema:'morphloom.uv-inspection-receipt/0.1';sourceFingerprint:string;report:UvQualityReport};
/** Async content hashing may finish out of order; a superseded receipt is never published. */
export class LatestUvInspection{
 private ticket=0;
 cancel():void{this.ticket++;}
 async run(root:THREE.Object3D,sourceJson:string,options:Parameters<typeof inspectUvQuality>[1]={}):Promise<UvInspectionReceipt|undefined>{
  const ticket=++this.ticket;
  const [sourceFingerprint,report]=await Promise.all([sha256(sourceJson),inspectUvQuality(root,options)]);
  return ticket===this.ticket?{schema:'morphloom.uv-inspection-receipt/0.1',sourceFingerprint,report}:undefined;
 }
}
