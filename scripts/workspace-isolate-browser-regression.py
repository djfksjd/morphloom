"""Native workspace edit/preview/save regression; no app-state injection.

Usage: python3 scripts/workspace-isolate-browser-regression.py workspace.json new-output
Fixture must include asset 'bearing' and sphere part 'ball_0000'.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

source, out = map(Path, sys.argv[1:3]); out.mkdir(parents=True, exist_ok=False)
base = json.loads(source.read_text()); session = 'morphloom-workspace-isolate-current'
metric_js = '''(() => {const text=Array.from(document.querySelectorAll('[role=status]')).map(e=>e.textContent).find(t=>t.includes('geometry-buffer bytes'));if(!text)return null;return {text,triangles:Number(text.match(/([0-9]+) triangles/)[1]),calls:Number(text.match(/([0-9]+) measured render calls/)[1])};})()'''

def call(*args):
    return subprocess.run(['agent-browser', '--session', session, *args], capture_output=True, text=True, check=True, timeout=70).stdout

def ref(role, label):
    snapshot = call('snapshot', '-i'); found = re.search(role+' "'+re.escape(label)+r'"[^\n]*?ref=(e\d+)', snapshot)
    assert found, (label, snapshot); return '@'+found[1]

def click(label): call('click', ref('button', label))
def save(name):
    file = out/name; call('download', ref('button', 'Save workspace JSON'), str(file)); return json.loads(file.read_text())
def metrics(): return json.loads(call('eval', metric_js))
def wait_counts(triangles=None, calls=None):
    condition = 'm!==null' + (f'&&m.triangles==={triangles}' if triangles is not None else '') + (f'&&m.calls==={calls}' if calls is not None else '')
    call('wait', '--fn', '(function(){const m='+metric_js+';return '+condition+';})()')
def capture(name):
    call('scrollintoview', 'canvas'); call('wait', '500'); call('screenshot', '--full', str(out/name))

try:
    call('open', 'http://127.0.0.1:4179/viewer.html?editor=workspace'); call('set', 'viewport', '1280', '720')
    call('upload', '[aria-label="Load workspace JSON"]', str(source))
    call('wait', '--fn', 'document.querySelector("[aria-label=\\"Workspace asset\\"] option[value=bearing]")!==null')
    call('select', '[aria-label="Workspace asset"]', 'bearing')
    call('fill', 'form input', 'ball_0000'); click('Select')
    call('wait', '--fn', 'document.querySelector("[aria-label=\\"Ball radius (mm)\\"]")!==null')
    wait_counts(); all_before = metrics(); assert all_before['calls'] > 1
    assert save('before.workspace.json') == base
    click('Fit view'); wait_counts(calls=all_before['calls']); capture('whole-before.png')
    # One mesh and the existing selection Box3Helper each draw once.
    call('check', ref('checkbox', 'Isolate selection')); wait_counts(calls=2)
    isolated = metrics(); assert isolated['triangles'] < all_before['triangles']
    assert save('isolated.workspace.json') == base
    click('Fit view'); wait_counts(calls=2); capture('isolated-before.png')
    asset = next(a for a in base['assets'] if a['id']=='bearing')
    ball = next(p for p in asset['source']['parts'] if p['id']=='ball_0000')
    radius = ball['geometry']['radius'] - 0.2
    call('fill', '[aria-label="Ball radius (mm)"]', str(radius)); click('Apply part edit'); wait_counts(calls=2)
    edited = save('edited.workspace.json')
    expected = json.loads(json.dumps(base)); target = next(p for a in expected['assets'] if a['id']=='bearing' for p in a['source']['parts'] if p['id']=='ball_0000')
    target['geometry']['radius'] = radius
    assert edited == expected, 'Edit changed unrelated source or preview entered stored IR'
    capture('isolated-edited.png')
    call('uncheck', ref('checkbox', 'Isolate selection')); wait_counts(triangles=all_before['triangles'])
    # Unchecking preserves the user's close camera; Fit view restores whole-scene framing.
    click('Fit view'); wait_counts(calls=all_before['calls'])
    restored = metrics(); capture('whole-edited.png'); assert save('restored.workspace.json') == expected
    click('Undo'); assert save('undo.workspace.json') == base
    click('Redo'); assert save('redo.workspace.json') == expected
    # Reopen from a fresh default workspace, so an identical old source cannot satisfy the barrier.
    call('close'); session = 'morphloom-isolate-reopen-' + out.name
    call('open', 'http://127.0.0.1:4179/viewer.html?editor=workspace')
    call('wait', '--fn', 'document.querySelector('+json.dumps('[aria-label="Load workspace JSON"]')+')!==null')
    call('upload', '[aria-label="Load workspace JSON"]', str(out/'edited.workspace.json'))
    call('wait', '--fn', 'document.querySelector("[aria-label=\\"Workspace asset\\"] option[value=bearing]")!==null')
    call('select', '[aria-label="Workspace asset"]', 'bearing')
    call('fill', 'form input', 'ball_0000'); click('Select')
    wait_counts(triangles=all_before['triangles'], calls=all_before['calls'])
    assert save('reopened.workspace.json') == expected
    report = {'pass': True, 'cases': ['native select ball', 'isolate changes actual draw calls and triangles', 'preview leaves source exact', 'edit radius while isolated', 'all non-target source fields exact', 'uncheck restores full counts', 'Undo/Redo', 'fresh-session reopen then explicitly reselect ball; preview is not saved in IR'], 'method': 'Native UI/file/DOM metrics/screenshot only', 'before': all_before, 'isolated': isolated, 'restored': restored, 'editedRadiusMm': radius}
    (out/'browser-evidence.json').write_text(json.dumps(report, indent=2)+'\n'); print(json.dumps(report, indent=2))
except Exception as error:
    (out/'failure-command-stderr.txt').write_text(getattr(error,'stderr','') or str(error))
    (out/'failure-snapshot.txt').write_text(call('snapshot','-i'))
    (out/'failure-metrics.json').write_text(call('eval',metric_js))
    if call('eval', 'document.querySelector("canvas")!==null').strip()=='true':
        capture('failure.png')
    raise
finally:
    call('close')
