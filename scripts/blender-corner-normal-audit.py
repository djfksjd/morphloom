"""Measure imported split-normal preservation under the predeclared 0.01 degree contract."""
import bpy,hashlib,json,sys,math
from pathlib import Path
files=sys.argv[sys.argv.index('--')+1:];assert len(files)==4,'source.glb edited.glb stability.glb new-report.json'
def snapshot(file):
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(Path(file).resolve()));rows={}
 for obj in bpy.context.scene.objects:
  if obj.type!='MESH':continue
  mesh=obj.data;values={};count=0
  for polygon in mesh.polygons:
   for i in polygon.loop_indices:
    normal=mesh.corner_normals[i].vector.normalized();co=mesh.vertices[mesh.loops[i].vertex_index].co
    key=tuple(round(float(v)*1000000)for v in co);values.setdefault(key,[]).append(tuple(normal));count+=1
  rows[obj.name]={'count':count,'positions':values}
 return rows
def compare(before,after):
 assert before.keys()==after.keys(),'Mesh identities changed';result=[]
 for name,row in before.items():
  next=after[name];assert row['count']==next['count'] and row['positions'].keys()==next['positions'].keys(),name+': corner counts/coordinates changed';worst=0
  for key,normals in row['positions'].items():
   current=next['positions'][key];assert len(normals)==len(current),name+': vertex association multiplicity changed'
   for previous,candidate in [(normals,current),(current,normals)]:
    for normal in previous:
     # glTF float storage and Blender normalization are compared by angle, not a quantization-cell hash.
     angle=min(math.degrees(math.acos(max(-1,min(1,sum(a*b for a,b in zip(normal,n))/math.sqrt(sum(a*a for a in normal)*sum(b*b for b in n))))))for n in candidate)
     worst=max(worst,angle)
  result.append({'mesh':name,'corners':row['count'],'maxNormalDifferenceDeg':worst,'pass':worst<=.01})
 return result
source,edited,stability=map(snapshot,files[:3]);pairs=[compare(source,edited),compare(edited,stability)];report={'pass':all(row['pass']for pair in pairs for row in pair),'blenderVersion':bpy.app.version_string,'fixedAngularToleranceDeg':.01,'pairs':pairs,'method':'actual glTF imports; local vertex coordinates at1e-6; split corner normals bidirectional angular nearest matching plus coordinate/multiplicity preservation','files':{str(Path(f).name):hashlib.sha256(Path(f).read_bytes()).hexdigest()for f in files[:3]},'scope':'named translation only; no arbitrary DCC remesh/normal edit certification; original quantization-hash failures retained'};Path(files[3]).write_text(json.dumps(report,indent=2)+'\n');assert report['pass'],'Actual split normal angular contract failed';print(json.dumps(report))
