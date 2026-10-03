import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {applyAssemblyComponentPatch,fingerprintAssemblyIR} from '../src/engine/assembly-edit';
import type {AssemblyIR} from '../src/engine/assembly-ir';
const out='outputs/tube-cap-flat-20261003';mkdirSync(out,{recursive:true});
const save=(name:string,ir:AssemblyIR)=>writeFileSync(out+'/'+name+'.assembly.json',JSON.stringify(ir,null,2)+'\n');
const demo=JSON.parse(readFileSync('outputs/tube-caps-20261003/demo-after.assembly.json','utf8')) as AssemblyIR;
const fan=JSON.parse(readFileSync('outputs/tube-caps-20261003/fan-after.assembly.json','utf8')) as AssemblyIR;
const rows=[];
for(const [name,ir,id] of [['demo',demo,'tube'],['fan',fan,'cage-rear-spoke-1']] as const){
 const {ir:next,receipt}=await applyAssemblyComponentPatch(ir,{schema:'morphloom.component-patch/0.2',operationId:name+'-cap',componentId:id,expectedInputFingerprint:await fingerprintAssemblyIR(ir),geometry:{operation:'tube-cap-finish',action:'set'}});
 save(name+'-before',ir);save(name+'-after',next);rows.push({name,id,receipt});
}
writeFileSync(out+'/patch-receipts.json',JSON.stringify(rows,null,2)+'\n');console.log('Demo and actual fan isolated flat cap migration generated');
