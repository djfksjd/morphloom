import {it,expect} from 'vitest';import {Euler,Quaternion,Matrix4,Vector3} from 'three';import {deterministicEulerXYZ,deterministicHalfSinCos} from '../src/engine/deterministic-rotation';
it('bounds trig error and unit rotations over signed angles and folding boundaries',()=>{
 for(let i=0;i<=4096;i++){const a=-2*Math.PI+4*Math.PI*i/4096,[s,c]=deterministicHalfSinCos(a);expect(Math.abs(s-Math.sin(a))).toBeLessThan(1e-13);expect(Math.abs(c-Math.cos(a))).toBeLessThan(1e-13);}
 for(const angle of [[0,0,0],[.1,.2,.3],[2*Math.PI,-2*Math.PI,Math.PI],[-Math.PI,Math.PI/2,-Math.PI/2],[4*Math.PI,-4*Math.PI,0]]){const q=deterministicEulerXYZ(angle);expect(Math.abs(q.length()-1)).toBeLessThan(1e-13);const m=new Matrix4().makeRotationFromQuaternion(q),native=new Matrix4().makeRotationFromEuler(new Euler(...angle as [number,number,number]));expect(Math.max(...m.elements.map((v,i)=>Math.abs(v-native.elements[i])))).toBeLessThan(1e-12);expect(new Vector3(1e6,-1e6,1e6).applyMatrix4(m).distanceTo(new Vector3(1e6,-1e6,1e6).applyMatrix4(native))).toBeLessThan(.00001);}
});
it('rejects nonfinite, unbounded or missing values and keeps input immutable',()=>{
 for(const a of [[NaN,0,0],[Infinity,0,0],[4*Math.PI+.1,0,0],[0,0]])expect(()=>deterministicEulerXYZ(a)).toThrow();const a=[.1,.2,.3];const q=deterministicEulerXYZ(a);expect(a).toEqual([.1,.2,.3]);expect(deterministicEulerXYZ(a).toArray()).toEqual(q.toArray());
 expect(()=>deterministicHalfSinCos(2*Math.PI+.1)).toThrow();
});
