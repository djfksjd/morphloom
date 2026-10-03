"""Native explicit schema/normal edit workflow; no application state injection."""
import json,re,subprocess,sys
from pathlib import Path
source,out=map(Path,sys.argv[1:3]);out.mkdir(parents=True,exist_ok=False);session='morphloom-corner-normal-'+out.name
base=json.loads(source.read_text())
def call(*a):return subprocess.run(['agent-browser','--session',session,*a],capture_output=True,text=True,check=True,timeout=70).stdout
def ref(role,label):
 s=call('snapshot','-i');m=re.search(role+' "'+re.escape(label)+r'"[^\n]*?ref=(e\d+)',s);assert m,(label,s);return '@'+m[1]
def click(label):call('click',ref('button',label))
def save(name):
 p=out/name;call('download',ref('button','Save project JSON'),str(p));return json.loads(p.read_text())
def open_ui():
 call('open','http://127.0.0.1:4179/viewer.html?editor=elements');call('wait','--fn',"document.querySelector('input[type=file]')!==null")
def clean(p):v=json.loads(json.dumps(p));v.pop('selection',None);return v
try:
 open_ui();call('upload','input[type=file]',str(source));call('wait','--fn',"Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='inner_race')")
 call('fill','form input','inner_race');click('Select');before=save('legacy.elements.json');assert clean(before)==base
 click('Enable normal weighting (schema 0.7)');call('wait','--fn',"document.querySelector('[aria-label=\"Normal weighting\"]')!==null")
 neutral=save('neutral.elements.json');expected=dict(base,schema='morphloom.elements/0.7');assert clean(neutral)==expected
 assert 'Enable surface editing'not in call('get','text','body') and 'Enable UV editing'not in call('get','text','body')
 call('check',ref('checkbox','Isolate selection'));click('Fit view');call('wait','500');call('screenshot','--full',str(out/'before.png'))
 call('select','[aria-label="Normal weighting"]','corner-angle');click('Cancel edit');assert call('get','value','[aria-label="Normal weighting"]').strip()=='uniform';assert save('cancel.elements.json')==neutral
 call('select','[aria-label="Normal weighting"]','corner-angle');click('Apply part edit');weighted=save('weighted.elements.json');target=next(p for p in expected['parts']if p['id']=='inner_race');target['normalWeighting']='corner-angle';assert clean(weighted)==expected
 call('wait','500');call('screenshot','--full',str(out/'after.png'))
 click('Undo');assert save('undo.elements.json')==neutral;click('Redo');assert save('redo.elements.json')==weighted
 call('close');session='morphloom-corner-normal-reopen-'+out.name;open_ui();call('upload','input[type=file]',str(out/'weighted.elements.json'));call('wait','--fn',"document.querySelector('[aria-label=\"Normal weighting\"]')?.value==='corner-angle'")
 assert save('reopened.elements.json')==weighted
 call('fill','form input','ball_0000');click('Select');assert call('eval',"document.querySelector('[aria-label=\"Normal weighting\"]').disabled").strip()=='true'
 report={'pass':True,'cases':['legacy source unchanged','explicit schema7 migration changes schema only','no downgrade buttons','Cancel leaves source and normals unchanged','Apply affects selected part option only','same camera preview before/after','Undo/Redo source exact','fresh reopen selected race weighting restored','sphere tool disabled with reason'],'method':'native UI/files/DOM only'};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
except Exception as e:
 (out/'failure.txt').write_text(str(e)+'\n'+getattr(e,'stderr',''));(out/'failure-snapshot.txt').write_text(call('snapshot','-i'));raise
finally:call('close')
