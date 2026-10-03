"""Actual Blender conformance: preserved user assets, malformed source, rollback and input readback."""
import bpy,json,sys,struct,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_source_normal_import import import_static_with_source_normals
args=sys.argv[sys.argv.index('--')+1:];assert len(args)==2,'source.glb new-evidence-directory'
base=Path(args[0]);root=Path(args[1]);root.mkdir(exist_ok=False)
raw=base.read_bytes();n=struct.unpack_from('<I',raw,12)[0];document=json.loads(raw[20:20+n]);tail=raw[20+n:]
def pack(d,t):
 b=json.dumps(d).encode();b+=b' '*((-len(b))%4);return struct.pack('<IIIII',0x46546c67,2,20+len(b)+len(t),len(b),0x4e4f534a)+b+t
bpy.ops.wm.read_factory_settings(use_empty=True);mesh=bpy.data.meshes.new('User sentinel');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);obj=bpy.data.objects.new('User sentinel',mesh);bpy.context.collection.objects.link(obj);obj.location=(.3,.7,.2);obj['userEdit']='preserve';mesh.uv_layers.new(name='User UV');before=(tuple(obj.location),[tuple(v.co) for v in mesh.vertices],obj['userEdit'],[tuple(v.uv) for v in mesh.uv_layers[0].data])
def inventory():return {kind:set(getattr(bpy.data,kind)) for kind in ['objects','meshes','materials','images','collections','actions']}
rows=[]
for name in ['framing','uri','nonunit-normal','oversize-accessor','name-collision']:
 d=json.loads(json.dumps(document));t=bytearray(tail)
 if name=='framing':data=b'glTF'+b'bad'
 elif name=='uri':d['images']=[{'uri':'https://invalid.example/do-not-fetch.png'}];data=pack(d,t)
 elif name=='oversize-accessor':d['accessors'][d['meshes'][0]['primitives'][0]['attributes']['POSITION']]['count']=200001;data=pack(d,t)
 elif name=='nonunit-normal':a=d['accessors'][d['meshes'][0]['primitives'][0]['attributes']['NORMAL']];off=8+d['bufferViews'][a['bufferView']].get('byteOffset',0)+a.get('byteOffset',0);struct.pack_into('<fff',t,off,0,0,0);data=pack(d,t)
 else:
  # A real importer collision occurs after decoding and scene creation; rollback must remove all owned datablocks.
  existing=bpy.data.meshes.new(d['meshes'][0].get('name','Mesh_0'));data=raw
 path=root/(name+'.glb');path.write_bytes(data);old=inventory()
 try:import_static_with_source_normals(path);raise RuntimeError('Unsupported input accepted')
 except AssertionError as error:reason=str(error)
 assert inventory()==old,(name,'rollback changed existing scene');assert (tuple(obj.location),[tuple(v.co) for v in mesh.vertices],obj['userEdit'],[tuple(v.uv) for v in mesh.uv_layers[0].data])==before;rows.append({'case':name,'pass':True,'reason':reason})
 if name=='name-collision':bpy.data.meshes.remove(existing)
# Fault only the verification completion after a real attribute write; no production contract bypass.
import blender_source_normal_import as module
native_payload=module._preserved_mesh_payload;calls=[0];mesh_count=len(document['meshes']);old=inventory()
def late_fault(mesh):
 calls[0]+=1;value=native_payload(mesh)
 return value if calls[0]<=mesh_count else ('Controlled late preservation failure',)
module._preserved_mesh_payload=late_fault
try:
 try:import_static_with_source_normals(base);raise RuntimeError('Late failure accepted')
 except AssertionError as error:assert 'changed geometry' in str(error)
 assert inventory()==old;rows.append({'case':'controlled late preservation fault rolls back imported meshes after normal attribute writes','pass':True})
finally:module._preserved_mesh_payload=native_payload
old=inventory();result=import_static_with_source_normals(base);assert (tuple(obj.location),[tuple(v.co) for v in mesh.vertices],obj['userEdit'],[tuple(v.uv) for v in mesh.uv_layers[0].data])==before;assert all(items.issubset(inventory()[kind]) for kind,items in old.items());rows.append({'case':'valid static source preserves unrelated user mesh/UV/property/placement','pass':True})
(root/'evidence.json').write_text(json.dumps({'pass':True,'sourceSha256':hashlib.sha256(raw).hexdigest(),'blenderVersion':bpy.app.version_string,'cases':rows,'validImport':result},indent=2)+'\n');print('PASS',len(rows),'actual Blender conformance cases')
