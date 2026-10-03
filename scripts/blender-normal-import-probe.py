"""Actual first-import corner normal samples in declared glTF Y-up world coordinates."""
import bpy,json,hashlib,sys,struct
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:];assert len(args) in [3,4],'source.glb stable-mesh-id new-output.json [NORMALS|FLAT|SMOOTH]'
mode=args[3]if len(args)==4 else 'NORMALS';assert mode in ['NORMALS','FLAT','SMOOTH']
source,selected,output=args[:3];file=Path(source);assert file.is_file() and file.stat().st_size<=256000000;assert not Path(output).exists()
bpy.ops.wm.read_factory_settings(use_empty=True)
raw=file.read_bytes();assert len(raw)>=28 and raw[:4]==b'glTF' and struct.unpack_from('<II',raw,4)==(2,len(raw))
length,kind=struct.unpack_from('<II',raw,12);assert kind==0x4e4f534a and length<=16000000 and 20+length<=len(raw)
document=json.loads(raw[20:20+length]);assert not any(v.get('uri') for v in document.get('buffers',[])+document.get('images',[])),'Embedded source only'
assert not document.get('animations') and len(document.get('nodes',[]))<=10000 and len(document.get('meshes',[]))<=128,'Static scene budget'
assert not any('skin'in n for n in document.get('nodes',[])) and not any(p.get('targets')for m in document.get('meshes',[])for p in m['primitives']),'Skin/morph unsupported'
bpy.ops.import_scene.gltf(filepath=str(file.resolve()),import_shading=mode)
obj=bpy.context.scene.objects.get(selected);assert obj is not None and obj.type=='MESH';mesh=obj.data;assert len(mesh.loops)<=200000
matrix=obj.matrix_world;normal_matrix=matrix.to_3x3().inverted().transposed();rows=set()
for polygon in mesh.polygons:
 for i in polygon.loop_indices:
  p=matrix@mesh.vertices[mesh.loops[i].vertex_index].co;n=(normal_matrix@mesh.corner_normals[i].vector).normalized()
  rows.add(tuple(float(v)for v in [p.x,p.z,-p.y,n.x,n.z,-n.y]))
report={'schema':'morphloom.blender-import-normal-probe/0.2'if len(args)==4 else'morphloom.blender-import-normal-probe/0.1','importShading':mode,'importPolicy':mode,'sourceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'blenderVersion':bpy.app.version_string,'stableMeshId':selected,'corners':len(mesh.loops),'uniqueSamples':len(rows),'hasCustomNormals':mesh.has_custom_normals,'coordinates':'glTF right-handed Y-up world; inverse Blender Z-up basis; meters','samples':[list(row)for row in sorted(rows)]};Path(output).parent.mkdir(parents=True,exist_ok=True);Path(output).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='samples'}))
