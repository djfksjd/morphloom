"""Actual edit/reopen audit for one diagnostic open depth mesh, no source overwrite."""
import bpy, hashlib, json, sys
from pathlib import Path
from collections import Counter

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(p))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if len(meshes)!=1:raise RuntimeError('Expected one visible-depth mesh')
    return meshes[0]
def snapshot(obj):
    uv=obj.data.uv_layers.active
    if uv is None:raise RuntimeError('Source UV missing')
    positions=Counter(tuple(round(v,8) for v in vert.co) for vert in obj.data.vertices)
    uvs=Counter(tuple(round(v,7) for v in loop.uv) for loop in uv.data)
    hierarchy=sorted((o.name,o.parent.name if o.parent else None) for o in bpy.context.scene.objects)
    return positions,uvs,hierarchy,[m.name for m in obj.data.materials],dict(obj.get('depthSource',{}))
def export(p):
    bpy.ops.export_scene.gltf(filepath=str(p),export_format='GLB',export_yup=True,export_extras=True,export_tangents=False)
args=sys.argv[sys.argv.index('--')+1:]
if len(args)!=2:raise RuntimeError('Usage: source.glb output-directory')
source=Path(args[0]).resolve();out=Path(args[1]).resolve();out.mkdir(parents=True,exist_ok=True)
if any((out/n).exists() for n in ['edited.glb','restored.glb','audit.json']):raise RuntimeError('Choose an empty audit output')
original_sha=digest(source);obj=load(source);before=snapshot(obj);vertex=obj.data.vertices[0];original=tuple(vertex.co);vertex.co.x+=.001;obj.data.update();edited=snapshot(obj)
if edited[0]==before[0] or edited[1:]!=before[1:]:raise RuntimeError('Edit did not change only the requested position')
export(out/'edited.glb');reopened=snapshot(load(out/'edited.glb'))
if reopened!=edited:raise RuntimeError('Edited actual GLB did not preserve UV/name/hierarchy/metadata/positions')
obj=load(source);obj.data.vertices[0].co.x+=.001;obj.data.vertices[0].co=original;obj.data.update();export(out/'restored.glb')
if snapshot(load(out/'restored.glb'))!=before:raise RuntimeError('Undo/reopen did not preserve original mesh')
if digest(source)!=original_sha:raise RuntimeError('Original file changed')
report={'schema':'morphloom.blender-depth-edit/0.1','status':'pass','blenderVersion':bpy.app.version_string,'sourceSha256':original_sha,'editedSha256':digest(out/'edited.glb'),'restoredSha256':digest(out/'restored.glb'),'editMm':1,'preserved':['UV','naming','hierarchy','materials','source lineage extras'],'purpose':'diagnostic-open-surface','releaseAllowed':False}
(out/'audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
