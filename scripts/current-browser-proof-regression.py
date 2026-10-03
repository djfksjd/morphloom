import subprocess,json,re,sys
from pathlib import Path
out=Path(sys.argv[2]).resolve();session=sys.argv[1]
def call(*a):return subprocess.run(['agent-browser','--session',session,*a],capture_output=True,text=True,timeout=70,check=True).stdout
call('open','http://127.0.0.1:4179/?asset=laurel-homes');rows=[]
for id in ['laurel-homes','blade','asphalt-surface','moderncat-concept','cooler','web-hero','field-human']:
 call('wait','--fn','document.querySelector("select")&&!document.querySelector("select").disabled')
 call('select','select[aria-label="검수할 결과 선택"]',id)
 call('wait','--fn',"document.querySelector('[aria-label=\"내보내기 및 비용 검증\"]').textContent.includes('PASS')&&!document.querySelector('select').disabled")
 state=json.loads(call('eval',"(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return {active:document.querySelector('select').value,blocked:!!document.querySelector('.quality-total em'),checks:Array.from(document.querySelectorAll('.quality-row')).map(x=>({text:x.textContent,status:x.querySelector('[aria-label]').getAttribute('aria-label')}))};})()"));assert state['active']==id
 s=call('snapshot','-i');ref=re.search(r'button "SAVE PROOF" \[ref=(e\d+)\]',s);assert ref;f=out/(id+'-proof.json');call('download','@'+ref[1],str(f));proof=json.loads(f.read_text());assert proof['compilerRevision']=='morphloom-compiler/0.37.0'
 state['savedFile']=f.name;rows.append(state)
 if state['blocked']:
  # Actual current selected proof must never claim release while the panel blocks.
  names={'laurel-homes':'laurel-homes-architectural-review','moderncat-concept':'pinterest-concept-architectural-review','cooler':'cooling-service-assembly','web-hero':'single-view-character-previs','blade':'ornate-knife-product-visualization','asphalt-surface':'asphalt-print-surface','field-human':'field-human-runtime-base'}
  receipt=next(a for a in proof['assets']if a['id']==names[id]);assert receipt['qualityReleaseReady'] is False
(out/'browser-observed-quality.json').write_text(json.dumps({'pass':True,'rows':rows},indent=2)+'\n');print('Actual7native SAVE PROOF and blocked-quality false assertions PASS')
