import bpy
import hashlib
import json
import sys
from pathlib import Path
from mathutils import Vector


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scene_stats():
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    corners = [obj.matrix_world @ Vector(corner) for obj in mesh_objects for corner in obj.bound_box]
    minimum = [min(point[axis] for point in corners) for axis in range(3)]
    maximum = [max(point[axis] for point in corners) for axis in range(3)]
    return {
        "objects": len(bpy.context.scene.objects),
        "meshes": len(mesh_objects),
        "vertices": sum(len(obj.data.vertices) for obj in mesh_objects),
        "polygons": sum(len(obj.data.polygons) for obj in mesh_objects),
        "materials": len(bpy.data.materials),
        "armatures": len(armatures),
        "bones": sum(len(obj.data.bones) for obj in armatures),
        "actions": len(bpy.data.actions),
        "boundsMeters": {"min": minimum, "max": maximum},
    }


def import_glb(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(path), import_pack_images=False)
    if "FINISHED" not in result:
        raise RuntimeError(f"Blender glTF import failed: {result}")
    stats = scene_stats()
    if stats["meshes"] == 0 or stats["vertices"] == 0 or stats["polygons"] == 0:
        raise RuntimeError("Blender imported no renderable mesh geometry")
    return stats


args = sys.argv[sys.argv.index("--") + 1:]
if len(args) != 3:
    raise RuntimeError("Usage: blender ... -- source.glb roundtrip.glb report.json")
source = Path(args[0]).resolve()
target = Path(args[1]).resolve()
report_path = Path(args[2]).resolve()

before = import_glb(source)
bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_yup=True, export_apply=False)
if not target.exists() or target.stat().st_size < 20:
    raise RuntimeError("Blender did not produce a valid-size GLB")
after = import_glb(target)

parity_fields = ["meshes", "polygons", "armatures", "bones", "actions"]
parity = all(before[field] == after[field] for field in parity_fields)
bounds_error_mm = max(
    abs(before["boundsMeters"][side][axis] - after["boundsMeters"][side][axis]) * 1000
    for side in ("min", "max")
    for axis in range(3)
)
passed = parity and bounds_error_mm <= 0.1
report = {
    "schema": "morphloom.blender-roundtrip/0.1",
    "pass": passed,
    "blenderVersion": bpy.app.version_string,
    "source": source.name,
    "sourceBytes": source.stat().st_size,
    "sourceSha256": digest(source),
    "roundTrip": target.name,
    "roundTripBytes": target.stat().st_size,
    "roundTripSha256": digest(target),
    "boundsErrorMm": bounds_error_mm,
    "imported": before,
    "reopened": after,
}
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
if not passed:
    raise RuntimeError("Blender round-trip parity gate failed")
