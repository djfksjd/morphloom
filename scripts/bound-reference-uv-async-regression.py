"""Native uploads with controlled File.arrayBuffer completion; no React state access."""
import json,subprocess,sys,re
from pathlib import Path
out=Path(sys.argv[1]);out.mkdir(exist_ok=False);session='morphloom-bound-uv-async-'+out.name
base=Path('/Users/danny/Documents/morphloom/outputs')
original=base/'uvscale-current-20261003/conformance-final/native-default.glb'
current=base/'source-spec-reference-20261003/final-current/gear.glb'
damaged=base/'bound-reference-uv-20261003/damaged-current-v2.glb'
def call(*args,stdin=None):
 return subprocess.run(['agent-browser','--session',session,*args],input=stdin,capture_output=True,text=True,check=True,timeout=60).stdout
def click():
 snapshot=call('snapshot','-i');match=re.search(r'button "Inspect bound reference UV"[^\n]*?ref=(e\d+)',snapshot);assert match,snapshot;call('click','@'+match[1])
def upload(kind,path):call('upload','[aria-label="'+kind+' reference GLB"]',str(path))
def painted():call('eval','(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return "painted";})()')
def assert_pending_cleared():
 painted();assert call('eval','document.querySelector(\'[aria-label="Original/current GLB UV inspection"] [role="status"]\').textContent').strip('" \n')=='Choose both GLB files'
 assert 'Save bound reference UV report' not in call('snapshot','-i')
try:
 call('open','http://127.0.0.1:4179/viewer.html?editor=elements');call('wait','--fn',"document.querySelector('[aria-label=\"Original/current GLB UV inspection\"]')!==null");call('click','[aria-label="Original/current GLB UV inspection"] > summary')
 upload('Original',original);upload('Translated',current)
 call('eval','--stdin',stdin='''(()=>{const native=File.prototype.arrayBuffer;let queue=[];File.prototype.arrayBuffer=function(){const file=this;return new Promise((resolve,reject)=>queue.push({file,resolve,reject}));};window.__boundFileRead={count:()=>queue.length,release:(fail)=>{const entries=queue;queue=[];for(const item of entries){if(fail)item.reject(new Error('Controlled stale read rejection'));else native.call(item.file).then(item.resolve,item.reject);}},restore:()=>{File.prototype.arrayBuffer=native;}};return 'File read harness installed';})()''')
 rows=[]
 for fail in [False,True]:
  upload('Translated',current);click();call('wait','--fn','window.__boundFileRead.count()===2');upload('Translated',damaged);assert_pending_cleared();call('eval','window.__boundFileRead.release('+str(fail).lower()+')');call('wait','200');assert_pending_cleared();rows.append('stale '+('rejection' if fail else 'completion')+' discarded after native file replacement')
 call('eval','window.__boundFileRead.restore()');upload('Translated',current);click();call('wait','--text','Bound reference UV: PASS');rows.append('ordinary inspection recovers after controlled stale reads')
 (out/'evidence.json').write_text(json.dumps({'pass':True,'cases':rows,'unmount':'not-run','method':'native uploads, controlled File.arrayBuffer only; no application state injection'},indent=2)+'\n');print('PASS',rows)
except Exception as e:
 (out/'failure.txt').write_text(str(e)+'\n'+getattr(e,'stderr',''));raise
finally:call('close')
