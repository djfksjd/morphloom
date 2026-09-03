extends SceneTree

const SCHEMA := "morphloom.godot-cross-domain-import/0.1"

func _sha256(path: String) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(FileAccess.get_file_as_bytes(path))
	return context.finish().hex_encode()

func _remember_resource(resource: Resource, seen: Dictionary) -> void:
	if resource == null:
		return
	seen[resource.get_instance_id()] = true

func _inspect_material(material: Material, material_ids: Dictionary, texture_ids: Dictionary) -> void:
	if material == null:
		return
	if material_ids.has(material.get_instance_id()):
		return
	_remember_resource(material, material_ids)
	if material is BaseMaterial3D:
		for property_name in [
			"albedo_texture", "metallic_texture", "roughness_texture", "normal_texture",
			"emission_texture", "ao_texture", "heightmap_texture", "clearcoat_texture",
		]:
			var texture = material.get(property_name)
			if texture is Texture2D:
				_remember_resource(texture, texture_ids)
				material_ids.texture_slots += 1

func _expand_bounds(aabb: AABB, transform: Transform3D, state: Dictionary, node_name: String) -> void:
	for x in [aabb.position.x, aabb.end.x]:
		for y in [aabb.position.y, aabb.end.y]:
			for z in [aabb.position.z, aabb.end.z]:
				var point := transform * Vector3(x, y, z)
				if not state.has("minimum"):
					state.minimum = point
					state.maximum = point
					state.minimum_nodes = [node_name, node_name, node_name]
					state.maximum_nodes = [node_name, node_name, node_name]
				else:
					for axis in range(3):
						if point[axis] < state.minimum[axis]:
							state.minimum[axis] = point[axis]
							state.minimum_nodes[axis] = node_name
						if point[axis] > state.maximum[axis]:
							state.maximum[axis] = point[axis]
							state.maximum_nodes[axis] = node_name

func _relative_transform(node: Node3D, imported_root: Node) -> Transform3D:
	var result := node.transform
	var parent := node.get_parent()
	while parent != null and parent != imported_root.get_parent():
		if parent is Node3D:
			result = (parent as Node3D).transform * result
		if parent == imported_root:
			break
		parent = parent.get_parent()
	return result

func _inspect_node(node: Node, stats: Dictionary, state: Dictionary) -> void:
	stats.nodes += 1
	if node is Skeleton3D:
		stats.skeletons += 1
		stats.bones += node.get_bone_count()
	if node is AnimationPlayer:
		for library_name in node.get_animation_library_list():
			var library: AnimationLibrary = node.get_animation_library(library_name)
			for animation_name in library.get_animation_list():
				var qualified_name := String(animation_name) if String(library_name).is_empty() else "%s/%s" % [library_name, animation_name]
				state.animation_names[qualified_name] = true
	if node is MeshInstance3D and node.mesh != null:
		var mesh: Mesh = node.mesh
		var relative_transform := _relative_transform(node, state.imported_root)
		var normal_transform := relative_transform.basis.inverse().transposed()
		stats.meshes += 1
		stats.blend_shapes += mesh.get_blend_shape_count()
		if not node.skeleton.is_empty():
			stats.skinned_meshes += 1
		_expand_bounds(mesh.get_aabb(), relative_transform, state, node.name)
		for surface_index in range(mesh.get_surface_count()):
			var arrays := mesh.surface_get_arrays(surface_index)
			var vertices = arrays[Mesh.ARRAY_VERTEX]
			var normals = arrays[Mesh.ARRAY_NORMAL]
			var indices = arrays[Mesh.ARRAY_INDEX]
			stats.vertices += vertices.size()
			if mesh.surface_get_primitive_type(surface_index) == Mesh.PRIMITIVE_TRIANGLES:
				stats.triangles += (indices.size() if indices.size() > 0 else vertices.size()) / 3
			if String(node.name) == "asphalt_core_sample" and normals.size() == vertices.size():
				for vertex_index in range(vertices.size()):
					var delivered_normal: Vector3 = (normal_transform * normals[vertex_index]).normalized()
					if delivered_normal.y <= 0.1:
						continue
					var delivered_y_mm: float = (relative_transform * vertices[vertex_index]).y * 1000.0
					if not is_finite(delivered_y_mm):
						continue
					var relief: Dictionary = state.surface_relief
					relief.samples += 1
					relief.sum_mm += delivered_y_mm
					relief.sum_squared_mm += delivered_y_mm * delivered_y_mm
					if relief.samples == 1:
						relief.minimum_mm = delivered_y_mm
						relief.maximum_mm = delivered_y_mm
					else:
						relief.minimum_mm = min(relief.minimum_mm, delivered_y_mm)
						relief.maximum_mm = max(relief.maximum_mm, delivered_y_mm)
			var material: Material = node.get_surface_override_material(surface_index)
			if material == null:
				material = mesh.surface_get_material(surface_index)
			_inspect_material(material, state.material_ids, state.texture_ids)
	for child in node.get_children():
		_inspect_node(child, stats, state)

func _write_report(output_path: String, report: Dictionary) -> bool:
	var file := FileAccess.open(output_path, FileAccess.WRITE)
	if file == null:
		push_error("Could not open Godot proof output: %s" % output_path)
		return false
	file.store_string(JSON.stringify(report, "  ") + "\n")
	file.close()
	return true

func _init() -> void:
	var arguments := OS.get_cmdline_user_args()
	if arguments.size() != 2:
		push_error("Usage: -- <res://asset.glb> <absolute-report.json>")
		quit(2)
		return
	var asset_path: String = arguments[0]
	var output_path: String = arguments[1]
	var packed: Resource = load(asset_path)
	if not packed is PackedScene:
		_write_report(output_path, {
			"schema": SCHEMA,
			"godot_version": Engine.get_version_info().string,
			"pass": false,
			"source": asset_path,
			"blockers": ["Godot did not import the GLB as a PackedScene."],
		})
		quit(1)
		return
	var instance: Node = packed.instantiate()
	get_root().add_child(instance)
	var stats := {
		"nodes": 0, "meshes": 0, "vertices": 0, "triangles": 0,
		"skeletons": 0, "bones": 0, "skinned_meshes": 0, "blend_shapes": 0,
	}
	var state := {
		"material_ids": {"texture_slots": 0}, "texture_ids": {}, "animation_names": {}, "imported_root": instance,
		"surface_relief": {"samples": 0, "sum_mm": 0.0, "sum_squared_mm": 0.0, "minimum_mm": 0.0, "maximum_mm": 0.0},
	}
	_inspect_node(instance, stats, state)
	stats.materials = state.material_ids.size() - 1
	stats.textures = state.texture_ids.size()
	stats.texture_slots = state.material_ids.texture_slots
	var animation_names: Array = state.animation_names.keys()
	animation_names.sort()
	stats.animation_clips = animation_names.size()
	stats.animation_names = animation_names
	var relief: Dictionary = state.surface_relief
	if relief.samples > 0:
		var relief_mean_mm: float = relief.sum_mm / relief.samples
		var relief_variance_mm2: float = max(0.0, relief.sum_squared_mm / relief.samples - relief_mean_mm * relief_mean_mm)
		stats.surface_relief = {
			"samples": relief.samples,
			"rms_roughness_mm": sqrt(relief_variance_mm2),
			"peak_to_valley_mm": relief.maximum_mm - relief.minimum_mm,
		}
	if state.has("minimum"):
		var size: Vector3 = state.maximum - state.minimum
		stats.bounds_size_meters = [size.x, size.y, size.z]
		stats.bounds_min_meters = [state.minimum.x, state.minimum.y, state.minimum.z]
		stats.bounds_max_meters = [state.maximum.x, state.maximum.y, state.maximum.z]
		stats.bounds_min_nodes = state.minimum_nodes
		stats.bounds_max_nodes = state.maximum_nodes
	else:
		stats.bounds_size_meters = [0.0, 0.0, 0.0]
	var blockers: Array[String] = []
	if stats.meshes < 1 or stats.vertices < 3 or stats.triangles < 1:
		blockers.append("Imported scene has no usable triangle mesh.")
	if stats.bounds_size_meters.any(func(value): return not is_finite(value) or value <= 0.0):
		blockers.append("Imported scene bounds are empty or non-finite.")
	var report := {
		"schema": SCHEMA,
		"godot_version": Engine.get_version_info().string,
		"pass": blockers.is_empty(),
		"source": asset_path,
		"source_sha256": _sha256(ProjectSettings.globalize_path(asset_path)),
		"stats": stats,
		"blockers": blockers,
	}
	var wrote := _write_report(output_path, report)
	instance.queue_free()
	quit(0 if wrote and blockers.is_empty() else 1)
