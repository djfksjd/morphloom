"""Actual-file checks, fixed cameras and bounded native-tool runtime."""
import hashlib,json,subprocess,sys
from pathlib import Path
out=Path(sys.argv[1]).resolve();scripts=Path(__file__).resolve().parent;blender='/Applications/Blender.app/Contents/MacOS/Blender'
evidence=json.loads((out/'browser-evidence.json').read_text())
commands=[]
for row in evidence['rows']:
 p=out/(row['name']+'.glb')
 if hashlib.sha256(p.read_bytes()).hexdigest()!=row['outputSha256']:raise RuntimeError('File/receipt mismatch')
 commands.append((row['name']+'-roundtrip','blender-glb-roundtrip.py',[p,out/(row['name']+'-roundtrip.glb'),out/(row['name']+'-blender.json')]))
commands.append(('wire-edit','blender-component-edit-audit.py',[out/'domed.glb',out/'blender-wire-edited.glb',out/'blender-wire-edit.json','cage-front-spoke-1','1','0','0']))
for name in ['flat','domed']:
 for view,mode in [('side','clay'),('front-iso','clay'),('front-iso','wire')]:
  label=name+'-'+view+'-'+mode
  commands.append((label,'blender-neutral-render.py',[out/(name+'.glb'),out/(label+'.png'),out/(label+'.json'),view,mode,out/'neutral-space.json']))
for label,script,args in commands:
 with (out/(label+'.log')).open('w') as log:r=subprocess.run([blender,'--background','--python-exit-code','1','--python',str(scripts/script),'--',*map(str,args)],stdout=log,stderr=subprocess.STDOUT,timeout=90)
 if r.returncode:raise RuntimeError(label+' failed; inspect log')
 print(label+' PASS',flush=True)
