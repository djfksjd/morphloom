import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {compileAssemblyIR} from '../src/engine/assembly-compiler';
import type {AssemblyIR} from '../src/engine/assembly-ir';
import {evaluateProductQuality} from '../src/engine/quality';
import {DEFAULT_PRODUCT_SPEC} from '../src/types';
import {analyzeTopology} from '../src/engine/topology';
const audit=(geometry:THREE.BufferGeometry)=>{const mesh=new THREE.Mesh(geometry);mesh.name='orientation-fixture';const report=analyzeTopology(mesh);geometry.dispose();return report;};
describe('shared-edge orientation separate from unsigned closure',()=>{
 it('does not hide one flipped box triangle behind closed incidence',()=>{const g=new THREE.BoxGeometry(1,1,1),index=g.index!;const b=index.getX(1),c=index.getX(2);index.setX(1,c);index.setX(2,b);const r=audit(g);expect(r.boundaryEdges).toBe(0);expect(r.nonManifoldEdges).toBe(0);expect(r.pass).toBe(true);expect(r.inconsistentWindingEdges).toBe(3);expect(r.orientationConsistent).toBe(false);expect(r.details[0]?.inconsistentWindingEdges).toBe(3);});
 it('accepts split UV/normal seams and both consistently oriented global directions',()=>{for(const reverse of [false,true]){const g=new THREE.BoxGeometry(1,1,1);if(reverse){const i=g.index!;for(let n=0;n<i.count;n+=3){const b=i.getX(n+1),c=i.getX(n+2);i.setX(n+1,c);i.setX(n+2,b);}}const expanded=g.toNonIndexed();g.dispose();const r=audit(expanded);expect(r.inconsistentWindingEdges).toBe(0);expect(r.orientationConsistent).toBe(true);}});
 it('does not report intentional boundaries as winding conflicts',()=>{const r=audit(new THREE.PlaneGeometry(2,3));expect(r.boundaryEdges).toBe(4);expect(r.pass).toBe(false);expect(r.inconsistentWindingEdges).toBe(0);expect(r.orientationConsistent).toBe(true);});
 it('counts actual legacy cap conflicts and independently blocks quality despite unsigned closure',()=>{
  const ir:AssemblyIR={schema:'morphloom.assembly/0.1',name:'Cap orientation fixture',units:'mm',components:[{id:'tube',name:'Tube',category:'mechanical',materialName:'steel',detail:'Authored test, no real-product claim',geometry:{op:'tube',points:[[0,0,0],[0,60,0]],radius:5,tubularSegments:8,radialSegments:8},material:{color:'#777777'}}]};
  const legacy=compileAssemblyIR(ir,'beauty');expect(legacy.metrics.topology.pass).toBe(true);expect(legacy.metrics.topology.inconsistentWindingEdges).toBe(16);
  const quality=evaluateProductQuality(DEFAULT_PRODUCT_SPEC,undefined,legacy.metrics,ir);expect(quality.checks.find(c=>c.id==='orientation')).toMatchObject({score:0,status:'blocked'});expect(quality.total).toBeLessThanOrEqual(59);
  const flat=structuredClone(ir);const g=flat.components[0]!.geometry;if(g.op==='tube')g.capFinish='flat-outward';const clean=compileAssemblyIR(flat,'beauty');expect(clean.metrics.topology.inconsistentWindingEdges).toBe(0);expect(clean.metrics.topology.orientationConsistent).toBe(true);expect(evaluateProductQuality(DEFAULT_PRODUCT_SPEC,undefined,clean.metrics,flat).checks.find(c=>c.id==='orientation')).toMatchObject({score:100,status:'pass'});
  for(const fields of [{inconsistentWindingEdges:3,orientationConsistent:undefined},{inconsistentWindingEdges:undefined,orientationConsistent:false},{inconsistentWindingEdges:0,orientationConsistent:false},{inconsistentWindingEdges:3,orientationConsistent:true}]){const partial={...clean.metrics,topology:{...clean.metrics.topology,...fields}};expect(evaluateProductQuality(DEFAULT_PRODUCT_SPEC,undefined,partial,flat).checks.find(c=>c.id==='orientation')).toMatchObject({score:0,status:'blocked'});}
  const historical={...clean.metrics,topology:{...clean.metrics.topology}};delete historical.topology.orientationConsistent;delete historical.topology.inconsistentWindingEdges;expect(evaluateProductQuality(DEFAULT_PRODUCT_SPEC,undefined,historical,flat).checks.find(c=>c.id==='orientation')).toMatchObject({score:0,status:'warn'});
 });
 it('keeps three-incident non-manifold edges separate from two-incident direction conflicts',()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,0,1,0,-1,0],3));g.setIndex([0,1,2,1,0,3,0,1,4]);const r=audit(g);expect(r.nonManifoldEdges).toBe(1);expect(r.inconsistentWindingEdges).toBe(0);expect(r.pass).toBe(false);});
});
