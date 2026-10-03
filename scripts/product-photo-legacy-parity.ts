import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {compileAssemblyIR} from '../src/engine/assembly-compiler';
import {snapshotScene} from '../src/engine/delivery-validation';
const baseline=process.argv[2],output=process.argv[3];
if(!baseline||!output)throw new Error('Usage: vite-node scripts/product-photo-legacy-parity.ts <baseline-checkout> <report.json>');
const old=await import(path.resolve(baseline,'src/engine/assembly-compiler.ts'));
const ir=JSON.parse(fs.readFileSync('outputs/product-photo-20261003/fan-positive.assembly.json','utf8'));
delete ir.components.find((c:{id:string})=>c.id==='front-hub-cap').material.referenceProjection.orientation;
const roots=[old.compileAssemblyIR(ir,'beauty').root,compileAssemblyIR(ir,'beauty').root];
try {
 const before=snapshotScene(roots[0]),after=snapshotScene(roots[1]);
 assert.deepEqual(after,before);
 fs.writeFileSync(output,JSON.stringify({schema:'morphloom.product-photo-legacy-parity/0.1',pass:true,baseline:path.resolve(baseline),scope:'Node compiler with absent orientation: exact geometry/UV/normal/material/transform snapshot. Browser image loading separately verified.',before,after},null,2));
}finally{
 for(const root of roots)root.traverse((o:any)=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){for(const v of Object.values(m) as any[])if(v?.isTexture)v.dispose();m.dispose();}});
}
