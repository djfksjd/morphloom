import {expect,it} from 'vitest';
import {deterministicCornerAngle} from '../src/engine/deterministic-corner-angle';
it('covers acute, obtuse, axis and reduction boundaries without quantizing angles',()=>{
 for(let i=0;i<=2048;i++){const angle=i*Math.PI/2048,y=Math.sin(angle),x=Math.cos(angle);expect(Math.abs(deterministicCornerAngle(y,x)-Math.atan2(y,x))).toBeLessThan(2e-15);}
 expect(deterministicCornerAngle(0,-1)).toBe(Math.PI);expect(deterministicCornerAngle(1,0)).toBe(Math.PI/2);
 expect(deterministicCornerAngle(1e-17,1)).toBe(1e-17);
});
it('rejects invalid angle domains',()=>{for(const [y,x] of [[-1,0],[0,0],[NaN,1],[1,Infinity]])expect(()=>deterministicCornerAngle(y,x)).toThrow();});
