import {DataTexture,RGBAFormat,UnsignedByteType,RepeatWrapping,SRGBColorSpace,Mesh,MeshStandardMaterial,Object3D} from 'three';
/** Synthetic diagnostic only; caller restores before disposing the owned source scene. */
export function attachUvChecker(root:Object3D):()=>void{
 const pixels=new Uint8Array(64*64*4);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const shade=((x>>3)+(y>>3))%2?220:40,i=(y*64+x)*4;pixels.set([shade,shade,shade,255],i);
 }
 const texture=new DataTexture(pixels,64,64,RGBAFormat,UnsignedByteType);texture.colorSpace=SRGBColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;texture.needsUpdate=true;
 const material=new MeshStandardMaterial({map:texture,color:0xffffff,roughness:1,metalness:0});
 material.name='Synthetic UV checker · 8 cells per UV tile';
 const originals:Array<{mesh:Mesh;material:Mesh['material']}>=[];
 root.traverse(o=>{if(o instanceof Mesh&&o.geometry.getAttribute('uv')){originals.push({mesh:o,material:o.material});o.material=material;}});
 let disposed=false;return()=>{if(disposed)return;disposed=true;for(const o of originals)o.mesh.material=o.material;material.dispose();texture.dispose();};
}
