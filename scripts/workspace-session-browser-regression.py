"""Native session restore and legacy-source conformance; no application-state injection."""
import json,re,subprocess,sys,time,hashlib
from pathlib import Path
source,out=map(Path,sys.argv[1:3]);out.mkdir(parents=True,exist_ok=False)
base=json.loads(source.read_text());session='morphloom-session-create-'+out.name
url='http://127.0.0.1:4179/viewer.html?editor=workspace'
def call(*args):return subprocess.run(['agent-browser','--session',session,*args],check=True,capture_output=True,text=True,timeout=70).stdout
def ref(role,label):
 s=call('snapshot','-i');m=re.search(role+' "'+re.escape(label)+r'"[^\n]*?ref=(e\d+)',s);assert m,(label,s);return '@'+m[1]
def click(label):call('click',ref('button',label))
def save(label,name):
 p=out/name;call('download',ref('button',label),str(p));return json.loads(p.read_text())
def open_ui():
 call('open',url);call('wait','--fn','document.querySelector('+json.dumps('[aria-label="Load workspace JSON"]')+')!==null')
def loaded():call('wait','--fn',"document.querySelector('[aria-label=\"Workspace asset\"] option[value=bearing]')!==null")
def capture(name):call('screenshot','--full',str(out/name))
try:
 open_ui();call('upload','[aria-label="Load workspace JSON"]',str(source));loaded();call('select','[aria-label="Workspace asset"]','bearing');call('fill','form input','ball_0000');click('Select');call('wait','--fn',"document.querySelector('[aria-label=\"Ball radius (mm)\"]')!==null")
 assert save('Save workspace JSON','before.workspace.json')==base
 capture('before-save.png');wrapper=save('Save editor session JSON','saved.session.json')
 assert wrapper['workspace']==base and wrapper['activeAssetId']=='bearing' and wrapper['selectedId']=='ball_0000'
 # Asset switches preserve selection locally, without source edits/history entries.
 other=next(a['id'] for a in base['assets'] if a['id']!='bearing');call('select','[aria-label="Workspace asset"]',other);call('select','[aria-label="Workspace asset"]','bearing');call('wait','--fn',"document.querySelector('[aria-label=\"Ball radius (mm)\"]')!==null")
 call('close');session='morphloom-session-restore-'+out.name;open_ui();call('upload','[aria-label="Load workspace JSON"]',str(out/'saved.session.json'));loaded();call('wait','--fn',"document.querySelector('[aria-label=\"Ball radius (mm)\"]')!==null")
 assert call('get','value','[aria-label="Workspace asset"]').strip()=='bearing'
 radius=next(p['geometry']['radius'] for a in base['assets'] if a['id']=='bearing' for p in a['source']['parts'] if p['id']=='ball_0000')
 assert abs(float(call('get','value','[aria-label="Ball radius (mm)"]'))-radius)<1e-6
 assert save('Save editor session JSON','restored.session.json')==wrapper
 assert save('Save workspace JSON','restored.workspace.json')==base
 capture('after-reopen.png')
 bad=dict(wrapper,selectedId='bearing::ball_0000');(out/'invalid.session.json').write_text(json.dumps(bad));call('upload','[aria-label="Load workspace JSON"]',str(out/'invalid.session.json'));call('wait','--fn',"document.querySelector('[role=alert]').textContent.includes('workspace-session:selection')")
 assert save('Save workspace JSON','invalid-rejected.workspace.json')==base
 assert save('Save editor session JSON','invalid-rejected.session.json')==wrapper
 # Delay only actual File.text completion; pending session cannot overwrite draft or Apply.
 (out/'async-session.json').write_text(json.dumps(wrapper))
 harness=(Path(__file__).parent/'async-import-browser-harness.js').read_text()
 subprocess.run(['agent-browser','--session',session,'eval','--stdin'],input=harness,check=True,capture_output=True,text=True,timeout=70)
 def hold():
  call('upload','[aria-label="Load workspace JSON"]',str(out/'async-session.json'));call('wait','--fn',"window.__morphloomImportTest.pending().includes('async-session.json')")
 hold();call('fill','[aria-label="Ball radius (mm)"]',str(radius-0.1));call('eval',"window.__morphloomImportTest.release('async-session.json')");call('wait','300')
 assert abs(float(call('get','value','[aria-label="Ball radius (mm)"]'))-(radius-0.1))<1e-6
 assert save('Save workspace JSON','draft.workspace.json')==base;click('Cancel edit')
 hold();call('fill','[aria-label="Ball radius (mm)"]',str(radius-0.2));click('Apply part edit');call('eval',"window.__morphloomImportTest.release('async-session.json')");call('wait','300')
 edited=save('Save workspace JSON','applied.workspace.json');expected=json.loads(json.dumps(base));next(p for a in expected['assets'] if a['id']=='bearing' for p in a['source']['parts'] if p['id']=='ball_0000')['geometry']['radius']=radius-0.2;assert edited==expected
 click('Undo');assert save('Save workspace JSON','undo.workspace.json')==base
 call('eval','window.__morphloomImportTest.restore()')
 # Legacy source remains first-asset/no selection, rather than guessing a prior context.
 call('upload','[aria-label="Load workspace JSON"]',str(source));call('wait','--fn',"document.querySelector('[aria-label=\"Workspace asset\"]').value==="+json.dumps(base['assets'][0]['id']))
 legacy=save('Save editor session JSON','legacy.session.json');assert legacy['activeAssetId']==base['assets'][0]['id'] and legacy['selectedId']=='' and legacy['workspace']==base
 report={'pass':True,'method':'native clicks/uploads/downloads/DOM only','cases':['source remains byte-content exact','explicit session save','asset switch preserves selection without source patch','fresh browser restores selected ball inspector without reselect','restored wrapper and full source exact','invalid namespaced selection rejects atomically','pending session import cannot overwrite draft','pending session import cannot overwrite Apply; all non-target source fields exact','Undo restores original source','legacy source first asset and empty selection unchanged'],'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sessionSha256':hashlib.sha256((out/'saved.session.json').read_bytes()).hexdigest(),'scope':'camera/isolate/history not serialized'}
 (out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
except Exception as e:
 (out/'failure.txt').write_text(str(e)+'\n'+getattr(e,'stderr',''));(out/'failure-snapshot.txt').write_text(call('snapshot','-i'));raise
finally:call('close')
