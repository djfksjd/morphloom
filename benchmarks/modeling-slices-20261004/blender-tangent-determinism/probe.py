import bpy,sys,json,hashlib,numpy as np
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:];source=Path(args[0]);root=Path(args[1]);root.mkdir();snapshots=[]
for iteration in range(2):
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source),import_shading='NORMALS',merge_vertices=False);rows={}
 for mesh in bpy.data.meshes:
  if not mesh.uv_layers:continue
  mesh.calc_tangents();t=np.empty(len(mesh.loops)*3,dtype=np.float32);mesh.loops.foreach_get('tangent',t);n=np.empty(len(mesh.loops)*3,dtype=np.float32);mesh.corner_normals.foreach_get('vector',n);uv=np.empty(len(mesh.loops)*2,dtype=np.float32);mesh.uv_layers.active.data.foreach_get('uv',uv);p=np.empty(len(mesh.vertices)*3,dtype=np.float32);mesh.vertices.foreach_get('co',p);indices=np.empty(len(mesh.loops),dtype=np.int32);mesh.loops.foreach_get('vertex_index',indices);sign=np.empty(len(mesh.loops),dtype=np.float32);mesh.loops.foreach_get('bitangent_sign',sign)
  rows[mesh.name]={'tangent':t.copy(),'normal':n.copy(),'uv':uv.copy(),'position':p.copy(),'index':indices.copy(),'sign':sign.copy()};np.savez(root/(str(iteration)+'-'+mesh.name+'.npz'),**rows[mesh.name]);mesh.free_tangents()
 snapshots.append(rows)
summary=[]
for name,a in snapshots[0].items():
 b=snapshots[1][name];summary.append({'mesh':name,'attributes':{key:{'exact':x.tobytes()==b[key].tobytes(),'differingValues':int(np.count_nonzero(x!=b[key])),'maxAbsDiff':float(np.max(np.abs(x-b[key])))if len(x)else 0}for key,x in a.items()}})
(root/'summary.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'blenderVersion':bpy.app.version_string,'threads':bpy.context.scene.render.threads,'rows':summary},indent=2)+'\n');print(json.dumps(summary))
