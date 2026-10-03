import type * as THREE from 'three';
import {auditPlanFootprint,validatePlanFootprintDescriptor,type PlanFootprintDescriptor,type PlanFootprintAudit} from './plan-footprint';
import {fingerprintJson} from './delivery-validation';

/** Declared floor regions only. Room enclosures, source fidelity and safety are separate checks. */
export interface ArchitecturalProgramDescriptor {
 schema:'morphloom.architectural-program/0.1';
 scope:'floor-cutaway';
 inventoryIds:string[];
 requirements:Array<{id:string;kind:'room-floor'|'stair-landing';footprint:PlanFootprintDescriptor}>;
}
export interface ArchitecturalProgramAudit {
 schema:'morphloom.architectural-program-audit/0.1';
 scope:'floor-cutaway';contractFingerprint:string;
 pass:boolean;required:number;passed:number;completeness:number;
 blockers:string[];requirements:Array<{id:string;kind:string;audit?:PlanFootprintAudit;error?:string}>;
}
export function validateArchitecturalProgram(value:ArchitecturalProgramDescriptor):void {
 const safe=/^[a-zA-Z0-9_-]{1,80}$/;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schema','scope','inventoryIds','requirements'].includes(k))||value.schema!=='morphloom.architectural-program/0.1'||value.scope!=='floor-cutaway')throw Error('Unsupported architectural program contract.');
 if(!Array.isArray(value.inventoryIds)||!Array.isArray(value.requirements)||value.inventoryIds.length<1||value.inventoryIds.length>128||value.requirements.length!==value.inventoryIds.length||new Set(value.inventoryIds).size!==value.inventoryIds.length||value.inventoryIds.some(id=>typeof id!=='string'||!safe.test(id)))throw Error('Invalid architectural program inventory.');
 const ids=new Set<string>(),components=new Set<string>();
 let samples=0;
 for(const row of value.requirements){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['id','kind','footprint'].includes(k))||!value.inventoryIds.includes(row.id)||ids.has(row.id)||!['room-floor','stair-landing'].includes(row.kind))throw Error('Invalid architectural program requirement.');
  ids.add(row.id);validatePlanFootprintDescriptor(row.footprint,true);
  if(row.footprint.evidence.status!=='authored')throw Error('Declared program targets must identify their authored-baseline provenance.');
  samples+=(row.footprint.resolution??128)**2;
  if(samples>524288)throw Error('Architectural program raster budget exceeded.');
  const f=row.footprint;
  if((f.resolution??128)<64||(f.minimumIoU??.97)<.97||(f.maximumFalsePositiveFraction??.02)>.02||(f.maximumFalseNegativeFraction??.02)>.02||(f.maximumVoidOccupancy??.01)>.01||f.componentIds.length>128)throw Error('Architectural program footprint weakens the fixed geometry contract.');
  for(const id of f.componentIds){if(components.has(id))throw Error('Architectural program requirements reuse the same component.');components.add(id);if(components.size>128)throw Error('Architectural program component budget exceeded.');}
 }
}
export function auditArchitecturalProgram(root:THREE.Object3D,contract:ArchitecturalProgramDescriptor):ArchitecturalProgramAudit {
 validateArchitecturalProgram(contract);
 const budget={triangles:0,work:0};
 const requirements:ArchitecturalProgramAudit['requirements']=contract.requirements.map(row=>{
  try{return {id:row.id,kind:row.kind,audit:auditPlanFootprint(root,row.footprint,{projection:'triangle-raster',budget,allowAuthoredBaseline:true})};}
  catch(error){return {id:row.id,kind:row.kind,error:error instanceof Error?error.message:'Floor projection not supported'};}
 });
 const passed=requirements.filter(r=>r.audit?.pass).length;
 return {schema:'morphloom.architectural-program-audit/0.1',scope:contract.scope,contractFingerprint:fingerprintJson(contract),pass:passed===requirements.length,required:requirements.length,passed,completeness:100*passed/requirements.length,blockers:requirements.flatMap(r=>r.audit?r.audit.blockers.map(b=>r.id+': '+b):[r.id+': '+r.error]),requirements};
}

/** Explicit copy/set/clear. A future declaration must not be silently erased. */
export function migrateArchitecturalProgram<T extends {architecturalProgram?:ArchitecturalProgramDescriptor}>(source:T,contract:ArchitecturalProgramDescriptor|undefined):T {
 if(source.architecturalProgram)validateArchitecturalProgram(source.architecturalProgram);
 if(contract)validateArchitecturalProgram(contract);
 const result=structuredClone(source);
 if(contract)result.architecturalProgram=structuredClone(contract);else delete result.architecturalProgram;
 return result;
}
