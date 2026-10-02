import type {BufferGeometry} from 'three';
import type {DepthSurfaceSource} from './depth-surface';
/** Actual Float32 triangle interpolation at original image pixel centres. */
export function sampleDepthMesh(s:DepthSurfaceSource,geometry:BufferGeometry):{depths:Float64Array;missingForegroundPixels:number} {
 if(s.width<2||s.height<2||s.width>256||s.height>256||s.mask.length!==s.width*s.height||!geometry.index||geometry.index.count%3||geometry.index.count/3>100000)throw new Error('Depth mesh sampling input budget is invalid.');
 let pixelTests=0;
 const p=geometry.attributes.position!.array,idx=geometry.index!.array,depths=new Float64Array(s.samples.length).fill(NaN),[left,right,bottom,top]=s.camera.frameMm;
 for(let i=0;i<idx.length;i+=3){const vertices=[idx[i]!,idx[i+1]!,idx[i+2]!].map(v=>[(p[v*3]!*1000-left)/(right-left)*s.width-.5,(top-p[v*3+1]!*1000)/(top-bottom)*s.height-.5,p[v*3+2]!*1000]);const [a,b,c]=vertices;const denominator=(b![1]!-c![1]!)*(a![0]!-c![0]!)+(c![0]!-b![0]!)*(a![1]!-c![1]!);if(Math.abs(denominator)<1e-15)continue;
  const x0=Math.max(0,Math.ceil(Math.min(...vertices.map(v=>v[0]!)))),x1=Math.min(s.width-1,Math.floor(Math.max(...vertices.map(v=>v[0]!)))),y0=Math.max(0,Math.ceil(Math.min(...vertices.map(v=>v[1]!)))),y1=Math.min(s.height-1,Math.floor(Math.max(...vertices.map(v=>v[1]!))));
  pixelTests+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);if(pixelTests>2000000)throw new Error('Depth mesh raster sampling exceeds2000000 pixel tests.');
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const u=((b![1]!-c![1]!)*(x-c![0]!)+(c![0]!-b![0]!)*(y-c![1]!))/denominator,v=((c![1]!-a![1]!)*(x-c![0]!)+(a![0]!-c![0]!)*(y-c![1]!))/denominator,w=1-u-v;if(Math.min(u,v,w)<-1e-9)continue;const depth=s.camera.cameraZMm-(u*a![2]!+v*b![2]!+w*c![2]!);const pixel=y*s.width+x;if(!Number.isFinite(depths[pixel])||depth<depths[pixel]!)depths[pixel]=depth;
  }
 }
 const missingForegroundPixels=s.mask.reduce((n,m,i)=>n+(m===1&&!Number.isFinite(depths[i])?1:0),0);
 return {depths,missingForegroundPixels};
}
