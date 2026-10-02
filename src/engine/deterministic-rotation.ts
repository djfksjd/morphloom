import {Quaternion} from 'three';
export const DETERMINISTIC_ROTATION_REVISION='morphloom.deterministic-rotation/0.1';
const SIN=[-1/6,1/120,-1/5040,1/362880,-1/39916800,1/6227020800,-1/1307674368000,1/355687428096000,-1/121645100408832000,1/51090942171709440000];
const COS=[-1/2,1/24,-1/720,1/40320,-1/3628800,1/479001600,-1/87178291200,1/20922789888000,-1/6402373705728000,1/2432902008176640000];
/** Explicit IEEE arithmetic, limited range. Avoid runtime-dependent transcendental sin/cos. */
export function deterministicHalfSinCos(halfAngle:number):[number,number]{
 if(!Number.isFinite(halfAngle)||Math.abs(halfAngle)>2*Math.PI)throw new Error('deterministic-half-angle-range: +/-2pi');
 let x=halfAngle;if(x>Math.PI)x-=2*Math.PI;else if(x< -Math.PI)x+=2*Math.PI;
 let sign=1;if(x>Math.PI/2){x=Math.PI-x;sign=-1;}else if(x< -Math.PI/2){x=-Math.PI-x;sign=-1;}
 const square=x*x;let s=SIN[SIN.length-1],c=COS[COS.length-1];
 for(let i=SIN.length-2;i>=0;i--)s=SIN[i]+square*s;
 for(let i=COS.length-2;i>=0;i--)c=COS[i]+square*c;
 return [x*(1+square*s),sign*(1+square*c)];
}
/** Source Euler angles are +/-2pi; resolved group fan rotations can reach +/-4pi. */
export function deterministicEulerXYZ(angles:readonly number[]):Quaternion{
 if(angles.length!==3||angles.some(a=>!Number.isFinite(a)||Math.abs(a)>4*Math.PI))throw new Error('deterministic-euler-range: three finite angles +/-4pi');
 const [s1,c1]=deterministicHalfSinCos(angles[0]/2),[s2,c2]=deterministicHalfSinCos(angles[1]/2),[s3,c3]=deterministicHalfSinCos(angles[2]/2);
 return new Quaternion(s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3).normalize();
}
