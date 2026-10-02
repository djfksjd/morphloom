import * as THREE from 'three';
import type {DepthSurfaceSource} from './depth-surface';
export interface DepthMeshing {schema:'morphloom.depth-meshing/0.1';mode:'declared-sphere-front';maxSagittaMm:number}
export interface ContinuousSphereReport {azimuthSegments:number;polarSegments:number;maximumChordDeviationMm:number;maximumVertexErrorMm:number;maximumRimRadialDeficitMm:number;vertexProvenance:'declared-parametric-surface'}
/** Caller first validates the observed footprint and mm anchors through sphereFrontDepths. */
export function continuousSphereFront(s:DepthSurfaceSource,depths:Float64Array):{geometry:THREE.BufferGeometry;report:ContinuousSphereReport} {
 const prior=s.primaryForm,operation=s.meshing;if(!prior||!operation)throw new Error('Explicit sphere primary form and meshing declaration are required.');
 const r=prior.radiusMm,[cx,cy]=prior.centerMm,[left,right,bottom,top]=s.camera.frameMm,tol=operation.maxSagittaMm;
 if(cx-r<left||cx+r>right||cy-r<bottom||cy+r>top)throw new Error('Continuous sphere footprint is cropped by the camera frame.');
 const a=s.calibration.fit[0]!,x=left+(right-left)*(a.pixel%s.width+.5)/s.width,y=top-(top-bottom)*(Math.floor(a.pixel/s.width)+.5)/s.height;
 const cz=s.camera.cameraZMm-depths[a.pixel]!-Math.sqrt(r*r-(x-cx)**2-(y-cy)**2);
 // Split sagitta budget across the two angular steps with a numerical reserve.
 const step=2*Math.acos(Math.max(-1,1-Math.min(tol*.45/r,1))),azimuth=Math.max(8,Math.ceil(2*Math.PI/step)),polar=Math.max(2,Math.ceil((Math.PI/2)/step));
 if(!Number.isFinite(step)||step<=0||azimuth*(2*polar-1)>100000)throw new Error('Continuous sphere triangle budget exceeded; declare a supported tolerance.');
 const geometry=new THREE.SphereGeometry(r/1000,azimuth,polar,0,Math.PI*2,0,Math.PI/2);geometry.rotateX(Math.PI/2);geometry.translate(cx/1000,cy/1000,cz/1000);
 try{
  const positions=geometry.attributes.position!,uv=geometry.attributes.uv!,indices=geometry.index!,point=(i:number)=>new THREE.Vector3(positions.getX(i)*1000-cx,positions.getY(i)*1000-cy,positions.getZ(i)*1000-cz);
  let vertexError=0,chordError=0,rimDeficit=0;const triangle=new THREE.Triangle(),origin=new THREE.Vector3(),closest=new THREE.Vector3();
  for(let i=0;i<positions.count;i++){const p=point(i);vertexError=Math.max(vertexError,Math.abs(p.length()-r));uv.setXY(i,(positions.getX(i)*1000-left)/(right-left),(positions.getY(i)*1000-bottom)/(top-bottom));if(uv.getX(i)<0||uv.getX(i)>1||uv.getY(i)<0||uv.getY(i)>1)throw new Error('Projected continuous UV is outside the original image.');}
  for(let i=0;i<indices.count;i+=3){const a=point(indices.getX(i)),b=point(indices.getX(i+1)),c=point(indices.getX(i+2));
   const center=a.clone().add(b).add(c).multiplyScalar(1/3),cross=b.clone().sub(a).cross(c.clone().sub(a));
   if(!Number.isFinite(cross.lengthSq())||cross.lengthSq()===0||cross.dot(center)<=0)throw new Error('Continuous surface has collapsed or flipped faces.');
   // Closest point to the sphere centre bounds deviation over the whole face.
   triangle.set(a,b,c).closestPointToPoint(origin,closest);chordError=Math.max(chordError,r-closest.length(),r-center.length());
   for(const [u,v] of [[a,b],[b,c],[c,a]]){const mid=u!.clone().add(v!).multiplyScalar(.5);chordError=Math.max(chordError,r-mid.length());if(Math.abs(u!.z)<.0001&&Math.abs(v!.z)<.0001)rimDeficit=Math.max(rimDeficit,r-Math.hypot(mid.x,mid.y));}
  }
  if(vertexError>.001||chordError>tol+.0001)throw new Error('Continuous surface exceeds declared curvature or Float32 precision tolerance.');
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return {geometry,report:{azimuthSegments:azimuth,polarSegments:polar,maximumChordDeviationMm:chordError,maximumVertexErrorMm:vertexError,maximumRimRadialDeficitMm:rimDeficit,vertexProvenance:'declared-parametric-surface'}};
 }catch(error){geometry.dispose();throw error;}
}
