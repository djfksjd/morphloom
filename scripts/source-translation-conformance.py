"""Run actual Blender translation cases and strict source-payload rejection checks.

Usage: python3 script manifest.json NEW-output-dir /Applications/.../Blender
Manifest: [{"id": "...", "source": "/absolute/file.glb", "node": "..."}]
"""
import copy
import hashlib
import json
import struct
import subprocess
import sys
from pathlib import Path

manifest, directory, blender = sys.argv[1:]
root = Path(__file__).resolve().parent
out = Path(directory)
out.mkdir(parents=True, exist_ok=False)
cases = json.loads(Path(manifest).read_text())
assert 2 <= len(cases) <= 8


def decode(path):
    raw = Path(path).read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+length]), raw[20+length:]


def encode(document, tail):
    data = json.dumps(document, separators=(',', ':')).encode()
    data += b' ' * ((-len(data)) % 4)
    return b'glTF'+struct.pack('<II', 2, 20+len(data)+len(tail))+struct.pack('<II', len(data), 0x4e4f534a)+data+tail


def run(label, source, node, delta=(2, 0, 0), expected=0, existing=False):
    output, receipt = out/(label+'.glb'), out/(label+'.json')
    if existing:
        output.write_bytes(b'do-not-overwrite')
    command = [blender, '--background', '--python-exit-code', '1', '--python', str(root/'blender-source-translation.py'), '--', str(source), str(output), str(receipt), node, *map(str, delta)]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
    (out/(label+'.log')).write_bytes(result.stdout)
    assert result.returncode == expected, (label, result.returncode)
    if expected:
        assert not receipt.exists() and (output.read_bytes() == b'do-not-overwrite' if existing else not output.exists())
    else:
        assert json.loads(receipt.read_text())['pass']
    return output


results = []
for case in cases:
    label = case['id']
    assert label.isascii() and label.replace('-', '').isalnum()
    source, node = Path(case['source']), case['node']
    delta = case.get('translationMm', [2, 0, 0])
    edited = run(label, source, node, delta)
    stabilized = run(label+'-stability', edited, node, (0, 0, 0))
    before, original_bin = decode(source)
    after, edited_bin = decode(edited)
    steady, steady_bin = decode(stabilized)
    assert original_bin == edited_bin == steady_bin and after == steady
    old = [n for n in before['nodes'] if n.get('name') == node][0]
    new = [n for n in after['nodes'] if n.get('name') == node][0]
    assert old != new
    # Independently ensure only transform was patched, not embedded IR or attributes.
    normalized = copy.deepcopy(after)
    normalized['nodes'][after['nodes'].index(new)] = old
    assert normalized == before
    report = out/(label+'-normals.json')
    audit = subprocess.run([blender, '--background', '--python-exit-code', '1', '--python', str(root/'blender-corner-normal-audit.py'), '--', str(source), str(edited), str(stabilized), str(report)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
    (out/(label+'-normals.log')).write_bytes(audit.stdout)
    assert audit.returncode == 0
    normals = json.loads(report.read_text())
    assert normals['pass']
    results.append({'id': label, 'translationMm': delta, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'editedSha256': hashlib.sha256(edited.read_bytes()).hexdigest(), 'stabilitySha256': hashlib.sha256(stabilized.read_bytes()).hexdigest(), 'binExact': True, 'onlyTargetTransformChanged': True, 'normalWorstDeg': max(row['maxNormalDifferenceDeg'] for pair in normals['pairs'] for row in pair)})

source, node = Path(cases[0]['source']), cases[0]['node']
document, tail = decode(source)
rejects = []
for label, mutation in [
    ('external-uri', lambda v: v['buffers'][0].update(uri='https://example.invalid/source.bin')),
    ('animation', lambda v: v.update(animations=[{}])),
    ('duplicate-name', lambda v: v['nodes'].append(copy.deepcopy(next(n for n in v['nodes'] if n.get('name') == node)))),
    ('missing-normal', lambda v: v['meshes'][0]['primitives'][0]['attributes'].pop('NORMAL')),
    ('cycle', lambda v: v['nodes'][0].update(children=[0])),
    ('non-affine-transform', lambda v: v['nodes'][0].update(matrix=[1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])),
    ('invalid-quaternion', lambda v: v['nodes'][0].update(rotation=[0, 0, 0, 0])),
    ('oversized-accessor', lambda v: v['accessors'][0].update(count=6_000_001)),
]:
    value = copy.deepcopy(document)
    mutation(value)
    fixture = out/(label+'-input.glb')
    fixture.write_bytes(encode(value, tail))
    run(label, fixture, node, expected=1)
    rejects.append(label)
for label, selected, delta, exists in [('missing-node', 'absent', (2, 0, 0), False), ('delta-range', node, (1001, 0, 0), False), ('overwrite', node, (2, 0, 0), True)]:
    run(label, source, selected, delta, expected=1, existing=exists)
    rejects.append(label)
(out/'verification.json').write_text(json.dumps({'pass': True, 'cases': results, 'rejections': rejects, 'normalToleranceDeg': .01, 'scope': 'Declared source translation only; original IR is before-edit reference. Raw first-import normal approximation and ordinary native DCC re-export remain separately blocked.'}, indent=2)+'\n')
print('PASS', len(results), 'actual Blender cases,', len(rejects), 'atomic rejection cases')
