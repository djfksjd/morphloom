// Run locally with agent-browser eval --stdin while Vite serves the repository.
// Original photographs stay local; this script makes actual GLB bytes for DCC auditing.
(async () => {
  const {compileAssemblyIR,waitForReferenceProjections}=await import('/src/engine/assembly-compiler.ts');
  const {snapshotScene,compareGlbRoundTrip}=await import('/src/engine/delivery-validation.ts');
  const {preparePortableGltfGeometry}=await import('/src/engine/gltf-export-preparation.ts');
  const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
  const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const read=async name=>{const response=await fetch('/outputs/product-photo-20261003/'+name+'.assembly.json');require(response.ok,'Missing fixture '+name);return response.json();};
  const positive=await read('fan-positive'),negative=await read('ui-corrected'),edited=await read('ui-edited');
  const half=ir=>{const next=structuredClone(ir);for(const c of next.components){c.position=(c.position??[0,0,0]).map(n=>n*.5);c.scale=(c.scale??[1,1,1]).map(n=>n*.5);if(c.material.referenceProjection)c.material.referenceProjection.boundsMm=c.material.referenceProjection.boundsMm.map(n=>n*.5);}return next;};
  const rows=[],snapshots=new Map(),resources=[];
  try {
    for(const [name,ir] of [['positive',positive],['negative',negative],['edited',edited],['half-positive',half(positive)],['half-negative',half(negative)]]){
      const native=JSON.stringify(ir),inputSha256=await sha(new TextEncoder().encode(native)),start=performance.now(),build=compileAssemblyIR(ir,'beauty'),compileMs=performance.now()-start;
      resources.push(build.root);require(compileMs<2000,'Compile budget exceeded');await waitForReferenceProjections(build.root);const preparation=preparePortableGltfGeometry(build.root);require(!preparation.unresolvedNormalMappedMeshes.length,'Missing tangent basis');
      const source=snapshotScene(build.root);require(source.triangles<=120000&&source.textureBytes<=16*1024*1024,'Geometry/texture budget exceeded');
      const bytes=await new GLTFExporter().parseAsync(build.root,{binary:true,includeCustomExtensions:true});require(bytes.byteLength<=20*1024*1024,'GLB budget exceeded');
      const loaded=await new GLTFLoader().parseAsync(bytes,'');resources.push(loaded.scene);const reopened=snapshotScene(loaded.scene),audit=compareGlbRoundTrip(source,reopened,bytes.byteLength,performance.now()-start);
      require(audit.status==='pass',name+': '+audit.blockers.join('; '));require(JSON.stringify(ir)===native,'Input mutated');snapshots.set(name,source);
      const link=document.createElement('a');link.id='product-photo-'+name;link.textContent='Download diagnostic '+name;link.download=name+'.glb';link.href=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'}));document.body.append(link);
      rows.push({name,inputSha256,outputSha256:await sha(bytes),compileMs,glbBytes:bytes.byteLength,triangles:source.triangles,textureBytes:source.textureBytes,preparation,audit});
    }
    for(const [before,after]of [['positive','negative'],['negative','edited'],['half-positive','half-negative']]){
      const a=snapshots.get(before),b=snapshots.get(after);const unchanged=a.meshPayloads.filter(m=>m.id!=='front-hub-cap').every(m=>{const n=b.meshPayloads.find(n=>n.id===m.id);return n&&JSON.stringify(m)===JSON.stringify(n);});require(unchanged,'Unrelated mesh changed '+before+' → '+after);
    }
    return {schema:'morphloom.product-photo-evidence/0.1',nonTargetMeshPreservation:true,releaseAllowed:false,scope:'photo-facing and editable visualization; dimensions/camera/material appearance estimated',rows};
  } finally {
    const geometries=new Set(),materials=new Set(),textures=new Set();for(const root of resources)root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});for(const g of geometries)g.dispose();for(const t of textures)t.dispose();for(const m of materials)m.dispose();
  }
})()
