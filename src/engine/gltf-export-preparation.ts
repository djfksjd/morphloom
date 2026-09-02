import * as THREE from 'three';

export interface GltfExportPreparationReport {
  visibleMeshes: number;
  normalizedNormalAttributes: number;
  /** Three supports a scalar sheen multiplier, while KHR_materials_sheen does not. */
  normalizedSheenMaterials: number;
  tangentSpacesGenerated: number;
  indexedForTangents: number;
  unresolvedNormalMappedMeshes: string[];
}

/**
 * glTF ignores parent transforms above a skinned mesh. Character builds use a
 * metadata group in the live viewer, so export its children as scene roots and
 * move the metadata to glTF scene extras without mutating the live hierarchy.
 */
export function createPortableGltfExportInput(root: THREE.Object3D): THREE.Object3D {
  if (root instanceof THREE.Scene) return root;
  let containsVisibleSkin = false;
  root.traverseVisible((object) => {
    if (object instanceof THREE.SkinnedMesh) containsVisibleSkin = true;
  });
  if (!containsVisibleSkin) return root;
  root.updateMatrix();
  if (!root.matrix.equals(new THREE.Matrix4())) {
    throw new Error('A skinned export root must have an identity transform before scene-root flattening.');
  }
  const scene = new THREE.Scene();
  scene.name = root.name;
  scene.userData = root.userData;
  scene.animations = root.animations;
  // GLTFExporter itself uses this non-reparenting technique for auxiliary
  // scenes. Retaining parent pointers keeps the interactive build untouched.
  scene.children.push(...root.children.filter((child) => child.visible));
  return scene;
}

function usesNormalMap(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((candidate) => (
    'normalMap' in candidate
    && candidate.normalMap instanceof THREE.Texture
  ));
}

/**
 * Makes generated meshes deterministic across glTF consumers before export.
 * A normal map without explicit tangents leaves each DCC/game engine free to
 * generate a different tangent basis, which changes highlights and relief.
 */
export function preparePortableGltfGeometry(root: THREE.Object3D): GltfExportPreparationReport {
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const fallbackAxis = new THREE.Vector3();
  const normalized = new Set<THREE.BufferGeometry>();
  const tangentReady = new Set<THREE.BufferGeometry>();
  const normalizedMaterials = new Set<THREE.Material>();
  const report: GltfExportPreparationReport = {
    visibleMeshes: 0,
    normalizedNormalAttributes: 0,
    normalizedSheenMaterials: 0,
    tangentSpacesGenerated: 0,
    indexedForTangents: 0,
    unresolvedNormalMappedMeshes: [],
  };

  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    report.visibleMeshes += 1;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (normalizedMaterials.has(material)) continue;
      normalizedMaterials.add(material);
      if (!(material instanceof THREE.MeshPhysicalMaterial) || material.sheen <= 0 || material.sheen === 1) continue;
      // Three.js evaluates sheenColor * sheen. glTF's KHR_materials_sheen has
      // no independent intensity scalar and GLTFExporter otherwise drops it,
      // reopening every positive value as 1. Bake the multiplier into the
      // color before export so both the rendered energy and audit survive.
      material.sheenColor.multiplyScalar(THREE.MathUtils.clamp(material.sheen, 0, 1));
      material.sheen = 1;
      material.needsUpdate = true;
      report.normalizedSheenMaterials += 1;
    }
    const geometry = object.geometry;
    const normalAttribute = geometry.getAttribute('normal');

    if (normalAttribute && !normalized.has(geometry)) {
      let changed = false;
      for (let index = 0; index < normalAttribute.count; index += 1) {
        normal.fromBufferAttribute(normalAttribute, index);
        const length = normal.length();
        if (Number.isFinite(length) && Math.abs(length - 1) <= 0.0005) continue;
        if (!Number.isFinite(length) || length <= 1e-12) normal.set(1, 0, 0);
        else normal.multiplyScalar(1 / length);
        normalAttribute.setXYZ(index, normal.x, normal.y, normal.z);
        changed = true;
      }
      if (changed) {
        normalAttribute.needsUpdate = true;
        report.normalizedNormalAttributes += 1;
      }
      normalized.add(geometry);
    }

    if (!usesNormalMap(object.material) || geometry.getAttribute('tangent') || tangentReady.has(geometry)) return;
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uvs = geometry.getAttribute('uv');
    if (!positions || !normals || !uvs || positions.count !== normals.count || positions.count !== uvs.count) {
      report.unresolvedNormalMappedMeshes.push(object.name || object.uuid);
      return;
    }
    if (!geometry.index) {
      const IndexArray = positions.count > 65_535 ? Uint32Array : Uint16Array;
      const indices = new IndexArray(positions.count);
      for (let index = 0; index < indices.length; index += 1) indices[index] = index;
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      report.indexedForTangents += 1;
    }
    geometry.computeTangents();
    const tangentAttribute = geometry.getAttribute('tangent');
    if (!tangentAttribute) {
      report.unresolvedNormalMappedMeshes.push(object.name || object.uuid);
      return;
    }
    for (let index = 0; index < tangentAttribute.count; index += 1) {
      tangent.fromBufferAttribute(tangentAttribute, index);
      let handedness = tangentAttribute.getW(index);
      const length = tangent.length();
      if (!Number.isFinite(length) || length <= 1e-12) {
        normal.fromBufferAttribute(normals, index);
        fallbackAxis.set(Math.abs(normal.x) < 0.9 ? 1 : 0, Math.abs(normal.x) < 0.9 ? 0 : 1, 0);
        tangent.crossVectors(normal, fallbackAxis).normalize();
        handedness = 1;
      } else {
        tangent.multiplyScalar(1 / length);
        if (handedness !== -1 && handedness !== 1) handedness = 1;
      }
      tangentAttribute.setXYZW(index, tangent.x, tangent.y, tangent.z, handedness);
    }
    tangentAttribute.needsUpdate = true;
    tangentReady.add(geometry);
    report.tangentSpacesGenerated += 1;
  });

  root.userData.morphloomGltfPreparation = report;
  return report;
}
