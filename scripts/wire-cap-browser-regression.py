import subprocess,json,re,sys,hashlib
from pathlib import Path
session=sys.argv[1];out=Path(sys.argv[2]).resolve()
def call(*a,stdin=None):return subprocess.run(['agent-browser','--session',session,*a],input=stdin,capture_output=True,text=True,check=True,timeout=70).stdout
def button(label):
 s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert m,label;call('click','@'+m[1])
def save(label,name):
 s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert m,label;call('download','@'+m[1],str(out/name));return json.loads((out/name).read_text())if name.endswith('.json')else None
def pick(id,y):
 call('mouse','move','480',str(y));call('mouse','down');call('mouse','up');call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('Stable ID: "+id+"')")
def ready(count):
 call('wait','--fn',"document.querySelector('[aria-label=\"내보내기 및 비용 검증\"]').textContent.includes('PASS')&&!document.querySelector('select').disabled")
 call('wait','--fn',"Array.from(document.querySelectorAll('.quality-row')).find(e=>e.textContent.includes('공유 모서리')).textContent.includes('방향 충돌 "+str(count)+"개')")
def idle():call('wait','--fn',"!document.querySelector('[aria-label=\"Wire flat cap finish\"]').disabled")
expected=json.loads((out/'ui-input.assembly.json').read_text());call('open','http://127.0.0.1:4179');call('wait','--fn','!document.querySelector("select").disabled');call('upload','input[type=file]',str(out/'ui-input.assembly.json'));call('wait','--fn','document.body.textContent.includes("WIRE CAP EDIT AUDIT XY")');ready(40);button('TOP');s=call('snapshot','-i')
if 'button "실측 도구 끄기"'in s:button('실측 도구 끄기')
pick('wire-alpha',320);call('eval','--stdin',stdin=(Path(__file__).parent/'editor-selection-browser-harness.js').read_text());call('check','[aria-label="Wire flat cap finish"]');call('eval','window.__editorDigestTest.arm()');button('Apply wire cap edit');call('wait','--fn','window.__editorDigestTest.pending()');pick('wire-beta',282);pick('wire-alpha',320);call('wait','--fn',"!document.querySelector('[aria-label=\"Wire flat cap finish\"]').checked");call('eval','window.__editorDigestTest.release()');idle();assert save('SAVE IR','ui-after-aba.assembly.json')==expected;assert 'true' in call('eval',"document.querySelector('[aria-label=\"Assembly component editor\"] [role=alert]')===null");call('eval','window.__editorDigestTest.restore()')
call('check','[aria-label="Wire flat cap finish"]');button('Cancel wire cap edit');assert save('SAVE IR','ui-after-cancel.assembly.json')==expected
call('check','[aria-label="Wire flat cap finish"]');button('Apply wire cap edit');ready(20);edited=save('SAVE IR','ui-after-edit.assembly.json');assert edited['electrical']['wires'][0]['capFinish']['schema']=='morphloom.wire-cap-finish/0.1';assert edited['electrical']['wires'][1:]==expected['electrical']['wires'][1:];assert edited['components']==expected['components'];assert edited['electrical']['ports']==expected['electrical']['ports'];save('GLB · BLENDER/UNITY/UNREAL/GODOT','ui-after-edit.glb');call('screenshot',str(out/'ui-after-edit.png'))
button('Undo component edit');ready(40);assert save('SAVE IR','ui-after-undo.assembly.json')==expected
button('Redo component edit');ready(20);assert save('SAVE IR','ui-after-redo.assembly.json')==edited
call('upload','input[type=file]',str(out/'ui-after-edit.assembly.json'));call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('부품을 선택하면')");ready(20);assert save('SAVE IR','ui-after-reopen.assembly.json')==edited
report={'pass':True,'cases':['real SHA completion and native selection A/B/A cancel stale commit/no stale error','Cancel preserves IR','Apply one wire40→20 total, remaining wire20 remains blocker','other wires/ports/components exact','Undo40','Redo20','saved IR reopen exact','regular GLB export'],'method':'native canvas/input/real digest/save/reopen; no state injection','glbSha256':hashlib.sha256((out/'ui-after-edit.glb').read_bytes()).hexdigest()};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
