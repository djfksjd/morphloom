import subprocess,json,re,sys,hashlib
from pathlib import Path
session=sys.argv[1];out=Path(sys.argv[2]).resolve()
def call(*args):return subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True,check=True,timeout=70).stdout
def button(label):
 s=call('snapshot','-i');r=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert r,label;call('click','@'+r[1])
def save(label,name):
 s=call('snapshot','-i');r=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert r,label;call('download','@'+r[1],str(out/name));return json.loads((out/name).read_text()) if name.endswith('.json') else None
def ready(count):
 call('wait','--fn',"document.querySelector('[aria-label=\"내보내기 및 비용 검증\"]').textContent.includes('PASS')&&!document.querySelector('select').disabled")
 call('wait','--fn',"Array.from(document.querySelectorAll('.quality-row')).find(e=>e.textContent.includes('공유 모서리')).textContent.includes('방향 충돌 "+str(count)+"개')")
expected=json.loads((out/'ui-input.assembly.json').read_text());call('open','http://127.0.0.1:4179');call('wait','--fn','!document.querySelector("select").disabled');call('upload','input[type=file]',str(out/'ui-input.assembly.json'));call('wait','--fn','document.body.textContent.includes("BLADE WINDING EDIT")');ready(40)
s=call('snapshot','-i')
if 'button "실측 도구 끄기"' in s:button('실측 도구 끄기')
call('mouse','move','480','320');call('mouse','down');call('mouse','up');call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('blade_core')")
call('check','[aria-label="Outward blade side walls"]');button('Cancel component edit');assert save('SAVE IR','ui-after-cancel.assembly.json')==expected
call('check','[aria-label="Outward blade side walls"]');button('Apply component edit');ready(0);edited=save('SAVE IR','ui-after-edit.assembly.json');assert edited['components'][0]['geometry']['sideWinding']['schema']=='morphloom.blade-side-winding/0.1';save('GLB · BLENDER/UNITY/UNREAL/GODOT','ui-after-edit.glb');call('screenshot',str(out/'ui-after-edit.png'))
button('Undo component edit');ready(40);assert save('SAVE IR','ui-after-undo.assembly.json')==expected
button('Redo component edit');ready(0);assert save('SAVE IR','ui-after-redo.assembly.json')==edited
call('upload','input[type=file]',str(out/'ui-after-edit.assembly.json'));ready(0);assert save('SAVE IR','ui-after-reopen.assembly.json')==edited
report={'pass':True,'cases':['actual Cancel preserves source','Apply current0 from40','Undo40','Redo0','Save IR/reopen exact','regular GLB export'],'method':'native canvas/inputs/save/upload; no state injection','glbSha256':hashlib.sha256((out/'ui-after-edit.glb').read_bytes()).hexdigest()};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
