import {it,expect} from 'vitest';
import {compileAssemblyGeometry} from '../src/engine/assembly-compiler';
it('does not flip diagonal sidewall UV axes for doubles that produce identical delivered vertices',()=>{
 const make=(j:number)=>compileAssemblyGeometry({op:'extrude',points:[[2.0686215721070766,2.1727413404732943],[2.1727413404732943,2.0686215721070766+j],[4,4],[0,4]],depth:8});
 const a=make(-1e-12),b=make(1e-12);
 try{expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));expect(Array.from(a.getAttribute('uv').array)).toEqual(Array.from(b.getAttribute('uv').array));}finally{a.dispose();b.dispose();}
});
