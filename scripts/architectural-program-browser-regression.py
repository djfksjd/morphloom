import subprocess,json,re,sys
from pathlib import Path
out=Path(sys.argv[1]).resolve();session='morphloom-laurel-next'
def call(*args):return subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True,timeout=100,check=True).stdout
def download(label,name):
 s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+'" \[ref=(e[0-9]+)\]',s);assert m,label;call('download','@'+m[1],str(out/name))
def ready():call('wait','--fn','Array.from(document.querySelectorAll("[aria-label]")).find(x=>x.getAttribute("aria-label")==="내보내기 및 비용 검증")?.textContent.includes("PASS")')
def checks():return json.loads(call('eval','Array.from(document.querySelectorAll(".quality-row")).map(x=>x.textContent)'))
call('open','http://127.0.0.1:4179/?asset=laurel-homes');ready();download('SAVE IR','current.assembly.json');current=json.loads((out/'current.assembly.json').read_text());assert len(current['architecturalProgram']['requirements'])==48
rows=[];positive=checks();assert any('48/48'in x for x in positive);rows.append({'case':'default48/48','checks':positive});call('screenshot',str(out/'current.png'))
negative=json.loads(json.dumps(current));negative['name']='LAUREL MISSING ROOM AUDIT';negative['metadata']['programCompleteness']=100;negative['components']=[c for c in negative['components']if c['id']!='unit_1_bath_floor'];(out/'missing-room.assembly.json').write_text(json.dumps(negative))
call('upload','input[type=file]',str(out/'missing-room.assembly.json'));call('wait','--fn','document.body.textContent.includes("LAUREL MISSING ROOM AUDIT")');ready();negativeChecks=checks();assert any('47/48'in x for x in negativeChecks);assert json.loads(call('eval','!!document.querySelector(".quality-total em")')) is True;rows.append({'case':'one floor absent, forged metadata100, blocked47/48','checks':negativeChecks});call('screenshot',str(out/'missing-room.png'))
download('SAVE IR','missing-room-reopened.assembly.json');assert json.loads((out/'missing-room-reopened.assembly.json').read_text())==negative
call('upload','input[type=file]',str(out/'current.assembly.json'));call('wait','--fn','document.body.textContent.toUpperCase().includes("LAUREL HOMES BUILDING B")');ready();assert any('48/48'in x for x in checks());rows.append({'case':'restore saved current contract48/48'})
(out/'browser-evidence.json').write_text(json.dumps({'pass':True,'rows':rows,'method':'native upload/download; no React state injection'},indent=2)+'\n');call('close');print('Actual program UI positive/negative/save/restore PASS')
