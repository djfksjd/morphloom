"""Control File read timing only. Native replacement and workspace child unmount."""
import json,re,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]);out=root/'async-browser';out.mkdir(exist_ok=False);session='morphloom-source-async-20261004';row=json.loads((root/'browser-originals-final.json').read_text())['rows'][0];rows=[]
def call(*args,stdin=None):return subprocess.run(['agent-browser','--session',session,*args],input=stdin,capture_output=True,text=True,check=True,timeout=70).stdout
def click(label):
 s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+r'"[^\n]*?ref=(e\d+)',s);assert m,(label,s);call('click','@'+m[1])
def upload(kind,key):call('upload','[aria-label="'+kind+' reference GLB"]',row[key])
def frame():call('eval','(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()')
def setup():
 call('click','[aria-label="Original/current GLB UV inspection"] > summary');upload('Original','original');upload('Translated','current');click('Inspect bound reference UV');call('wait','--text','Bound reference UV: PASS')
def arm():call('eval','window.__reads.arm=true');click('Generate modified native source JSON');call('wait','--fn','window.__reads.queue.length===2')
def release(fail):call('eval','window.__reads.release('+str(fail).lower()+')');call('wait','250');frame()
def noresult():
 s=call('snapshot','-i');assert 'Save modified source JSON' not in s and 'Save source regeneration proof' not in s and 'Save bound reference UV report' not in s,s
hook="""(()=>{const native=File.prototype.arrayBuffer;window.__reads={arm:false,queue:[],release(fail){const q=this.queue;this.queue=[];this.arm=false;for(const v of q)fail?v.reject(new Error('Controlled read failure')):native.call(v.file).then(v.resolve,v.reject)}};File.prototype.arrayBuffer=function(){return window.__reads.arm?new Promise((resolve,reject)=>window.__reads.queue.push({file:this,resolve,reject})):native.call(this)};return true})()"""
try:
 call('open','http://127.0.0.1:4179/?editor=elements');call('wait','--fn',"document.querySelector('[aria-label=\"Original/current GLB UV inspection\"]')!==null");setup();call('eval','--stdin',stdin=hook)
 for fail in [False,True]:
  arm();upload('Translated','current');noresult();release(fail);noresult();assert 'Bound reference UV: BLOCKED' not in call('get','text','[aria-label="Original/current GLB UV inspection"]');rows.append('reconstruction stale '+('rejection' if fail else 'completion')+' discarded after native file replacement');click('Inspect bound reference UV');call('wait','--text','Bound reference UV: PASS')
 arm();release(True);call('wait','--text','Controlled read failure');noresult();rows.append('current reconstruction read failure blocks result')
 click('Inspect bound reference UV');call('wait','--text','Bound reference UV: PASS');click('Generate modified native source JSON');call('wait','--text','Modified native source: VERIFIED');upload('Original','original');noresult();rows.append('file replacement invalidates verified downloads')
 call('close');session+='-unmount';call('open','http://127.0.0.1:4179/?editor=workspace');call('wait','--fn',"document.querySelector('[aria-label=\"Load workspace JSON\"]')!==null");call('upload','[aria-label="Load workspace JSON"]',str(root/'async.workspace.json'));call('wait','--fn',"document.querySelector('[aria-label=\"Workspace asset\"] option[value=bearing]')!==null");call('select','[aria-label="Workspace asset"]','bearing');setup();call('eval','--stdin',stdin=hook)
 for fail in [False,True]:
  arm();call('select','[aria-label="Workspace asset"]','gear');release(fail);noresult();assert 'Controlled read failure' not in call('get','text','[aria-label="Original/current GLB UV inspection"]');rows.append('unmounted child '+('rejection' if fail else 'completion')+' cannot affect replacement child');call('select','[aria-label="Workspace asset"]','bearing');setup()
 call('screenshot','--full',str(out/'async.png'));(out/'evidence.json').write_text(json.dumps({'pass':True,'cases':rows,'method':'native controls; File.arrayBuffer timing/fault only, no React state or source changes'},indent=2)+'\n');print('PASS',rows)
except Exception as e:(out/'failure.txt').write_text(str(e)+'\n'+getattr(e,'stderr',''));(out/'snapshot.txt').write_text(call('snapshot','-i'));raise
finally:call('close')
