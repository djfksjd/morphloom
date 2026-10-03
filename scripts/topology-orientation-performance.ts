import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {compileAssemblyGeometry} from '../src/engine/assembly-compiler';
import {analyzeTopology} from '../src/engine/topology';
const baseline=process.argv[3]??readFileSync('/tmp/morphloom-orientation-baseline-path','utf8').trim();
const old=await import(baseline+'/src/engine/topology.ts');
const geometry=compileAssemblyGeometry({op:'tube',points:[[0,0,0],[0,120,0]],radius:5,tubularSegments:256,radialSegments:32,capFinish:'flat-outward'});
const mesh=new THREE.Mesh(geometry);const run=(fn:typeof analyzeTopology)=>{const start=performance.now();const result=fn(mesh);return {ms:performance.now()-start,closurePass:result.pass,triangles:result.triangles};};
run(old.analyzeTopology);run(analyzeTopology);const samples=[];
for(let i=0;i<5;i++){const first=i%2?run(analyzeTopology):run(old.analyzeTopology),second=i%2?run(old.analyzeTopology):run(analyzeTopology);samples.push(i%2?{legacy:first,current:second,order:'current-first'}:{legacy:first,current:second,order:'legacy-first'});if(i%2){samples[i]!.legacy=second;samples[i]!.current=first;}}
geometry.dispose();writeFileSync(process.argv[2]!,JSON.stringify({schema:'morphloom.orientation-timing/0.1',baselineCompiler:'0.35.0',currentCompiler:'0.36.0',method:'same16448triangle tube, warmup once;5paired alternating samples; timing observations only; other user processes unchanged',samples},null,2)+'\n');console.log('Paired audit timing recorded');
