"""Explicit static translation adapter; preserves original GLB BIN, not a DCC re-export.

No arbitrary edited Blender scene is accepted. The command imports a source,
performs one declared translation, verifies unchanged data, then patches that
source node. Embedded procedural metadata remains a BEFORE-edit reference.
"""
import bpy
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def matrix(node):
    def numbers(values, arity):
        require(isinstance(values, list) and len(values) == arity and
                all(type(v) in (int, float) and math.isfinite(v) for v in values), 'Finite numeric transform arity')
    if 'matrix' in node:
        require(not any(k in node for k in ('translation', 'rotation', 'scale')), 'Mixed transform')
        values = node['matrix']
        numbers(values, 16)
        require(values[3] == values[7] == values[11] == 0 and values[15] == 1, 'Affine matrix required')
        return Matrix([values[i:i+4] for i in range(0, 16, 4)]).transposed()
    t, r, s = node.get('translation', [0, 0, 0]), node.get('rotation', [0, 0, 0, 1]), node.get('scale', [1, 1, 1])
    numbers(t, 3)
    numbers(r, 4)
    numbers(s, 3)
    require(abs(sum(v*v for v in r)-1) <= 1e-5, 'Unit quaternion required')
    return Matrix.LocRotScale(Vector(t), Quaternion((r[3], *r[:3])), Vector(s))


def mesh_payload(obj):
    mesh = obj.data
    require(not obj.modifiers and not mesh.shape_keys, 'Modifiers/morph unsupported')
    require(len(mesh.vertices) <= 2_000_000 and len(mesh.loops) <= 6_000_000, 'Mesh budget')
    # Exact values/order inside this Blender import. No quantization or normals repair.
    return sha(json.dumps({
        'vertices': [list(v.co) for v in mesh.vertices],
        'loops': [l.vertex_index for l in mesh.loops],
        'polygons': [(p.loop_start, p.loop_total, p.material_index, p.use_smooth) for p in mesh.polygons],
        'normals': [list(n.vector) for n in mesh.corner_normals],
        'uv': [(layer.name, [list(v.uv) for v in layer.data]) for layer in mesh.uv_layers],
        'materials': [slot.material.as_pointer() if slot.material else None for slot in obj.material_slots],
        'data': mesh.as_pointer(),
        'parent': obj.parent.as_pointer() if obj.parent else None,
    }, separators=(',', ':'), allow_nan=False).encode())


args = sys.argv[sys.argv.index('--')+1:]
require(len(args) == 7, 'input.glb new-output.glb new-receipt.json node-name dx_mm dy_mm dz_mm (glTF Y-up world)')
source, output, receipt = map(Path, args[:3])
name = args[3]
delta = [float(v) for v in args[4:]]
require(all(math.isfinite(v) and abs(v) <= 1000 for v in delta), 'Translation range')
require(0 < source.stat().st_size <= 256*1024*1024, 'Input budget')
require(not output.exists() and not receipt.exists(), 'Never overwrite an existing output')
raw = source.read_bytes()
require(len(raw) >= 28 and raw[:4] == b'glTF' and struct.unpack_from('<II', raw, 4) == (2, len(raw)), 'GLB framing')
length, kind = struct.unpack_from('<II', raw, 12)
require(kind == 0x4e4f534a and length <= 16_000_000 and 20+length+8 <= len(raw), 'JSON framing/budget')
document = json.loads(raw[20:20+length])
tail = raw[20+length:]
bin_length, bin_kind = struct.unpack_from('<II', tail)
require(bin_kind == 0x004e4942 and bin_length+8 == len(tail), 'One embedded BIN chunk required')
require(not document.get('animations') and not document.get('extensionsRequired'), 'Animation/required extension unsupported')
require(not any(v.get('uri') for v in document.get('buffers', []) + document.get('images', [])), 'External URI unsupported')
nodes, meshes = document.get('nodes', []), document.get('meshes', [])
require(0 < len(nodes) <= 10000 and 0 < len(meshes) <= 128, 'Scene budget')
require(not any('skin' in n or n.get('extensions') for n in nodes), 'Skin/instancing/extension unsupported')
require(not any(p.get('targets') or p.get('extensions') for m in meshes for p in m['primitives']), 'Morph/primitive extension unsupported')
accessors = document.get('accessors', [])
require(len(accessors) <= 1024 and all(type(a.get('count')) is int and 0 < a['count'] <= 6_000_000 for a in accessors), 'Accessor budget')
require(all(p.get('mode', 4) == 4 and 'POSITION' in p.get('attributes', {}) and 'NORMAL' in p.get('attributes', {})
            for m in meshes for p in m['primitives']), 'Explicit static triangle POSITION/NORMAL required')
for m in meshes:
    for p in m['primitives']:
        for attribute in ('POSITION', 'NORMAL'):
            a = p['attributes'][attribute]
            require(type(a) is int and 0 <= a < len(accessors) and accessors[a]['count'] <= 2_000_000, 'Vertex accessor budget')
mesh_names = [n.get('name') for n in nodes if 'mesh' in n]
require(all(isinstance(n, str) and n for n in mesh_names) and len(set(mesh_names)) == len(mesh_names), 'Unique mesh node names required')
parents = {}
for i, node in enumerate(nodes):
    for child in node.get('children', []):
        require(isinstance(child, int) and 0 <= child < len(nodes) and child not in parents, 'Invalid/multiple parent')
        parents[child] = i
matches = [i for i, node in enumerate(nodes) if node.get('name') == name]
require(len(matches) == 1, 'Unique source node required')
index = matches[0]
require('mesh' in nodes[index] and not nodes[index].get('children'), 'Target must be a leaf mesh node')
worlds = {}


def world(i, path=()):
    require(i not in path, 'Hierarchy cycle')
    if i not in worlds:
        value = matrix(nodes[i])
        require(all(math.isfinite(v) for row in value for v in row), 'Nonfinite transform')
        worlds[i] = world(parents[i], (*path, i)) @ value if i in parents else value
    return worlds[i]


for i in range(len(nodes)):
    world(i)
parent = world(parents[index]) if index in parents else Matrix.Identity(4)
require(abs(parent.to_3x3().determinant()) > 1e-12, 'Singular parent transform')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source.resolve()), import_shading='NORMALS', merge_vertices=False)
objects = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == 'MESH'}
require(set(objects) == set(mesh_names) and len(objects) <= 128, 'Imported mesh identity correspondence/budget')
target = objects[name]
basis = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
expected_before = basis @ world(index) @ basis.inverted()
transform_error = max(abs(a-b) for ra, rb in zip(expected_before, target.matrix_world) for a, b in zip(ra, rb))
require(transform_error <= 1e-7, 'Import/source transform correspondence failed: max matrix component error='+repr(transform_error))
before_payload = {key: mesh_payload(obj) for key, obj in objects.items()}
before_matrices = {key: obj.matrix_world.copy() for key, obj in objects.items()}
expected = target.matrix_world.copy()
expected.translation += Vector((delta[0]/1000, -delta[2]/1000, delta[1]/1000))
target.matrix_world = expected
bpy.context.view_layer.update()
require(before_payload == {key: mesh_payload(obj) for key, obj in objects.items()}, 'Actual mesh/normal/UV/material binding changed')
for key, obj in objects.items():
    wanted = expected if key == name else before_matrices[key]
    require(max(abs(a-b) for ra, rb in zip(wanted, obj.matrix_world) for a, b in zip(ra, rb)) <= 1e-7, 'Actual world transform changed outside declaration')
local_delta = parent.to_3x3().inverted() @ Vector([v/1000 for v in delta])
node = nodes[index]
if 'matrix' in node:
    for axis in range(3):
        node['matrix'][12+axis] += local_delta[axis]
else:
    node['translation'] = [v+d for v, d in zip(node.get('translation', [0, 0, 0]), local_delta)]
encoded = json.dumps(document, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
encoded += b' ' * ((-len(encoded)) % 4)
result = b'glTF' + struct.pack('<II', 2, 20+len(encoded)+len(tail)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + tail
report = {'schema': 'morphloom.source-translation/0.1', 'pass': True,
          'sourceSha256': sha(raw), 'outputSha256': sha(result), 'binChunkSha256': sha(tail),
          'blenderVersion': bpy.app.version_string, 'node': name, 'translationMm': delta,
          'coordinates': 'glTF right-handed Y-up world, millimeters', 'unchangedMeshPayloads': len(objects),
          'preserved': 'Original BIN and all JSON except the declared target node transform',
          'limitations': 'Baked translation adapter, not Blender native re-export. Embedded procedural/source metadata is BEFORE-edit reference; IR is not synchronized. Arbitrary DCC edits are unsupported.'}
output.parent.mkdir(parents=True, exist_ok=True)
receipt.parent.mkdir(parents=True, exist_ok=True)
created = []
try:
    with output.open('xb') as handle:
        created.append(output)
        handle.write(result)
    with receipt.open('x') as handle:
        created.append(receipt)
        json.dump(report, handle, indent=2)
        handle.write('\n')
except BaseException:
    # Remove only files created by this invocation; never an existing destination.
    for path in reversed(created):
        path.unlink(missing_ok=True)
    raise
print(json.dumps(report))
