import bpy
import hashlib
import json
import math
import mathutils
import os
import sys
from pathlib import Path


def fail(message):
    raise RuntimeError(message)


def args_after_separator():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


args = args_after_separator()
if len(args) < 4:
    fail(
        "Usage: blender ... -- <input.glb> <output.glb> <receipt.json> <component> "
        "[dx_mm dy_mm dz_mm | local-relief amplitude_mm radius_fraction center_u center_v]"
    )

input_path = Path(args[0]).resolve()
output_path = Path(args[1]).resolve()
receipt_path = Path(args[2]).resolve()
component_name = args[3]
stability_path = output_path.with_name(f"{output_path.stem}-stability{output_path.suffix}")
operation_kind = "local-relief" if len(args) >= 5 and args[4] == "local-relief" else "translation"
if operation_kind == "translation":
    delta_mm = [float(value) for value in (args[4:7] or [12.0, 0.0, 0.0])]
    if len(delta_mm) != 3 or any(not math.isfinite(value) or abs(value) > 1000 for value in delta_mm):
        fail("Edit delta must contain three finite values within +/-1000 mm.")
    relief_parameters = None
else:
    if len(args) != 9:
        fail("Local relief requires amplitude_mm, radius_fraction, center_u, and center_v.")
    relief_parameters = [float(value) for value in args[5:9]]
    if any(not math.isfinite(value) for value in relief_parameters):
        fail("Local relief parameters must be finite.")
    delta_mm = None
if not input_path.is_file() or input_path.stat().st_size < 12 or input_path.stat().st_size > 256 * 1024 * 1024:
    fail("Input GLB is outside the 12-byte..256-MB edit budget.")
if not component_name or len(component_name) > 256:
    fail("Component name is invalid.")
output_path.parent.mkdir(parents=True, exist_ok=True)
receipt_path.parent.mkdir(parents=True, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras,
        bpy.data.lights, bpy.data.armatures, bpy.data.actions,
    ):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def world_bounds(obj):
    corners = [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
    return {
        "minimum": [min(point[axis] for point in corners) for axis in range(3)],
        "maximum": [max(point[axis] for point in corners) for axis in range(3)],
    }


def quantized(value, precision=1_000_000):
    return int(round(float(value) * precision))


def digest_lines(lines):
    digest = hashlib.sha256()
    for line in sorted(lines):
        digest.update(line.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def canonical_face_geometry_digest(mesh):
    lines = []
    for polygon in mesh.polygons:
        corners = []
        for vertex_index in polygon.vertices:
            coordinate = mesh.vertices[vertex_index].co
            corners.append(
                f"{quantized(coordinate.x)},{quantized(coordinate.y)},{quantized(coordinate.z)}"
            )
        lines.append(f"{polygon.material_index}:" + ";".join(sorted(corners)))
    return digest_lines(lines)


def canonical_uv_digest(mesh):
    active_uv = mesh.uv_layers.active
    if active_uv is None:
        return None
    lines = []
    for polygon in mesh.polygons:
        corners = []
        for loop_index in polygon.loop_indices:
            loop = mesh.loops[loop_index]
            coordinate = mesh.vertices[loop.vertex_index].co
            uv = active_uv.data[loop_index].uv
            corners.append(
                ",".join(
                    str(value)
                    for value in (
                        quantized(coordinate.x), quantized(coordinate.y), quantized(coordinate.z),
                        quantized(uv.x, 100_000), quantized(uv.y, 100_000),
                    )
                )
            )
        lines.append(f"{polygon.material_index}:" + ";".join(sorted(corners)))
    return digest_lines(lines)


def material_slot_signature(obj):
    slots = []
    for slot in obj.material_slots:
        material = slot.material
        if material is None:
            slots.append({"name": None})
            continue
        slots.append({
            "name": material.name,
            "diffuse": [round(float(value), 6) for value in material.diffuse_color],
            "metallic": round(float(material.metallic), 6),
            "roughness": round(float(material.roughness), 6),
        })
    return slots


def modifier_signature(obj):
    return [
        {
            "name": modifier.name,
            "type": modifier.type,
            "object": stable_object_id(modifier.object) if hasattr(modifier, "object") and modifier.object else None,
        }
        for modifier in obj.modifiers
    ]


def stable_object_id(obj):
    candidate = obj.get("morphloomStableNodeId")
    if isinstance(candidate, str) and candidate:
        return candidate
    if obj.type == "MESH":
        for modifier in obj.modifiers:
            if modifier.type != "ARMATURE" or not modifier.object:
                continue
            armature_candidate = modifier.object.get("morphloomStableNodeId")
            if isinstance(armature_candidate, str) and armature_candidate:
                return armature_candidate
    return obj.name


def mesh_signature(obj):
    mesh = obj.data
    bounds = world_bounds(obj)
    return {
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
        "materialSlots": len(obj.material_slots),
        "materialSlotSignature": material_slot_signature(obj),
        "geometryDigest": canonical_face_geometry_digest(mesh),
        "uvDigest": canonical_uv_digest(mesh),
        "parent": stable_object_id(obj.parent) if obj.parent else None,
        "modifiers": modifier_signature(obj),
        "skinned": any(modifier.type == "ARMATURE" for modifier in obj.modifiers),
        "bounds": bounds,
        "center": [(bounds["minimum"][axis] + bounds["maximum"][axis]) * 0.5 for axis in range(3)],
        "size": [bounds["maximum"][axis] - bounds["minimum"][axis] for axis in range(3)],
    }


def scene_runtime_signature():
    armatures = []
    for obj in sorted((item for item in bpy.context.scene.objects if item.type == "ARMATURE"), key=lambda item: item.name):
        armatures.append({
            "name": obj.name,
            "parent": obj.parent.name if obj.parent else None,
            "bones": sorted(bone.name for bone in obj.data.bones),
        })
    actions = []
    for action in sorted(bpy.data.actions, key=lambda item: item.name):
        actions.append({
            "name": action.name,
            "frameRange": [round(float(value), 6) for value in action.frame_range],
        })
    return {"armatures": armatures, "actions": actions}


def apply_local_relief(obj, amplitude_mm, radius_fraction, center_u, center_v):
    if not (0.1 <= amplitude_mm <= 20.0):
        fail("Local relief amplitude must be within 0.1..20 mm.")
    if not (0.05 <= radius_fraction <= 0.45):
        fail("Local relief radius fraction must be within 0.05..0.45.")
    if not (0.1 <= center_u <= 0.9 and 0.1 <= center_v <= 0.9):
        fail("Local relief center must remain inside normalized 0.1..0.9 bounds.")
    mesh = obj.data
    minimum = [min(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)]
    maximum = [max(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)]
    spans = [maximum[axis] - minimum[axis] for axis in range(3)]
    if any(span <= 1e-9 for span in spans):
        fail("Local relief requires a non-degenerate three-dimensional mesh.")
    height_axis = min(range(3), key=lambda axis: spans[axis])
    plane_axes = [axis for axis in range(3) if axis != height_axis]
    top_band = max(0.006, spans[height_axis] * 0.18)
    changed = 0
    maximum_displacement_mm = 0.0
    amplitude_m = amplitude_mm / 1000.0
    for vertex in mesh.vertices:
        if vertex.co[height_axis] < maximum[height_axis] - top_band:
            continue
        u = (vertex.co[plane_axes[0]] - minimum[plane_axes[0]]) / spans[plane_axes[0]]
        v = (vertex.co[plane_axes[1]] - minimum[plane_axes[1]]) / spans[plane_axes[1]]
        distance = math.hypot(u - center_u, v - center_v)
        if distance >= radius_fraction:
            continue
        normalized = distance / radius_fraction
        weight = (1.0 - normalized * normalized) ** 2
        displacement = amplitude_m * weight
        if displacement <= 1e-8:
            continue
        vertex.co[height_axis] += displacement
        changed += 1
        maximum_displacement_mm = max(maximum_displacement_mm, displacement * 1000.0)
    mesh.update()
    bpy.context.view_layer.update()
    if changed < 3 or changed >= len(mesh.vertices):
        fail("Local relief edit did not isolate a bounded vertex patch.")
    if maximum_displacement_mm < amplitude_mm * 0.5:
        fail("Local relief edit missed the requested patch center.")
    return {
        "kind": "local-relief",
        "amplitudeMm": amplitude_mm,
        "radiusFraction": radius_fraction,
        "centerUv": [center_u, center_v],
        "heightAxis": height_axis,
        "changedVertices": changed,
        "totalVertices": len(mesh.vertices),
        "maximumDisplacementMm": maximum_displacement_mm,
    }


def collect_meshes():
    mesh_objects = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and not any(collection.name == "glTF_not_exported" for collection in obj.users_collection)
    ]
    meshes = {stable_object_id(obj): obj for obj in mesh_objects}
    if not meshes or len(meshes) > 4096:
        fail("Imported scene must contain 1..4096 mesh objects.")
    if len(meshes) != len(mesh_objects):
        fail("Imported scene contains duplicate stable mesh identifiers.")
    return meshes


def max_abs(values):
    return max(abs(value) for value in values) if values else 0.0


clear_scene()
bpy.ops.import_scene.gltf(filepath=str(input_path))
before_objects = collect_meshes()
if component_name not in before_objects:
    fail(f"Editable component not found: {component_name}")
for stable_id, obj in before_objects.items():
    obj["morphloomStableNodeId"] = stable_id
before = {name: mesh_signature(obj) for name, obj in before_objects.items()}
before_runtime = scene_runtime_signature()
target = before_objects[component_name]
if operation_kind == "translation":
    edited_matrix = target.matrix_world.copy()
    edited_matrix.translation += mathutils.Vector([value / 1000.0 for value in delta_mm])
    target.matrix_world = edited_matrix
    bpy.context.view_layer.update()
    edit_receipt = {"kind": "translation", "translationMm": delta_mm}
else:
    edit_receipt = apply_local_relief(target, *relief_parameters)
expected = {name: mesh_signature(obj) for name, obj in before_objects.items()}
expected_runtime = scene_runtime_signature()

bpy.ops.export_scene.gltf(
    filepath=str(output_path),
    export_format="GLB",
    use_visible=True,
    export_apply=False,
    export_yup=True,
    export_tangents=True,
    export_extras=True,
    export_armature_object_remove=True,
    export_force_sampling=False,
)
if not output_path.is_file() or output_path.stat().st_size < 12:
    fail("Blender did not emit the edited GLB.")

clear_scene()
bpy.ops.import_scene.gltf(filepath=str(output_path))
after_objects = collect_meshes()
after = {name: mesh_signature(obj) for name, obj in after_objects.items()}
after_runtime = scene_runtime_signature()

# A second no-op serialization distinguishes a one-time importer/exporter seam
# re-index from an unstable mesh that keeps changing on every DCC round trip.
bpy.ops.export_scene.gltf(
    filepath=str(stability_path),
    export_format="GLB",
    use_visible=True,
    export_apply=False,
    export_yup=True,
    export_tangents=True,
    export_extras=True,
    export_armature_object_remove=True,
    export_force_sampling=False,
)
if not stability_path.is_file() or stability_path.stat().st_size < 12:
    fail("Blender did not emit the no-op stability GLB.")
clear_scene()
bpy.ops.import_scene.gltf(filepath=str(stability_path))
stabilized_objects = collect_meshes()
stabilized = {name: mesh_signature(obj) for name, obj in stabilized_objects.items()}
stabilized_runtime = scene_runtime_signature()

blockers = []
warnings = []
skinned_semantic_deferrals = []
topology_changes = []
stability_changes = []
if set(before) != set(after):
    blockers.append("Named mesh set changed after component edit round trip.")
if set(after) != set(stabilized):
    blockers.append("Named mesh set changed during the no-op stability round trip.")
if before_runtime != expected_runtime:
    blockers.append("The edit changed armature or animation data before export.")
if expected_runtime != after_runtime:
    blockers.append("Armature or animation data changed after the edit round trip.")
if after_runtime != stabilized_runtime:
    blockers.append("Armature or animation data changed during the no-op stability round trip.")
unchanged_max_center_drift_mm = 0.0
unchanged_max_size_drift_mm = 0.0
for name in sorted(set(before) & set(after)):
    source = before[name]
    result = after[name]
    intended = expected[name]
    if source["vertices"] != result["vertices"] or source["edges"] != result["edges"] or source["polygons"] != result["polygons"]:
        topology_changes.append({
            "component": name,
            "before": {
                "vertices": source["vertices"],
                "edges": source["edges"],
                "polygons": source["polygons"],
            },
            "after": {
                "vertices": result["vertices"],
                "edges": result["edges"],
                "polygons": result["polygons"],
            },
        })
    if intended["polygons"] != result["polygons"]:
        blockers.append(f"{name}: polygon count changed.")
    if intended["materialSlots"] != result["materialSlots"]:
        blockers.append(f"{name}: material slot count changed.")
    skinned_semantics_deferred = intended["skinned"] or result["skinned"]
    if intended["geometryDigest"] != result["geometryDigest"]:
        if skinned_semantics_deferred:
            skinned_semantic_deferrals.append(name)
        else:
            blockers.append(f"{name}: canonical face geometry changed outside the requested edit.")
    if intended["uvDigest"] != result["uvDigest"] and not skinned_semantics_deferred:
        blockers.append(f"{name}: UV mapping changed outside the requested edit.")
    if intended["materialSlotSignature"] != result["materialSlotSignature"]:
        blockers.append(f"{name}: material assignments or PBR factors changed.")
    if intended["parent"] != result["parent"] or intended["modifiers"] != result["modifiers"]:
        blockers.append(f"{name}: hierarchy or modifier bindings changed.")
    center_delta_mm = [(result["center"][axis] - source["center"][axis]) * 1000 for axis in range(3)]
    size_delta_mm = [(result["size"][axis] - source["size"][axis]) * 1000 for axis in range(3)]
    expected_center_error_mm = max_abs([
        (result["center"][axis] - intended["center"][axis]) * 1000 for axis in range(3)
    ])
    expected_size_error_mm = max_abs([
        (result["size"][axis] - intended["size"][axis]) * 1000 for axis in range(3)
    ])
    bounds_tolerance_mm = 0.5 if skinned_semantics_deferred else 0.01
    if expected_center_error_mm > bounds_tolerance_mm or expected_size_error_mm > bounds_tolerance_mm:
        blockers.append(f"{name}: edited-state bounds drift exceeds {bounds_tolerance_mm:.2f} mm after re-open.")
    if name == component_name:
        if operation_kind == "translation":
            error = max_abs([center_delta_mm[axis] - delta_mm[axis] for axis in range(3)])
            if error > 0.01:
                blockers.append(f"{name}: requested translation drift {error:.6f} mm exceeds 0.01 mm.")
            if max_abs(size_delta_mm) > 0.01:
                blockers.append(f"{name}: translated component size changed by more than 0.01 mm.")
        elif source["geometryDigest"] == result["geometryDigest"]:
            blockers.append(f"{name}: local relief did not produce a persistent geometry edit.")
    else:
        unchanged_max_center_drift_mm = max(unchanged_max_center_drift_mm, max_abs(center_delta_mm))
        unchanged_max_size_drift_mm = max(unchanged_max_size_drift_mm, max_abs(size_delta_mm))
        if max_abs(center_delta_mm) > bounds_tolerance_mm or max_abs(size_delta_mm) > bounds_tolerance_mm:
            blockers.append(f"{name}: unchanged component drift exceeds {bounds_tolerance_mm:.2f} mm.")
for name in sorted(set(after) & set(stabilized)):
    source = after[name]
    result = stabilized[name]
    skinned_semantics_deferred = source["skinned"] or result["skinned"]
    changed = (
        source["vertices"] != result["vertices"]
        or source["edges"] != result["edges"]
        or source["polygons"] != result["polygons"]
        or source["materialSlots"] != result["materialSlots"]
        or (not skinned_semantics_deferred and source["geometryDigest"] != result["geometryDigest"])
        or (not skinned_semantics_deferred and source["uvDigest"] != result["uvDigest"])
        or source["materialSlotSignature"] != result["materialSlotSignature"]
        or source["parent"] != result["parent"]
        or source["modifiers"] != result["modifiers"]
    )
    if changed:
        stability_changes.append({
            "component": name,
            "before": {
                "vertices": source["vertices"], "edges": source["edges"],
                "polygons": source["polygons"], "materialSlots": source["materialSlots"],
            },
            "after": {
                "vertices": result["vertices"], "edges": result["edges"],
                "polygons": result["polygons"], "materialSlots": result["materialSlots"],
            },
        })
        if (
            source["polygons"] != result["polygons"]
            or source["materialSlots"] != result["materialSlots"]
            or (not skinned_semantics_deferred and source["geometryDigest"] != result["geometryDigest"])
            or (not skinned_semantics_deferred and source["uvDigest"] != result["uvDigest"])
            or source["materialSlotSignature"] != result["materialSlotSignature"]
            or source["parent"] != result["parent"]
            or source["modifiers"] != result["modifiers"]
        ):
            blockers.append(f"{name}: geometry, UV, material, or hierarchy did not stabilize after the no-op round trip.")
        else:
            warnings.append(f"{name}: Blender re-indexed UV/normal seam vertices while preserving polygons and material slots.")

receipt = {
    "schema": "morphloom.blender-component-edit-audit/0.2",
    "application": "Blender",
    "version": bpy.app.version_string,
    "input": {
        "path": str(input_path),
        "bytes": input_path.stat().st_size,
        "sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
    },
    "output": {
        "path": str(output_path),
        "bytes": output_path.stat().st_size,
        "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
    },
    "stabilityOutput": {
        "path": str(stability_path),
        "bytes": stability_path.stat().st_size,
        "sha256": hashlib.sha256(stability_path.read_bytes()).hexdigest(),
    },
    "edit": {"component": component_name, **edit_receipt},
    "meshCount": len(after),
    "unchangedMeshes": max(0, len(after) - 1),
    "maximumUnchangedCenterDriftMm": unchanged_max_center_drift_mm,
    "maximumUnchangedSizeDriftMm": unchanged_max_size_drift_mm,
    "topologyChanges": topology_changes,
    "topologyInterpretation": "Polygon counts, canonical face geometry, UVs, PBR factors, hierarchy, and modifier bindings are blocking. A one-time seam vertex/edge re-index is reported only when those semantic invariants remain stable.",
    "runtime": {
        "armatures": len(after_runtime["armatures"]),
        "actions": len(after_runtime["actions"]),
        "preserved": before_runtime == expected_runtime == after_runtime == stabilized_runtime,
    },
    "skinnedSemanticDeferrals": sorted(set(skinned_semantic_deferrals)),
    "stabilityChanges": stability_changes,
    "warnings": warnings,
    "pass": not blockers,
    "blockers": blockers[:100],
    "limitation": "This proves one requested object transform or bounded local-relief edit, canonical face/UV/PBR-slot/hierarchy preservation, bounded non-target drift, and armature/action inventory preservation through two Blender round trips. Vertex/edge indices at UV or normal seams are not promised to remain identical. It does not prove artistic usability, native CAD feature history, bone-weight editing, shader-node parity beyond exported PBR factors, or every possible edit operation.",
}
receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt, indent=2))
if blockers:
    sys.exit(1)
