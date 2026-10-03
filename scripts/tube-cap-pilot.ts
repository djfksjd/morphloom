import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {applyAssemblyComponentPatch,fingerprintAssemblyIR} from '../src/engine/assembly-edit';
import type {AssemblyIR} from '../src/engine/assembly-ir';
const out='outputs/tube-caps-20261003';mkdirSync(out,{recursive:true});
const save=(name:string,ir:AssemblyIR)=>writeFileSync(out+'/'+name+'.assembly.json',JSON.stringify(ir,null,2)+'\n');
const demo:AssemblyIR={schema:'morphloom.assembly/0.1',units:'mm',name:'authored open tube cap inspection',components:[{id:'tube',name:'Tube cap inspection',category:'mechanical',materialName:'clean steel',detail:'Authored diagnostic, not measured product',geometry:{op:'tube',points:[[0,0,0],[0,0,80]],radius:20,tubularSegments:32,radialSegments:16},material:{color:'#999999',roughness:.45,metalness:.2,surface:'brushed-metal'}}]};
const fan=JSON.parse(readFileSync('outputs/guard-profile-20261003/domed.assembly.json','utf8')) as AssemblyIR;
const rows=[];
for(const [name,ir,id] of [['demo',demo,'tube'],['fan',fan,'cage-rear-spoke-1']] as const){
 const {ir:next,receipt}=await applyAssemblyComponentPatch(ir,{schema:'morphloom.component-patch/0.2',operationId:name+'-cap',componentId:id,expectedInputFingerprint:await fingerprintAssemblyIR(ir),geometry:{operation:'tube-cap-winding',action:'set'}});
 save(name+'-before',ir);save(name+'-after',next);rows.push({name,id,receipt});
}
writeFileSync(out+'/patch-receipts.json',JSON.stringify(rows,null,2)+'\n');console.log('Demo and actual fan isolated cap migration generated');
