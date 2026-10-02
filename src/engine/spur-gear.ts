import type { AssemblyGeometryIR } from './assembly-ir';
export type SpurGearGeometry={op:'spur-gear';moduleMm:number;toothCount:number;pressureAngleDeg:number;faceWidthMm:number;boreDiameterMm:number;toothOverrides?:Record<string,{addendumScale:number}>};
type Point=[number,number];
const fail=():never=>{throw new Error('Invalid spur gear: finite bounded parameters, undercut-safe teeth and bore required');};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const bounded=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
export const toothIds=(g:SpurGearGeometry):string[]=>Number.isInteger(g.toothCount)&&g.toothCount>=18&&g.toothCount<=64
  ? Array.from({length:g.toothCount},(_,i)=>`tooth_${String(i).padStart(4,'0')}`) : [];
export function validateSpurGear(value:unknown):asserts value is SpurGearGeometry{
  if(!record(value)||value.op!=='spur-gear'||Object.keys(value).some(k=>!['op','moduleMm','toothCount','pressureAngleDeg','faceWidthMm','boreDiameterMm','toothOverrides'].includes(k))||
    !bounded(value.moduleMm,0.2,5)||!bounded(value.toothCount,18,64)||!Number.isInteger(value.toothCount)||!bounded(value.pressureAngleDeg,20,25)||
    !bounded(value.faceWidthMm,0.1,100)||!bounded(value.boreDiameterMm,0,300))fail();
  const g=value as unknown as SpurGearGeometry,alpha=g.pressureAngleDeg*Math.PI/180;
  if(g.toothCount<Math.ceil(2/Math.sin(alpha)**2)||g.boreDiameterMm>=g.moduleMm*(g.toothCount-2.5)-g.moduleMm*0.1)fail();
  if(g.toothOverrides!==undefined){
    if(!record(g.toothOverrides)||Object.keys(g.toothOverrides).length>g.toothCount)fail();
    const ids=new Set(toothIds(g));
    for(const [id,v] of Object.entries(g.toothOverrides))if(!ids.has(id)||!record(v)||Object.keys(v).length!==1||!bounded(v.addendumScale,0.9,1.1))fail();
  }
}
export function gearDimensions(g:SpurGearGeometry):{pitchDiameterMm:number;baseDiameterMm:number;addendumDiameterMm:number;rootDiameterMm:number}{
  validateSpurGear(g);const d=g.moduleMm*g.toothCount;
  return {pitchDiameterMm:d,baseDiameterMm:d*Math.cos(g.pressureAngleDeg*Math.PI/180),addendumDiameterMm:d+2*g.moduleMm,rootDiameterMm:d-2.5*g.moduleMm};
}
const polar=(r:number,a:number):Point=>[r*Math.cos(a),r*Math.sin(a)];
const involute=(r:number,base:number):number=>{const t=Math.sqrt(Math.max(0,(r/base)**2-1));return t-Math.atan(t);};
const distance=(p:Point,a:Point,b:Point):number=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};
/** Zero profile shift; radial root connector is explicitly an approximation, not cutter trochoid. */
export function gearProfile(g:SpurGearGeometry):{points:Point[];features:{id:string;points:Point[]}[];maximumFlankChordErrorMm:number}{
  const d=gearDimensions(g),rp=d.pitchDiameterMm/2,rb=d.baseDiameterMm/2,rf=d.rootDiameterMm/2;
  const alpha=g.pressureAngleDeg*Math.PI/180,halfBase=Math.PI/(2*g.toothCount)+Math.tan(alpha)-alpha,sector=Math.PI/g.toothCount;
  const features:{id:string;points:Point[]}[]=[],all:Point[]=[];let maxError=0;
  for(const [i,id] of toothIds(g).entries()){
    const center=2*Math.PI*i/g.toothCount,ra=rp+g.moduleMm*(g.toothOverrides?.[id]?.addendumScale??1),start=Math.max(rb,rf);
    const halfStart=halfBase-involute(start,rb),halfTip=halfBase-involute(ra,rb);
    if(halfTip<=0||halfStart>=sector)fail();const points:Point[]=[];
    const add=(p:Point):void=>{if(!points.length||Math.hypot(points[points.length-1][0]-p[0],points[points.length-1][1]-p[1])>1e-10)points.push(p);};
    for(let k=0;k<=4;k++)add(polar(rf,center-sector+(sector-halfStart)*k/4));
    const flank=(r:number,side:number):Point=>polar(r,center+side*(halfBase-involute(r,rb)));
    for(let k=0;k<=32;k++)add(flank(start+(ra-start)*k/32,-1));
    for(let k=1;k<=8;k++)add(polar(ra,center-halfTip+2*halfTip*k/8));
    for(let k=31;k>=0;k--)add(flank(start+(ra-start)*k/32,1));
    add(polar(rf,center+halfStart));for(let k=1;k<=4;k++)add(polar(rf,center+halfStart+(sector-halfStart)*k/4));
    // Involute derivative is rb*t*(cos(t),sin(t)); the maximum chord deviation
    // occurs where that tangent is parallel to the chord. No sample score proxy.
    for(let k=0;k<32;k++){
      const r0=start+(ra-start)*k/32,r1=start+(ra-start)*(k+1)/32,a=flank(r0,-1),b=flank(r1,-1),rotation=center-halfBase;
      const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.atan2(-dx*Math.sin(rotation)+dy*Math.cos(rotation),dx*Math.cos(rotation)+dy*Math.sin(rotation));
      const t0=Math.sqrt(Math.max(0,(r0/rb)**2-1)),t1=Math.sqrt(Math.max(0,(r1/rb)**2-1));
      if(t>=t0&&t<=t1)maxError=Math.max(maxError,distance(flank(rb*Math.sqrt(1+t*t),-1),a,b));
    }
    features.push({id,points});all.push(...(i?points.slice(1):points));
  }
  all.pop(); // last sector boundary closes at the first point
  if(all.length>8192||maxError>0.005*g.moduleMm)throw new Error('Spur gear curve resolution budget exceeded');
  return {points:all,features,maximumFlankChordErrorMm:maxError};
}
export function gearExtrude(g:SpurGearGeometry):Extract<AssemblyGeometryIR,{op:'extrude'}>{
  const radius=g.boreDiameterMm/2;
  // Physical 0.002 mm sag budget; oversampling tiny bores creates cap slivers.
  const segments=radius>0?Math.max(128,Math.ceil(Math.PI/Math.acos(1-Math.min(0.002/radius,1))/4)*4):128;
  const {points}=gearProfile(g),holes=radius>0?[Array.from({length:segments},(_,i)=>polar(radius,2*Math.PI*(i+0.5)/segments))]:[];
  return {op:'extrude',points,holes,depth:g.faceWidthMm,bevelSize:0,bevelThickness:0};
}
/** Closed diagnostic sector cut; this is not a detachable tooth of a physical assembly. */
export function extractToothGeometry(g:SpurGearGeometry,id:string):Extract<AssemblyGeometryIR,{op:'extrude'}>{
  const profile=gearProfile(g),i=toothIds(g).indexOf(id);if(i<0)throw new Error('Unknown connected tooth feature');
  const points=profile.features[i].points.map(p=>[...p] as Point),center=2*Math.PI*i/g.toothCount,half=Math.PI/g.toothCount;
  if(g.boreDiameterMm>0)for(let k=0;k<=16;k++)points.push(polar(g.boreDiameterMm/2,center+half-2*half*k/16));else points.push([0,0]);
  return {op:'extrude',points,depth:g.faceWidthMm,bevelSize:0,bevelThickness:0};
}
