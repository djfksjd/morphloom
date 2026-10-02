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
rows=[]
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
run('upload','input[aria-label="Load workspace JSON"]',str((p/'workspace-generated.json').resolve()));run('select',ref('Workspace asset','combobox'),'gear');expected=hashlib.sha256(pathlib.Path('outputs/domain-pack-v4-20261002/native/default.json').read_bytes()).hexdigest();wait(lambda x:x['source']==expected);download_bundle('Export workspace GLB + JSON','workspace-before');print('browser baseline export PASS')
