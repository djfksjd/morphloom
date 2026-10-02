import {it,expect} from 'vitest';
import {generateSpurGearProject} from '../src/engine/gear-pack';
import {pickGearTooth} from '../src/engine/gear-picking';
import {buildElementScene} from '../src/engine/element-renderer';
import * as THREE from 'three';
it('selects actual tooth contours and rejects bore, body, gaps and invalid coordinates',()=>{
 const g=generateSpurGearProject({}).parts[0].geometry!;if(g.op!=='spur-gear')throw Error('gear');
 for(let i=0;i<24;i++){const a=i*Math.PI/12;expect(pickGearTooth(g,[12*Math.cos(a),12*Math.sin(a),4])).toBe(`tooth_${String(i).padStart(4,'0')}`);}
 for(const p of [[0,0,4],[5,0,4],[12*Math.cos(Math.PI/24),12*Math.sin(Math.PI/24),4],[14,0,4],[12,0,-5],[12,0,5],[NaN,0,4]])expect(pickGearTooth(g,p)).toBeNull();
});
it('uses the actual transformed ray hit and keeps identity after local contour edits',()=>{
 const p=generateSpurGearProject({});p.parts[0].position=[20,30,40];p.parts[0].rotation=[0.2,0.3,0.5];p.parts[0].scale=[2,0.7,1.3];
 const g=p.parts[0].geometry!;if(g.op!=='spur-gear')throw Error('gear');g.toothOverrides={tooth_0003:{addendumScale:0.9}};
 const s=buildElementScene(p,'detail');try{
 s.root.updateMatrixWorld(true);const mesh=s.root.getObjectByName('spur_gear') as THREE.Mesh;
 const a=Math.PI/4,point=new THREE.Vector3(0.012*Math.cos(a),0.012*Math.sin(a),0.004).applyMatrix4(mesh.matrixWorld);
 const direction=new THREE.Vector3(0,0,-1).transformDirection(mesh.matrixWorld),ray=new THREE.Raycaster(point.clone().addScaledVector(direction,-0.1),direction);
 const hit=ray.intersectObject(mesh)[0];expect(hit).toBeDefined();const q=mesh.worldToLocal(hit.point.clone()).multiplyScalar(1000);expect(pickGearTooth(g,q.toArray())).toBe('tooth_0003');
 }finally{s.dispose();}
});
