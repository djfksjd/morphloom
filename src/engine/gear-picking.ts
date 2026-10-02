import {gearProfile, gearDimensions, toothIds, type SpurGearGeometry} from './spur-gear';
/** Local coordinates in millimetres. Only the material outside the root circle is a tooth. */
export function makeGearToothPicker(input:SpurGearGeometry):(point:readonly number[])=>string|null{
 const g=structuredClone(input),root=gearDimensions(g).rootDiameterMm/2,profile=gearProfile(g),ids=toothIds(g);
 return (point:readonly number[]):string|null=>{
 if(point.length!==3||!point.every(Number.isFinite))return null;
 const [x,y,z]=point;
 if(Math.abs(z)>g.faceWidthMm/2+1e-6||Math.hypot(x,y)<=root+1e-6)return null;
 const angle=Math.atan2(y,x),i=((Math.round(angle*g.toothCount/(2*Math.PI))%g.toothCount)+g.toothCount)%g.toothCount;
 const contour=profile.features[i].points;let inside=false;
 // Close the feature at the root circle chord. Explicit boundary tolerance handles cap/side hits.
 for(let k=0,j=contour.length-1;k<contour.length;j=k++){
  const a=contour[j],b=contour[k],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
  const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l)):0;
  if(Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<1e-5)return ids[i];
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside?ids[i]:null;
 };
}
export function pickGearTooth(g:SpurGearGeometry,point:readonly number[]):string|null{return makeGearToothPicker(g)(point);}
