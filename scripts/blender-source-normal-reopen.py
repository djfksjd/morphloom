"""Actual .blend reopen and separately recorded GLB export; no default-import repair claim."""
import bpy,sys,json,math,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_source_normal_import import _source_spec
args=sys.argv[sys.argv.index('--')+1:];assert len(args)==2,'profile directory native browser-flow manifest';root=Path(args[0]);manifest=Path(args[1]);rows=[]
for row in json.loads(manifest.read_text())['rows']:
 name=row['id'];receipt=json.loads((root/(name+'.receipt.json')).read_text());blend=root/(name+'.blend');assert hashlib.sha256(blend.read_bytes()).hexdigest()==receipt['blendSha256'];assert hashlib.sha256(Path(row['regenerated']).read_bytes()).hexdigest()==receipt['sourceSha256'];assert receipt['currentEditableIRAvailable'] is False and receipt['sourceSpecState']=='before-edit-reference';specs,_=_source_spec(row['regenerated']);bpy.ops.wm.open_mainfile(filepath=str(blend));assert len(bpy.data.meshes)==len(specs);assert not any('sourceSpec' in obj for obj in bpy.context.scene.objects);results=[]
 for mesh in bpy.data.meshes:
  positions,normals,indices=specs[mesh.name];assert len(mesh.vertices)==len(positions);assert [l.vertex_index for l in mesh.loops]==indices;assert all(tuple(v.co)==p for v,p in zip(mesh.vertices,positions));assert mesh.attributes['custom_normal'].data_type=='FLOAT_VECTOR';worst=0
  for loop in mesh.loops:
   a=mesh.corner_normals[loop.index].vector;e=normals[loop.vertex_index];dot=sum(float(x)*y for x,y in zip(a,e));length=math.sqrt(sum(float(x)*float(x)for x in a)*sum(y*y for y in e));worst=max(worst,math.degrees(math.acos(max(-1,min(1,dot/length)))))
  assert worst<=.01;results.append({'mesh':mesh.name,'maxNormalErrorDeg':worst,'pass':True})
 exported=root/(name+'.reexport.glb');assert not exported.exists();bpy.ops.export_scene.gltf(filepath=str(exported),export_format='GLB',export_normals=True,export_yup=True)
 rows.append({'id':name,'blendReopen':{'pass':True,'meshes':results},'source':row['regenerated'],'exported':str(exported),'exportSha256':hashlib.sha256(exported.read_bytes()).hexdigest()});print('PASS .blend reopen/export',name,flush=True)
(root/'reopen.json').write_text(json.dumps(rows,indent=2)+'\n')
