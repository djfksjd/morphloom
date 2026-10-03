import {it,expect} from 'vitest';
import {Vector3} from 'three';
import {compileAssemblyGeometry} from '../src/engine/assembly-compiler';
import {creasePartNormals} from '../src/engine/part-geometry';
it.each([16,32,128])('corner-angle cylindrical sides are radial at %i segments; caps stay axial',segments=>{
 const source=compileAssemblyGeometry({op:'lathe',profile:[[10,-6],[10,6],[14,6],[14,-6],[10,-6]],segments});
 const g=creasePartNormals(source,Math.PI/6,'corner-angle');
 try{const p=g.getAttribute('position'),n=g.getAttribute('normal');for(let i=0;i<p.count;i++){const normal=new Vector3().fromBufferAttribute(n,i).normalize();if(Math.abs(normal.y)>.001){expect(Math.abs(normal.y)).toBeCloseTo(1,7);continue;}const sign=Math.hypot(p.getX(i),p.getZ(i))<.012?-1:1,radial=new Vector3(sign*p.getX(i),0,sign*p.getZ(i)).normalize();expect(Math.acos(Math.min(1,Math.max(-1,normal.dot(radial))))*180/Math.PI).toBeLessThanOrEqual(.01);}}finally{if(g!==source)g.dispose();source.dispose();}
});

import {BufferGeometry,Float32BufferAttribute,Mesh} from 'three';
import {generateBearingProject} from '../src/engine/bearing-pack';
import {migrateElementProjectToV7,editPart,serializeProject,parseProject,validateProject} from '../src/engine/element-project';
import {exportSelectedScene} from '../src/engine/element-renderer';
import {analyzeTopology} from '../src/engine/topology';
it('explicit migration inserts no weighting and preserves every generated legacy attribute',()=>{
 const legacy=generateBearingProject({}),up=migrateElementProjectToV7(legacy);expect({...up,schema:legacy.schema}).toEqual(legacy);
 const a=exportSelectedScene(legacy,legacy.parts.map(p=>p.id)),b=exportSelectedScene(up,up.parts.map(p=>p.id));try{for(const id of legacy.parts.map(p=>p.id)){const x=a.root.getObjectByName(id) as Mesh,y=b.root.getObjectByName(id) as Mesh;for(const key of Object.keys(x.geometry.attributes))expect(y.geometry.getAttribute(key).array).toEqual(x.geometry.getAttribute(key).array);expect(y.geometry.index?.array).toEqual(x.geometry.index?.array);}}finally{a.dispose();b.dispose();}
 expect(()=>editPart(legacy,'inner_race',{normalWeighting:'corner-angle'})).toThrow();
 for(const value of [null,'area','unknown'])expect(()=>validateProject({...up,parts:up.parts.map(p=>p.id==='inner_race'?{...p,normalWeighting:value}:p)})).toThrow();
 expect(()=>editPart(up,'ball_0000',{normalWeighting:'corner-angle'})).toThrow();
 const next=editPart(up,'inner_race',{normalWeighting:'corner-angle'});expect(parseProject(serializeProject(next))).toEqual(next);
});
it.each([{}, {boreDiameterMm:12,outerDiameterMm:30,widthMm:10,ballDiameterMm:5,ballCount:7}, {boreDiameterMm:40,outerDiameterMm:80,widthMm:24,ballDiameterMm:12,ballCount:12}])('changes only selected race normals for %j',input=>{
 const p=migrateElementProjectToV7(generateBearingProject(input)),next=editPart(p,'inner_race',{normalWeighting:'corner-angle'}),a=exportSelectedScene(p,p.parts.map(p=>p.id)),b=exportSelectedScene(next,p.parts.map(p=>p.id));
 try{expect(analyzeTopology(a.root).pass).toBe(true);expect(analyzeTopology(b.root).pass).toBe(true);a.root.updateMatrixWorld(true);b.root.updateMatrixWorld(true);for(const id of p.parts.map(p=>p.id)){const x=a.root.getObjectByName(id) as Mesh,y=b.root.getObjectByName(id) as Mesh;expect(x.matrixWorld.toArray()).toEqual(y.matrixWorld.toArray());expect(x.parent?.name).toBe(y.parent?.name);for(const key of Object.keys(x.geometry.attributes)){if(id==='inner_race'&&key==='normal')expect(y.geometry.getAttribute(key).array).not.toEqual(x.geometry.getAttribute(key).array);else expect(y.geometry.getAttribute(key).array).toEqual(x.geometry.getAttribute(key).array);}expect(y.geometry.index?.array).toEqual(x.geometry.index?.array);}}finally{a.dispose();b.dispose();}
});
it('ignores a planar quad diagonal while preserving the hard boundary',()=>{
 const points=[0,0,0,1,0,0,1,1,0,0,1,0,0,0,1,1,0,1];const rows=[];
 for(const index of [[0,1,2,0,2,3,0,4,5,0,5,1],[0,1,3,1,2,3,0,4,1,1,4,5]]){const raw=new BufferGeometry();raw.setAttribute('position',new Float32BufferAttribute(points,3));raw.setIndex(index);const g=creasePartNormals(raw,Math.PI/6,'corner-angle');try{const p=g.getAttribute('position'),n=g.getAttribute('normal'),values=new Set<string>();for(let i=0;i<p.count;i++)values.add([p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i)].join(','));rows.push([...values].sort());}finally{g.dispose();raw.dispose();}}
 expect(rows[0]).toEqual(rows[1]);
});
it('rejects degenerate corner triangles and invalid weighting without disposing caller geometry',()=>{
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,1,0,0],3));g.setIndex([0,1,2]);expect(()=>creasePartNormals(g,Math.PI/6,'corner-angle')).toThrow(/Degenerate/);expect(()=>creasePartNormals(g,Math.PI/6,'other' as 'uniform')).toThrow(/Invalid/);expect(g.getAttribute('position').count).toBe(3);g.dispose();
});
it('preserves smooth cylinder normals when every quad diagonal is flipped',()=>{
 const original=compileAssemblyGeometry({op:'lathe',profile:[[10,-6],[10,6],[14,6],[14,-6],[10,-6]],segments:32}),alternate=original.clone(),index=Array.from({length:original.getAttribute('position').count},(_,i)=>i);
 for(let i=0;i<index.length;i+=6){const [a,b,c,,,d]=index.slice(i,i+6);index.splice(i,6,a,b,d,b,c,d);}alternate.setIndex(index);
 const a=creasePartNormals(original,Math.PI/6,'corner-angle'),b=creasePartNormals(alternate,Math.PI/6,'corner-angle');try{
 const values=(g:BufferGeometry)=>{const out=new Map<string,Vector3[]>(),p=g.getAttribute('position'),n=g.getAttribute('normal');for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].join(',');const rows=out.get(key)??[];rows.push(new Vector3().fromBufferAttribute(n,i).normalize());out.set(key,rows);}return out;};const old=values(a),next=values(b);for(const [key,rows]of old){for(const normal of rows){expect(next.get(key)!.some(n=>Math.acos(Math.min(1,Math.max(-1,n.dot(normal))))*180/Math.PI<=.01)).toBe(true);}}
 }finally{a.dispose();b.dispose();original.dispose();alternate.dispose();}
});
import {createElementDomainRegistry}from'../src/engine/element-domain-packs';
import {bearingPack}from'../src/engine/bearing-pack';
it('accepts native schema7 from a v4 pack without changing legacy packs',()=>{
 const registry=createElementDomainRegistry();registry.register({...bearingPack,metadata:{...bearingPack.metadata,version:'morphloom.domain-pack/0.4',id:'test.weighted-normal',representation:{id:'morphloom.elements/0.7',mode:'native'},dependencies:{engineApi:'0.4'}},generate:input=>migrateElementProjectToV7(generateBearingProject(input))});
 expect(registry.generate('test.weighted-normal',{},[]).schema).toBe('morphloom.elements/0.7');registry.register(bearingPack);expect(registry.generate(bearingPack.metadata.id,{},[]).schema).toBe('morphloom.elements/0.2');
});
