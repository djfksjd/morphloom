import {expect,it} from 'vitest';
import {compileAssemblyIR} from '../src/engine/assembly-compiler';
import {LAUREL_HOMES_BUILDING_B_IR} from '../src/engine/laurel-homes-building-b';
it('audits every declared floor region rather than trusting programCompleteness metadata',()=>{
 const built=compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR,'beauty');
 expect((built.metrics as unknown as {architecturalProgram?:{pass:boolean;required:number}}).architecturalProgram).toMatchObject({pass:true,required:48});
},20000);

import * as THREE from 'three';
import {auditArchitecturalProgram,validateArchitecturalProgram,type ArchitecturalProgramDescriptor} from '../src/engine/architectural-program';
import {evaluateProductQuality} from '../src/engine/quality';
import {DEFAULT_PRODUCT_SPEC} from '../src/types';
import {snapshotScene,compareGlbRoundTrip} from '../src/engine/delivery-validation';

it('one missing room blocks even with aggregate slab IoU1 and forged metadata100',()=>{
 const ir=structuredClone(LAUREL_HOMES_BUILDING_B_IR);ir.metadata!.programCompleteness=100;
 ir.components=ir.components.filter(c=>c.id!=='unit_1_bath_floor');
 const b=compileAssemblyIR(ir,'beauty');
 expect(b.metrics.planFootprint?.iou).toBe(1);
 expect(b.metrics.architecturalProgram).toMatchObject({pass:false,passed:47,required:48});
 expect(b.metrics.architecturalProgram?.blockers.join(' ')).toContain('unit_1_bath_floor');
 expect(evaluateProductQuality(DEFAULT_PRODUCT_SPEC,undefined,b.metrics,ir).checks.find(c=>c.id==='silhouette')?.status).toBe('blocked');
},20000);

it('rejects omitted inventory, duplicate component reuse, unsupported version and weak thresholds',()=>{
 const c=structuredClone(LAUREL_HOMES_BUILDING_B_IR.architecturalProgram!);
 const missing=structuredClone(c);missing.requirements.pop();expect(()=>validateArchitecturalProgram(missing)).toThrow(/inventory/);
 const reused=structuredClone(c);reused.requirements[1]!.footprint.componentIds=reused.requirements[0]!.footprint.componentIds;expect(()=>validateArchitecturalProgram(reused)).toThrow(/reuse/);
 const weak=structuredClone(c);weak.requirements[0]!.footprint.minimumIoU=.1;expect(()=>validateArchitecturalProgram(weak)).toThrow(/weakens/);
 expect(()=>validateArchitecturalProgram({...c,schema:'future'}as unknown as ArchitecturalProgramDescriptor)).toThrow(/Unsupported/);
});

it('works on a second authored footprint and detects actual translation, audit payload loss and stale contract',()=>{
 const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(.2,.02,.1),new THREE.MeshStandardMaterial());mesh.name='other-floor';root.add(mesh);
 const contract:ArchitecturalProgramDescriptor={schema:'morphloom.architectural-program/0.1',scope:'floor-cutaway',inventoryIds:['other'],requirements:[{id:'other',kind:'room-floor',footprint:{schema:'morphloom.plan-footprint/0.1',componentIds:['other-floor'],targetRegions:[{id:'region',boundsMm:[-100,-50,100,50]}],resolution:64,evidence:{status:'authored',source:'test-authored-plan',note:'synthetic dimensional fixture'}}}]};
 const audit=auditArchitecturalProgram(root,contract);expect(audit.pass).toBe(true);
 root.userData.architecturalProgramAudit=audit;const before=snapshotScene(root);delete root.userData.architecturalProgramAudit;const after=snapshotScene(root);
 expect(compareGlbRoundTrip(before,after,1024,4).blockers).toContain('architectural-program audit metadata changed during GLB round-trip');
 mesh.position.x=.05;root.updateMatrixWorld(true);expect(auditArchitecturalProgram(root,contract).pass).toBe(false);
 const ir=structuredClone(LAUREL_HOMES_BUILDING_B_IR);ir.architecturalProgram!.requirements[0]!.footprint.targetRegions[0]!.polygonMm![0]![0]+=10;
 // Cached passing metrics from a different contract cannot make this contract ready.
 const fake={architecturalProgram:{...audit,completeness:100,passed:48,required:48}};
 expect(evaluateProductQuality(DEFAULT_PRODUCT_SPEC,undefined,fake as never,ir).checks.find(c=>c.id==='silhouette')?.status).toBe('blocked');
 mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();
});

import {migrateArchitecturalProgram} from '../src/engine/architectural-program';
it('explicitly migrates by copy, refuses future versions, and keeps legacy cutaway blocked',()=>{
 const source=LAUREL_HOMES_BUILDING_B_IR,legacy=migrateArchitecturalProgram(source,undefined);
 expect(source.architecturalProgram).toBeDefined();expect(legacy.architecturalProgram).toBeUndefined();
 expect(migrateArchitecturalProgram(legacy,source.architecturalProgram)).toEqual(source);
 const future=structuredClone(source);future.architecturalProgram!.schema='future'as never;
 expect(()=>migrateArchitecturalProgram(future,undefined)).toThrow(/Unsupported/);
 expect(evaluateProductQuality(DEFAULT_PRODUCT_SPEC,undefined,undefined,legacy).checks.find(c=>c.id==='silhouette')?.status).toBe('blocked');
});

import {auditDomainReadiness} from '../src/engine/domain-readiness';
it('domain readiness recomputes geometry and refuses a copied passing audit after removing a floor',()=>{
 const b=compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR,'beauty');
 const floor=b.root.getObjectByName('unit_1_kitchen_floor')!;floor.removeFromParent();
 const report=auditDomainReadiness({domain:'architecture',root:b.root,topology:b.metrics.topology,evidenceScore:100,deterministic:true,browserGlbRoundTrip:true});
 expect(report.checks.find(c=>c.id==='architecture-program')).toMatchObject({pass:false,score:0});
},20000);

import {auditPlanFootprint} from '../src/engine/plan-footprint';
it('opt-in triangle projection matches legacy raycasting for all48 rotated/authored regions',()=>{
 const b=compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR,'beauty');
 for(const row of LAUREL_HOMES_BUILDING_B_IR.architecturalProgram!.requirements){
  const reference={...row.footprint,evidence:{...row.footprint.evidence,status:'datasheet' as const}};
  expect(auditPlanFootprint(b.root,row.footprint,{projection:'triangle-raster',allowAuthoredBaseline:true})).toEqual(auditPlanFootprint(b.root,reference));
 }
},20000);
it('triangle projection preserves a real opening and matches the raycast void check',()=>{
 const root=new THREE.Group(),ring=new THREE.Group();ring.name='ring';root.add(ring);
 const rectangles:Array<[number,number,number,number]>=[[-100,50,100,100],[-100,-100,100,-50],[-100,-50,-50,50],[50,-50,100,50]];
 for(const [x0,z0,x1,z1]of rectangles){const m=new THREE.Mesh(new THREE.BoxGeometry((x1-x0)/1000,.02,(z1-z0)/1000),new THREE.MeshBasicMaterial());m.position.set((x0+x1)/2000,0,(z0+z1)/2000);ring.add(m);}
 const descriptor={schema:'morphloom.plan-footprint/0.1'as const,componentIds:['ring'],targetRegions:rectangles.map((boundsMm,i)=>({id:'bar-'+i,boundsMm})),voidRegions:[{id:'hole',boundsMm:[-50,-50,50,50]as [number,number,number,number]}],resolution:64,evidence:{status:'datasheet'as const,source:'authored-ring',note:'actual four-bar through opening'}};
 const raster=auditPlanFootprint(root,descriptor,{projection:'triangle-raster'});expect(raster).toEqual(auditPlanFootprint(root,descriptor));expect(raster.pass).toBe(true);expect(raster.voidOccupancy[0]?.fraction).toBe(0);
 root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});
});

it('unsupported instanced representations fail the declared program without crashing analysis',()=>{
 const root=new THREE.Group(),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.2,.02,.1),new THREE.MeshBasicMaterial(),1);mesh.name='unsupported';root.add(mesh);
 const contract:ArchitecturalProgramDescriptor={schema:'morphloom.architectural-program/0.1',scope:'floor-cutaway',inventoryIds:['one'],requirements:[{id:'one',kind:'room-floor',footprint:{schema:'morphloom.plan-footprint/0.1',componentIds:['unsupported'],targetRegions:[{id:'region',boundsMm:[-100,-50,100,50]}],resolution:64,evidence:{status:'authored',source:'synthetic',note:'unsupported representation test'}}}]};
 expect(auditArchitecturalProgram(root,contract)).toMatchObject({pass:false,passed:0,required:1});
 expect(auditArchitecturalProgram(root,contract).blockers.join(' ')).toContain('non-instanced');
 mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();
});
it('never promotes an authored program target into the default measured-plan audit',()=>{
 const b=compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR,'beauty'),f=LAUREL_HOMES_BUILDING_B_IR.architecturalProgram!.requirements[0]!.footprint;
 expect(f.evidence.status).toBe('authored');expect(()=>auditPlanFootprint(b.root,f)).toThrow(/evidence/);
});

import {validateAssemblyIR} from '../src/engine/assembly-compiler';
it('rejects a full-building task that tries to substitute a floor-cutaway program',()=>{
 const ir=structuredClone(LAUREL_HOMES_BUILDING_B_IR);ir.metadata!.scope='full-building';ir.metadata!.ceilingAndRoofIncluded=true;
 expect(()=>validateAssemblyIR(ir)).toThrow(/cannot silently substitute/);
});
