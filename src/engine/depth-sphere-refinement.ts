import * as THREE from 'three';
import {ConvexHull} from 'three/addons/math/ConvexHull.js';
import type {DepthSurfaceSource} from './depth-surface';
/** Full observed raster + declared sphere samples. Held-out anchor locations/depths are never consumed. */
export function refineSphereRaster(s:DepthSurfaceSource,base:THREE.BufferGeometry,center:[number,number,number],rimAzimuth:number):{geometry:THREE.BufferGeometry;rasterVertices:number;snappedVertices:number} {
 const [left,right,bottom,top]=s.camera.frameMm,r=s.primaryForm!.radiusMm,p=base.attributes.position!,units:THREE.Vector3[]=[],lookup=new Map<string,number>();
 const key=(v:THREE.Vector3)=>v.toArray().map(n=>Math.round(n*1e12)).join(':');
 const add=(v:THREE.Vector3)=>{v.normalize();const k=key(v);if(!lookup.has(k)){lookup.set(k,units.length);units.push(v);}};
 const raster=(pixel:number)=>{const x=left+(right-left)*(pixel%s.width+.5)/s.width-center[0],y=top-(top-bottom)*(Math.floor(pixel/s.width)+.5)/s.height-center[1],square=r*r-x*x-y*y;if(!Number.isFinite(square)||square<=0)throw new Error('Declared sphere does not cover a finite foreground sample.');return new THREE.Vector3(x,y,Math.sqrt(square));};
 const foreground=s.mask.reduce((sum,v)=>sum+v,0);let snappedVertices=0;
 for(let pixel=0;pixel<s.mask.length;pixel++)if(s.mask[pixel]===1)add(raster(pixel));
 const baseParameters=(base as THREE.SphereGeometry).parameters,rimStart=baseParameters.heightSegments*(baseParameters.widthSegments+1);
 for(let i=0;i<rimStart;i++){const v=new THREE.Vector3(p.getX(i)*1000-center[0],p.getY(i)*1000-center[1],p.getZ(i)*1000-center[2]);v.normalize().multiplyScalar(r);
  const px=Math.round((v.x+center[0]-left)/(right-left)*s.width-.5),py=Math.round((top-v.y-center[1])/(top-bottom)*s.height-.5);
  if(px>=0&&px<s.width&&py>=0&&py<s.height&&s.mask[py*s.width+px]===1&&v.distanceTo(raster(py*s.width+px))<.0035){snappedVertices++;continue;}
  add(v);
 }
 for(let i=0;i<rimAzimuth;i++){const phi=i/rimAzimuth*Math.PI*2;add(new THREE.Vector3(-Math.cos(phi),-Math.sin(phi),0));}
 if(units.length*2>100004)throw new Error('Raster-preserving continuous sphere exceeds triangle budget.');
 const hull=new ConvexHull().setFromPoints(units),faces:number[][]=[];
 for(const face of hull.faces){const ids:number[]=[],points:THREE.Vector3[]=[];let edge=face.edge;do{const point=edge.head().point;points.push(point);ids.push(lookup.get(key(point))!);edge=edge.next;}while(edge!==face.edge);
  // The temporary hull cap is only an algorithmic construction, never exported as hidden geometry.
  if(points.some(point=>point.z!==0)){const start=ids.indexOf(Math.min(...ids));faces.push([...ids.slice(start),...ids.slice(0,start)]);}
 }
 // ConvexHull enumerates equivalent faces differently across JS runtimes.
 faces.sort((a,b)=>a[0]!-b[0]!||a[1]!-b[1]!||a[2]!-b[2]!);
 if(faces.length>100000)throw new Error('Refined continuous sphere exceeds triangle budget.');
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(units.flatMap(v=>[v.x*r+center[0],v.y*r+center[1],v.z*r+center[2]]).map(n=>n/1000),3));geometry.setIndex(faces.flat());
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute(units.flatMap(v=>v.toArray()),3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(units.flatMap(v=>[(v.x*r+center[0]-left)/(right-left),(v.y*r+center[1]-bottom)/(top-bottom)]),2));
 return {geometry,rasterVertices:foreground,snappedVertices};
}
