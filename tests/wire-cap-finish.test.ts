import * as THREE from 'three';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {compileAssemblyIR,validateAssemblyIR} from '../src/engine/assembly-compiler';
import {COOLING_ASSEMBLY_IR} from '../src/engine/cooling-assembly';
import {applyWireCapPatch,migrateWireCapFinish} from '../src/engine/wire-cap-finish';
import {fingerprintAssemblyIR} from '../src/engine/assembly-edit';
import {analyzeTopology} from '../src/engine/topology';
import type {AssemblyIR} from '../src/engine/assembly-ir';
const old=()=>JSON.parse(readFileSync(new URL('../benchmarks/modeling-slices-20261003/wire-cap-finish/before.assembly.json',import.meta.url),'utf8')) as AssemblyIR;
const hash=(a:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const dispose=(root:THREE.Object3D)=>root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
it('fixes all75 wire caps without changing side buffers, port centres or any triangle count',()=>{
 const source=old(),ir=structuredClone(source);for(const w of ir.electrical!.wires)w.capFinish={schema:'morphloom.wire-cap-finish/0.1',finish:'flat-outward'};
 const before=compileAssemblyIR(source,'beauty'),after=compileAssemblyIR(ir,'beauty');
 try{expect(after.metrics.triangles).toBe(before.metrics.triangles);expect(after.metrics.bounds.equals(before.metrics.bounds)).toBe(true);expect(after.metrics.connectivity!.endpointErrorMaxMm).toBeLessThanOrEqual(ir.electrical!.endpointToleranceMm??.05);
  for(const w of ir.electrical!.wires){expect(after.metrics.topology.details.find(d=>d.name===w.id)?.inconsistentWindingEdges,w.id).toBe(0);
   const g=(after.root.getObjectByName(w.id) as THREE.Mesh).geometry,b=(before.root.getObjectByName(w.id) as THREE.Mesh).geometry;expect(g.getAttribute('position').count).toBe(b.getAttribute('position').count+22);
   for(const key of ['position','normal','uv'])expect(Array.from(g.getAttribute(key).array).slice(0,b.getAttribute(key).array.length)).toEqual(Array.from(b.getAttribute(key).array));
   const sideCount=b.index!.count-60;expect(Array.from(g.index!.array).slice(0,sideCount)).toEqual(Array.from(b.index!.array).slice(0,sideCount));
   const p=g.getAttribute('position'),n=g.getAttribute('normal');const centres=g.userData.morphloomWireCapFinish.centerIndices as [number,number];expect(centres).toEqual([b.getAttribute('position').count-2,b.getAttribute('position').count-1]);
   for(let i=sideCount;i<g.index!.count;i+=3){const ids=[0,1,2].map(j=>g.index!.getX(i+j)),a=new THREE.Vector3().fromBufferAttribute(p,ids[0]!),bb=new THREE.Vector3().fromBufferAttribute(p,ids[1]!),c=new THREE.Vector3().fromBufferAttribute(p,ids[2]!),normal=new THREE.Vector3().fromBufferAttribute(n,ids[0]!);expect(bb.sub(a).cross(c.sub(a)).dot(normal)).toBeGreaterThan(0);for(const id of ids)expect(new THREE.Vector3().fromBufferAttribute(n,id).distanceTo(normal)).toBe(0);}
  }
 }finally{dispose(before.root);dispose(after.root);}
});
it('preserves all322 historical no-option geometry buffers and fixes full default1596→0',()=>{
 const golden=JSON.parse(readFileSync(new URL('../benchmarks/modeling-slices-20261003/wire-cap-finish/before-buffers.json',import.meta.url),'utf8')),b=compileAssemblyIR(old(),'beauty'),n=compileAssemblyIR(COOLING_ASSEMBLY_IR,'beauty');
 try{expect(b.metrics.topology.inconsistentWindingEdges).toBe(1596);expect(n.metrics.topology.inconsistentWindingEdges).toBe(0);expect(n.metrics.topology.boundaryEdges+n.metrics.topology.nonManifoldEdges+n.metrics.topology.degenerateTriangles).toBe(0);expect(n.metrics.triangles).toBe(272560);expect(n.metrics.bounds.equals(b.metrics.bounds)).toBe(true);
  b.root.traverse(o=>{if(o instanceof THREE.Mesh){for(const [key,a]of Object.entries(o.geometry.attributes))expect(hash(a.array),o.name+'/'+key).toBe(golden[o.name].attributes[key]);expect(o.geometry.index?hash(o.geometry.index.array):null).toBe(golden[o.name].index);}});
  const changed=new Set([...COOLING_ASSEMBLY_IR.electrical!.wires.map(w=>w.id),...COOLING_ASSEMBLY_IR.components.filter(c=>c.geometry.op==='tube').map(c=>c.id)]);
  n.root.traverse(o=>{if(o instanceof THREE.Mesh&&!changed.has(o.name)){for(const [key,a]of Object.entries(o.geometry.attributes))expect(hash(a.array),o.name+'/'+key).toBe(golden[o.name].attributes[key]);expect(o.geometry.index?hash(o.geometry.index.array):null).toBe(golden[o.name].index);}});
 }finally{dispose(b.root);dispose(n.root);}
});
it('isolates one wire patch and round-trips clear with exact non-target preservation',async()=>{
 const source=old(),snapshot=structuredClone(source),wire=source.electrical!.wires[0]!;const patch={schema:'morphloom.wire-cap-patch/0.1' as const,operationId:'cap',wireId:wire.id,expectedInputFingerprint:await fingerprintAssemblyIR(source),action:'set' as const};
 const result=await applyWireCapPatch(source,patch);expect(result.receipt.unaffectedPreserved).toBe(true);expect(source).toEqual(snapshot);expect(result.ir.components).toEqual(source.components);expect(result.ir.electrical!.ports).toEqual(source.electrical!.ports);expect(result.ir.electrical!.wires.slice(1)).toEqual(source.electrical!.wires.slice(1));
 const cleared=await applyWireCapPatch(result.ir,{...patch,expectedInputFingerprint:await fingerprintAssemblyIR(result.ir),action:'clear'});expect(cleared.ir).toEqual(source);
 for(const change of [{schema:'unknown'},{action:'flip'},{operationId:undefined},{operationId:42},{wireId:'missing'},{expectedInputFingerprint:'0'.repeat(64)},{extra:true}])await expect(applyWireCapPatch(source,{...patch,...change} as never)).rejects.toThrow();
 const duplicate=structuredClone(source);duplicate.components[0]!.id=wire.id;await expect(applyWireCapPatch(duplicate,{...patch,expectedInputFingerprint:await fingerprintAssemblyIR(duplicate)})).rejects.toThrow(/ambiguous/);
});
it('strictly refuses unsupported cap declarations and keeps migration deep and reversible',()=>{
 const source=old(),wire=source.electrical!.wires[0]!,copy=structuredClone(wire),result=migrateWireCapFinish(wire,true);expect(wire).toEqual(copy);expect(migrateWireCapFinish(result,false)).toEqual(wire);expect(result).not.toBe(wire);
 for(const value of [true,'flat-outward',{}, {schema:'future',finish:'flat-outward'},{schema:'morphloom.wire-cap-finish/0.1',finish:'inward'},{schema:'morphloom.wire-cap-finish/0.1',finish:'flat-outward',extra:1}]){const ir=structuredClone(source);(ir.electrical!.wires[0] as unknown as Record<string,unknown>).capFinish=value;expect(()=>validateAssemblyIR(ir)).toThrow();expect(()=>migrateWireCapFinish(ir.electrical!.wires[0]!,false)).toThrow();}
});
it('keeps finish through live-anchor rerouting in a different diameter/route case',()=>{
 const ir=old();const selected=ir.electrical!.wires[0]!;selected.diameter=.7;selected.capFinish={schema:'morphloom.wire-cap-finish/0.1',finish:'flat-outward'};const b=compileAssemblyIR(ir,'beauty');
 try{const g=(b.root.getObjectByName(selected.id) as THREE.Mesh).geometry;const port=ir.electrical!.ports.find(p=>p.id===selected.from)!,component=b.root.getObjectByName(port.componentId)!;component.position.x+=.01;b.root.updateMatrixWorld(true);(b.root.userData.updateElectricalHarness as ()=>void)();const mesh=b.root.getObjectByName(selected.id) as THREE.Mesh;expect(mesh.geometry).not.toBe(g);const meta=mesh.geometry.userData.morphloomWireCapFinish;expect(meta.finish).toBe('flat-outward');const p=mesh.geometry.getAttribute('position'),start=new THREE.Vector3().fromBufferAttribute(p,meta.centerIndices[0]),terminal=b.root.getObjectByName(selected.id+'_terminal_1');expect(terminal).toBeDefined();expect(start.distanceTo(terminal!.position)).toBeLessThan(1e-7);const group=new THREE.Group();group.add(mesh.clone());expect(analyzeTopology(group).inconsistentWindingEdges).toBe(0);
 }finally{dispose(b.root);}
});

it('refuses sub-quantization cap diameters before migration or IR commit',()=>{const ir=old(),w=ir.electrical!.wires[0]!;w.diameter=.001;expect(()=>migrateWireCapFinish(w,true)).toThrow(/quantization/);w.capFinish={schema:'morphloom.wire-cap-finish/0.1',finish:'flat-outward'};expect(()=>validateAssemblyIR(ir)).toThrow();});
