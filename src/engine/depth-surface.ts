import * as THREE from 'three';
import {validateDepthQuality,inspectDepthQuality,sphereFrontDepths,type DepthQualityContract,type DepthQualityReport,type SphereFrontConstraint} from './depth-boundary';

export const DEPTH_SURFACE_ENGINE_REVISION='morphloom.depth-surface-engine/0.2';
export interface DepthAnchor {id: string; pixel: number; depthMm: number}
/** Source field remains independent of this explicitly approximate display mesh. */
export interface DepthSurfaceSource {
  schema: 'morphloom.depth-surface/0.1'|'morphloom.depth-surface/0.2';
  id: string;
  imageSha256: string;
  rawFieldSha256: string;
  width: number;
  height: number;
  samples: number[];
  mask: number[];
  camera: {
    projection: 'orthographic-front'; units: 'mm'; axes: 'right-handed-y-up';
    /** left, right, bottom, top at original image boundaries, not vertex centres. */
    frameMm: [number, number, number, number]; cameraZMm: number;
  };
  calibration: {basis: 'user-measured' | 'authored-fixture'; fit: DepthAnchor[]; validation: DepthAnchor[]};
  stride: number;
  quality?:DepthQualityContract;
  primaryForm?:SphereFrontConstraint;
  preview?:'raw-depth'|'declared-sphere-front';
}
export interface DepthSurfaceReport {
  schema: 'morphloom.depth-surface-report/0.2';
  engineRevision:typeof DEPTH_SURFACE_ENGINE_REVISION;
  calibrationPass: boolean; releaseAllowed: false; representation: 'inferred-open-visible-surface';
  inverseDepthFit: {scale: number; offset: number};
  validation: {normalizedMae: number; maximumNormalizedError: number; errors: Array<{id: string; errorMm: number; normalizedError: number}>};
  triangles: number; vertices: number; skippedCells: number;
  blockers: string[];
  quality:DepthQualityReport;
  candidate?:{kind:'declared-sphere-front';validationPass:boolean;maximumAnchorErrorMm:number;quality:DepthQualityReport};
}
const bounded = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1e6;
const SHA = /^[a-f0-9]{64}$/;

export function validateDepthSurfaceSource(input: unknown): asserts input is DepthSurfaceSource {
  if (!input || typeof input !== 'object') throw new Error('Invalid depth source.');
  const s = input as DepthSurfaceSource;
  const allowed=(value:object,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
  if(!allowed(s,['schema','id','imageSha256','rawFieldSha256','width','height','samples','mask','camera','calibration','stride','quality','primaryForm','preview']))throw new Error('Unknown depth source parameters.');
  if (!['morphloom.depth-surface/0.1','morphloom.depth-surface/0.2'].includes(s.schema) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(s.id)
    || typeof s.id !== 'string' || !SHA.test(s.imageSha256) || !SHA.test(s.rawFieldSha256)
    || !Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 2 || s.height < 2
    || s.width > 256 || s.height > 256 || !Array.isArray(s.samples) || !Array.isArray(s.mask)
    || s.samples.length !== s.width*s.height || s.mask.length !== s.samples.length
    || s.samples.some(n => typeof n !== 'number' || !bounded(n)) || s.mask.some(n => n !== 0 && n !== 1)
    || !Number.isInteger(s.stride) || s.stride < 1 || s.stride > 8) throw new Error('Depth source version or field budget is invalid.');
  const c = s.camera;
  if (!c || !allowed(c,['projection','units','axes','frameMm','cameraZMm']) || c.projection !== 'orthographic-front' || c.units !== 'mm' || c.axes !== 'right-handed-y-up'
    || !Array.isArray(c.frameMm) || c.frameMm.length !== 4 || !c.frameMm.every(bounded)
    || c.frameMm[1]-c.frameMm[0] < .001 || c.frameMm[3]-c.frameMm[2] < .001
    || !bounded(c.cameraZMm)) throw new Error('Explicit front orthographic mm camera is required.');
  if (!s.calibration || !allowed(s.calibration,['basis','fit','validation']) || !['user-measured','authored-fixture'].includes(s.calibration.basis)) throw new Error('Depth calibration basis is required.');
  const ids = new Set<string>(), pixels = new Set<number>();
  for (const [anchors, minimum] of [[s.calibration.fit, 6], [s.calibration.validation, 4]] as const) {
    if (!Array.isArray(anchors) || anchors.length < minimum || anchors.length > 512) throw new Error('Independent fit/validation anchor counts are invalid.');
    for (const a of anchors) {
      if (!a || !allowed(a,['id','pixel','depthMm']) || typeof a.id !== 'string' || !a.id.trim() || a.id.length > 96 || ids.has(a.id)
        || !Number.isInteger(a.pixel) || a.pixel < 0 || a.pixel >= s.samples.length || pixels.has(a.pixel)
        || s.mask[a.pixel] !== 1 || !bounded(a.depthMm) || a.depthMm <= .001) throw new Error('Invalid, duplicate or masked depth anchor.');
      ids.add(a.id); pixels.add(a.pixel);
    }
  }
  if(s.preview!==undefined&&(s.schema!=='morphloom.depth-surface/0.2'||!['raw-depth','declared-sphere-front'].includes(s.preview)))throw new Error('Unsupported native depth preview operation.');
  validateDepthQuality(s);
}

export function migrateDepthSurface(input:unknown):DepthSurfaceSource{
 validateDepthSurfaceSource(input);
 const s=structuredClone(input);if(s.schema==='morphloom.depth-surface/0.1'){s.schema='morphloom.depth-surface/0.2';s.quality={depthEnvelope:{status:'unknown'},boundary:{status:'unknown'}};}return s;
}

export function compileDepthSurface(input: unknown, options: {diagnostic?: boolean;candidate?:'declared-sphere-front'} = {}): {
  geometry: THREE.BufferGeometry; report: DepthSurfaceReport; sourcePixels: number[];
} {
  if(options.candidate!==undefined&&options.candidate!=='declared-sphere-front')throw new Error('Unsupported depth candidate operation.');
  if(options.diagnostic!==undefined&&typeof options.diagnostic!=='boolean')throw new Error('Diagnostic mode must be explicit boolean.');
  validateDepthSurfaceSource(input);
  const s = input, fit = s.calibration.fit;
  const fitInverse=fit.map(a=>1/a.depthMm);
  if(Math.max(...fitInverse)-Math.min(...fitInverse)<=1e-9)throw new Error('Fit anchors do not constrain inverse-depth range.');
  const meanX = fit.reduce((sum,a) => sum+s.samples[a.pixel]!,0)/fit.length;
  const meanY = fit.reduce((sum,a) => sum+1/a.depthMm,0)/fit.length;
  let variance = 0, covariance = 0;
  for (const a of fit) {const dx=s.samples[a.pixel]!-meanX; variance+=dx*dx; covariance+=dx*(1/a.depthMm-meanY);}
  const scale = covariance/variance, offset = meanY-scale*meanX;
  if (!(variance > 1e-14) || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(offset)) throw new Error('Inverse-depth calibration is unconstrained or reversed.');
  let depths:Float64Array = new Float64Array(s.samples.length);
  for (let i=0;i<depths.length;i++) if (s.mask[i] === 1) {
    const inverse = scale*s.samples[i]!+offset;
    if (!(inverse > 0) || !bounded(1/inverse)) throw new Error('Calibrated foreground depth is non-positive or outside mm bounds.');
    depths[i] = 1/inverse;
  }
  const validation = s.calibration.validation;
  const inv = validation.map(a => 1/a.depthMm);
  const range = Math.max(...inv)-Math.min(...inv);
  if (!(range > 1e-9)) throw new Error('Validation anchors do not constrain inverse-depth range.');
  const errors = validation.map(a => ({id:a.id,errorMm:Math.abs(depths[a.pixel]!-a.depthMm),
    normalizedError:Math.abs(scale*s.samples[a.pixel]!+offset-1/a.depthMm)/range}));
  const normalizedMae = errors.reduce((sum,a) => sum+a.normalizedError,0)/errors.length;
  const maximumNormalizedError = Math.max(...errors.map(a => a.normalizedError));
  const blockers: string[] = [];
  if (normalizedMae > .1) blockers.push('Depth validation normalized MAE exceeds .100.');
  for (const a of errors) if (a.normalizedError > .25) blockers.push(`Depth validation ${a.id} exceeds .250.`);
  const calibrationPass=blockers.length===0;
  const quality=inspectDepthQuality(s,depths);blockers.push(...quality.blockers);
  let candidate:DepthSurfaceReport['candidate'];
  const candidateMode=options.candidate??(s.preview==='declared-sphere-front'?'declared-sphere-front':undefined);
  if(candidateMode){
    if(!options.diagnostic)throw new Error('Primary-form candidates require explicit diagnostic mode.');
    depths=sphereFrontDepths(s);const candidateQuality=inspectDepthQuality(s,depths);
    const candidateErrors=[...fit,...validation].map(a=>Math.abs(depths[a.pixel]!-a.depthMm));
    const maxError=Math.max(...candidateErrors);
    // Candidate validation remains separate; failed raw reports are never replaced.
    const candidateNormalized=validation.map(a=>Math.abs(1/depths[a.pixel]!-1/a.depthMm)/range);
    const validationPass=candidateNormalized.reduce((a,b)=>a+b,0)/validation.length<=.1&&Math.max(...candidateNormalized)<=.25&&candidateQuality.pass;
    candidate={kind:'declared-sphere-front',validationPass,maximumAnchorErrorMm:maxError,quality:candidateQuality};
  }
  if (blockers.length && !options.diagnostic) throw new Error(blockers.join(' '));
  const axis = (count:number) => {const values:number[]=[];for(let n=0;n<count-1;n+=s.stride)values.push(n);values.push(count-1);return values;};
  const xs=axis(s.width),ys=axis(s.height), cells:number[][]=[];
  let skippedCells=0;
  for(let y=0;y<ys.length-1;y++)for(let x=0;x<xs.length-1;x++) {
    const x0=xs[x]!,x1=xs[x+1]!,y0=ys[y]!,y1=ys[y+1]!;
    let valid=true;
    for(let py=y0;py<=y1&&valid;py++)for(let px=x0;px<=x1;px++)if(s.mask[py*s.width+px]!==1){valid=false;break;}
    if(!valid){skippedCells++;continue;}
    cells.push([y0*s.width+x0,y0*s.width+x1,y1*s.width+x0,y1*s.width+x1]);
  }
  if(cells.length < 1 || cells.length*2 > 100_000) throw new Error('Visible surface is empty or exceeds 100000 triangles; increase stride.');
  const sourcePixels=[...new Set(cells.flat())].sort((a,b)=>a-b), lookup=new Map(sourcePixels.map((p,i)=>[p,i]));
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  const [left,right,bottom,top]=s.camera.frameMm;
  for(const pixel of sourcePixels) {
    const u=(pixel%s.width+.5)/s.width,v=(Math.floor(pixel/s.width)+.5)/s.height;
    positions.push((left+(right-left)*u)/1000,(top-(top-bottom)*v)/1000,(s.camera.cameraZMm-depths[pixel]!)/1000);
    uvs.push(u,1-v);
  }
  for(const cell of cells) {const [a,b,c,d]=cell.map(p=>lookup.get(p)!);indices.push(a!,c!,b!,b!,c!,d!);}
  // Float32 is the actual GPU/export representation; reject collapsed projected cells.
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]! * 3,b=indices[i+1]! * 3,c=indices[i+2]! * 3;
    const ax=Math.fround(positions[a]!),ay=Math.fround(positions[a+1]!);
    const area=(Math.fround(positions[b]!)-ax)*(Math.fround(positions[c+1]!)-ay)
      -(Math.fround(positions[b+1]!)-ay)*(Math.fround(positions[c]!)-ax);
    if(!Number.isFinite(area)||area<=0)throw new Error('Camera frame collapses at Float32 precision; use a local datum.');
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData.depthSource={candidate:candidateMode??null,schema:s.schema,id:s.id,imageSha256:s.imageSha256,rawFieldSha256:s.rawFieldSha256,
    representation:'inferred-open-visible-surface',releaseAllowed:false};
  return {geometry,sourcePixels,report:{schema:'morphloom.depth-surface-report/0.2',engineRevision:DEPTH_SURFACE_ENGINE_REVISION,calibrationPass,
    releaseAllowed:false,representation:'inferred-open-visible-surface',inverseDepthFit:{scale,offset},
    validation:{normalizedMae,maximumNormalizedError,errors},triangles:indices.length/3,vertices:sourcePixels.length,skippedCells,blockers,quality,...(candidate?{candidate}:{})}};
}
