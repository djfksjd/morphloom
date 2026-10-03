import fs from 'node:fs';
import assert from 'node:assert/strict';
import {reconstructTranslatedSource} from '../src/engine/translated-source';
const [original,current,output,receipt]=process.argv.slice(2);assert(original&&current&&output&&receipt&&!fs.existsSync(output)&&!fs.existsSync(receipt));
class Reader {result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:Reader});
const read=(file:string)=>new Uint8Array(fs.readFileSync(file)).buffer;
const result=await reconstructTranslatedSource(read(original),read(current));
// Open exclusively before writing, so rollback also owns partially written files.
const created:string[]=[];
function writeOwned(path:string,text:string):void {
 const descriptor=fs.openSync(path,'wx');created.push(path);
 try{fs.writeFileSync(descriptor,text);}finally{fs.closeSync(descriptor);}
}
try {writeOwned(output,result.sourceJson);writeOwned(receipt,JSON.stringify(result.receipt,null,2)+'\n');}
catch(error){for(const path of created.reverse())fs.unlinkSync(path);throw error;}
console.log(JSON.stringify(result.receipt));
