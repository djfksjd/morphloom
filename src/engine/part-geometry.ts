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


export {creasePartNormals} from './crease-part-normals';
