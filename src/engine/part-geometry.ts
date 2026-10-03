import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { AssemblyGeometryIR } from './assembly-ir';
import { validateAssemblyIR } from './assembly-compiler';
import { validateSpurGear, type SpurGearGeometry } from './spur-gear';

/** Versioned element geometry reuses a bounded subset of the existing assembly compiler. */
export type PartGeometry = Extract<AssemblyGeometryIR, { op: 'sphere' | 'lathe' | 'extrude' }> | SpurGearGeometry;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const finite = (v: unknown, min: number, max: number): v is number => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
const segment = (v: unknown, min=3, max=128): boolean => Number.isInteger(v) && finite(v,min,max);
const keys = (v: Record<string,unknown>, required: string[], optional: string[] = []): boolean => required.every(k=>Object.hasOwn(v,k)) && Object.keys(v).every(k=>[...required,...optional].includes(k));
type Point = [number,number];
const cross = (a:Point,b:Point,c:Point): number => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function on(a:Point,b:Point,p:Point): boolean { return Math.abs(cross(a,b,p))<1e-10 && p[0]>=Math.min(a[0],b[0])-1e-10 && p[0]<=Math.max(a[0],b[0])+1e-10 && p[1]>=Math.min(a[1],b[1])-1e-10 && p[1]<=Math.max(a[1],b[1])+1e-10; }
function intersects(a:Point,b:Point,c:Point,d:Point): boolean {
  return (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
}
function polygon(value: unknown): value is Point[] {
  if (!Array.isArray(value) || value.length<3 || value.length>256 || !value.every(p=>Array.isArray(p) && p.length===2 && p.every(x=>finite(x,-10_000,10_000)))) return false;
  const p=value as Point[];
  let area=0;
  for(let i=0;i<p.length;i++) {
    const a=p[i],b=p[(i+1)%p.length]; if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6) return false;
    area+=a[0]*b[1]-b[0]*a[1];
    for(let j=i+1;j<p.length;j++) if(j!==i+1 && !(i===0 && j===p.length-1) && intersects(a,b,p[j],p[(j+1)%p.length])) return false;
  }
  return Math.abs(area)>1e-8;
}
function inside(p:Point, loop:Point[]): boolean {
  let result=false;
  for(let i=0,j=loop.length-1;i<loop.length;j=i++) {
    const a=loop[i],b=loop[j]; if(on(a,b,p)) return false;
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) result=!result;
  }
  return result;
}
function loopsIntersect(a:Point[],b:Point[]): boolean { return a.some((p,i)=>b.some((q,j)=>intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length]))); }
export function validatePartGeometry(value: unknown, allowGear=false): asserts value is PartGeometry {
  const fail=():never=>{throw new Error('Invalid declarative part geometry');};
  if(!plain(value)) return fail();
  if(value.op==='spur-gear'){if(!allowGear)return fail();validateSpurGear(value);return;}
  if(value.op==='sphere') {
    if(!keys(value,['op','radius'],['widthSegments','heightSegments']) || !finite(value.radius,0.01,10_000) ||
      (value.widthSegments!==undefined && (!segment(value.widthSegments,8) || (value.widthSegments as number)%4!==0)) ||
      (value.heightSegments!==undefined && (!segment(value.heightSegments,4) || (value.heightSegments as number)%2!==0))) fail();
  } else if(value.op==='lathe') {
    if(!keys(value,['op','profile'],['segments']) || !Array.isArray(value.profile) || value.profile.length<5 || value.profile.length>129 ||
      !value.profile.every(p=>Array.isArray(p) && p.length===2 && finite(p[0],0.01,10_000) && finite(p[1],-10_000,10_000)) ||
      JSON.stringify(value.profile[0])!==JSON.stringify(value.profile[value.profile.length-1]) || !polygon(value.profile.slice(0,-1)) ||
      (value.segments!==undefined && (!segment(value.segments,16) || (value.segments as number)%4!==0))) fail();
  } else if(value.op==='extrude') {
    if(!keys(value,['op','points','depth'],['holes','bevelSize','bevelThickness','bevelSegments']) || !polygon(value.points) || !finite(value.depth,0.01,10_000) ||
      (value.bevelSize!==undefined && !finite(value.bevelSize,0,10_000)) || (value.bevelThickness!==undefined && !finite(value.bevelThickness,0,10_000)) ||
      (value.bevelSegments!==undefined && !segment(value.bevelSegments,0,8))) fail();
    const outer=value.points as Point[],holes=value.holes;
    if(holes!==undefined) {
      if(!Array.isArray(holes) || holes.length>32 || !holes.every(polygon)) fail();
      const loops=holes as Point[][];
      for(let i=0;i<loops.length;i++) {
        if(!loops[i].every(p=>inside(p,outer)) || loopsIntersect(loops[i],outer)) fail();
        for(let j=0;j<i;j++) if(loopsIntersect(loops[i],loops[j]) || inside(loops[i][0],loops[j]) || inside(loops[j][0],loops[i])) fail();
      }
    }
  } else fail();
  validateAssemblyIR({schema:'morphloom.assembly/0.1',units:'mm',name:'declared geometry',components:[{id:'part',name:'part',category:'mechanical',materialName:'raw',detail:'validated element geometry',geometry:value,material:{color:'#808080'}}]});
}


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
        if(weights){const center=new Vector3().fromBufferAttribute(p,i+j),u=new Vector3().fromBufferAttribute(p,i+(j+1)%3).sub(center),v=new Vector3().fromBufferAttribute(p,i+(j+2)%3).sub(center);if(u.lengthSq()===0||v.lengthSq()===0||n.lengthSq()===0)throw new Error('Degenerate corner-angle triangle');u.normalize();v.normalize();weights[i+j]=Math.atan2(new Vector3().crossVectors(u,v).length(),u.dot(v));} }
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
