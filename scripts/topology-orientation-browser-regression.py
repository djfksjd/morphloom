import subprocess,json,re
from pathlib import Path
import sys
out=Path(sys.argv[2]).resolve();session=sys.argv[1]
def call(*a,stdin=None):return subprocess.run(['agent-browser','--session',session,*a],input=stdin,capture_output=True,text=True,timeout=45,check=True).stdout
call('open','http://127.0.0.1:4179');call('wait','--fn','!document.querySelector("select").disabled');call('upload','input[type=file]',str(out/'legacy.assembly.json'));call('wait','--fn','document.body.textContent.includes("TUBE ORIENTATION AUDIT")');call('wait','--fn','!document.querySelector("select").disabled')
s=call('snapshot','-i');m=re.search(r'button "실측 도구 끄기" \[ref=(e\d+)\]',s)
if m:call('click','@'+m[1])
def pick(id,x,y):
 call('mouse','move',str(x),str(y));call('mouse','down');call('mouse','up');call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('"+id+"')")
def save(n):
 s=call('snapshot','-i');ref=re.search(r'button "SAVE IR" \[ref=(e\d+)\]',s);assert ref;call('download','@'+ref[1],str(out/(n+'.assembly.json')));return json.loads((out/(n+'.assembly.json')).read_text())


def download(button,name):
 s=call('snapshot','-i');ref=re.search('button "'+re.escape(button)+'" \[ref=(e\d+)\]',s);assert ref;call('download','@'+ref[1],str(out/name))
def row():return call('eval',"Array.from(document.querySelectorAll('.quality-row')).find(x=>x.textContent.includes('공유 모서리')).textContent")
def ready():call('wait','--fn',"document.querySelector('[aria-label=\"내보내기 및 비용 검증\"]').textContent.includes('PASS')&&!document.querySelector('select').disabled")
ready();assert '16' in row();before=save('ui-legacy');download('GLB · BLENDER/UNITY/UNREAL/GODOT','ui-legacy.glb');call('screenshot',str(out/'ui-legacy.png'))
pick('tube',480,320);call('check','[aria-label="Flat tube cap finish"]');s=call('snapshot','-i');apply=re.search(r'button "Apply component edit" \[ref=(e\d+)\]',s);assert apply;call('click','@'+apply[1]);call('wait','--fn',"Array.from(document.querySelectorAll('.quality-row')).find(x=>x.textContent.includes('공유 모서리')).textContent.includes('방향 충돌 0개')");ready();after=save('ui-flat');assert after['components'][0]['geometry']['capFinish']=='flat-outward';download('GLB · BLENDER/UNITY/UNREAL/GODOT','ui-flat.glb');call('screenshot',str(out/'ui-flat.png'))
s=call('snapshot','-i');undo=re.search(r'button "Undo component edit" \[ref=(e\d+)\]',s);assert undo;call('click','@'+undo[1]);call('wait','--fn',"Array.from(document.querySelectorAll('.quality-row')).find(x=>x.textContent.includes('공유 모서리')).textContent.includes('방향 충돌 16개')");ready();assert save('ui-undo')==before
import hashlib
report={'schema':'morphloom.orientation-browser/0.1','pass':True,'legacyConflicts':16,'flatConflicts':0,'undoRestoredLegacy':True,'method':'actual native IR/upload/selection/flat migration/save/GLB/Undo; no state injection','files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.suffix in ['.glb','.png'] or p.name.endswith('.assembly.json')}};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
