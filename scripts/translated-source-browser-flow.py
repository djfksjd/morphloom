"""Native binding, downloads, fresh-session reload and additional edit. No app state injection."""
import json,re,subprocess,sys,hashlib
from pathlib import Path
root=Path(sys.argv[1]);manifest=json.loads((root/'browser-originals-final.json').read_text());results=[]
for row in manifest['rows']:
 name=row['id'];out=root/'browser-flow'/name;out.mkdir(parents=True,exist_ok=False);session='morphloom-source-flow-'+name+'-20261004'
 def call(*args):return subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True,check=True,timeout=70).stdout
 def ref(label):
  s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+r'"[^\n]*?ref=(e\d+)',s);assert m,(label,s);return '@'+m[1]
 def click(label):call('click',ref(label))
 def save(label,file):call('download',ref(label),str(file))
 def exported(label,folder):
  folder.mkdir();call('--download-path',str(folder),'download',ref(label),str(folder/'observed.download'))
  candidates=[p for p in folder.rglob('*') if p.is_file() and p.read_bytes()[:4]==b'glTF'];assert len(candidates)==1,candidates
  result=folder/'regenerated.glb';result.write_bytes(candidates[0].read_bytes());return result
 try:
  call('--download-path',str(out/'sidecars'),'open','http://127.0.0.1:4179/?editor=elements');call('wait','--fn',"document.querySelector('[aria-label=\"Original/current GLB UV inspection\"]')!==null")
  call('click','[aria-label="Original/current GLB UV inspection"] > summary')
  for label,key in [('Original','original'),('Translated','current')]:call('upload','[aria-label="'+label+' reference GLB"]',row[key])
  click('Inspect bound reference UV');call('wait','--text','Bound reference UV: PASS');click('Generate modified native source JSON');call('wait','--text','Modified native source: VERIFIED')
  save('Save modified source JSON',out/'modified.elements.json');save('Save source regeneration proof',out/'proof.json');call('screenshot','--full',str(out/'verified.png'))
  modified=json.loads((out/'modified.elements.json').read_text());expected=json.loads(Path(row['source']).read_text());assert modified==expected
  before={p['id']:p for p in modified['parts']};proof=json.loads((out/'proof.json').read_text());assert proof['sourceFingerprint']==hashlib.sha256((out/'modified.elements.json').read_bytes()).hexdigest()
  # A truly fresh browser session reloads the downloaded source.
  call('close');session+='-reopen';call('--download-path',str(out/'reload-sidecars'),'open','http://127.0.0.1:4179/?editor=elements');call('wait','--fn',"document.querySelector('nav input[type=file]')!==null");call('upload','nav input[type=file]',str(out/'modified.elements.json'));call('wait','--fn',"document.querySelector('form input')!==null")
  call('fill','form input',row['target']);click('Select');call('wait','--fn',"Array.from(document.querySelectorAll('summary')).some(e=>e.textContent.includes('UV quality: integrity PASS'))")
  save('Save project JSON',out/'resaved.elements.json');resaved=json.loads((out/'resaved.elements.json').read_text());assert {k:v for k,v in resaved.items() if k!='selection'}=={k:v for k,v in modified.items() if k!='selection'}
  first=exported('Export project GLB + source JSON',out/'first');second=exported('Export project GLB + source JSON',out/'repeat');assert first.read_bytes()==second.read_bytes(),'Repeated GLB bytes differ'
  # Additional native edit, Undo and Redo prove the reopened IR remains editable.
  target=before[row['target']];newx=target['position'][0]+1;call('fill','[aria-label="Position X"]',str(newx));click('Apply part edit');save('Save project JSON',out/'additional.elements.json')
  additional=json.loads((out/'additional.elements.json').read_text());wanted=json.loads(json.dumps(resaved));next(p for p in wanted['parts'] if p['id']==row['target'])['position'][0]=newx;assert additional==wanted
  click('Undo');save('Save project JSON',out/'undo.elements.json');assert json.loads((out/'undo.elements.json').read_text())==resaved
  click('Redo');save('Save project JSON',out/'redo.elements.json');assert json.loads((out/'redo.elements.json').read_text())==additional
  call('screenshot','--full',str(out/'reopened-edited.png'))
  results.append({'id':name,'pass':True,'regenerated':str(first),'source':str(out/'modified.elements.json'),'sourceSha256':proof['sourceFingerprint'],'regeneratedSha256':hashlib.sha256(first.read_bytes()).hexdigest(),'checks':['native binding+UV+reconstruction','actual source/proof downloads','fresh session reload','no-op resave except UI selection','repeated export entire GLB exact','additional edit/Undo/Redo; all other IR fields exact']});print('PASS native flow',name,flush=True)
 except Exception as e:
  (out/'failure.txt').write_text(str(e)+'\n'+getattr(e,'stderr',''));(out/'failure-snapshot.txt').write_text(call('snapshot','-i'));raise
 finally:call('close')
(root/'browser-flow.json').write_text(json.dumps({'pass':True,'engine':'0.12','rows':results},indent=2)+'\n')
