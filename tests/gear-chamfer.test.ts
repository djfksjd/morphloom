import {it,expect} from 'vitest';import * as T from 'three';
import {generateSpurGearProject} from '../src/engine/gear-pack';import {generateBearingProject} from '../src/engine/bearing-pack';
import {migrateElementProjectToV5,editPart,serializeProject,parseProject} from '../src/engine/element-project';import {exportSelectedScene} from '../src/engine/element-renderer';
import {compileGearChamfer,gearChamferMaximum} from '../src/engine/gear-chamfer';
import {compileAssemblyGeometry,compileDerivedGearGeometry} from '../src/engine/assembly-compiler';
import {gearExtrude} from '../src/engine/spur-gear';
import {analyzeTopology} from '../src/engine/topology';
it('rejects old versions and unsafe geometry while migration inserts no defaults',()=>{
 const old=generateSpurGearProject({}),p=migrateElementProjectToV5(old);expect({...p,schema:old.schema}).toEqual(old);expect(()=>editPart(old,old.parts[0].id,{axialChamferMm:.05})).toThrow();
 for(const v of [-1,NaN,Infinity,.0001,.051])expect(()=>editPart(p,p.parts[0].id,{axialChamferMm:v})).toThrow();
 const bearing=migrateElementProjectToV5(generateBearingProject({}));expect(()=>editPart(bearing,bearing.parts[0].id,{axialChamferMm:.01})).toThrow();
 const thin=migrateElementProjectToV5(generateSpurGearProject({boreDiameterMm:21.39}));expect(()=>editPart(thin,thin.parts[0].id,{axialChamferMm:.0055})).toThrow();
 expect(parseProject(serializeProject(editPart(p,p.parts[0].id,{axialChamferMm:.05}))).parts[0].axialChamferMm).toBe(.05);
});
it('creates real 45 degree chamfers without changing middle outline or width across scales',()=>{
 for(const input of [{},{moduleMm:.2,toothCount:18,faceWidthMm:2,boreDiameterMm:1},{moduleMm:2,toothCount:40,pressureAngleDeg:25,faceWidthMm:12,boreDiameterMm:10},{moduleMm:.2,toothCount:64,faceWidthMm:.1,boreDiameterMm:0},{moduleMm:5,toothCount:18,faceWidthMm:100,boreDiameterMm:0},{moduleMm:5,toothCount:64,pressureAngleDeg:25,faceWidthMm:.1,boreDiameterMm:0}]){
  const p=generateSpurGearProject(input),spec=p.parts[0].geometry!;if(spec.op!=='spur-gear')throw Error();const c=gearChamferMaximum(spec),g=compileGearChamfer(spec,c);try{g.computeBoundingBox();expect(g.boundingBox!.getSize(new T.Vector3()).z*1000).toBeCloseTo(spec.faceWidthMm,4);expect(analyzeTopology(new T.Mesh(g)).pass).toBe(true);const pos=g.getAttribute('position');let midRadius=0,capRadius=0;for(let i=0;i<pos.count;i++){const z=Math.abs(pos.getZ(i))*1000,r=Math.hypot(pos.getX(i),pos.getY(i))*1000;if(z<spec.faceWidthMm/2-c*.5)midRadius=Math.max(midRadius,r);if(Math.abs(z-spec.faceWidthMm/2)<.00001)capRadius=Math.max(capRadius,r);}expect(midRadius).toBeCloseTo(spec.moduleMm*(spec.toothCount+2)/2,4);expect(midRadius-capRadius).toBeCloseTo(c,4);}finally{g.dispose();}
 }
});
it('neutral amount preserves delivered buffers and positive amount changes actual vertices',()=>{
 const p=migrateElementProjectToV5(generateSpurGearProject({})),ids=p.parts.map(p=>p.id),a=exportSelectedScene(p,ids),b=exportSelectedScene(editPart(p,ids[0],{axialChamferMm:0}),ids),c=exportSelectedScene(editPart(p,ids[0],{axialChamferMm:.05}),ids);
 try{const geom=(s:typeof a)=>(s.root.getObjectByName(ids[0]) as T.Mesh).geometry;for(const key of ['position','normal','uv'])expect(geom(a).getAttribute(key).array).toEqual(geom(b).getAttribute(key).array);expect(geom(c).getAttribute('position').count).toBeGreaterThan(geom(a).getAttribute('position').count);}finally{a.dispose();b.dispose();c.dispose();}
});

it('keeps raw array limits while accepting the declared bounded generated profile',()=>{
 const g=generateSpurGearProject({moduleMm:.2,toothCount:64,faceWidthMm:.1,boreDiameterMm:0}).parts[0].geometry!;if(g.op!=='spur-gear')throw Error();
 expect(gearExtrude(g).points.length).toBeGreaterThan(4096);expect(()=>compileAssemblyGeometry(gearExtrude(g))).toThrow(/too large/);
 const mesh=compileDerivedGearGeometry(g);try{expect(mesh.getAttribute('position').count/3).toBeLessThan(100000);}finally{mesh.dispose();}
});
