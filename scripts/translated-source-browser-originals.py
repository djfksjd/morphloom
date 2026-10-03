"""Current-engine original GLBs through actual native editor upload/export."""
import json,re,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]);rows=[];names=sys.argv[2:] or ['small','default','large','gear']
for name in names:
 out=root/'browser-originals-v3'/name;out.mkdir(parents=True,exist_ok=False);session='morphloom-source-original-'+name+'-v3-20261004'
 def call(*args):return subprocess.run(['agent-browser','--session',session,*args],capture_output=True,text=True,check=True,timeout=70).stdout
 def ref(label):
  match=re.search('button "'+re.escape(label)+r'"[^\n]*?ref=(e\d+)',call('snapshot','-i'));assert match,label;return '@'+match[1]
 try:
  call('--download-path',str(out/'sidecars'),'open','http://127.0.0.1:4179/?editor=elements');call('wait','--fn',"document.querySelector('nav input[type=file]')!==null")
  call('upload','nav input[type=file]',str(root/(name+'.elements.json')))
  expected='spur_gear' if name=='gear' else 'ball_0000'; project=json.loads((root/(name+'.elements.json')).read_text()); label=next(p.get('name',p['id']) for p in project['parts'] if p['id']==expected);call('wait','--fn',"Array.from(document.querySelectorAll('button')).some(e=>e.textContent==="+json.dumps(label)+")")
  call('download',ref('Save project JSON'),str(out/'original.elements.json'))
  call('download',ref('Export project GLB + source JSON'),str(out/'export-observed.download'))
  # One action downloads three files; the CLI may observe any one of them.
  actual=[p for p in out.rglob('*') if p.is_file() and p.read_bytes()[:4]==b'glTF']
  assert len(actual)==1,actual
  (out/'original.glb').write_bytes(actual[0].read_bytes())
  rows.append({'id':name,'file':str(out/'original.glb'),'source':str(out/'original.elements.json'),'target':expected})
 except Exception as e:
  (out/'failure.txt').write_text(str(e)+'\n'+getattr(e,'stderr',''));raise
 finally:call('close')
(root/'browser-originals-v3.json').write_text(json.dumps({'pass':True,'engine':'0.12','rows':rows,'method':'native uploads/downloads, no application state injection'},indent=2)+'\n');print('PASS',len(rows),'current originals')
