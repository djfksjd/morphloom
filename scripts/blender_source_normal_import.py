"""Opt-in static source Float32 normal import.

Preserves explicit NORMAL using Blender float-vector corner attributes.

This does not use import_shading=FLAT (which discards NORMAL in Blender 5.2).
It checks exact vertex correspondence before setting original custom normals.
"""
import bpy,math,struct,json,hashlib,tempfile
from pathlib import Path
from io_scene_gltf2.io.imp.gltf2_io_gltf import glTFImporter
from io_scene_gltf2.io.imp.gltf2_io_binary import BinaryData

POLICY='morphloom.blender-source-normal-import/0.1'
def _source_spec(source):
 path=Path(source);assert path.is_file() and 12<=path.stat().st_size<=256000000,'Source file budget'
 raw=path.read_bytes();assert len(raw)>=28 and raw[:4]==b'glTF' and struct.unpack_from('<II',raw,4)==(2,len(raw)),'GLB framing';n=struct.unpack_from('<I',raw,12)[0];assert n<=16000000 and 20+n+8<=len(raw),'JSON budget'
 reader=glTFImporter(str(path.resolve()),{'import_user_extensions':[]})
 try:
  reader.read();reader.checks();data=reader.data
  assert bpy.app.version[:2]==(5,2),'Only Blender 5.2 import profile is supported'
  assert not data.animations and not data.skins and not data.extensions_required,'Static source only; animation/skin unsupported'
  assert 0<len(data.meshes or [])<=128 and len(data.nodes or [])<=10000,'Scene budget'
  assert not any(node.skin is not None or node.extensions for node in data.nodes or []),'Instanced/extended source nodes unsupported'
  assert not data.images and not data.textures,'Textured sources unsupported by this import profile'
  assert not any(b.uri for b in data.buffers or []) and not any(i.uri for i in data.images or []),'Embedded GLB only; URI unsupported'
  specs={};total=0;total_corners=0
  for index,spec in enumerate(data.meshes or []):
   name=spec.name or 'Mesh_'+str(index);assert name not in specs,'Duplicate source mesh name';positions=[];normals=[];loops=[]
   for primitive in spec.primitives:
    assert primitive.mode in [None,4] and not primitive.targets,'Triangle static primitives only'
    assert 'NORMAL' in primitive.attributes and 'POSITION' in primitive.attributes,'Every primitive needs explicit POSITION/NORMAL'
    assert all(reader.data.accessors[primitive.attributes[k]].component_type==5126 and reader.data.accessors[primitive.attributes[k]].type=='VEC3' for k in ['POSITION','NORMAL']),'Only explicit Float32 VEC3 source attributes supported'
    assert reader.data.accessors[primitive.attributes['POSITION']].count<=200000 and reader.data.accessors[primitive.attributes['NORMAL']].count<=200000,'Accessor budget'
    a=BinaryData.get_data_from_accessor(reader,primitive.attributes['POSITION']);n=BinaryData.get_data_from_accessor(reader,primitive.attributes['NORMAL']);assert len(a)==len(n),'Attribute correspondence'
    assert primitive.indices is None or reader.data.accessors[primitive.indices].count<=200000,'Index budget'
    encoded=BinaryData.get_data_from_accessor(reader,primitive.indices)if primitive.indices is not None else range(len(a));indices=[int(v[0])if isinstance(v,(list,tuple))and len(v)==1 else int(v)for v in encoded];assert len(indices)%3==0 and len(indices)<=200000 and all(0<=v<len(a)for v in indices),'Triangle index budget'
    used=sorted(set(indices));remap={v:i+len(positions)for i,v in enumerate(used)};loops.extend(remap[v]for v in indices);a=[a[i]for i in used];n=[n[i]for i in used]
    positions.extend((float(p[0]),-float(p[2]),float(p[1]))for p in a);normals.extend((float(v[0]),-float(v[2]),float(v[1]))for v in n)
   total+=len(positions);total_corners+=len(loops);assert total<=2000000 and len(loops)<=200000 and total_corners<=2000000,'Vertex/corner budget'
   assert all(all(math.isfinite(x)for x in row)for row in positions+normals)and all(abs(sum(x*x for x in n)-1)<=1e-4 for n in normals),'Non-finite/non-unit source attributes'
   specs[name]=(positions,normals,loops)
  return specs,total
 finally:
  reader.log.flush()
  for handler in [reader.log.console_handler,reader.log.error_console_handler,reader.log.popup_handler]:handler.close()

def _preserved_mesh_payload(mesh):
 return ([tuple(v.co) for v in mesh.vertices],[v.vertex_index for v in mesh.loops],
         [(p.loop_start,p.loop_total,p.material_index) for p in mesh.polygons],
         [(uv.name,[tuple(v.uv) for v in uv.data]) for uv in mesh.uv_layers],
         [material.as_pointer() if material else None for material in mesh.materials])

def _import_checked(source):
 specs,total=_source_spec(source);path=Path(source)
 before=set(bpy.data.meshes);bpy.ops.import_scene.gltf(filepath=str(path.resolve()),import_shading='NORMALS',merge_vertices=False);imported=[mesh for mesh in bpy.data.meshes if mesh not in before];assert len(imported)==len(specs),'Missing/extra imported meshes'
 checked=[]
 for mesh in imported:
  assert mesh.name in specs,'Ambiguous import name';positions,normals,loops=specs[mesh.name];assert len(mesh.vertices)==len(positions),'Importer vertex reordering/merging unsupported'
  assert all(max(abs(float(c)-v)for c,v in zip(vertex.co,p))<=1e-8 for vertex,p in zip(mesh.vertices,positions)),'Importer vertex geometry/order mismatch'
  assert [loop.vertex_index for loop in mesh.loops]==loops,'Importer topology/order mismatch'
  checked.append((mesh,normals))
 # Preserve source Float32 normals directly in Blender's supported float-vector normal attribute.
 # The legacy setter encodes short2 corner-fan angles; it is deliberately not used here.
 before_payload={mesh.name:_preserved_mesh_payload(mesh) for mesh,_ in checked}
 before_objects={obj.name:(obj.data.as_pointer(),obj.parent.as_pointer() if obj.parent else None,[list(row) for row in obj.matrix_world]) for obj in bpy.context.scene.objects if obj.type=='MESH'}
 receipts=[]
 for mesh,normals in checked:
  old=mesh.attributes.get('custom_normal')
  if old:mesh.attributes.remove(old)
  attribute=mesh.attributes.new('custom_normal','FLOAT_VECTOR','CORNER')
  assert attribute.name=='custom_normal' and attribute.domain=='CORNER' and attribute.data_type=='FLOAT_VECTOR','Float-vector custom normals unsupported'
  from array import array
  values=array('f',(value for loop in mesh.loops for value in normals[loop.vertex_index]))
  attribute.data.foreach_set('vector',values);mesh.update()
  worst=0
  for loop in mesh.loops:
   actual=mesh.corner_normals[loop.index].vector;expected=normals[loop.vertex_index]
   dot=sum(float(a)*b for a,b in zip(actual,expected));length=math.sqrt(sum(float(a)*float(a)for a in actual)*sum(b*b for b in expected));angle=math.degrees(math.acos(max(-1,min(1,dot/length))));worst=max(worst,angle)
  assert worst<=.01,'Float normal readback failed fixed 0.01 degree'
  assert _preserved_mesh_payload(mesh)==before_payload[mesh.name],'Normal import changed geometry/UV/index/materials'
  receipts.append({'mesh':mesh.name,'storage':'FLOAT_VECTOR/CORNER','appliedMaxInputErrorDeg':worst,'corners':len(mesh.loops)})
 assert {obj.name:(obj.data.as_pointer(),obj.parent.as_pointer() if obj.parent else None,[list(row) for row in obj.matrix_world]) for obj in bpy.context.scene.objects if obj.type=='MESH'}==before_objects,'Normal import changed hierarchy/transforms'
 return {'policy':POLICY,'referenceReceipts':receipts,'meshCount':len(checked),'vertices':total,'nonNormalPayloadExact':True,'hierarchyTransformsExact':True,'scope':'static explicit source Float32 normals; no normal recalculation, quantization or geometry/UV/PBR/transform changes; no arbitrary DCC edit/IR inverse conversion'}

def import_static_with_source_normals(source):
 """Rollback newly imported datablocks on any rejection; never mutate preexisting assets."""
 collections=[bpy.data.objects,bpy.data.meshes,bpy.data.materials,bpy.data.images,bpy.data.collections,bpy.data.actions]
 before=[set(collection) for collection in collections]
 selected=list(bpy.context.selected_objects);active=bpy.context.view_layer.objects.active
 try:
  path=Path(source)
  with path.open('rb') as file:raw=file.read(256000001)
  assert 28<=len(raw)<=256000000,'Snapshot file budget'
  # The decoder and actual importer consume one owned immutable snapshot, never a changing source path.
  with tempfile.TemporaryDirectory(prefix='morphloom-source-normal-') as folder:
   snapshot=Path(folder)/'source.glb';snapshot.write_bytes(raw)
   result=_import_checked(snapshot)
  result['inputSha256']=hashlib.sha256(raw).hexdigest()
  n=struct.unpack_from('<I',raw,12)[0];document=json.loads(raw[20:20+n])
  result['sourceReferences']=[node['extras']['sourceSpec'] for node in document.get('nodes',[]) if 'sourceSpec' in node.get('extras',{})]
  return result
 except Exception:
  for collection,original in zip(collections,before):
   for item in list(collection):
    if item not in original:collection.remove(item,do_unlink=True)
  for obj in selected:
   if obj.name in bpy.context.view_layer.objects:obj.select_set(True)
  if active and active.name in bpy.context.view_layer.objects:bpy.context.view_layer.objects.active=active
  raise
