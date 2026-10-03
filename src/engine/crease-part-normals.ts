import {deterministicCornerAngle} from './deterministic-corner-angle';
import {BufferAttribute,BufferGeometry,Vector3} from 'three';

/** Relative vertex precision is necessary for millimeter assets; fixed centimeter hashes merge unrelated faces. */
export function creasePartNormals(source: BufferGeometry, angle: number, weighting: 'uniform' | 'corner-angle' = 'uniform'): BufferGeometry {
  if(weighting!=='uniform'&&weighting!=='corner-angle')throw new Error('Invalid normal weighting');
  const g = source.index ? source.toNonIndexed() : source;
  try {
    const p = g.getAttribute('position');
    g.computeBoundingBox();
    const extent = g.boundingBox!.getSize(new Vector3());
    const precision = Math.max(extent.x,extent.y,extent.z) * 1e-7;
    if (!(precision > 0)) throw new Error('Degenerate crease geometry');
    const key = (i:number):string => [p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v/precision)).join(':');
    const weights=weighting==='corner-angle'?new Float64Array(p.count):undefined;
    const normals:Vector3[] = [], shared = new Map<string,number[]>();
    const a=new Vector3(),b=new Vector3(),c=new Vector3();
    for(let i=0;i<p.count;i+=3) {
      a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
      const n=b.sub(a).cross(c.sub(a)).normalize(); normals.push(n.clone());
      for(let j=0;j<3;j++) { const k=key(i+j); let faces=shared.get(k); if(!faces) {faces=[];shared.set(k,faces);} faces.push(i+j);
        if(weights){const center=new Vector3().fromBufferAttribute(p,i+j),u=new Vector3().fromBufferAttribute(p,i+(j+1)%3).sub(center),v=new Vector3().fromBufferAttribute(p,i+(j+2)%3).sub(center);if(u.lengthSq()===0||v.lengthSq()===0||n.lengthSq()===0)throw new Error('Degenerate corner-angle triangle');u.normalize();v.normalize();weights[i+j]=deterministicCornerAngle(new Vector3().crossVectors(u,v).length(),u.dot(v));} }
    }
    const data=new Float32Array(p.count*3),sum=new Vector3(),threshold=Math.cos(angle)-1e-7;
    for(let i=0;i<p.count;i++) {
      sum.set(0,0,0);const face=normals[Math.floor(i/3)];
      for(const other of shared.get(key(i))!) if(face.dot(normals[Math.floor(other/3)])>=threshold) {if(weights)sum.addScaledVector(normals[Math.floor(other/3)],weights[other]);else sum.add(normals[Math.floor(other/3)]);}
      sum.normalize();data.set(sum.toArray(),i*3);
    }
    g.setAttribute('normal',new BufferAttribute(data,3));return g;
  } catch(error) { if(g!==source) g.dispose();throw error; }
}
