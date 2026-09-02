import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def world_bounds(meshes):
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    corners = 0
    for obj in meshes:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
            corners += 1
    if corners == 0:
        raise RuntimeError("Static mesh audit imported no geometry")
    return minimum, maximum


args = sys.argv[sys.argv.index("--") + 1:]
if len(args) != 2:
    raise RuntimeError("Usage: blender ... -- source.obj|stl|ply report.json")
source = Path(args[0]).resolve()
report_path = Path(args[1]).resolve()
file_format = source.suffix.lower().lstrip(".")
if file_format not in {"obj", "stl", "ply"} or report_path.suffix.lower() != ".json":
    raise RuntimeError("Static mesh audit supports OBJ, STL and PLY with a JSON report")
if source == report_path or not report_path.parent.is_dir():
    raise RuntimeError("Static mesh audit paths are invalid")
if not source.is_file() or source.stat().st_size < 32 or source.stat().st_size > 256 * 1024 * 1024:
    raise RuntimeError("Static mesh source is outside the 32 byte..256 MB budget")

bpy.ops.wm.read_factory_settings(use_empty=True)
if file_format == "obj":
    result = bpy.ops.wm.obj_import(filepath=str(source))
elif file_format == "stl":
    result = bpy.ops.wm.stl_import(filepath=str(source))
else:
    result = bpy.ops.wm.ply_import(filepath=str(source))
if "FINISHED" not in result:
    raise RuntimeError(f"Blender {file_format.upper()} import failed: {result}")

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) > 100_000:
    raise RuntimeError("Static mesh audit object budget exceeded")
minimum, maximum = world_bounds(meshes)
triangles = 0
vertices = 0
for obj in meshes:
    vertices += len(obj.data.vertices)
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
if triangles < 1 or triangles > 10_000_000 or vertices > 20_000_000:
    raise RuntimeError("Static mesh audit geometry budget is invalid or exceeded")

report = {
    "schema": "morphloom.blender-static-mesh-audit/0.1",
    "status": "pass",
    "blenderVersion": bpy.app.version_string,
    "format": file_format,
    "source": source.name,
    "sourceBytes": source.stat().st_size,
    "sourceSha256": digest(source),
    "objects": len(bpy.context.scene.objects),
    "meshes": len(meshes),
    "vertices": vertices,
    "triangles": triangles,
    "bounds": {
        "min": list(minimum),
        "max": list(maximum),
        "size": list(maximum - minimum),
    },
    "scope": "Independent Blender application import of a Morphloom static-mesh download. Materials, rigging and animation are outside OBJ/STL/PLY parity.",
}
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
