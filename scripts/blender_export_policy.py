"""Preserve source tangent requirements instead of forcing unused generated tangents."""
import json
import struct


def tangent_export_required(path):
    with path.open('rb') as handle:
        header = handle.read(20)
        if len(header) != 20 or header[:4] != b'glTF':
            raise RuntimeError('Tangent policy requires a GLB')
        size, kind = struct.unpack('<II', header[12:20])
        if kind != 0x4E4F534A or size > 16 * 1024 * 1024:
            raise RuntimeError('GLB JSON missing or exceeds 16 MB policy budget')
        document = json.loads(handle.read(size))
    def normal_texture(value):
        if isinstance(value, dict):
            return any(key.lower().endswith('normaltexture') or normal_texture(v) for key, v in value.items())
        return isinstance(value, list) and any(normal_texture(v) for v in value)
    return any('TANGENT' in primitive.get('attributes', {})
               for mesh in document.get('meshes', []) for primitive in mesh.get('primitives', [])) or normal_texture(document.get('materials', []))
