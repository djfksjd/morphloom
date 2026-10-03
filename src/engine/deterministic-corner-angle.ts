/** Corner angles use y=|u x v| >= 0 and x=u.v. Explicit IEEE arithmetic
 * avoids runtime-dependent atan2 last bits in weighted-normal cancellation.
 * Reduced Taylor argument is bounded by tan(pi/8); no output quantization.
 */
export function deterministicCornerAngle(y:number,x:number):number {
  if(!Number.isFinite(y)||!Number.isFinite(x)||y<0||y===0&&x===0)throw new Error('Invalid corner angle inputs');
  if(x===0)return Math.PI/2;
  let t=y/Math.abs(x),inverted=t>1;
  if(inverted)t=1/t;
  const reduced=t>Math.SQRT2-1;
  if(reduced)t=(t-1)/(t+1);
  const square=t*t;
  let sum=1/49;
  for(let k=23;k>=0;k--)sum=(k%2===0?1:-1)/(2*k+1)+square*sum;
  let angle=t*sum;
  if(reduced)angle+=Math.PI/4;
  if(inverted)angle=Math.PI/2-angle;
  return x<0?Math.PI-angle:angle;
}
