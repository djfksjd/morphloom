import type {AssemblyIR,ElectricalWireIR} from './assembly-ir';
import {fingerprintAssemblyIR} from './assembly-edit';
export interface WireCapFinishIR {schema:'morphloom.wire-cap-finish/0.1';finish:'flat-outward'}
export function validateWireCapFinish(value:unknown,diameter:unknown):void{
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid wire cap finish.');
 if(typeof diameter!=='number'||!Number.isFinite(diameter)||diameter<.01||diameter>20)throw Error('Flat wire caps require 0.01..20 mm diameter for the existing 1 micrometre ring quantization.');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['schema','finish'].includes(k))||v.schema!=='morphloom.wire-cap-finish/0.1'||v.finish!=='flat-outward')throw Error('Unsupported wire cap finish version/keys.');
}
export function migrateWireCapFinish(wire:ElectricalWireIR,flat:boolean):ElectricalWireIR{
 if(typeof flat!=='boolean')throw Error('Wire cap migration requires boolean choice.');validateWireCapFinish(wire.capFinish,wire.diameter);
 const result=structuredClone(wire);if(flat)result.capFinish={schema:'morphloom.wire-cap-finish/0.1',finish:'flat-outward'};else delete result.capFinish;validateWireCapFinish(result.capFinish,result.diameter);return result;
}
export interface WireCapPatch {schema:'morphloom.wire-cap-patch/0.1';operationId:string;wireId:string;expectedInputFingerprint:string;action:'set'|'clear'}
/** Isolated declaration edit; it does not certify the electrical graph or a bench test. */
export async function applyWireCapPatch(ir:AssemblyIR,patch:WireCapPatch){
 const safe=/^[a-zA-Z0-9_-]{1,80}$/;
 if(!patch||typeof patch!=='object'||Object.keys(patch).some(k=>!['schema','operationId','wireId','expectedInputFingerprint','action'].includes(k))||patch.schema!=='morphloom.wire-cap-patch/0.1'||typeof patch.operationId!=='string'||typeof patch.wireId!=='string'||typeof patch.expectedInputFingerprint!=='string'||!safe.test(patch.operationId)||!safe.test(patch.wireId)||!/^[a-f0-9]{64}$/.test(patch.expectedInputFingerprint)||!['set','clear'].includes(patch.action))throw Error('Unsafe wire cap patch.');
 const inputFingerprint=await fingerprintAssemblyIR(ir);if(inputFingerprint!==patch.expectedInputFingerprint)throw Error('Wire patch targets a stale AssemblyIR fingerprint.');
 const matches=ir.electrical?.wires.filter(w=>w.id===patch.wireId);if(!ir.electrical||matches?.length!==1||ir.components.some(c=>c.id===patch.wireId))throw Error('Wire ID missing or ambiguous.');
 const result:AssemblyIR={...ir,electrical:{...ir.electrical,wires:ir.electrical.wires.map(w=>w.id===patch.wireId?migrateWireCapFinish(w,patch.action==='set'):w)}};
 const withoutTarget=(source:AssemblyIR):AssemblyIR=>({...source,electrical:{...source.electrical!,wires:source.electrical!.wires.filter(w=>w.id!==patch.wireId)}});
 const unaffectedInputFingerprint=await fingerprintAssemblyIR(withoutTarget(ir)),unaffectedOutputFingerprint=await fingerprintAssemblyIR(withoutTarget(result)),outputFingerprint=await fingerprintAssemblyIR(result);
 if(inputFingerprint===outputFingerprint||unaffectedInputFingerprint!==unaffectedOutputFingerprint)throw Error('Wire patch did not produce an isolated edit.');
 return {ir:result,receipt:{schema:'morphloom.wire-cap-edit-receipt/0.1' as const,wireId:patch.wireId,operationId:patch.operationId,inputFingerprint,outputFingerprint,unaffectedInputFingerprint,unaffectedOutputFingerprint,unaffectedPreserved:true as const}};
}
