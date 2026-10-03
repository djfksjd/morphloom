"""Actual Blender corner-normal and planar UV inspection; no repair."""
import bpy,json,sys,hashlib
from pathlib import Path
from mathutils import Vector
source,out,target,segments=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(Path(source).resolve()))
obj=next((o for o in bpy.context.scene.objects if o.type=='MESH' and o.name==target),None)
if obj is None:raise RuntimeError('Missing stable target')
mesh=obj.data;mesh.calc_loop_triangles();caps=list(mesh.loop_triangles)[-2*int(segments):]
dots=[];ratios=[];edge_scales=[]
for tri in caps:
 a,b,c=[mesh.vertices[i].co for i in tri.vertices];face=(b-a).cross(c-a);area=face.length*.5
 if area<1e-14:raise RuntimeError('Degenerate cap triangle')
 face.normalize()
 for loop in tri.loops:dots.append(mesh.corner_normals[loop].vector.dot(face))
 uv=[mesh.uv_layers.active.data[i].uv for i in tri.loops]
 positions=[mesh.vertices[i].co for i in tri.vertices]
 for i in range(3):
  length=(positions[(i+1)%3]-positions[i]).length
  if length<1e-12:raise RuntimeError('Degenerate cap edge')
  edge_scales.append((uv[(i+1)%3]-uv[i]).length/length)
 areaUv=abs((uv[1].x-uv[0].x)*(uv[2].y-uv[0].y)-(uv[1].y-uv[0].y)*(uv[2].x-uv[0].x))*.5;ratios.append(areaUv/area)
spread=max(ratios)/min(ratios)-1 if min(ratios)>0 else None
edge_spread=max(edge_scales)/min(edge_scales)-1 if min(edge_scales)>0 else None
report={'schema':'morphloom.blender-flat-cap/0.1','sourceSha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),'blenderVersion':bpy.app.version_string,'target':target,'capTriangles':len(caps),'minimumCornerNormalDotFace':min(dots),'uniformNormalPass':min(dots)>.99999,'uvAreaToGeometryAreaRelativeSpread':spread,'uvEdgeScaleRelativeSpread':edge_spread,'planarUvPass':spread is not None and spread<=.0001 and edge_spread is not None and edge_spread<=.0001,'scope':'target imported cap corners only; no whole asset source-fidelity or atlas/mip approval'}
Path(out).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
