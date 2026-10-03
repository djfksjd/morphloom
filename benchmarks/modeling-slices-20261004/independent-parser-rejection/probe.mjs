import {validateBytes} from 'gltf-validator';
import {WebIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {writeFileSync} from 'node:fs';
const cases={valid:{asset:{version:'2.0'},scene:0,scenes:[{}]}, optional:{asset:{version:'2.0'},scene:0,scenes:[{}],extensionsUsed:['VENDOR_unimplemented'],extensions:{VENDOR_unimplemented:{}}},externalImage:{asset:{version:'2.0'},scene:0,scenes:[{}],images:[{uri:'https://example.invalid/image.png'}]}, unknownRequired:{asset:{version:'2.0'},scene:0,scenes:[{}],extensionsUsed:['VENDOR_unimplemented'],extensionsRequired:['VENDOR_unimplemented'],extensions:{VENDOR_unimplemented:{}}}};
for(const [name,j] of Object.entries(cases)){
const json=new TextEncoder().encode(JSON.stringify(j)),padded=Math.ceil(json.length/4)*4,b=new Uint8Array(20+padded),v=new DataView(b.buffer);
v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,b.length,true);v.setUint32(12,padded,true);v.setUint32(16,0x4e4f534a,true);b.fill(32,20);b.set(json,20);writeFileSync(`work/parser-rejection/${name}.glb`,b);
const r=await validateBytes(b,{format:'glb',writeTimestamp:false});let parsed;try{await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(b);parsed='pass'}catch(e){parsed=e.message}
console.log(JSON.stringify({name,issues:r.issues,parsed}));}
