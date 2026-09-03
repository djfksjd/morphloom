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


def delivery_meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


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
        raise RuntimeError("Neutral renderer imported no mesh geometry")
    return minimum, maximum


def normalize_scene(meshes):
    minimum, maximum = world_bounds(meshes)
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    # glTF Y-up becomes Blender Z-up. The source-facing broadside is X/Z and depth is Y.
    broadside_extent = max(size.x, size.z)
    if not math.isfinite(broadside_extent) or broadside_extent <= 1e-9:
        raise RuntimeError("Neutral renderer found a degenerate broadside envelope")
    scale = 2.0 / broadside_extent
    transform = Matrix.Scale(scale, 4) @ Matrix.Translation(-center)
    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    for root in roots:
        root.matrix_world = transform @ root.matrix_world
    bpy.context.view_layer.update()
    normalized_minimum, normalized_maximum = world_bounds(meshes)
    return {
        "sourceBounds": {"min": list(minimum), "max": list(maximum), "size": list(size)},
        "scale": scale,
        "normalizedBounds": {
            "min": list(normalized_minimum),
            "max": list(normalized_maximum),
            "size": list(normalized_maximum - normalized_minimum),
        },
    }


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
    return obj


args = sys.argv[sys.argv.index("--") + 1:]
if len(args) not in {3, 4}:
    raise RuntimeError("Usage: blender ... -- source.glb render.png report.json [front|rear|iso]")
source = Path(args[0]).resolve()
render_path = Path(args[1]).resolve()
report_path = Path(args[2]).resolve()
view_id = args[3] if len(args) == 4 else "front"
camera_presets = {
    "front": {"position": (0, -4.0, 0), "orthographicHeight": 2.35},
    "rear": {"position": (0, 4.0, 0), "orthographicHeight": 2.35},
    "iso": {"position": (2.8, -3.4, 1.8), "orthographicHeight": 2.55},
}
if view_id not in camera_presets:
    raise RuntimeError(f"Neutral renderer view is unsupported: {view_id}")
if source.suffix.lower() != ".glb" or render_path.suffix.lower() != ".png" or report_path.suffix.lower() != ".json":
    raise RuntimeError("Neutral renderer requires GLB input, PNG output and JSON report paths")
if len({source, render_path, report_path}) != 3:
    raise RuntimeError("Neutral renderer input and output paths must be distinct")
if not render_path.parent.is_dir() or not report_path.parent.is_dir():
    raise RuntimeError("Neutral renderer output directories must already exist")
if not source.is_file() or source.stat().st_size < 20 or source.stat().st_size > 256 * 1024 * 1024:
    raise RuntimeError("Neutral renderer source GLB is missing or empty")

bpy.ops.wm.read_factory_settings(use_empty=True)
result = bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)
if "FINISHED" not in result:
    raise RuntimeError(f"Blender glTF import failed: {result}")
meshes = delivery_meshes()
if len(meshes) > 100_000:
    raise RuntimeError("Neutral renderer mesh-object budget exceeded")
normalization = normalize_scene(meshes)

# Remove source cameras and lights. Both candidates receive this exact neutral studio.
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
scene.render.use_file_extension = True
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 0

world = bpy.data.worlds.new("Morphloom neutral world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.12, 0.12, 0.12, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.28
scene.world = world

camera_data = bpy.data.cameras.new("Morphloom neutral camera")
camera_data.type = "ORTHO"
camera_preset = camera_presets[view_id]
camera_data.ortho_scale = camera_preset["orthographicHeight"]
camera = bpy.data.objects.new("Morphloom neutral camera", camera_data)
scene.collection.objects.link(camera)
camera.location = camera_preset["position"]
look_at(camera, (0, 0, 0))
scene.camera = camera

area_light("Neutral key", (-2.5, -3.0, 3.5), 900, 4.0)
area_light("Neutral fill", (3.0, -2.0, 1.2), 500, 3.0)
area_light("Neutral rim", (0.5, 2.5, 2.5), 700, 2.5)

bpy.ops.render.render(write_still=True)
if not render_path.is_file() or render_path.stat().st_size < 100:
    raise RuntimeError("Neutral renderer did not produce a valid PNG")

rendered = bpy.data.images.load(str(render_path), check_existing=False)
width, height = rendered.size
pixels = rendered.pixels[:]
visible = [index // 4 for index in range(3, len(pixels), 4) if pixels[index] > (1 / 255)]
if not visible:
    raise RuntimeError("Neutral renderer produced an empty alpha silhouette")
minimum_x = min(pixel % width for pixel in visible)
maximum_x = max(pixel % width for pixel in visible)
minimum_y = min(pixel // width for pixel in visible)
maximum_y = max(pixel // width for pixel in visible)
minimum_margin = min(minimum_x, minimum_y, width - 1 - maximum_x, height - 1 - maximum_y)
framing = {
    "alphaBoundsPixels": {"min": [minimum_x, minimum_y], "max": [maximum_x, maximum_y]},
    "minimumMarginPixels": minimum_margin,
    "touchesBorder": minimum_margin <= 1,
}
if minimum_margin < 8:
    raise RuntimeError(f"Neutral renderer framing is clipped or unsafe: minimum margin {minimum_margin}px")

report = {
    "schema": "morphloom.neutral-glb-render/0.3",
    "protocol": "morphloom-neutral-glb-v2",
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
        "method": "broadside-xz-max-extent",
        "targetExtent": 2.0,
        **normalization,
    },
    "camera": {
        "projection": "orthographic",
        "position": list(camera_preset["position"]),
        "target": [0, 0, 0],
        "up": [0, 0, 1],
        "orthographicHeight": camera_preset["orthographicHeight"],
    },
    "framing": framing,
    "renderSettings": {"engine": "BLENDER_EEVEE", "width": 1024, "height": 1024, "transparent": True, "viewTransform": "AgX", "look": "AgX - Medium High Contrast"},
    "studio": {
        "world": {"color": [0.12, 0.12, 0.12, 1], "strength": 0.28},
        "lights": [
            {"name": "Neutral key", "location": [-2.5, -3.0, 3.5], "energy": 900, "size": 4.0},
            {"name": "Neutral fill", "location": [3.0, -2.0, 1.2], "energy": 500, "size": 3.0},
            {"name": "Neutral rim", "location": [0.5, 2.5, 2.5], "energy": 700, "size": 2.5},
        ],
    },
}
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
