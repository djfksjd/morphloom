import subprocess,pathlib,re,json,time,hashlib
p=pathlib.Path('outputs/domain-pack-v4-20261002/browser');p.mkdir(exist_ok=True)
def run(*args):
 r=subprocess.run(['agent-browser','--session','morphloom-gear',*args],capture_output=True,text=True,timeout=35);assert r.returncode==0,r.stderr;return r.stdout
def ref(label,kind='button'):
 return '@'+re.search(rf'{kind} "{re.escape(label)}".*?ref=(e\d+)',run('snapshot','-i')).group(1)
def receipt():
 text=json.loads(run('eval','document.querySelector("details[aria-label=\\"UV quality\\"]").textContent'));s=re.search('Source SHA256: ([a-f0-9]{64})',text);g=re.search('Geometry SHA256: ([a-f0-9]{64})',text);return {'source':s.group(1),'geometry':g.group(1)} if s and g else None
def wait(test):
 for _ in range(80):
  r=receipt()
  if r and test(r):return r
  time.sleep(.05)
 raise RuntimeError('receipt not current')
run('open','http://127.0.0.1:4176/?editor=elements');rows=[]
def download_bundle(label,name):
 before={f:f.stat().st_mtime_ns for f in p.iterdir() if f.is_file()}
 run('download',ref(label),str((p/(name+'.download')).resolve()))
 for _ in range(100):
  changed=[f for f in p.iterdir() if f.is_file() and (f not in before or f.stat().st_mtime_ns!=before[f])];glbs=[f for f in changed if f.read_bytes()[:4]==b'glTF'];reports=[]
  for f in changed:
   try:
    obj=json.loads(f.read_bytes())
    if obj.get('schema')=='morphloom.uv-inspection-receipt/0.1':reports.append(obj)
   except (UnicodeDecodeError,json.JSONDecodeError):pass
  if len(glbs)==1 and len(reports)==1:break
  time.sleep(.1)
 assert len(glbs)==1 and len(reports)==1,[str(f) for f in changed]
 data=glbs[0].read_bytes();report=reports[0];assert report['outputFingerprint']==hashlib.sha256(data).hexdigest();(p/(name+'.glb')).write_bytes(data);(p/(name+'.receipt.json')).write_text(json.dumps(report,indent=2));return report
run('select',ref('Domain Pack','combobox'),'example.surface-gear.visual');before=wait(lambda x:True);run('download',ref('Save project JSON'),str((p/'generated.elements.json').resolve()));original=json.loads((p/'generated.elements.json').read_text());original.pop('selection',None);assert original==json.loads(pathlib.Path('outputs/domain-pack-v4-20261002/native/default.json').read_text());download_bundle('Export project GLB + source JSON','generated')
run('click',ref('External involute spur gear · radial root approximation'));run('fill',ref('Gear faceWidthMm','spinbutton'),'10');run('fill',ref('Part roughness','spinbutton'),'.52');assert receipt()['source']==before['source'];run('click',ref('Cancel edit'));assert receipt()['source']==before['source']
run('fill',ref('Gear faceWidthMm','spinbutton'),'10');run('fill',ref('Part roughness','spinbutton'),'.52');run('click',ref('Apply part edit'));after=wait(lambda x:x['source']!=before['source']);assert after['geometry']!=before['geometry'];run('click',ref('Undo'));wait(lambda x:x['source']==before['source']);run('click',ref('Redo'));wait(lambda x:x['source']==after['source']);run('download',ref('Save project JSON'),str((p/'edited.elements.json').resolve()));saved=json.loads((p/'edited.elements.json').read_text());saved.pop('selection',None);expected=json.loads(json.dumps(original));expected['parts'][0]['geometry']['faceWidthMm']=10;expected['parts'][0]['material']['roughness']=.52;assert saved==expected;run('upload','input[type=file]',str((p/'edited.elements.json').resolve()));wait(lambda x:x['source']==after['source']);download_bundle('Export project GLB + source JSON','edited');run('screenshot',str((p/'edited-view.png').resolve()))
run('open','http://127.0.0.1:4176/?editor=workspace');run('download',ref('Save workspace JSON'),str((p/'workspace-initial.json').resolve()));run('select',ref('Append Domain Pack','combobox'),'example.surface-gear.visual');run('fill',ref('Instance ID','textbox'),'gear');run('click',ref('Append asset'));wait(lambda x:x['source']==before['source']);run('download',ref('Save workspace JSON'),str((p/'workspace-generated.json').resolve()));w=json.loads((p/'workspace-generated.json').read_text());assert w['assets'][0]==json.loads((p/'workspace-initial.json').read_text())['assets'][0];assert w['assets'][1]['source']==original
run('click',ref('External involute spur gear · radial root approximation'));run('fill',ref('Part roughness','spinbutton'),'.52');run('click',ref('Apply part edit'));changed=wait(lambda x:x['source']!=before['source']);run('click',ref('Undo workspace'));wait(lambda x:x['source']==before['source']);run('click',ref('Redo workspace'));wait(lambda x:x['source']==changed['source']);run('download',ref('Save workspace JSON'),str((p/'workspace-edited.json').resolve()));edited=json.loads((p/'workspace-edited.json').read_text());assert edited['assets'][0]==w['assets'][0];e=json.loads(json.dumps(w));e['assets'][1]['source']['parts'][0]['material']['roughness']=.52;assert edited==e
run('upload','input[aria-label="Load workspace JSON"]',str((p/'workspace-edited.json').resolve()));run('select',ref('Workspace asset','combobox'),'gear');wait(lambda x:x['source']==changed['source']);download_bundle('Export workspace GLB + JSON','workspace-edited');run('screenshot',str((p/'mixed-view.png').resolve()));(p/'workflow.json').write_text(json.dumps({'pass':True,'generatedSource':before,'editedSource':after,'workspaceSource':changed,'checks':['registry generation','generic inspector staged cancel/apply','dimension and PBR edit','undo/redo','save/reopen','actual GLB UV/standard gate','mixed fur source preservation']},indent=2));print('standalone + mixed UI and actual exports PASS')
