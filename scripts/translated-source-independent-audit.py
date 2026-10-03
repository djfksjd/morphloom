"""Independent framing/BIN and actual Blender first import; reexport is reported separately."""
import bpy,json,hashlib,struct,sys,math
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--')+1]);out=root/'independent';out.mkdir(exist_ok=False)
inputs=json.loads((root/'browser-originals-final.json').read_text())['rows'];flow={r['id']:r for r in json.loads((root/'browser-flow.json').read_text())['rows']};rows=[]
def sha(v):return hashlib.sha256(v).hexdigest()
def read(file):
 raw=Path(file).read_bytes();assert raw[:4]==b'glTF' and struct.unpack_from('<II',raw,4)==(2,len(raw));n=struct.unpack_from('<I',raw,12)[0];assert struct.unpack_from('<I',raw,16)[0]==0x4e4f534a;tail=raw[20+n:];assert struct.unpack_from('<II',tail)==(len(tail)-8,0x004e4942);return json.loads(raw[20:20+n]),tail,sha(raw)
def imported(file):
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(Path(file).resolve()),import_shading='NORMALS');result={}
 for o in bpy.context.scene.objects:
  payload=None
  if o.type=='MESH':
   m=o.data;payload=sha(json.dumps({'vertices':[list(v.co) for v in m.vertices],'loops':[v.vertex_index for v in m.loops],'faces':[(p.loop_start,p.loop_total,p.material_index) for p in m.polygons],'normal':[list(n.vector) for n in m.corner_normals],'uv':[(l.name,[list(v.uv) for v in l.data]) for l in m.uv_layers],'materials':[(s.material.name,list(s.material.diffuse_color),s.material.roughness,s.material.metallic) for s in o.material_slots]},sort_keys=True).encode())
  result[o.name]={'mesh':payload,'parent':o.parent.name if o.parent else None,'matrix':[list(r) for r in o.matrix_world]}
 return result
for row in inputs:
 name=row['id'];files=[row['original'],row['current'],flow[name]['regenerated']];parsed=[read(f) for f in files];assert parsed[0][1]==parsed[1][1]==parsed[2][1],'actual BIN mismatch';before,current,regenerated=[imported(f) for f in files];assert before.keys()==current.keys()==regenerated.keys();target=row['target'];maximum=0
 for key in before:
  assert before[key]['mesh']==current[key]['mesh']==regenerated[key]['mesh'],(name,key,'mesh/material/UV/normal changed on first import')
  assert before[key]['parent']==current[key]['parent']==regenerated[key]['parent']
  for i in range(4):
   for j in range(4):
    delta=([.002,.003,.001][i] if key==target and j==3 and i<3 else 0) # glTF (2,1,-3)mm -> Blender (2,3,1)mm
    maximum=max(maximum,abs(current[key]['matrix'][i][j]-before[key]['matrix'][i][j]-delta));assert abs(current[key]['matrix'][i][j]-regenerated[key]['matrix'][i][j])<=1e-6
 assert maximum<=1e-6
 # Current GLB first import is retained separately from an actual Blender reexport.
 exported=out/(name+'.blender-reexport.glb');bpy.ops.export_scene.gltf(filepath=str(exported),export_format='GLB',export_normals=True,export_yup=True)
 reexport=read(exported);again=imported(exported);assert again.keys()==regenerated.keys()
 rows.append({'id':name,'firstImport':{'pass':True,'allMeshesAndNormalsUvMaterialsHierarchyPreservedBetweenInputs':True,'maximumTranslationErrorMeters':maximum},'regeneratedBinExact':True,'files':[{'path':f,'sha256':p[2]} for f,p in zip(files,parsed)],'blenderReexport':{'executed':True,'reopened':True,'path':str(exported),'sha256':reexport[2],'binExact':reexport[1]==parsed[2][1],'normalFidelity':'not certified; compare raw NORMAL independently'},'blenderVersion':bpy.app.version_string});print('PASS independent first import',name,flush=True)
(out/'evidence.json').write_text(json.dumps({'pass':True,'scope':'Native regeneration and actual first-import correspondence; no Blender raw-normal or production approval','rows':rows},indent=2)+'\n')
