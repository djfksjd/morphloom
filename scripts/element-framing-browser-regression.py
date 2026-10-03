"""Native inputs/screenshots only. Run with fixture directory and a NEW output directory.

fixture-directory: default.elements.json, small.elements.json, large.elements.json,
bearing.elements.json, mixed.workspace.json. PIL measures captured pixels; DOM reads
only locate the canvas. No camera/React state injection or model-quality assertion.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from PIL import Image

fixtures, out = map(Path, sys.argv[1:3])
out.mkdir(parents=True, exist_ok=False)
rows = []

for name, mode, width in [
    ('default', 'elements', 1280), ('default-narrow', 'elements', 900),
    ('small', 'elements', 1280), ('large', 'elements', 1280),
    ('bearing', 'elements', 1280), ('animal', 'elements', 1280),
    ('mixed', 'workspace', 1280), ('empty', 'elements', 1280),
]:
    session = 'morphloom-framing-' + name

    def call(*args):
        return subprocess.run(['agent-browser', '--session', session, *args],
                              capture_output=True, text=True, check=True, timeout=70).stdout

    def ref(role, label):
        snapshot = call('snapshot', '-i')
        found = re.search(role + ' "' + re.escape(label) + r'"[^\n]*?ref=(e\d+)', snapshot)
        assert found, (name, label, snapshot)
        return '@' + found[1]

    def capture(label):
        call('scrollintoview', 'canvas')
        call('wait', '500')
        rect = json.loads(call('eval', '(() => { const r=document.querySelector("canvas").getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}; })()'))
        (out / (label + '-rect.json')).write_text(json.dumps(rect))
        target = out / (label + '.png')
        call('screenshot', '--full', str(target))
        im = Image.open(target).convert('RGB')
        box = tuple(round(rect[k]) for k in ['x', 'y', 'width', 'height'])
        crop = im.crop((box[0], box[1], box[0]+box[2], box[1]+box[3]))
        crop.save(out / (label + '-canvas.png'))
        return crop, rect

    try:
        call('open', 'http://127.0.0.1:4179/viewer.html?editor=' + mode)
        call('set', 'viewport', str(width), '720')
        if name != 'animal':
            source = fixtures / (('default' if name == 'default-narrow' else name) + ('.workspace.json' if mode == 'workspace' else '.elements.json'))
            call('upload', '[aria-label="Load workspace JSON"]' if mode == 'workspace' else 'input[type=file]', str(source))
        if name != 'animal':
            call('wait', '--fn', 'document.body.textContent.includes("Loaded project · generator association unknown")')
        call('wait', '--fn', 'document.querySelector("canvas")!==null && Array.from(document.querySelectorAll("summary")).some(e=>e.textContent.includes("UV quality: integrity"))')
        call('check', ref('checkbox', 'Synthetic UV checker preview'))
        call('click', ref('button', 'Fit view'))
        crop, rect = capture(name)
        bg = (32, 37, 43)
        points = [(x, y) for y in range(crop.height) for x in range(crop.width)
                  if max(abs(a-b) for a, b in zip(crop.getpixel((x, y)), bg)) > 30]
        if name == 'empty':
            assert not points, 'Empty fallback unexpectedly renders geometry'
            assert 'viewport ready' in call('eval', 'document.querySelector("[role=status]").textContent')
            rows.append({'name': name, 'pass': True, 'scope': 'Empty scene fallback initializes viewport, not UV delivery approval'})
            continue
        assert points, name + ': no foreground'
        xs, ys = zip(*points)
        foreground = [min(xs), min(ys), max(xs), max(ys)]
        occupancy = max((max(xs)-min(xs)+1)/crop.width, (max(ys)-min(ys)+1)/crop.height)
        margin = min(min(xs), min(ys), crop.width-1-max(xs), crop.height-1-max(ys))
        assert margin >= 8, (name, 'clipped', margin)
        if name.startswith('default'):
            assert 0.5 <= occupancy <= 0.9, (name, occupancy)
        row = {'name': name, 'canvas': rect, 'foreground': foreground, 'occupancy': occupancy, 'marginPx': margin, 'pass': True}
        if name == 'default':
            # Real pointer orbit, settle damping, then recreate the viewport via
            # checker mode changes. Camera ownership must preserve this pose.
            viewport_rect = json.loads(call('eval', '(() => {const r=document.querySelector("canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()'))
            x, y = viewport_rect['x'] + viewport_rect['width']/2, viewport_rect['y'] + viewport_rect['height']/2
            call('mouse', 'move', str(round(x)), str(round(y)))
            call('mouse', 'down'); call('mouse', 'move', str(round(x+60)), str(round(y+20))); call('mouse', 'up')
            call('wait', '3000')
            orbit, _ = capture('orbit-before')
            call('uncheck', ref('checkbox', 'Synthetic UV checker preview'))
            call('check', ref('checkbox', 'Synthetic UV checker preview'))
            restored, _ = capture('orbit-restored')
            assert orbit.size == restored.size
            delta = sum(a != b for a, b in zip(orbit.getdata(), restored.getdata())) / (orbit.width*orbit.height)
            assert delta < 0.01, ('orbit pose lost', delta)
            row['orbitRestoreChangedPixelFraction'] = delta
            call('fill', '[aria-label="Position X"]', '1')
            call('click', ref('button', 'Apply part edit'))
            edited_source = out / 'pose-edited.elements.json'
            call('download', ref('button', 'Save project JSON'), str(edited_source))
            assert json.loads(edited_source.read_text())['parts'][0]['position'][0] == 1
            call('click', ref('button', 'Undo'))
            undone_source = out / 'pose-undone.elements.json'
            call('download', ref('button', 'Save project JSON'), str(undone_source))
            assert json.loads(undone_source.read_text())['parts'][0]['position'][0] == 0
            undone, _ = capture('orbit-after-edit-undo')
            edit_delta = sum(a != b for a, b in zip(orbit.getdata(), undone.getdata())) / (orbit.width*orbit.height)
            assert edit_delta < 0.01, ('Edit/history lost orbit pose', edit_delta)
            row['editUndoRestoreChangedPixelFraction'] = edit_delta
        rows.append(row)
    finally:
        call('close')

report = {'pass': True, 'method': 'Native CLI; real file upload, Fit view, pointer orbit, checker toggles; full-page pixels. DOM reads locate canvas only.', 'rows': rows,
          'fixtureSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in fixtures.iterdir() if p.is_file()}}
(out / 'browser-evidence.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
