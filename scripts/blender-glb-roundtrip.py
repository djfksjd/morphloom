import bpy
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from mathutils import Vector


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scene_stats():
    helper_objects = [
        obj for obj in bpy.context.scene.objects
        if any(collection.name == "glTF_not_exported" for collection in obj.users_collection)
    ]
    delivery_objects = [obj for obj in bpy.context.scene.objects if obj not in helper_objects]
    mesh_objects = [obj for obj in delivery_objects if obj.type == "MESH"]
    armatures = [obj for obj in delivery_objects if obj.type == "ARMATURE"]
    images = [image for image in bpy.data.images if image.name not in {"Render Result", "Viewer Node"}]
    corners = [obj.matrix_world @ Vector(corner) for obj in mesh_objects for corner in obj.bound_box]
    minimum = [min(point[axis] for point in corners) for axis in range(3)]
    maximum = [max(point[axis] for point in corners) for axis in range(3)]
    corner_count = 0
    corner_sum = [0.0, 0.0, 0.0]
    corner_sum_squares = [0.0, 0.0, 0.0]
    surface_area = 0.0
    for obj in mesh_objects:
        matrix = obj.matrix_world
        for polygon in obj.data.polygons:
            points = [matrix @ obj.data.vertices[index].co for index in polygon.vertices]
            for point in points:
                corner_count += 1
                for axis in range(3):
                    corner_sum[axis] += point[axis]
                    corner_sum_squares[axis] += point[axis] * point[axis]
            for index in range(1, len(points) - 1):
                surface_area += (points[index] - points[0]).cross(points[index + 1] - points[0]).length * 0.5
    skinned_vertices = sum(len(obj.data.vertices) for obj in mesh_objects if len(obj.vertex_groups) > 0)
    weighted_vertices = sum(
        1 for obj in mesh_objects for vertex in obj.data.vertices if len(vertex.groups) > 0
    )
    return {
        "objects": len(delivery_objects),
        "excludedImporterHelpers": len(helper_objects),
        "meshes": len(mesh_objects),
        "vertices": sum(len(obj.data.vertices) for obj in mesh_objects),
        "polygons": sum(len(obj.data.polygons) for obj in mesh_objects),
        "materials": len(bpy.data.materials),
        "images": len(images),
        "imageNames": sorted(image.name for image in images),
        "imageDimensions": sorted([[image.size[0], image.size[1]] for image in images]),
        "shapeKeys": sum(
            max(0, len(obj.data.shape_keys.key_blocks) - 1)
            for obj in mesh_objects
            if obj.data.shape_keys
        ),
        "skinnedVertices": skinned_vertices,
        "weightedVertices": weighted_vertices,
        "weightedCoverage": weighted_vertices / skinned_vertices if skinned_vertices else 1.0,
        "armatures": len(armatures),
        "bones": sum(len(obj.data.bones) for obj in armatures),
        "boneNames": sorted(bone.name for obj in armatures for bone in obj.data.bones),
        "actions": len(bpy.data.actions),
        "actionNames": sorted(action.name for action in bpy.data.actions),
        "geometryMoments": {
            "cornerCount": corner_count,
            "cornerSum": corner_sum,
            "cornerSumSquares": corner_sum_squares,
            "surfaceAreaSquareMeters": surface_area,
        },
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
bpy.ops.export_scene.gltf(
    filepath=str(target),
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_tangents=True,
    export_morph_tangent=True,
    export_armature_object_remove=True,
)
if not target.exists() or target.stat().st_size < 20:
    raise RuntimeError("Blender did not produce a valid-size GLB")
after = import_glb(target)

parity_fields = [
    "meshes", "polygons", "materials", "shapeKeys",
    "armatures", "bones", "actions",
]
identity_fields = ["boneNames", "actionNames"]
def close_number(left, right):
    return abs(left - right) <= max(1e-8, abs(left) * 1e-7, abs(right) * 1e-7)


before_moments = before["geometryMoments"]
after_moments = after["geometryMoments"]
corner_count = before_moments["cornerCount"]
before_corner_mean = [value / max(1, corner_count) for value in before_moments["cornerSum"]]
after_corner_mean = [value / max(1, corner_count) for value in after_moments["cornerSum"]]
before_corner_mean_squares = [value / max(1, corner_count) for value in before_moments["cornerSumSquares"]]
after_corner_mean_squares = [value / max(1, corner_count) for value in after_moments["cornerSumSquares"]]
geometry_parity = (
    corner_count == after_moments["cornerCount"]
    and all(abs(left - right) <= 5e-7 for left, right in zip(before_corner_mean, after_corner_mean))
    and all(abs(left - right) <= 1e-6 for left, right in zip(before_corner_mean_squares, after_corner_mean_squares))
    and close_number(before_moments["surfaceAreaSquareMeters"], after_moments["surfaceAreaSquareMeters"])
)
lost_image_dimensions = list((Counter(map(tuple, before["imageDimensions"])) - Counter(map(tuple, after["imageDimensions"]))).elements())
added_image_dimensions = list((Counter(map(tuple, after["imageDimensions"])) - Counter(map(tuple, before["imageDimensions"]))).elements())
# Blender folds Morphloom's shared uniform 1x1 iridescence-thickness map into
# the equivalent scalar material value. Other image loss or addition blocks.
image_parity = not added_image_dimensions and len(lost_image_dimensions) <= 1 and all(size == (1, 1) for size in lost_image_dimensions)
skinning_parity = (
    before["weightedCoverage"] >= 0.999999
    and after["weightedCoverage"] >= 0.999999
)
parity = (
    all(before[field] == after[field] for field in parity_fields)
    and all(before[field] == after[field] for field in identity_fields)
    and geometry_parity
    and image_parity
    and skinning_parity
)
bounds_error_mm = max(
    abs(before["boundsMeters"][side][axis] - after["boundsMeters"][side][axis]) * 1000
    for side in ("min", "max")
    for axis in range(3)
)
bounds_tolerance_mm = 0.5 if before["armatures"] > 0 else 0.1
passed = parity and bounds_error_mm <= bounds_tolerance_mm
report = {
    "schema": "morphloom.blender-roundtrip/0.2",
    "pass": passed,
    "blenderVersion": bpy.app.version_string,
    "source": source.name,
    "sourceBytes": source.stat().st_size,
    "sourceSha256": digest(source),
    "roundTrip": target.name,
    "roundTripBytes": target.stat().st_size,
    "roundTripSha256": digest(target),
    "boundsErrorMm": bounds_error_mm,
    "boundsToleranceMm": bounds_tolerance_mm,
    "geometryParity": geometry_parity,
    "imageParity": image_parity,
    "skinningParity": skinning_parity,
    "lostImageDimensions": lost_image_dimensions,
    "addedImageDimensions": added_image_dimensions,
    "imported": before,
    "reopened": after,
}
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
if not passed:
    raise RuntimeError("Blender round-trip parity gate failed")
