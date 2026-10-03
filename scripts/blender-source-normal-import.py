"""Explicit opt-in first import to .blend, with unchanged 0.01 degree source-normal gate."""
import bpy,json,sys,hashlib,tempfile,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_source_normal_import import import_static_with_source_normals
args=sys.argv[sys.argv.index('--')+1:];assert len(args)==3,'source.glb new.blend new.receipt.json'
source,output,receipt=map(Path,args);assert source.is_file() and not output.exists() and not receipt.exists() and output.resolve()!=receipt.resolve();assert output.parent.is_dir() and receipt.parent.is_dir()
bpy.ops.wm.read_factory_settings(use_empty=True)
result=import_static_with_source_normals(source)
# Save only the complete successfully checked scene. Report the profile explicitly.
report={'schema':'morphloom.blender-source-normal-import-receipt/0.1','sourceSha256':result['inputSha256'],'blenderVersion':bpy.app.version_string,'fixedNormalToleranceDeg':.01,'import':result,'scope':'Explicit static first import/.blend preservation; GLB reexport and general delivery not certified'}
# Imported procedural metadata is a reference, never a claim of DCC-to-IR reconstruction.
references=[{'schema':'morphloom.source-spec-reference/0.1','state':'before-edit-reference','sourceSha256':report['sourceSha256'],'sourceSpec':spec} for spec in result.pop('sourceReferences')]
for obj in bpy.context.scene.objects:
 if 'sourceSpec' in obj:del obj['sourceSpec']
bpy.context.scene['morphloom_source_references_json']=json.dumps(references,sort_keys=True)
report['currentEditableIRAvailable']=False;report['sourceSpecState']='before-edit-reference'
bpy.context.scene['morphloom_source_normal_import']=json.dumps(report,sort_keys=True)
created=[]
try:
 with tempfile.TemporaryDirectory(prefix='morphloom-normal-import-',dir=output.parent) as folder:
  temporary=Path(folder)/'checked.blend'
  bpy.ops.wm.save_as_mainfile(filepath=str(temporary.resolve()),check_existing=False)
  assert temporary.is_file() and temporary.stat().st_size<=256_000_000
  # Link publishes exclusively; an output created by another process is never overwritten.
  os.link(temporary,output);created.append(output)
  report['blendSha256']=hashlib.sha256(output.read_bytes()).hexdigest()
  with receipt.open('x') as file:
   created.append(receipt);file.write(json.dumps(report,indent=2)+'\n')
except Exception:
 for path in reversed(created):path.unlink()
 raise
print(json.dumps(report))
