/** Local diagnostic only: byte arrays at geometry, weighted-normal and export boundaries. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseProject} from '../src/engine/element-project';
import {normalBoundary} from './translated-source-normal-boundary';
const [input,output]=process.argv.slice(2);assert(input&&output&&!fs.existsSync(output));
const raw=fs.readFileSync(input);assert(raw.length<=256_000_000&&raw.length>=28&&raw.toString('ascii',0,4)==='glTF');
const n=raw.readUInt32LE(12);assert(n<=16_000_000&&20+n<=raw.length&&raw.readUInt32LE(16)===0x4e4f534a);
const document=JSON.parse(raw.toString('utf8',20,20+n)),owners=document.nodes.filter((n:any)=>n.extras?.sourceSpec);assert(owners.length===1);
class Reader{result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(b:Blob){void b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}Object.assign(globalThis,{FileReader:Reader});
fs.writeFileSync(output,JSON.stringify(await normalBoundary(parseProject(JSON.stringify(owners[0].extras.sourceSpec)))),{flag:'wx'});
