// Run locally with agent-browser eval --stdin while Vite serves the repository.
// Original photographs stay local; this script makes actual GLB bytes for DCC auditing.
(async () => {
  for(const name of ['flat','domed','half-domed','alternate']){for(const old of document.querySelectorAll('[id="product-photo-'+name+'"]')){URL.revokeObjectURL(old.href);old.remove();}}
  const {compileAssemblyIR,waitForReferenceProjections}=await import('/src/engine/assembly-compiler.ts');
  const {snapshotScene,compareGlbRoundTrip}=await import('/src/engine/delivery-validation.ts');
  const {preparePortableGltfGeometry}=await import('/src/engine/gltf-export-preparation.ts');
  const {GLTFExporter}=await import('/node_modules/.vite/deps/three_addons_exporters_GLTFExporter__js.js');
  const {GLTFLoader}=await import('/node_modules/.vite/deps/three_addons_loaders_GLTFLoader__js.js');
  const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const read=async name=>{const response=await fetch('/outputs/guard-profile-20261003/'+name+'.assembly.json');require(response.ok,'Missing fixture '+name);return response.json();};
  const flat=await read('flat'),domed=await read('domed'),halfDomed=await read('half-domed'),alternate=await read('alternate');
  const rows=[],snapshots=new Map(),resources=[],links=[];let complete=false;
  try {
    for(const [name,ir] of [['flat',flat],['domed',domed],['half-domed',halfDomed],['alternate',alternate]]){
      const native=JSON.stringify(ir),inputSha256=await sha(new TextEncoder().encode(native)),start=performance.now(),build=compileAssemblyIR(ir,'beauty'),compileMs=performance.now()-start;
      resources.push(build.root);require(compileMs<2000,'Compile budget exceeded');await waitForReferenceProjections(build.root);const preparation=preparePortableGltfGeometry(build.root);require(!preparation.unresolvedNormalMappedMeshes.length,'Missing tangent basis');
      const source=snapshotScene(build.root);require(source.triangles<=120000&&source.textureBytes<=16*1024*1024,'Geometry/texture budget exceeded');
      const bytes=await new GLTFExporter().parseAsync(build.root,{binary:true,includeCustomExtensions:true});require(bytes.byteLength<=20*1024*1024,'GLB budget exceeded');
      const loaded=await new GLTFLoader().parseAsync(bytes,'');resources.push(loaded.scene);const reopened=snapshotScene(loaded.scene),audit=compareGlbRoundTrip(source,reopened,bytes.byteLength,performance.now()-start);
      require(audit.status==='pass',name+': '+audit.blockers.join('; '));require(JSON.stringify(ir)===native,'Input mutated');snapshots.set(name,source);
      const link=document.createElement('a');link.id='product-photo-'+name;link.textContent='Download diagnostic '+name;link.download=name+'.glb';link.href=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'}));links.push(link);document.body.append(link);
      rows.push({name,inputSha256,outputSha256:await sha(bytes),compileMs,glbBytes:bytes.byteLength,triangles:source.triangles,textureBytes:source.textureBytes,preparation,audit});
    }
    const targets=new Set([...Array.from({length:18},(_,i)=>'cage-front-ring-'+(i+1)),...Array.from({length:12},(_,i)=>'cage-front-spoke-'+(i+1)),'front-hub-cap']);
    const a=snapshots.get('flat'),b=snapshots.get('domed');require(a.meshPayloads.filter(m=>!targets.has(m.id)).every(m=>{const n=b.meshPayloads.find(n=>n.id===m.id);return n&&JSON.stringify(m)===JSON.stringify(n);}), 'Unrelated actual mesh changed');
    complete=true;
    return {schema:'morphloom.guard-profile-browser/0.1',nonTargetMeshPreservation:true,releaseAllowed:false,scope:'quadratic wire profile; rise/camera/dimensions estimated; source fidelity not verified',rows};
  } finally {
    if(!complete)for(const link of links){URL.revokeObjectURL(link.href);link.remove();}
    const geometries=new Set(),materials=new Set(),textures=new Set();for(const root of resources)root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});for(const g of geometries)g.dispose();for(const t of textures)t.dispose();for(const m of materials)m.dispose();
  }
})()
