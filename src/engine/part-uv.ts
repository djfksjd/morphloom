import {BufferGeometry,Float32BufferAttribute} from 'three';
/** Owned geometry only. Validate and stage all coordinates before committing the operation. */
export function applyPartUvScale(g:BufferGeometry,scale?:number):BufferGeometry{
 if(scale===undefined)return g;
 if(!Number.isFinite(scale)||scale<.001||scale>1000)throw new Error('uv-scale-range: 0.001..1000');
 const uv=g.getAttribute('uv'),p=g.getAttribute('position');
 if(!uv||!p||uv.itemSize!==2||uv.count!==p.count)throw new Error('uv-scale-attribute: matching UV required');
 const values=new Float32Array(uv.count*2);
 for(let i=0;i<uv.count;i++)for(let j=0;j<2;j++){
  const v=j===0?uv.getX(i):uv.getY(i);const n=Math.fround(v*scale);
  if(!Number.isFinite(v)||!Number.isFinite(n))throw new Error('uv-scale-nonfinite');values[i*2+j]=n;
 }
 if(scale!==1)g.setAttribute('uv',new Float32BufferAttribute(values,2));return g;
}
