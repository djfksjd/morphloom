// Actual glTF primitives can split one stable component along material boundaries.
// Audit both raw primitives and the explicitly named component union; never join unrelated parts.
(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
 const {analyzeTopology}=await import('/src/engine/topology.ts');
 const {inspectExportedUv}=await import('/src/engine/uv-delivery.ts');
 const rows=[];
 for(const name of ['positive','negative','edited','half-positive','half-negative']){
  const bytes=await(await fetch(document.getElementById('product-photo-'+name).href)).arrayBuffer();
  const uv=await inspectExportedUv(bytes,'actual-glb-diagnostic');for(const m of uv.report.meshes)delete m.triangles;
  const {scene}=await new GLTFLoader().parseAsync(bytes,''),root=new THREE.Group(),owners=new Map(),identities=new Map();scene.updateMatrixWorld(true);
  const rawPrimitiveTopology=analyzeTopology(scene),point=new THREE.Vector3();
  try{
   scene.traverse(o=>{if(!o.isMesh)return;let owner=o;while(owner&&!owner.userData.morphloomStableNodeId)owner=owner.parent;
    if(!owner)throw new Error('GLB mesh lacks explicit stable component owner');const id=owner.userData.morphloomStableNodeId;
    if(identities.has(id)&&identities.get(id)!==owner)throw new Error('Duplicate stable component owner '+id);identities.set(id,owner);
    if(!owners.has(owner))owners.set(owner,{values:[],template:o});const values=owners.get(owner).values,p=o.geometry.getAttribute('position'),indices=o.geometry.index;
    for(let i=0;i<(indices?.count??p.count);i++){point.fromBufferAttribute(p,indices?indices.getX(i):i).applyMatrix4(o.matrixWorld).multiplyScalar(1000);values.push(point.x,point.y,point.z);}
   });
   for(const [owner,{values,template}]of owners){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(values,3));const mesh=template.clone(false);mesh.geometry=g;mesh.name=owner.userData.morphloomStableNodeId;root.add(mesh);}
   const componentUnionTopology=analyzeTopology(root);if(!componentUnionTopology.pass||!uv.report.integrityPass)throw new Error(name+': actual component/UV integrity blocked');
   rows.push({name,units:'mm',componentUnionPolicy:'explicit stable owner only; no cross-component welding; existing topology tolerance unchanged',uv,rawPrimitiveTopology,componentUnionTopology});
  }finally{
   const geometries=new Set(),materials=new Set(),textures=new Set();for(const r of [scene,root])r.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});for(const g of geometries)g.dispose();for(const t of textures)t.dispose();for(const m of materials)m.dispose();
  }
 }
 return {schema:'morphloom.product-photo-file-audit/0.1',rows};
})()
