"""Collect fresh existing UI delivery proofs after a compiler revision changes.

Requires an already-open agent-browser session on the current build. No React
state injection; select each existing asset and wait for its actual export/reopen.
"""
import subprocess
import sys
from pathlib import Path

session = sys.argv[1]
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
assets = ['blade', 'laurel-homes', 'cooler', 'moderncat-concept', 'web-hero', 'field-human', 'asphalt-surface']
def run(*args):
    result = subprocess.run(['agent-browser', '--session', session, *args], capture_output=True, text=True, timeout=45, check=True)
    return result.stdout
# Wait for the initial React compile/proof to finish; selection events during it are intentionally ignored.
run('wait', '--fn', "document.querySelector('[aria-label=\"내보내기 및 비용 검증\"]').textContent.includes('PASS') && !document.querySelector('select[aria-label=\"검수할 결과 선택\"]').disabled")
for count, asset in enumerate(assets, 1):
    run('snapshot', '-i')
    run('select', 'select[aria-label="검수할 결과 선택"]', asset)
    run('wait', '--fn', "document.querySelector('select[aria-label=\"검수할 결과 선택\"]').value === '" + asset + "'")
    condition = "document.querySelector('[aria-label=\"브라우저 왕복 검증 수집 현황\"]').textContent.includes('" + str(count) + "/7 ASSETS') && !document.querySelector('select[aria-label=\"검수할 결과 선택\"]').disabled"
    run('wait', '--fn', condition)
    (output / (asset + '.txt')).write_text(run('get', 'text', '[aria-label="내보내기 및 비용 검증"]'))
    run('screenshot', str(output / (asset + '.png')))
    print(asset + ' actual proof collected', flush=True)
run('snapshot', '-i')
run('download', '[aria-label="브라우저 왕복 검증 수집 현황"] button', str(output / 'browser-roundtrip.json'))
