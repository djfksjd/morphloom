"""Inspect actual imported triangle orientation; no normal recalculation or repair."""
import bpy, hashlib, json, sys
from collections import defaultdict
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]
source,out,target=args
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(source).resolve()))
obj=next((o for o in bpy.context.scene.objects if o.type=='MESH' and o.name==target),None)
if obj is None: raise RuntimeError('Stable target missing: '+target)
mesh=obj.data
mesh.calc_loop_triangles()
coordinates=[tuple(round(v,7) for v in vertex.co) for vertex in mesh.vertices]
keys={}; ids=[]
for point in coordinates:
 if point not in keys:keys[point]=len(keys)
 ids.append(keys[point])
edges=defaultdict(list); degenerate=0
for tri in mesh.loop_triangles:
 vertices=[ids[i] for i in tri.vertices]
 a,b,c=[mesh.vertices[i].co for i in tri.vertices]
 if len(set(vertices))!=3 or (b-a).cross(c-a).length<1e-14:degenerate+=1
 for i in range(3):
  a,b=vertices[i],vertices[(i+1)%3];edges[tuple(sorted((a,b)))].append(1 if a<b else -1)
boundary=sum(len(v)==1 for v in edges.values()); nonmanifold=sum(len(v)>2 for v in edges.values()); inconsistent=sum(len(v)==2 and v[0]==v[1] for v in edges.values())
report={'schema':'morphloom.blender-cap-orientation/0.1','blenderVersion':bpy.app.version_string,'sourceSha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),'target':target,'triangles':len(mesh.loop_triangles),'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,'degenerateTriangles':degenerate,'inconsistentDirectedEdges':inconsistent,'orientationPass':boundary==nonmanifold==degenerate==inconsistent==0,'scope':'actual imported target triangle orientation; cap shading and whole asset source fidelity not certified'}
Path(out).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
