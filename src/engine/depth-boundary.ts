import type {AssemblyGeometryIR} from './assembly-ir';
import type {DepthAnchor, DepthSurfaceSource} from './depth-surface';
export type DepthEnvelope = {status:'unknown'} | {status:'declared';nearMm:number;farMm:number;toleranceMm:number;basis:'user-measured'|'authored-fixture'};
export type BoundaryContract = {status:'unknown'} | {status:'declared';bandPixels:number;toleranceMm:number;basis:'user-measured'|'authored-fixture';anchors:DepthAnchor[]};
export interface DepthQualityContract {depthEnvelope:DepthEnvelope;boundary:BoundaryContract}
export interface SphereFrontConstraint {schema:'morphloom.sphere-front-constraint/0.1';radiusMm:number;centerMm:[number,number,number];basis:'user-declared'|'authored-fixture';centerFitToleranceMm:number}
export interface DepthQualityReport {
 pass:boolean; blockers:string[];
 envelope:{status:'not-run'|'unknown'|'pass'|'fail';violations:number;maximumExcessMm:number;samplePixels:number[]};
 boundary:{status:'not-run'|'unknown'|'pass'|'fail';bandPixels:number;pixels:number;anchors:number;maximumErrorMm:number;errors:Array<{id:string;pixel:number;errorMm:number}>};
}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6;
const keys=(v:object,list:string[])=>Object.keys(v).every(k=>list.includes(k));
/** Four-neighbour foreground boundary band, including image borders and real holes. */
export function depthBoundaryBand(s:Pick<DepthSurfaceSource,'width'|'height'|'mask'>,bandPixels:number):Uint8Array {
 const count=s.mask.length, distances=new Int16Array(count).fill(-1),queue=new Uint32Array(count),band=new Uint8Array(count);
 let head=0,tail=0;
 const neighbours=(p:number)=>{const x=p%s.width,y=Math.floor(p/s.width);return [x>0?p-1:-1,x+1<s.width?p+1:-1,y>0?p-s.width:-1,y+1<s.height?p+s.width:-1];};
 for(let p=0;p<count;p++)if(s.mask[p]===1&&neighbours(p).some(n=>n<0||s.mask[n]!==1)){distances[p]=0;queue[tail++]=p;}
 while(head<tail){const p=queue[head++]!;band[p]=1;if(distances[p]!+1>=bandPixels)continue;
  for(const n of neighbours(p))if(n>=0&&s.mask[n]===1&&distances[n]===-1){distances[n]=distances[p]!+1;queue[tail++]=n;}
 }
 return band;
}
export function validateDepthQuality(s:DepthSurfaceSource):void {
 if(s.schema==='morphloom.depth-surface/0.1'){
  if(s.quality!==undefined||s.primaryForm!==undefined)throw new Error('Quality/primary-form contracts require depth source0.2.');return;
 }
 const q=s.quality;
 if(!q||!keys(q,['depthEnvelope','boundary']))throw new Error('Depth quality contract is required.');
 const e=q.depthEnvelope,b=q.boundary;
 for(const item of [e,b])if(!item||!['unknown','declared'].includes(item.status)||!keys(item,item.status==='unknown'?['status']:item===e?['status','nearMm','farMm','toleranceMm','basis']:['status','bandPixels','toleranceMm','basis','anchors']))throw new Error('Invalid depth quality declaration.');
 if(e.status==='declared'&&(!finite(e.nearMm)||!finite(e.farMm)||e.nearMm<=.001||e.farMm<e.nearMm
  ||!finite(e.toleranceMm)||e.toleranceMm<0||e.toleranceMm>10||!['user-measured','authored-fixture'].includes(e.basis)))throw new Error('Invalid declared depth envelope.');
 if(b.status==='declared'){
  if(!Number.isInteger(b.bandPixels)||b.bandPixels<1||b.bandPixels>8||!finite(b.toleranceMm)||b.toleranceMm<0||b.toleranceMm>10
   ||!['user-measured','authored-fixture'].includes(b.basis)||!Array.isArray(b.anchors)||b.anchors.length<4||b.anchors.length>512)throw new Error('Invalid boundary contract.');
  const band=depthBoundaryBand(s,b.bandPixels),ids=new Set([...s.calibration.fit,...s.calibration.validation].map(a=>a.id)),pixels=new Set([...s.calibration.fit,...s.calibration.validation].map(a=>a.pixel));
  for(const a of b.anchors){if(!a||!keys(a,['id','pixel','depthMm'])||typeof a.id!=='string'||!a.id.trim()||a.id.length>96||ids.has(a.id)
    ||!Number.isInteger(a.pixel)||a.pixel<0||a.pixel>=s.mask.length||pixels.has(a.pixel)||band[a.pixel]!==1||!finite(a.depthMm)||a.depthMm<=.001)throw new Error('Boundary anchors must be independent and in the declared mask band.');ids.add(a.id);pixels.add(a.pixel);}
 }
 if(s.primaryForm){const p=s.primaryForm;if(!keys(p,['schema','radiusMm','centerMm','basis','centerFitToleranceMm'])||p.schema!=='morphloom.sphere-front-constraint/0.1'||!finite(p.radiusMm)||p.radiusMm<=.001||p.radiusMm>100000
  ||!finite(p.centerFitToleranceMm)||p.centerFitToleranceMm<0||p.centerFitToleranceMm>10
  ||!Array.isArray(p.centerMm)||p.centerMm.length!==3||!p.centerMm.every(finite)||!['user-declared','authored-fixture'].includes(p.basis))throw new Error('Invalid sphere primary-form declaration.');}
}
export function inspectDepthQuality(s:DepthSurfaceSource,depths:Float64Array):DepthQualityReport {
 if(depths.length!==s.width*s.height||depths.length!==s.mask.length)throw new Error('Depth quality array does not cover the full source.');
 for(let p=0;p<depths.length;p++)if(s.mask[p]===1&&(!finite(depths[p])||depths[p]!<=.001))throw new Error(`Invalid foreground depth at pixel ${p}.`);
 const q=s.quality,report:DepthQualityReport={pass:false,blockers:[],envelope:{status:q?'unknown':'not-run',violations:0,maximumExcessMm:0,samplePixels:[]},boundary:{status:q?'unknown':'not-run',bandPixels:0,pixels:0,anchors:0,maximumErrorMm:0,errors:[]}};
 if(!q)return report;
 if(q.depthEnvelope.status==='unknown')report.blockers.push('Depth envelope is unknown.');
 else {const e=q.depthEnvelope;for(let p=0;p<depths.length;p++)if(s.mask[p]===1){const excess=Math.max(e.nearMm-depths[p]!,depths[p]!-e.farMm,0);
   if(excess>e.toleranceMm){report.envelope.violations++;report.envelope.maximumExcessMm=Math.max(report.envelope.maximumExcessMm,excess);if(report.envelope.samplePixels.length<32)report.envelope.samplePixels.push(p);}}
  report.envelope.status=report.envelope.violations?'fail':'pass';if(report.envelope.violations)report.blockers.push(`Depth envelope violated by ${report.envelope.violations} foreground samples.`);
 }
 if(q.boundary.status==='unknown')report.blockers.push('Depth boundary validation is unknown.');
 else {const b=q.boundary;report.boundary.bandPixels=b.bandPixels;report.boundary.pixels=depthBoundaryBand(s,b.bandPixels).reduce((a,v)=>a+v,0);report.boundary.anchors=b.anchors.length;
  report.boundary.errors=b.anchors.map(a=>({id:a.id,pixel:a.pixel,errorMm:Math.abs(depths[a.pixel]!-a.depthMm)}));report.boundary.maximumErrorMm=Math.max(...report.boundary.errors.map(a=>a.errorMm));
  report.boundary.status=report.boundary.errors.some(a=>a.errorMm>b.toleranceMm)?'fail':'pass';
  for(const a of report.boundary.errors)if(a.errorMm>b.toleranceMm)report.blockers.push(`Depth boundary ${a.id} exceeds ${b.toleranceMm}mm.`);
 }
 report.pass=report.blockers.length===0;return report;
}
/** Reuse the same declared radius as AssemblyIR/element bearing-ball spheres. */
export function sphereFrontConstraintFromAssembly(geometry:AssemblyGeometryIR,centerMm:[number,number,number],basis:SphereFrontConstraint['basis'],centerFitToleranceMm:number):SphereFrontConstraint {
 if(geometry.op!=='sphere'||!finite(geometry.radius)||geometry.radius<=.001||geometry.radius>100000)throw new Error('Only a declared spherical primary form is supported.');
 return {schema:'morphloom.sphere-front-constraint/0.1',radiusMm:geometry.radius,centerMm:[...centerMm],basis,centerFitToleranceMm};
}
/** Explicit declared-primary-form proposal, never an inferred hidden hemisphere. */
export function sphereFrontDepths(s:DepthSurfaceSource):Float64Array {
 const c=s.primaryForm;if(!c)throw new Error('Declared sphere primary form is required.');
 const depths=new Float64Array(s.samples.length),[left,right,bottom,top]=s.camera.frameMm,[cx,cy,declaredZ]=c.centerMm;
 for(let p=0;p<depths.length;p++){
  const x=left+(right-left)*(p%s.width+.5)/s.width,y=top-(top-bottom)*(Math.floor(p/s.width)+.5)/s.height;
  const square=c.radiusMm*c.radiusMm-(x-cx)**2-(y-cy)**2;
  if((square>0)!==(s.mask[p]===1))throw new Error('Declared sphere silhouette does not match the observed mask; holes/occlusions are unsupported.');
  if(s.mask[p]===1)depths[p]=Math.sqrt(square);
 }
 // Fit only observable Z placement; radius/XY are fixed declared primary form.
 const cz=s.calibration.fit.reduce((sum,a)=>sum+s.camera.cameraZMm-a.depthMm-depths[a.pixel]!,0)/s.calibration.fit.length;
 for(const a of s.calibration.fit)if(Math.abs((s.camera.cameraZMm-cz-depths[a.pixel]!)-a.depthMm)>c.centerFitToleranceMm)throw new Error(`Sphere fit anchor ${a.id} exceeds center fit tolerance.`);
 if(Math.abs(cz-declaredZ)>c.centerFitToleranceMm)throw new Error('Fitted sphere datum exceeds the declared center tolerance.');
 for(let p=0;p<depths.length;p++)if(s.mask[p]===1){const depth=s.camera.cameraZMm-cz-depths[p]!;if(!finite(depth)||depth<=.001)throw new Error('Sphere candidate lies outside positive camera depth.');depths[p]=depth;}
 return depths;
}
