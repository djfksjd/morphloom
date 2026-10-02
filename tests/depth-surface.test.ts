import {describe, it, expect} from 'vitest';
import {compileDepthSurface, type DepthSurfaceSource} from '../src/engine/depth-surface';
function source(): DepthSurfaceSource {
 const width=8,height=8, samples=Array.from({length:64},(_,i)=>1/(200+(i%8)*2+Math.floor(i/8))),mask=Array(64).fill(1);
 const anchor=(pixel:number)=>({id:`a${pixel}`,pixel,depthMm:1/samples[pixel]!});
 return {schema:'morphloom.depth-surface/0.1',id:'surface',imageSha256:'a'.repeat(64),rawFieldSha256:'b'.repeat(64),width,height,samples,mask,
 camera:{projection:'orthographic-front',units:'mm',axes:'right-handed-y-up',frameMm:[-40,40,-40,40],cameraZMm:300},
 calibration:{basis:'authored-fixture',fit:[0,7,8,15,32,63].map(anchor),validation:[2,9,25,60].map(anchor)},stride:1};
}
describe('calibrated visible depth surfaces',()=>{
 it('creates actual reciprocal mm geometry, outward normals and pixel-centre UV deterministically',()=>{
  const s=source(),a=compileDepthSurface(s),b=compileDepthSurface(s);
  try{expect(a.report.calibrationPass).toBe(true);expect(a.report.releaseAllowed).toBe(false);
   expect(a.geometry.attributes.position!.array).toEqual(b.geometry.attributes.position!.array);
   expect(a.geometry.attributes.position!.getZ(0)).toBeCloseTo(.1,6);
   expect(a.geometry.attributes.uv!.getX(0)).toBeCloseTo(.5/8,6);
   expect(a.geometry.attributes.normal!.getZ(0)).toBeGreaterThan(0);
   expect(s.samples).toEqual(source().samples);
  }finally{a.geometry.dispose();b.geometry.dispose();}
 });
 it('preserves holes and refuses any cell across a masked interior at coarse stride',()=>{
  const s=source();s.stride=3;s.mask[2*8+2]=0;
  const result=compileDepthSurface(s);
  try{const ids=result.sourcePixels;const index=result.geometry.index!;
   for(let i=0;i<index.count;i+=3){const pixels=[0,1,2].map(k=>ids[index.getX(i+k)]!);const xs=pixels.map(p=>p%8),ys=pixels.map(p=>Math.floor(p/8));
    expect(Math.min(...xs)<=2&&Math.max(...xs)>=2&&Math.min(...ys)<=2&&Math.max(...ys)>=2).toBe(false);
   }
  }finally{result.geometry.dispose();}
 });
 it('blocks a critical validation failure instead of hiding it in an average',()=>{
  const s=source();s.calibration.validation[0]!.depthMm=100;
  expect(()=>compileDepthSurface(s)).toThrow(/validation/);
  const diagnostic=compileDepthSurface(s,{diagnostic:true});try{expect(diagnostic.report.calibrationPass).toBe(false);expect(diagnostic.report.releaseAllowed).toBe(false);}finally{diagnostic.geometry.dispose();}
 });
 it('rejects unconstrained fit depths and float32-collapsed frames',()=>{
  const flat=source();for(const a of flat.calibration.fit)a.depthMm=200;
  expect(()=>compileDepthSurface(flat)).toThrow(/unconstrained|range/);
  const collapsed=source();collapsed.camera.frameMm=[999999.999,1000000,-40,40];
  expect(()=>compileDepthSurface(collapsed)).toThrow(/precision/);
 });
 it('rejects missing camera, invalid mask, duplicate/colliding anchors and reversed proxy',()=>{
  for(const mutate of [s=>{s.camera.units='m' as 'mm';},s=>{s.mask[2]=2;},s=>{s.calibration.validation[0]!.pixel=0;},s=>{s.samples=s.samples.map(v=>-v);} ] as Array<(s:DepthSurfaceSource)=>void>){const s=source();mutate(s);expect(()=>compileDepthSurface(s)).toThrow();}
 });
});
