"""Isolate Blender's custom-normal setter using the exact GLB accessors; no mesh repair."""
import bpy,json,math,sys,hashlib
from pathlib import Path
from mathutils import Vector
from io_scene_gltf2.io.imp.gltf2_io_gltf import glTFImporter
from io_scene_gltf2.io.imp.gltf2_io_binary import BinaryData
args=sys.argv[sys.argv.index('--')+1:];assert len(args)==3
source,target,output=args;assert not Path(output).exists();assert Path(source).stat().st_size<=256000000
reader=glTFImporter(str(Path(source).resolve()),{'import_user_extensions':[]});reader.read();reader.checks();nodes=[n for n in reader.data.nodes if n.name==target and n.mesh is not None];assert len(nodes)==1;primitives=reader.data.meshes[nodes[0].mesh].primitives;assert len(primitives)==1;primitive=primitives[0];assert primitive.mode in [None,4] and not primitive.targets
positions=BinaryData.get_data_from_accessor(reader,primitive.attributes['POSITION']);normals=BinaryData.get_data_from_accessor(reader,primitive.attributes['NORMAL']);indices=BinaryData.get_data_from_accessor(reader,primitive.indices)if primitive.indices is not None else list(range(len(positions)));indices=[int(v[0]) if isinstance(v,(list,tuple)) and len(v)==1 else int(v) for v in indices];assert len(positions)==len(normals)<=200000 and len(indices)<=600000
vertices=[(float(p[0]),-float(p[2]),float(p[1]))for p in positions];expected=[(float(n[0]),-float(n[2]),float(n[1]))for n in normals];faces=[tuple(int(v)for v in indices[i:i+3])for i in range(0,len(indices),3)];rows=[]
for shading in ['smooth','flat']:
 mesh=bpy.data.meshes.new('Exact NORMAL setter diagnostic');mesh.from_pydata(vertices,[],faces);mesh.update();mesh.shade_smooth()if shading=='smooth'else mesh.shade_flat();mesh.normals_split_custom_set_from_vertices(expected);worst=0
 for polygon in mesh.polygons:
  for i in polygon.loop_indices:
   normal=mesh.corner_normals[i].vector;wanted=expected[mesh.loops[i].vertex_index];dot=sum(float(a)*float(b)for a,b in zip(normal,wanted));length=math.sqrt(sum(float(a)*float(a)for a in normal)*sum(float(b)*float(b)for b in wanted));angle=math.degrees(math.acos(max(-1,min(1,dot/length))));worst=max(worst,angle)
 rows.append({'shading':shading,'maxSetterNormalDifferenceDeg':worst,'corners':len(mesh.loops),'hasCustomNormals':mesh.has_custom_normals,'fixedToleranceDeg':.01,'pass':worst<=.01});bpy.data.meshes.remove(mesh)
report={'schema':'morphloom.blender-normal-setter-probe/0.1','sourceSha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),'blenderVersion':bpy.app.version_string,'target':target,'method':'Exact POS/NORMAL/index decoded with installed glTF BinaryData; same proper Y-up/Z-up rotation; fresh mesh direct custom-normal setter/readback; no normal recalculation/asset regeneration/export','rows':rows};Path(output).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
