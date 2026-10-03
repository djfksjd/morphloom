"""Actual uploads/downloads with controlled file-read timing; no React state injection."""
import subprocess,sys,json,re,hashlib
from pathlib import Path
session=sys.argv[1];out=Path(sys.argv[2]).resolve();script=Path(__file__).resolve().parent

def call(*args,stdin=None):
 p=subprocess.run(['agent-browser','--session',session,*args],input=stdin,capture_output=True,text=True,timeout=45,check=True)
 if 'Evaluation error:' in p.stdout+p.stderr:raise RuntimeError('Browser test evaluator failed')
 return p.stdout

def pending(tag):
 name='async-'+tag+'.assembly.json';call('upload','input[type=file]',str(out/name));call('wait','--fn',f'window.__morphloomImportTest.pending().includes({json.dumps(name)})')

def release(tag,fail=False):call('eval',f'window.__morphloomImportTest.{"fail" if fail else "release"}({json.dumps("async-"+tag+".assembly.json")})')

def painted(condition):return call('eval','(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);if(!('+condition+'))throw Error("Native import ownership assertion failed");return "PASS";})()')

def save(name):
 s=call('snapshot','-i');ref=re.search(r'button "SAVE IR" \[ref=(e\d+)\]',s)
 if not ref:raise RuntimeError('Native SAVE IR unavailable')
 p=out/(name+'.assembly.json');call('download','@'+ref[1],str(p));return json.loads(p.read_text())

def note():return call('get','text','.viewer-note p').strip()

# CSS attribute selectors use single quotes inside the JavaScript string.
def ready():call('wait','--fn',"document.querySelector('[aria-label=\"내보내기 및 비용 검증\"]').textContent.includes('PASS') && !document.querySelector('select[aria-label=\"검수할 결과 선택\"]').disabled")

call('open',sys.argv[3] if len(sys.argv)>3 else 'http://127.0.0.1:4179');ready()
call('eval','--stdin',stdin=(script/'async-import-browser-harness.js').read_text());expected=json.loads((out/'async-b.assembly.json').read_text());rows=[]
pending('a');pending('b');release('b');call('wait','--fn','document.body.textContent.includes("ASYNC IMPORT B")');ready();release('a');painted('document.body.textContent.includes("ASYNC IMPORT B") && !document.body.textContent.includes("ASYNC IMPORT A")');assert save('final-reverse-order')==expected;rows.append({'case':'reverse-success','pass':True})
pending('a');pending('b');release('b');ready();before=note();release('a',True);painted('!document.body.textContent.includes("Delayed fixture read failure")');assert note()==before;assert save('final-stale-error')==expected;rows.append({'case':'stale-error','pass':True})
(out/'async-bad.assembly.json').write_text('{');pending('a');pending('bad');release('bad');painted('document.querySelector(".viewer-note p").textContent.includes("JSON")');before=note();release('a');painted('document.body.textContent.includes("ASYNC IMPORT B")');assert note()==before;assert save('final-newer-invalid')==expected;rows.append({'case':'newer-invalid','pass':True})
(out/'async-large.json').write_bytes(b' ' * 2000001);pending('a');call('upload','input[type=file]',str(out/'async-large.json'));painted('document.querySelector(".viewer-note p").textContent.includes("2MB") && document.querySelector("input[type=file]").value === ""');before=note();release('a');painted('document.body.textContent.includes("ASYNC IMPORT B")');assert note()==before;assert save('final-newer-oversized')==expected;rows.append({'case':'newer-oversized','pass':True})
pending('a');call('select','select[aria-label="검수할 결과 선택"]','blade');ready();switched=save('final-switch-before-old');release('a');painted("document.querySelector('select[aria-label=\"검수할 결과 선택\"]').value === 'blade'");assert save('final-switch-after-old')==switched;rows.append({'case':'real-asset-switch','pass':True})
# A committed edit also supersedes an older pending file.
pending('b');release('b');call('wait','--fn','document.body.textContent.includes("ASYNC IMPORT B")');painted("document.querySelector('select').value === 'imported'");ready()
snapshot=call('snapshot','-i');measurement=re.search(r'button "실측 도구 끄기" \[ref=(e\d+)\]',snapshot)
if measurement:call('click','@'+measurement[1])
point=json.loads(call('eval','(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()'))
call('mouse','move',str(round(point['x'])),str(round(point['y'])));call('mouse','down');call('mouse','up')
call('wait','--fn',"document.querySelector('[aria-label=\"Assembly component editor\"]').textContent.includes('part-b')")
pending('a');call('fill','[aria-label="Component position X"]','2')
snapshot=call('snapshot','-i');apply=re.search(r'button "Apply component edit" \[ref=(e\d+)\]',snapshot);assert apply;call('click','@'+apply[1]);call('wait','--fn',"Array.from(document.querySelectorAll('.selected-part-card button')).some(b=>b.textContent==='Undo component edit'&&!b.disabled)")
edited=save('final-edit-before-old');assert edited['components'][0]['position']==[2,0,0];release('a');painted('document.body.textContent.includes("ASYNC IMPORT B")');assert save('final-edit-after-old')==edited;rows.append({'case':'committed-component-edit','pass':True})
# Clearing and an explicitly fired native TTL callback are independent intents.
pending('a');snapshot=call('snapshot','-i');clear=re.search(r'button "CLEAR IMPORTED SESSION[^"\n]*" \[ref=(e\d+)\]',snapshot);assert clear;call('click','@'+clear[1]);ready();cleared=save('final-clear-before-old');release('a');painted('!document.body.textContent.includes("ASYNC IMPORT A")');assert save('final-clear-after-old')==cleared;rows.append({'case':'clear-imported-session','pass':True})
pending('b');release('b');ready();pending('a');call('eval','window.__morphloomImportTest.fireExpiry()');ready();expired=save('final-expiry-before-old');release('a');painted('!document.body.textContent.includes("ASYNC IMPORT A")');assert save('final-expiry-after-old')==expired;rows.append({'case':'native-ttl-callback-controlled-timer','pass':True})
call('eval','window.__morphloomImportTest.restore()')
report={'schema':'morphloom.async-import-browser/0.1','pass':True,'method':'actual File.text bytes and native UI uploads/downloads; only completion order controlled','rows':rows,'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('final-*.assembly.json')}};(out/'browser-evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
