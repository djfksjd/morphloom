import {it,expect,vi} from 'vitest';import * as THREE from 'three';
import {inspectUvQuality,uvAttributeSignature,LatestUvInspection} from '../src/engine/uv-quality';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {exportSelectedScene} from '../src/engine/element-renderer';
function mesh(uv:number[],x=0):THREE.Mesh{const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([x,0,0,x+1,0,0,x,1,0],3)).setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return new THREE.Mesh(g,new THREE.MeshStandardMaterial());}
it('measures world area, signed UV area and anisotropic stretch from actual transformed triangles',async()=>{
 const m=mesh([0,0,1,0,0,1]);m.scale.set(2,1,1);const r=await inspectUvQuality(m,{includeTriangles:true});const t=r.meshes[0].triangles![0];expect(t.worldAreaM2).toBe(1);expect(t.signedUvArea).toBe(0.5);expect(t.anisotropy).toBeCloseTo(2);expect(t.uvUnitsPerMeter).toBeCloseTo(Math.sqrt(0.5));
});
it('keeps an unhealthy mesh from being hidden by other healthy meshes and fingerprints real UV edits',async()=>{
 const root=new THREE.Group();root.add(mesh([0,0,1,0,0,1]),mesh([0,0,0,0,0,0],2));const a=await inspectUvQuality(root);expect(a.integrityPass).toBe(false);expect(a.meshes[1].degenerateUvTriangles).toBe(1);
 root.children[1].visible=false;const b=await inspectUvQuality(root);expect(b.integrityPass).toBe(true);expect(b.geometryFingerprint).not.toBe(a.geometryFingerprint);
 (root.children[0] as THREE.Mesh).geometry.getAttribute('uv').setX(0,NaN);expect((await inspectUvQuality(root)).integrityPass).toBe(false);
});
it('counts positive area overlap, ignores shared edges and rejects stale declared mapping signatures',async()=>{
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,2,0,0,3,0,0,2,1,0],3)).setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1,0,0,1],2));const m=new THREE.Mesh(g);
 m.userData.uvMapping={revision:'morphloom.native-uv/0.1',kind:'planar-projection',uvSignature:uvAttributeSignature(g)};
 const a=await inspectUvQuality(m);expect(a.meshes[0].overlap.positiveAreaPairs).toBe(1);expect(a.meshes[0].overlap.intent).toBe('declared-planar-overlap');
 g.getAttribute('uv').setXY(3,1,1);g.getAttribute('uv').setXY(4,0,1);g.getAttribute('uv').setXY(5,1,0);const b=await inspectUvQuality(m);expect(b.meshes[0].overlap.positiveAreaPairs).toBe(0);expect(b.meshes[0].overlap.intent).toBe('unverified');
 const c=await inspectUvQuality(m,{overlapPairBudget:0});expect(c.meshes[0].overlap.complete).toBe(false);
});

it('never publishes an older receipt when native content hashing resolves out of order, or after cancellation',async()=>{
 const native=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);let release:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{release=resolve;});
 const spy=vi.spyOn(globalThis.crypto.subtle,'digest').mockImplementationOnce(async(algorithm,data)=>{const bytes=await native(algorithm,data);await barrier;return bytes;});
 try{const gate=new LatestUvInspection(),old=gate.run(mesh([0,0,0,0,0,0]),'old');const latest=await gate.run(mesh([0,0,1,0,0,1]),'new');expect(latest?.report.integrityPass).toBe(true);release();expect(await old).toBeUndefined();const cancelled=gate.run(mesh([0,0,1,0,0,1]),'cancel');gate.cancel();expect(await cancelled).toBeUndefined();}finally{release();spy.mockRestore();}
});

it('fails a damaged connected tooth even when the complete gear remains under the existing aggregate fraction',async()=>{
 const p=generateSpurGearProject({moduleMm:2,toothCount:40,pressureAngleDeg:25,faceWidthMm:12,boreDiameterMm:10}),s=exportSelectedScene(p,['spur_gear']);
 try{const before=await inspectUvQuality(s.root,{includeTriangles:true});expect(before.integrityPass).toBe(true);const uv=(s.root.getObjectByName('spur_gear') as THREE.Mesh).geometry.getAttribute('uv');
 const affected=before.meshes[0].triangles!.filter(t=>t.connectedFeatureId==='spur_gear/tooth_0003'&&!t.legacyDegenerate).slice(0,12);expect(affected).toHaveLength(12);
 for(const t of affected)for(let k=0;k<3;k++)uv.setXY(t.index*3+k,0,0);const after=await inspectUvQuality(s.root);const m=after.meshes[0];expect(m.degenerateUvTriangles/m.eligibleUvTriangles).toBeLessThanOrEqual(0.05);expect(m.features.find(f=>f.id==='spur_gear/tooth_0003')!.integrityPass).toBe(false);expect(after.integrityPass).toBe(false);expect(after.geometryFingerprint).not.toBe(before.geometryFingerprint);
 }finally{s.dispose();}
});
it('preserves scoped native component identities through the actual GLB loader name sanitization',async()=>{
 const {buildWorkspaceScene,serializeWorkspace}=await import('../src/engine/element-workspace');const {inspectExportedUv}=await import('../src/engine/uv-delivery');const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
 class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob):void{void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
 vi.stubGlobal('FileReader',Reader);
 const w={schema:'morphloom.workspace/0.1' as const,units:'mm' as const,coordinates:'right-handed-y-up' as const,assets:[{id:'gear',packId:'mechanical.spur-gear.visual',requiredCapabilities:['selected-scene-export'],source:generateSpurGearProject({}),positionMm:[30,0,0] as [number,number,number],rotationRad:[0.1,0.2,0.3] as [number,number,number]}]},s=buildWorkspaceScene(w,'detail',true);
 try{const b=await new GLTFExporter().parseAsync(s.root,{binary:true}) as ArrayBuffer,r=await inspectExportedUv(b,serializeWorkspace(w));expect(r.report.meshes[0].id).toBe('gear::spur_gear');expect(r.report.meshes[0].features[3].id).toBe('gear::spur_gear/tooth_0003');}finally{s.dispose();vi.unstubAllGlobals();}
});
