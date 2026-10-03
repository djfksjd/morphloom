"""Real File.text bytes; control completion only, never React state."""
import subprocess,json,re,sys,hashlib,time,shutil
from pathlib import Path
out=Path(sys.argv[1]).resolve();session=sys.argv[2];out.mkdir(parents=True,exist_ok=True);downloads=out/'downloads';downloads.mkdir(exist_ok=True)
def call(*a,stdin=None):return subprocess.run(['agent-browser','--session',session,*a],input=stdin,capture_output=True,text=True,check=True,timeout=70).stdout
def ref(label):
 s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert m,label;return '@'+m[1]
def click(label):call('click',ref(label))
def save(name):
 p=out/name;call('download',ref('Save project JSON'),str(p));return json.loads(p.read_text())
def radius():return float(call('get','value','[aria-label="Ball radius (mm)"]').strip())
def wait_radius(n):call('wait','--fn',"Math.abs(Number(document.querySelector("+json.dumps('[aria-label="Ball radius (mm)"]')+").value)-"+str(n)+")<0.000001")
def upload(name):call('upload','input[type=file]',str(out/name))
def hold(name):upload(name);call('wait','--fn',"window.__morphloomImportTest.pending().includes("+json.dumps(name)+")")
def release(name,fail=False):call('eval',"window.__morphloomImportTest."+('fail' if fail else 'release')+'('+json.dumps(name)+')')
def settle():call('wait','--fn',"document.querySelector('input[type=file]').value==='' ")
def fill(n):call('fill','[aria-label="Ball radius (mm)"]',str(n))
call('--download-path',str(downloads),'open','http://127.0.0.1:4179/viewer.html?editor=elements');upload('base.json');wait_radius(3);settle()
base=save('before.json');call('eval','--stdin',stdin=(Path(__file__).parent/'async-import-browser-harness.js').read_text());rows=[]
hold('async-base.json');fill(2.6);click('Apply part edit');edited=save('edited.json');release('async-base.json');assert save('after-delayed-apply.json')==edited;rows.append('Apply preserves2.6mm after stale completion')
hold('async-base.json');fill(2.7);release('async-base.json');wait_radius(2.7);assert save('after-delayed-draft.json')==edited;click('Cancel edit');wait_radius(2.6);rows.append('Draft survives stale completion; Cancel retains applied source')
hold('async-base.json');click('Undo');wait_radius(3);release('async-base.json');assert save('after-delayed-undo.json')==base;rows.append('Undo remains current')
hold('async-base.json');click('Redo');wait_radius(2.6);release('async-base.json');assert save('after-delayed-redo.json')==edited;rows.append('Redo remains current')
hold('async-base.json');fill(2.5);click('Apply part edit');latest=save('latest.json');release('async-base.json',True);assert save('after-stale-error.json')==latest;assert 'Delayed fixture read failure' not in call('get','text','body');rows.append('Stale read error discarded')
hold('async-base.json');hold('async-edited.json');release('async-edited.json');wait_radius(2.8);settle();newest=save('newest.json');release('async-base.json');assert save('after-inverted-completion.json')==newest;rows.append('Newest file wins reversed completion')
hold('async-base.json');click('ball_0001');release('async-base.json');assert save('after-selection.json')['selection']==['ball_0001'];rows.append('New selection survives old file')
hold('async-base.json');click('Bird example');bird=save('bird.json');release('async-base.json');assert save('after-generation.json')==bird;rows.append('New Domain Pack survives old file')
call('eval','window.__morphloomImportTest.restore()');upload('async-edited.json');wait_radius(2.8);settle();current=save('reopened.json')
assert [p for p in current['parts'] if p['id']!='ball_0000']==[p for p in base['parts'] if p['id']!='ball_0000'];rows.append('Current normal import and selection/10 unrelated parts preserved')
call('close');session+='-export'
call('--download-path',str(downloads),'open','http://127.0.0.1:4179/viewer.html?editor=elements');upload('async-edited.json');wait_radius(2.8);settle();click('Export selected GLB + source JSON')
paths=[downloads/'morphloom-selection.glb',downloads/'morphloom-source.json',downloads/'morphloom-uv-quality.json']
deadline=time.monotonic()+30
while not all(p.exists() for p in paths):
 if time.monotonic()>deadline:raise RuntimeError('Download completion timeout')
 time.sleep(.1)
assert paths[0].read_bytes()[:4]==b'glTF';assert json.loads(paths[1].read_text())==current
uv=json.loads(paths[2].read_text());assert uv['meshExport']['uv']['allowed'] and uv['meshExport']['standard']['errors']==0
rows.append('All3 actual native downloads; glTF magic and JSON/UV gates checked')
call('screenshot',str(out/'ui.png'));report={'pass':True,'cases':rows,'sourceRevision':'assembly0.39; element-renderer0.10; UI intent change only','method':'native controls/File.text actual bytes; completion timing only','hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in paths}};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));call('close')
