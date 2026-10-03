import subprocess,json,re,sys,hashlib
from pathlib import Path
out=Path(sys.argv[2]).resolve();session=sys.argv[1]
def call(*a):return subprocess.run(['agent-browser','--session',session,*a],capture_output=True,text=True,timeout=70,check=True).stdout
def ready():call('wait','--fn',"document.querySelector('[aria-label=\"내보내기 및 비용 검증\"]').textContent.includes('PASS')&&!document.querySelector('select').disabled")
def button(label):
 s=call('snapshot','-i');ref=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert ref,label;call('click','@'+ref[1])
def download(label,name):
 s=call('snapshot','-i');ref=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert ref;call('download','@'+ref[1],str(out/name))
def row(count):call('wait','--fn',"Array.from(document.querySelectorAll('.quality-row')).find(e=>e.textContent.includes('공유 모서리')).textContent.includes('방향 충돌 "+str(count)+"개')")
call('open','http://127.0.0.1:4179');call('wait','--fn','!document.querySelector("select").disabled');call('upload','input[type=file]','/Users/danny/Documents/morphloom/outputs/topology-orientation-20261003/ui-flat.assembly.json');call('wait','--fn','document.body.textContent.includes("TUBE ORIENTATION AUDIT")');ready();row(0)
s=call('snapshot','-i')
if 'button "실측 도구 끄기"'in s:button('실측 도구 끄기')
call('mouse','move','480','320');call('mouse','down');call('mouse','up');call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('tube')")
rows=[]
for mode in ['Clay','Wire','X-Ray']:
 button(mode);call('uncheck','[aria-label="Flat tube cap finish"]');button('Apply component edit')
 pending=call('eval',"(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const r=Array.from(document.querySelectorAll('.quality-row')).find(e=>e.textContent.includes('공유 모서리'));if(!r.textContent.includes('not-run'))throw Error('Stale geometry score retained while pending');return r.textContent;})()")
 ready();row(16);download('SAVE IR',mode.lower()+'-edited.assembly.json');download('GLB · BLENDER/UNITY/UNREAL/GODOT',mode.lower()+'-edited.glb');call('screenshot',str(out/(mode.lower()+'-edited.png')))
 assert 'capFinish' not in json.loads((out/(mode.lower()+'-edited.assembly.json')).read_text())['components'][0]['geometry']
 rows.append({'mode':mode,'pending':pending,'currentConflicts':16,'regularGlbSha256':hashlib.sha256((out/(mode.lower()+'-edited.glb')).read_bytes()).hexdigest()});button('Undo component edit');ready();row(0)
button('Beauty');ready();row(0);download('GLB · BLENDER/UNITY/UNREAL/GODOT','beauty-restored.glb');report={'schema':'morphloom.inspection-metrics-browser/0.1','pass':True,'method':'actual native modes/edit/Undo/regular Save IR and GLB; no state injection','rows':rows,'restoredBeautyConflicts':0};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
