import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def bounds(meshes):
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
    if not meshes:
        raise RuntimeError("Surface renderer imported no mesh geometry")
    return minimum, maximum


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area_light(name, location, energy, size):
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    look_at(obj, (0, 0, 0))


args = sys.argv[sys.argv.index("--") + 1:]
if len(args) != 4:
    raise RuntimeError("Usage: blender ... -- source.glb render.png report.json top|grazing")
source = Path(args[0]).resolve()
render_path = Path(args[1]).resolve()
report_path = Path(args[2]).resolve()
view_id = args[3]
presets = {
    "top": {"position": (0, 0, 4.0), "orthographicHeight": 2.35},
    "grazing": {"position": (2.8, -3.2, 1.05), "orthographicHeight": 2.55},
}
if view_id not in presets:
    raise RuntimeError(f"Surface renderer view is unsupported: {view_id}")
if source.suffix.lower() != ".glb" or render_path.suffix.lower() != ".png" or report_path.suffix.lower() != ".json":
    raise RuntimeError("Surface renderer requires GLB input, PNG output and JSON report paths")
if not source.is_file() or source.stat().st_size < 20 or source.stat().st_size > 256 * 1024 * 1024:
    raise RuntimeError("Surface renderer source GLB is missing or outside the size budget")
if not render_path.parent.is_dir() or not report_path.parent.is_dir():
    raise RuntimeError("Surface renderer output directories must already exist")

bpy.ops.wm.read_factory_settings(use_empty=True)
result = bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
if "FINISHED" not in result:
    raise RuntimeError(f"Blender glTF import failed: {result}")
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
minimum, maximum = bounds(meshes)
center = (minimum + maximum) * 0.5
size = maximum - minimum
surface_extent = max(size.x, size.y)
if not math.isfinite(surface_extent) or surface_extent <= 1e-9:
    raise RuntimeError("Surface renderer found a degenerate X/Y envelope")
scale = 2.0 / surface_extent
transform = Matrix.Scale(scale, 4) @ Matrix.Translation(-center)
for root in [obj for obj in bpy.context.scene.objects if obj.parent is None]:
    root.matrix_world = transform @ root.matrix_world
bpy.context.view_layer.update()
normalized_minimum, normalized_maximum = bounds(meshes)

for obj in list(bpy.context.scene.objects):
    if obj.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(obj, do_unlink=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.render.filepath = str(render_path)
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 0

world = bpy.data.worlds.new("Locked surface comparison world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.08, 0.08, 0.08, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32
scene.world = world

preset = presets[view_id]
camera_data = bpy.data.cameras.new("Locked surface comparison camera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = preset["orthographicHeight"]
camera = bpy.data.objects.new("Locked surface comparison camera", camera_data)
scene.collection.objects.link(camera)
camera.location = preset["position"]
look_at(camera, (0, 0, 0))
scene.camera = camera

# A broad key reveals colour; the low raking light exposes delivered relief.
area_light("Surface key", (-2.4, -2.8, 3.2), 110, 3.5)
area_light("Surface rake", (3.2, 0.4, 0.42), 190, 1.1)
area_light("Surface fill", (-1.5, 2.5, 1.6), 55, 2.5)

bpy.ops.render.render(write_still=True)
if not render_path.is_file() or render_path.stat().st_size < 100:
    raise RuntimeError("Surface renderer did not produce a valid PNG")

report = {
    "schema": "morphloom.surface-neutral-glb-render/0.1",
    "protocol": "morphloom-surface-neutral-v1",
    "viewId": view_id,
    "blenderVersion": bpy.app.version_string,
    "source": source.name,
    "sourceBytes": source.stat().st_size,
    "sourceSha256": digest(source),
    "render": render_path.name,
    "renderBytes": render_path.stat().st_size,
    "renderSha256": digest(render_path),
    "meshes": len(meshes),
    "materials": len(bpy.data.materials),
    "normalization": {
        "method": "surface-xy-max-extent",
        "targetExtent": 2.0,
        "sourceBounds": {"min": list(minimum), "max": list(maximum), "size": list(size)},
        "scale": scale,
        "normalizedBounds": {
            "min": list(normalized_minimum),
            "max": list(normalized_maximum),
            "size": list(normalized_maximum - normalized_minimum),
        },
    },
    "camera": {"projection": "orthographic", **preset, "target": [0, 0, 0]},
    "renderSettings": {
        "engine": "BLENDER_EEVEE",
        "width": 1024,
        "height": 1024,
        "transparent": True,
        "viewTransform": "AgX",
        "look": "AgX - Medium High Contrast",
    },
    "studio": {
        "world": {"color": [0.08, 0.08, 0.08, 1], "strength": 0.32},
        "lights": [
            {"name": "Surface key", "location": [-2.4, -2.8, 3.2], "energy": 110, "size": 3.5},
            {"name": "Surface rake", "location": [3.2, 0.4, 0.42], "energy": 190, "size": 1.1},
            {"name": "Surface fill", "location": [-1.5, 2.5, 1.6], "energy": 55, "size": 2.5},
        ],
    },
}
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
