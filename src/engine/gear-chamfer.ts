import {Mesh,MeshBasicMaterial,type BufferGeometry} from 'three';
import {validateSpurGear,gearDimensions,type SpurGearGeometry} from './spur-gear';
import {compileDerivedGearGeometry} from './assembly-compiler';import {analyzeTopology} from './topology';
export function gearChamferMaximum(g:SpurGearGeometry):number{
 validateSpurGear(g);const wall=(gearDimensions(g).rootDiameterMm-g.boreDiameterMm)/2;
 return wall<g.moduleMm*.25?0:Math.min(g.moduleMm*.05,g.faceWidthMm*.1,wall*.1);
}
export function validateGearChamferAmount(g:SpurGearGeometry,value:unknown):asserts value is number{
 const maximum=gearChamferMaximum(g);
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||(value!==0&&(value<.001||value>maximum)))throw new Error(`gear-chamfer-range: 0 or 0.001..${maximum} mm; root radial wall >= 0.25 module required`);
}
/** Inset contour at caps, original contour at middle; centered final width stays authored. */
export function compileGearChamfer(g:SpurGearGeometry,amount:number):BufferGeometry{
 validateGearChamferAmount(g,amount);const geometry=compileDerivedGearGeometry(g,amount);if(amount===0)return geometry;
 const material=new MeshBasicMaterial();
 try{
  if(geometry.getAttribute('position').count/3>100000)throw new Error('gear-chamfer-triangle-budget');
  const report=analyzeTopology(new Mesh(geometry,material));if(!report.pass)throw new Error(`gear-chamfer-topology: degenerate=${report.degenerateTriangles}, non-manifold=${report.nonManifoldEdges}, intersections=${report.selfIntersections}, complete=${report.selfIntersectionComplete}`);
  return geometry;
 }catch(error){geometry.dispose();throw error;}finally{material.dispose();}
}
