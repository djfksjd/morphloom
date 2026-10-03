"""Bounded actual-file Blender checks; no source photo leaves the local computer."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'outputs/product-photo-20261003').resolve()
blender = sys.argv[2] if len(sys.argv) > 2 else '/Applications/Blender.app/Contents/MacOS/Blender'
scripts = Path(__file__).resolve().parent
evidence = json.loads((out / 'browser-evidence.json').read_text())
commands = []
for row in evidence['rows']:
    source = out / (row['name'] + '.glb')
    if hashlib.sha256(source.read_bytes()).hexdigest() != row['outputSha256']:
        raise RuntimeError('Browser receipt does not match actual file: ' + row['name'])
    commands.append(('roundtrip-' + row['name'], 'blender-glb-roundtrip.py', [source, out / (row['name'] + '-roundtrip.glb'), out / (row['name'] + '-blender.json')]))
commands.append(('component-edit', 'blender-component-edit-audit.py', [out / 'negative.glb', out / 'blender-edited.glb', out / 'blender-edit.json', 'front-hub-cap', '1', '0', '0']))
for name, view, mode, isolated in [('positive', 'rear', 'material', False), ('negative', 'rear', 'material', False), ('positive', 'rear', 'material', True), ('negative', 'rear', 'material', True), ('negative', 'iso', 'clay', False), ('negative', 'iso', 'wire', False), ('negative', 'rear', 'grazing', True)]:
    label = name + ('-closeup' if isolated else '-neutral') + '-' + mode
    arguments = [out / (name + '.glb'), out / (label + '.png'), out / (label + '.json'), view, mode]
    if isolated:
        arguments.append(out / 'closeup-space.json')
    commands.append((label, 'blender-neutral-render.py', arguments))
for label, script, arguments in commands:
    with (out / (label + '.log')).open('w') as log:
        result = subprocess.run([blender, '--background', '--python-exit-code', '1', '--python', str(scripts / script), '--', *map(str, arguments)], stdout=log, stderr=subprocess.STDOUT, timeout=90, check=False)
    if result.returncode:
        raise RuntimeError(label + ' failed; inspect its log')
    print(label + ' PASS', flush=True)
