"""Actual local file uploads and DOM checks; no application state injection."""
import json,re,subprocess,sys
from pathlib import Path
out=Path(sys.argv[1]);session='morphloom-bound-reference-ui-'+out.name
def call(*args):
 return subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True,check=True,timeout=70).stdout
def ref(role,label):
 text=call('snapshot','-i');match=re.search(role+' "'+re.escape(label)+r'"[^\n]*?ref=(e\d+)',text);assert match,(label,text);return '@'+match[1]
def click(label):call('click',ref('button',label))
def upload(kind,path):call('upload','[aria-label="'+kind+' reference GLB"]',str(path))
def wait(text):call('wait','--text',text)
root=Path('/Users/danny/Documents/morphloom/outputs');files=root/'bound-reference-uv-20261003'
original=root/'uvscale-current-20261003/conformance-final/native-default.glb'
current=root/'source-spec-reference-20261003/final-current/gear.glb'
try:
 call('open','http://127.0.0.1:4179/viewer.html?editor=elements')
 call('wait','--fn',"document.querySelector('[aria-label=\"Original/current GLB UV inspection\"]')!==null")
 call('download',ref('button','Save project JSON'),str(out/'before.elements.json'))
 call('click','[aria-label="Original/current GLB UV inspection"] > summary')
 upload('Original',original);upload('Translated',current);click('Inspect bound reference UV');wait('Bound reference UV: PASS')
 call('download',ref('button','Save bound reference UV report'),str(out/'healthy.json'))
 d=json.loads((out/'healthy.json').read_text());assert d['report']['integrityPass'] and d['currentEditableIRAvailable'] is False
 assert len(d['report']['meshes'][0]['features'])==24
 call('screenshot','--full',str(out/'healthy.png'))
 upload('Translated',files/'damaged-current-v2.glb')
 assert 'Save bound reference UV report' not in call('snapshot','-i')
 click('Inspect bound reference UV');wait('Bound reference UV: BLOCKED');wait('Original/current BIN differs')
 upload('Original',files/'damaged-original-v2.glb');click('Inspect bound reference UV');wait('Bound reference UV: FAIL')
 call('download',ref('button','Save bound reference UV report'),str(out/'damaged.json'))
 d=json.loads((out/'damaged.json').read_text());assert not d['report']['integrityPass']
 assert any(not f['integrityPass'] and f['degenerateUvTriangles']==24 for f in d['report']['meshes'][0]['features'])
 call('click','[aria-label="Original/current GLB UV inspection"] details > summary');wait('spur_gear/tooth_0003: FAIL')
 call('screenshot','--full',str(out/'damaged.png'))
 upload('Original',original);upload('Translated',current);click('Inspect bound reference UV');wait('Bound reference UV: PASS')
 call('download',ref('button','Save project JSON'),str(out/'after.elements.json'))
 assert (out/'before.elements.json').read_bytes()==(out/'after.elements.json').read_bytes()
 evidence={'pass':True,'cases':['native pair upload/PASS','24 connected tooth results','actual downloaded receipt/IR false','new file invalidates receipt','wrong original BIN BLOCKED','damaged tooth FAIL and displayed','failure recovery','source project bytes preserved'],'method':'native UI/file/DOM only'}
 (out/'browser-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
except Exception as e:
 (out/'failure.txt').write_text(str(e)+'\n'+getattr(e,'stderr',''));(out/'failure-snapshot.txt').write_text(call('snapshot','-i'));raise
finally:call('close')
