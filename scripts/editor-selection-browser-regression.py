import subprocess,json,re
from pathlib import Path
import sys
out=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else Path('/Users/danny/Documents/morphloom/outputs/editor-selection-20261003');session=sys.argv[1]
def call(*a,stdin=None):return subprocess.run(['agent-browser','--session',session,*a],input=stdin,capture_output=True,text=True,timeout=45,check=True).stdout
call('open','http://127.0.0.1:4179');call('wait','--fn','!document.querySelector("select").disabled');call('upload','input[type=file]',str(out/'editor-race.assembly.json'));call('wait','--fn','document.body.textContent.includes("EDITOR SELECTION RACE")');call('wait','--fn','!document.querySelector("select").disabled')
s=call('snapshot','-i');m=re.search(r'button "실측 도구 끄기" \[ref=(e\d+)\]',s)
if m:call('click','@'+m[1])
def pick(id,x,y):
 call('mouse','move',str(x),str(y));call('mouse','down');call('mouse','up');call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('"+id+"')")
def save(n):
 s=call('snapshot','-i');ref=re.search(r'button "SAVE IR" \[ref=(e\d+)\]',s);assert ref;call('download','@'+ref[1],str(out/(n+'.assembly.json')));return json.loads((out/(n+'.assembly.json')).read_text())

expected=json.loads((out/'editor-race.assembly.json').read_text());rows=[]
call('eval','--stdin',stdin=(Path(__file__).parent/'editor-selection-browser-harness.js').read_text())
def apply():
 s=call('snapshot','-i');ref=re.search(r'button "Apply component edit" \[ref=(e\d+)\]',s);assert ref;call('click','@'+ref[1])
def idle():call('wait','--fn',"!document.querySelector('[aria-label=\"Component position X\"]').disabled")
def button(name):
 s=call('snapshot','-i');ref=re.search('button "'+name+'" \[ref=(e\d+)\]',s);assert ref;call('click','@'+ref[1])
def no_alert():
 result=call('eval',"(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);if(document.querySelector('[aria-label=\"Assembly component editor\"] [role=alert]'))throw Error('Stale error leaked');return true;})()");assert 'true' in result
pick('part-a',370,300);call('fill','[aria-label="Component position X"]','-63');call('eval','window.__editorDigestTest.arm()');apply();call('wait','--fn','window.__editorDigestTest.pending()');pick('part-b',620,340);pick('part-a',370,300);call('wait','--fn',"document.querySelector('[aria-label=\"Component position X\"]').value==='-65'");call('eval','window.__editorDigestTest.release()');idle();no_alert();assert save('after-aba')==expected;rows.append({'case':'selection-a-b-a-cancels-old-commit','pass':True})
call('fill','[aria-label="Component position X"]','-63');call('eval','window.__editorDigestTest.arm()');apply();call('wait','--fn','window.__editorDigestTest.pending()');pick('part-b',620,340);call('eval','window.__editorDigestTest.release()');idle();no_alert();assert save('after-one-way')==expected;rows.append({'case':'selection-a-b-suppresses-old-error','pass':True})
pick('part-a',370,300);call('fill','[aria-label="Component position X"]','-63');apply();idle();call('wait','--fn',"document.querySelector('[aria-label=\"Component position X\"]').value==='-63'");edited=save('after-normal-edit');assert edited['components'][0]['position']==[-63,0,0] and edited['components'][1]==expected['components'][1];rows.append({'case':'subsequent-valid-edit-and-non-target-preservation','pass':True})
button('Undo component edit');call('wait','--fn',"document.querySelector('[aria-label=\"Component position X\"]').value==='-65'");assert save('after-undo')==expected;button('Redo component edit');call('wait','--fn',"document.querySelector('[aria-label=\"Component position X\"]').value==='-63'");assert save('after-redo')==edited;rows.append({'case':'undo-redo','pass':True})
call('fill','[aria-label="Component position X"]','100001');apply();call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"] [role=alert]')!==null");assert save('after-current-invalid')==edited;rows.append({'case':'current-error-visible-and-no-commit','pass':True});button('Cancel component edit')
call('eval','window.__editorDigestTest.restore()');button('Undo component edit');call('wait','--fn',"document.querySelector('[aria-label=\"Component position X\"]').value==='-65'");assert save('before-reopen-undo')==expected;call('upload','input[type=file]',str(out/'after-normal-edit.assembly.json'));call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('부품을 선택하면')");call('wait','--fn','!document.querySelector("select").disabled');assert save('after-reopen')==edited;rows.append({'case':'saved-edited-ir-reopen','pass':True})
import hashlib
report={'schema':'morphloom.editor-selection-browser/0.1','pass':True,'rows':rows,'method':'native canvas/inputs/Undo/Redo/upload/save; one real SHA-256 completion controlled','files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.assembly.json')}};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
