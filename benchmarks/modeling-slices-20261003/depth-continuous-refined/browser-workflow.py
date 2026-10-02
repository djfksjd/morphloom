import subprocess,pathlib,re,json,hashlib
root=pathlib.Path('/Users/danny/Documents/morphloom');out=root/'outputs/depth-continuous-20261003/refined/browser';out.mkdir(exist_ok=True)
def run(*args):
 r=subprocess.run(['agent-browser','--session','morphloom-gear',*args],capture_output=True,text=True,timeout=40)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout
def ref(label,kind):
 m=re.search(rf'{kind} "{re.escape(label)}".*?ref=(e\d+)',run('snapshot','-i'))
 if not m:raise RuntimeError('Missing '+label)
 return '@'+m.group(1)
def load(file):
 run('open','http://127.0.0.1:4176/?editor=depth');run('wait','input[type=file]');run('upload','input[type=file]',str(file));run('wait','main.depth-editor > details')
def save(name):
 run('download',ref('원본 필드 + 편집 상태 저장','button'),str(out/(name+'.depth.json')));return json.loads((out/(name+'.depth.json')).read_text())
load(root/'outputs/depth-boundary-20261003/fixtures/large-checker-depth.depth.json')
run('check',ref('선언된 IR 구면으로 가시 표면 후보','checkbox'));run('select',ref('시점','combobox'),'iso');run('screenshot',str(out/'grid.png'));grid=save('grid')
run('click','main.depth-editor > details:nth-of-type(2) > summary')
# Invalid budget must preserve current native; cancel restores the declared draft.
run('fill',ref('구면 chord 허용오차 mm','spinbutton'),'0.00001');run('click',ref('연속 경계 적용','button'));assert 'budget' in json.loads(run('eval','document.body.innerText'));assert save('failed')==grid
run('click',ref('연속 경계 입력 취소','button'))
run('check',ref('연속 구면 전면 (대상 topology·UV 변경)','checkbox'));continuous=save('continuous');assert continuous['schema']=='morphloom.depth-surface/0.3' and continuous['meshing']['mode']=='declared-sphere-front'
for key in ['samples','mask','quality','calibration','primaryForm','imageSha256','rawFieldSha256']:assert continuous[key]==grid[key]
run('screenshot',str(out/'continuous.png'));run('download',ref('진단 GLB 내보내기','button'),str(out/'continuous.glb'))
run('click',ref('Undo','button'));assert save('undo')==grid
run('click',ref('Redo','button'));assert save('redo')==continuous
run('fill',ref('구면 chord 허용오차 mm','spinbutton'),'0.015');run('click',ref('연속 경계 적용','button'));edited=save('edited');assert edited['meshing']['maxSagittaMm']==.015
run('click',ref('Undo','button'));assert save('undo-tolerance')==continuous
run('click',ref('Redo','button'));assert save('redo-tolerance')==edited
run('select',ref('표시','combobox'),'checker');run('screenshot',str(out/'checker.png'));run('select',ref('표시','combobox'),'wire');run('screenshot',str(out/'wire.png'))
load(out/'edited.depth.json');assert save('reopened')==edited
load(root/'outputs/depth-continuous-20261003/refined/ball_0000.continuous.depth.json');run('download',ref('진단 GLB 내보내기','button'),str(out/'ball-continuous.glb'));run('screenshot',str(out/'ball.png'))
load(root/'outputs/depth-boundary-20261003/fixtures/torus-depth.depth.json');run('click','main.depth-editor > details:nth-of-type(2) > summary');assert json.loads(run('eval','Array.from(document.querySelectorAll("input[type=checkbox]")).find(e=>e.parentElement.textContent.includes("연속 구면 전면")).disabled'))
rows=[]
for label,node,browser in [('sphere','large-checker-depth.continuous.glb','continuous.glb'),('ball','ball_0000.continuous.glb','ball-continuous.glb')]:
 a=(root/'outputs/depth-continuous-20261003/refined'/node).read_bytes();b=(out/browser).read_bytes();assert a==b;rows.append({'case':label,'exactBytes':True,'sha256':hashlib.sha256(a).hexdigest()})
(out/'workflow.json').write_text(json.dumps({'pass':True,'nativeVersion':'0.3','cases':['explicit topology/UV opt-in','invalid budget preserved state','input cancel','undo/redo operation+tolerance','raw source preservation','save/reopen','checker/wire','ball export','torus disabled'],'nodeBrowser':rows},indent=2)+'\n');print('Continuous sphere browser workflow PASS')
