import { describe, expect, it } from 'vitest';
import { generateSpurGearProject, gearPack } from '../src/engine/gear-pack';
import { gearProfile, gearDimensions, toothIds, extractToothGeometry } from '../src/engine/spur-gear';
import { buildElementScene, exportSelectedScene } from '../src/engine/element-renderer';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs';
import { validateProject, editPart, migrateElementProjectToV3, ElementHistory, serializeProject } from '../src/engine/element-project';
import { analyzeTopology } from '../src/engine/topology';
import * as THREE from 'three';

describe('declared external involute spur gear',()=>{
  it('measures pitch-circle tooth thickness from the generated flank segments',()=>{
    const p=generateSpurGearProject({}),g=p.parts[0].geometry!;if(g.op!=='spur-gear')throw new Error('gear expected');
    const points=gearProfile(g).features[0].points,r=g.moduleMm*g.toothCount/2,angles:number[]=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];if((Math.hypot(...a)-r)*(Math.hypot(...b)-r)>=0)continue;
      const dx=b[0]-a[0],dy=b[1]-a[1],A=dx*dx+dy*dy,B=2*(a[0]*dx+a[1]*dy),C=a[0]*a[0]+a[1]*a[1]-r*r;
      const roots=[(-B+Math.sqrt(B*B-4*A*C))/(2*A),(-B-Math.sqrt(B*B-4*A*C))/(2*A)];
      const t=roots.find(v=>v>=0&&v<=1)!;angles.push(Math.atan2(a[1]+dy*t,a[0]+dx*t));
    }
    expect(angles).toHaveLength(2);expect(Math.abs(r*Math.abs(angles[1]-angles[0])-Math.PI*g.moduleMm/2)).toBeLessThanOrEqual(0.005*g.moduleMm);
  });
  it('checks analytic diameters and bounds actual bore/width geometry across sizes',()=>{
    for(const input of [{},{moduleMm:0.2,toothCount:18,pressureAngleDeg:20,faceWidthMm:2,boreDiameterMm:1},{moduleMm:2,toothCount:40,pressureAngleDeg:25,faceWidthMm:12,boreDiameterMm:10}]){
      const p=generateSpurGearProject(input),g=p.parts[0].geometry!;
      if(g.op!=='spur-gear')throw new Error('Expected gear');const d=gearDimensions(g),profile=gearProfile(g);
      expect(d.pitchDiameterMm).toBe(g.moduleMm*g.toothCount);
      expect(d.baseDiameterMm).toBeCloseTo(d.pitchDiameterMm*Math.cos(g.pressureAngleDeg*Math.PI/180),10);
      expect(profile.maximumFlankChordErrorMm).toBeLessThanOrEqual(0.005*g.moduleMm);
      expect(profile.features.map(f=>f.id)).toEqual(toothIds(g));
      const scene=buildElementScene(p,'detail');
      try{
        expect(analyzeTopology(scene.root).pass).toBe(true);expect(scene.stats.triangles).toBeLessThan(100_000);
        const mesh=scene.root.getObjectByName('spur_gear') as THREE.Mesh,positions=mesh.geometry.getAttribute('position');
        let minR=Infinity,maxR=0,minZ=Infinity,maxZ=-Infinity;
        for(let i=0;i<positions.count;i++){const r=Math.hypot(positions.getX(i),positions.getY(i))*1000;minR=Math.min(minR,r);maxR=Math.max(maxR,r);minZ=Math.min(minZ,positions.getZ(i)*1000);maxZ=Math.max(maxZ,positions.getZ(i)*1000);}
        expect(Math.abs(2*maxR-d.addendumDiameterMm)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(2*minR-g.boreDiameterMm)).toBeLessThanOrEqual(0.01);expect(Math.abs(maxZ-minZ-g.faceWidthMm)).toBeLessThanOrEqual(0.01);
        scene.root.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1));expect(ray.intersectObject(scene.root,true)).toHaveLength(0);
      }finally{scene.dispose();}
    }
  });
  it('keeps connected feature identities and changes only the requested tooth contour',()=>{
    const p=generateSpurGearProject({}),g=p.parts[0].geometry!;if(g.op!=='spur-gear')throw new Error('Expected gear');
    const before=gearProfile(g),next={...g,toothOverrides:{tooth_0003:{addendumScale:0.9}}},after=gearProfile(next);
    expect(after.features.map(f=>f.id)).toEqual(before.features.map(f=>f.id));
    for(let i=0;i<g.toothCount;i++)if(i!==3)expect(after.features[i].points).toEqual(before.features[i].points);
    expect(after.features[3].points).not.toEqual(before.features[3].points);
    const history=new ElementHistory(p);history.commit(editPart(p,p.parts[0].id,{geometry:next}));expect(serializeProject(history.undo())).toBe(serializeProject(p));
    const piece=extractToothGeometry(next,'tooth_0003');expect(piece.points.length).toBeGreaterThan(10);
    const copy=structuredClone(p);copy.parts[0].geometry=piece;const exported=exportSelectedScene(copy,[copy.parts[0].id]);
    try{expect(analyzeTopology(exported.root).pass).toBe(true);}finally{exported.dispose();}
  });
  it('rejects undercut-risk, fractional teeth, unsupported fields and versions atomically',()=>{
    for(const input of [{toothCount:12},{toothCount:24.5},{pressureAngleDeg:10},{boreDiameterMm:100},{moduleMm:0},{moduleMm:null},{execute:'code'}])expect(()=>generateSpurGearProject(input)).toThrow();
    const p=generateSpurGearProject({});expect(()=>validateProject({...p,schema:'morphloom.elements/0.2'})).toThrow();
    const bad=structuredClone(p);const g=bad.parts[0].geometry!;if(g.op==='spur-gear')g.toothOverrides={tooth_9999:{addendumScale:1}};expect(()=>validateProject(bad)).toThrow();
    const old={schema:'morphloom.elements/0.1',units:'mm',coordinates:'right-handed-y-up',seed:17,parts:[],regions:[],groups:[],elements:[]};
    expect(migrateElementProjectToV3(old).schema).toBe('morphloom.elements/0.3');expect(old.schema).toBe('morphloom.elements/0.1');
  });
  it('reaches the registry generation/editing/export path with version-matched capabilities',()=>{
    const r=createElementDomainRegistry();r.register(gearPack);const p=r.generate(gearPack.metadata.id,{},['connected-feature-editing']);expect(p.schema).toBe('morphloom.elements/0.3');
    expect(()=>r.generate(gearPack.metadata.id,{},['manufacturing-cad'])).toThrow();
  });
});
