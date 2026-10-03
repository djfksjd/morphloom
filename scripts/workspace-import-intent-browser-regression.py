"""Real mixed-workspace uploads and child edits; completion timing only."""
import subprocess,json,re,sys,hashlib
from pathlib import Path
out=Path(sys.argv[1]).resolve();session=sys.argv[2]
def call(*a,stdin=None):return subprocess.run(['agent-browser','--session',session,*a],input=stdin,capture_output=True,text=True,check=True,timeout=70).stdout
def ref(label):
 s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+'" \[ref=(e\d+)\]',s);assert m,label;return '@'+m[1]
def click(label):call('click',ref(label))
def save(name):
 p=out/name;call('download',ref('Save workspace JSON'),str(p));return json.loads(p.read_text())
def upload(name):call('upload','[aria-label="Load workspace JSON"]',str(out/name))
def hold(name='async-base.workspace.json'):upload(name);call('wait','--fn','window.__morphloomImportTest.pending().includes('+json.dumps(name)+')')
def release(name='async-base.workspace.json',fail=False):call('eval','window.__morphloomImportTest.'+('fail'if fail else'release')+'('+json.dumps(name)+')')
def wait_radius(n):call('wait','--fn','Math.abs(Number(document.querySelector('+json.dumps('[aria-label="Ball radius (mm)"]')+').value)-'+str(n)+')<0.000001')
def pick_bearing():call('select','[aria-label="Workspace asset"]','bearing');click('ball_0000')
def fill(n):call('fill','[aria-label="Ball radius (mm)"]',str(n))
def r(p):return next(x for a in p['assets']if a['id']=='bearing' for x in a['source']['parts']if x['id']=='ball_0000')['geometry']['radius']
call('open','http://127.0.0.1:4179/viewer.html?editor=workspace');upload('base.workspace.json');call('wait','--fn',"document.querySelector('[aria-label=\"Workspace asset\"] option[value=bearing]')!==null");pick_bearing();wait_radius(3);base=save('before.json');call('eval','--stdin',stdin=(Path(__file__).parent/'async-import-browser-harness.js').read_text());rows=[]
hold();fill(2.6);click('Apply part edit');release();wait_radius(2.6);edited=save('edited.json');assert abs(r(edited)-2.6)<1e-6;assert edited['assets'][0]==base['assets'][0];rows.append('Child Apply survives parent import; other domain/seed/datum exact')
hold();fill(2.7);release();wait_radius(2.7);assert save('draft.json')==edited;click('Cancel edit');wait_radius(2.6);rows.append('Child draft protected')
hold();click('Undo');release();wait_radius(3);assert save('child-undo.json')==base;rows.append('Child Undo protected')
hold();click('Redo');release();wait_radius(2.6);assert save('child-redo.json')==edited;rows.append('Child Redo protected')
hold();click('Undo workspace');click('ball_0000');release();wait_radius(3);assert save('parent-undo.json')==base;rows.append('Workspace Undo protected')
hold();click('Redo workspace');click('ball_0000');release();wait_radius(2.6);assert save('parent-redo.json')==edited;rows.append('Workspace Redo protected')
hold();hold('async-new.workspace.json');release('async-new.workspace.json');call('wait','--fn',"document.querySelector('[aria-label=\"Workspace asset\"]').value==='animal'");pick_bearing();wait_radius(2.8);newest=save('newest.json');release();assert save('reversed-completion.json')==newest;rows.append('Newest workspace file wins reversed completion')
hold();fill(2.4);click('Apply part edit');release(fail=True);wait_radius(2.4);latest=save('after-stale-error.json');assert 'Delayed fixture read failure'not in call('get','text','body');assert abs(r(latest)-2.4)<1e-6;rows.append('Stale read error discarded after child edit')
call('select','[aria-label="Workspace asset"]','animal');hold();call('select','[aria-label="Workspace asset"]','bearing');release();assert call('get','value','[aria-label="Workspace asset"]').strip()=='bearing';rows.append('Active asset selection preserved')
call('fill','[aria-label="Instance ID"]','bearing_second');hold();click('Append asset');release();combined=save('appended.json');assert len(combined['assets'])==3 and combined['assets'][:2]==latest['assets'];rows.append('Append retains both existing source assets')
call('eval','window.__morphloomImportTest.restore()');upload('after-stale-error.json');call('wait','--fn',"document.querySelector('[aria-label=\"Workspace asset\"]').value==='animal'");pick_bearing();wait_radius(2.4);assert save('reopened.json')==latest;rows.append('Current save/reopen restores both sources')
call('screenshot',str(out/'ui.png'));report={'pass':True,'cases':rows,'method':'native parent/child UI with actual File.text bytes; no React state injection','hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in out.glob('*.json')}};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));call('close')
