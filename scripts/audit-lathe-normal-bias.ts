import { Vector3 } from 'three';
import { compileAssemblyGeometry } from '../src/engine/assembly-compiler';
import { creasePartNormals } from '../src/engine/part-geometry';
const weighting=process.argv[2]??'uniform';if(weighting!=='uniform'&&weighting!=='corner-angle')throw Error('Unsupported normal weighting');const rows=[];
for(const segments of [16,32,128]) {
 const source=compileAssemblyGeometry({op:'lathe',profile:[[10,-6],[10,6],[14,6],[14,-6],[10,-6]],segments});
 const mesh=creasePartNormals(source,Math.PI/6,weighting);
 try {
  const p=mesh.getAttribute('position'),n=mesh.getAttribute('normal');let worst=0,sideVertices=0;
  for(let i=0;i<p.count;i++) {
   const normal=new Vector3().fromBufferAttribute(n,i),radius=Math.hypot(p.getX(i),p.getZ(i));
   if(Math.abs(normal.y)>.001)continue;
   const sign=radius<.012?-1:1,expected=new Vector3(sign*p.getX(i),0,sign*p.getZ(i)).normalize();
   worst=Math.max(worst,Math.acos(Math.min(1,Math.max(-1,normal.normalize().dot(expected))))*180/Math.PI);sideVertices++;
  }
  rows.push({segments,sideVertices,worstRadialNormalErrorDeg:worst});
 }finally{if(mesh!==source)mesh.dispose();source.dispose();}
}
console.log(JSON.stringify({weighting,claim:'Rotationally symmetric straight cylinder side normals should be radial; no actual reference object used',rows},null,2));
