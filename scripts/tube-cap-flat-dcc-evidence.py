"""Actual GLBs, corner normal/UV audits, and same fixed-camera render pairs."""
from pathlib import Path
import subprocess,json,hashlib,sys
r=Path(__file__).resolve().parent;o=Path(sys.argv[1]).resolve();b='/Applications/Blender.app/Contents/MacOS/Blender'
rows=json.loads((o/'browser-evidence.json').read_text())['rows']
for row in rows:
 n=row['name'];src=o/(n+'.glb');assert hashlib.sha256(src.read_bytes()).hexdigest()==row['outputSha256'];target='tube' if n.startswith('demo') else 'cage-rear-spoke-1'
 native=json.loads((o/(n+'.assembly.json')).read_text());seg=next(c['geometry']['radialSegments'] for c in native['components'] if c['id']==target)
 for label,script,args in [('roundtrip','blender-glb-roundtrip.py',[src,o/(n+'-roundtrip.glb'),o/(n+'-blender.json')]),('flat','blender-flat-cap-audit.py',[src,o/(n+'-flat.json'),target,str(seg)]),('orientation','blender-tube-cap-audit.py',[src,o/(n+'-orientation.json'),target])]:
  with (o/(n+'-'+label+'.log')).open('w') as log:subprocess.run([b,'--background','--python-exit-code','1','--python',str(r/script),'--',*map(str,args)],stdout=log,stderr=subprocess.STDOUT,timeout=90,check=True)
 d=json.loads((o/(n+'-flat.json')).read_text());assert d['uniformNormalPass']==n.endswith('after');assert d['planarUvPass']==n.endswith('after');assert json.loads((o/(n+'-orientation.json')).read_text())['orientationPass'];print(n+' flat normal dot='+str(d['minimumCornerNormalDotFace'])+' UV edge spread='+str(d['uvEdgeScaleRelativeSpread']),flush=True)
for n in ['demo-before','demo-after']:
 for view,mode in [('front-iso','clay'),('front','grazing')]:
  label=n+'-'+view+'-'+mode
  with (o/(label+'.log')).open('w') as log:subprocess.run([b,'--background','--python-exit-code','1','--python',str(r/'blender-neutral-render.py'),'--',str(o/(n+'.glb')),str(o/(label+'.png')),str(o/(label+'.json')),view,mode,str(o/'neutral-space.json')],stdout=log,stderr=subprocess.STDOUT,timeout=90,check=True)
  print(label+' PASS',flush=True)
