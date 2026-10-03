"""Actual imported local edge orientation. Closedness is an explicit purpose flag."""
import bpy,sys,json,hashlib
from pathlib import Path
from collections import defaultdict
args=sys.argv[sys.argv.index('--')+1:]
if len(args)<2:raise RuntimeError('Usage: source.glb report.json [--require-closed]')
source,out=map(lambda x:Path(x).resolve(),args[:2]);closed=args[2:]==['--require-closed']
if args[2:] not in [[],['--require-closed']]or source==out or source.suffix.lower()!='.glb' or not 20<=source.stat().st_size<=256*1024*1024:raise RuntimeError('Unsafe orientation audit arguments')
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source));rows=[]
for obj in sorted([x for x in bpy.context.scene.objects if x.type=='MESH'],key=lambda x:x.name):
 mesh=obj.data;mesh.calc_loop_triangles();keys={};ids=[]
 for vertex in mesh.vertices:
  point=tuple(round(v,7)for v in vertex.co)
  if point not in keys:keys[point]=len(keys)
  ids.append(keys[point])
 edges=defaultdict(list);degenerate=0
 for tri in mesh.loop_triangles:
  vertices=[ids[i]for i in tri.vertices];a,b,c=[mesh.vertices[i].co for i in tri.vertices]
  if len(set(vertices))!=3 or (b-a).cross(c-a).length<1e-14:degenerate+=1
  for j in range(3):
   a,b=vertices[j],vertices[(j+1)%3];edges[tuple(sorted((a,b)))].append(1 if a<b else -1)
 boundary=sum(len(v)==1 for v in edges.values());nonmanifold=sum(len(v)>2 for v in edges.values());conflicts=sum(len(v)==2 and v[0]==v[1]for v in edges.values())
 rows.append({'name':obj.name,'triangles':len(mesh.loop_triangles),'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,'degenerateTriangles':degenerate,'inconsistentDirectedEdges':conflicts,'pass':nonmanifold==degenerate==conflicts==0 and(not closed or boundary==0)})
report={'schema':'morphloom.blender-mesh-orientation/0.1','blenderVersion':bpy.app.version_string,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'requireClosed':closed,'weldPrecisionMetres':1e-7,'pass':bool(rows)and all(r['pass']for r in rows),'rows':rows,'scope':'actual imported local directed edges; whole volume/outward orientation, UV, self-intersection, artistic/source/CAD approval not certified'};out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'pass':report['pass'],'meshes':len(rows),'conflicts':sum(r['inconsistentDirectedEdges']for r in rows)}))
if not report['pass']:raise SystemExit(1)
