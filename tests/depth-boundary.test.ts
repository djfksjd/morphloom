import {inspectDepthQuality,sphereFrontDepths,sphereFrontConstraintFromAssembly} from '../src/engine/depth-boundary';
import {describe,it,expect} from 'vitest';
import {compileDepthSurface,migrateDepthSurface,type DepthSurfaceSource} from '../src/engine/depth-surface';
function source():DepthSurfaceSource{
 const samples=Array.from({length:64},(_,i)=>1/(200+i)), anchor=(p:number)=>({id:`p${p}`,pixel:p,depthMm:200+p});
 return {schema:'morphloom.depth-surface/0.1',id:'surface',imageSha256:'a'.repeat(64),rawFieldSha256:'b'.repeat(64),width:8,height:8,samples,mask:Array(64).fill(1),camera:{projection:'orthographic-front',units:'mm',axes:'right-handed-y-up',frameMm:[-40,40,-40,40],cameraZMm:300},calibration:{basis:'authored-fixture',fit:[0,7,16,24,32,63].map(anchor),validation:[2,9,25,60].map(anchor)},stride:1};
}
function declared(){const s=migrateDepthSurface(source());s.quality={depthEnvelope:{status:'declared',nearMm:200,farMm:263,toleranceMm:.001,basis:'authored-fixture'},boundary:{status:'declared',bandPixels:1,toleranceMm:.001,basis:'authored-fixture',anchors:[1,6,56,62].map(p=>({id:`edge${p}`,pixel:p,depthMm:200+p}))}};return s;}
describe('independent depth boundary quality',()=>{
 it('migrates losslessly to unknown contracts and refuses silent approval',()=>{const before=source(),s=migrateDepthSurface(before);expect(s.schema).toBe('morphloom.depth-surface/0.2');expect(s.samples).toEqual(before.samples);expect(s.samples).not.toBe(before.samples);expect(()=>compileDepthSurface(s)).toThrow(/unknown/);});
 it('blocks a single foreground spike outside envelope even when mean anchors pass',()=>{const s=declared();s.samples[5]=1/400;expect(()=>compileDepthSurface(s)).toThrow(/envelope/);const c=compileDepthSurface(s,{diagnostic:true});try{expect(c.report.quality.envelope.violations).toBe(1);expect(c.report.calibrationPass).toBe(true);}finally{c.geometry.dispose();}});
 it('blocks a single independent boundary error and rejects interior/colliding anchors',()=>{const s=declared();s.quality.boundary.status==='declared'&&(s.quality.boundary.anchors[0]!.depthMm+=1);expect(()=>compileDepthSurface(s)).toThrow(/boundary/);
  for(const pixel of [0,18]){const n=declared();if(n.quality.boundary.status==='declared')n.quality.boundary.anchors[0]!.pixel=pixel;expect(()=>compileDepthSurface(n)).toThrow();}
 });
 it('rejects incomplete/non-finite helper fields and opposing sphere fit residuals',()=>{
  const s=declared();expect(()=>inspectDepthQuality(s,new Float64Array(63))).toThrow(/cover/);
  const depths=new Float64Array(s.samples.map(v=>1/v));depths[5]=NaN;expect(()=>inspectDepthQuality(s,depths)).toThrow(/pixel 5/);
  const sphere=declared();sphere.primaryForm=sphereFrontConstraintFromAssembly({op:'sphere',radius:50},[0,0,0],'authored-fixture',.001);
  const truth=(p:number)=>300-Math.sqrt(2500-(-40+(p%8+.5)*10)**2-(40-(Math.floor(p/8)+.5)*10)**2);
  for(const a of sphere.calibration.fit)a.depthMm=truth(a.pixel);
  sphere.calibration.fit[0]!.depthMm+=10;sphere.calibration.fit[1]!.depthMm-=10;
  expect(()=>sphereFrontDepths(sphere)).toThrow(/fit anchor/);
  expect(()=>sphereFrontConstraintFromAssembly({op:'torus',radius:50,tube:10},[0,0,0],'authored-fixture',.001)).toThrow();
 });
 it('preserves geometry UV and indices when only the verified contract is added',()=>{const a=compileDepthSurface(source()),b=compileDepthSurface(declared());try{expect(b.report.quality.pass).toBe(true);expect(a.geometry.attributes.position!.array).toEqual(b.geometry.attributes.position!.array);expect(a.geometry.attributes.uv!.array).toEqual(b.geometry.attributes.uv!.array);expect(a.geometry.index!.array).toEqual(b.geometry.index!.array);}finally{a.geometry.dispose();b.geometry.dispose();}});
});
