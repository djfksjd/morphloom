import subprocess,json,re,sys
from pathlib import Path
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True);session='morphloom-static-current'
def call(*a):return subprocess.run(['agent-browser','--session',session,*a],capture_output=True,text=True,timeout=120,check=True).stdout
call('open','http://127.0.0.1:4179/?asset=asphalt-surface');call('wait','--fn','Array.from(document.querySelectorAll("[aria-label]")).find(x=>x.getAttribute("aria-label")==="내보내기 및 비용 검증")?.textContent.includes("PASS")');rows=[]
for label,name in [('SAVE ASSET PACK GLB + OBJ/STL/PLY + IR + quality + preview + Figma SVG ↓','asphalt-pack.zip'),('CAD MESH · OBJ','asphalt.obj'),('PRINT MESH · STL (MM)','asphalt.stl'),('PLY · MESHLAB/CLOUDCOMPARE','asphalt.ply'),('USDZ · APPLE AR','asphalt.usdz')]:
 s=call('snapshot','-i');m=re.search('button "'+re.escape(label)+'" \[ref=(e[0-9]+)\]',s);assert m,label;call('download','@'+m[1],str(out/name));rows.append({'file':name,'exitCode':0})
(out/'browser-downloads.json').write_text(json.dumps(rows,indent=2)+'\n');call('close');print('Actual current static downloads PASS')
