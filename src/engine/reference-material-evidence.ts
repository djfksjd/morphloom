import * as THREE from 'three';
import type { MaskedReferenceSurfaceDerivation } from './reference-surface';

export interface ReferenceMaterialApplicationReceipt {
  schema: 'morphloom.reference-material-application/0.1';
  sourceId: string;
  evidenceFingerprint: string;
  status: 'applied' | 'rejected';
  appliedMaterials: string[];
  skippedMeshesWithoutUv: string[];
  blockers: string[];
  albedoMode: 'neutral-modulation' | 'source-colour';
  channels: {
    baseColor: 'reference' | 'not-applied';
    normal: 'reference' | 'not-applied';
    roughness: 'reference' | 'not-applied';
    metallic: 'unverified';
  };
}

function makeTexture(
  data: Uint8ClampedArray,
  size: number,
  colorSpace: THREE.ColorSpace,
  channel: 'baseColor' | 'normal' | 'metallicRoughness',
): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(data), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.userData.morphloomReferenceDerived = channel;
  texture.needsUpdate = true;
  return texture;
}

function packedMetallicRoughness(derivation: MaskedReferenceSurfaceDerivation): Uint8ClampedArray {
  const source = derivation.analysis.roughnessRgba;
  const packed = new Uint8ClampedArray(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    packed[offset] = 255;
    packed[offset + 1] = source[offset]!;
    packed[offset + 2] = 255;
    packed[offset + 3] = 255;
  }
  return packed;
}

/**
 * Applies a neutral, source-derived micro-surface to existing authored PBR
 * materials without changing geometry or claiming calibrated metallic values.
 * Materials retain their authored colour/metalness factors; the reference tile
 * contributes only bounded spatial modulation, tangent normals and roughness.
 */
export function applyReferenceMaterialEvidence(
  root: THREE.Object3D,
  derivation: MaskedReferenceSurfaceDerivation,
  options: {
    materialFilter?: (material: THREE.MeshPhysicalMaterial, mesh: THREE.Mesh) => boolean;
    repeat?: number;
    /**
     * `source-colour` is reserved for admitted stationary material close-ups.
     * Object photographs should keep the default neutral modulation so baked
     * lighting and structural outlines cannot overwrite authored colours.
     */
    albedoMode?: 'neutral-modulation' | 'source-colour';
  } = {},
): ReferenceMaterialApplicationReceipt {
  const repeat = options.repeat ?? 3;
  const albedoMode = options.albedoMode ?? 'neutral-modulation';
  if (!Number.isFinite(repeat) || repeat < 0.25 || repeat > 64) {
    throw new Error('Reference material repeat must be within 0.25..64.');
  }
  if (!derivation.materialSuitability.pass) {
    return {
      schema: 'morphloom.reference-material-application/0.1',
      sourceId: derivation.selectedSourceId,
      evidenceFingerprint: derivation.selectedSourceFingerprint,
      status: 'rejected',
      appliedMaterials: [],
      skippedMeshesWithoutUv: [],
      blockers: [...derivation.materialSuitability.blockers],
      albedoMode,
      channels: { baseColor: 'not-applied', normal: 'not-applied', roughness: 'not-applied', metallic: 'unverified' },
    };
  }
  const baseColorPixels = albedoMode === 'source-colour'
    ? derivation.sourceAlbedoRgba
    : derivation.albedoRgba;
  const baseColor = makeTexture(baseColorPixels, derivation.textureSize, THREE.SRGBColorSpace, 'baseColor');
  const normal = makeTexture(derivation.analysis.normalRgba, derivation.textureSize, THREE.NoColorSpace, 'normal');
  const metallicRoughness = makeTexture(
    packedMetallicRoughness(derivation), derivation.textureSize, THREE.NoColorSpace, 'metallicRoughness',
  );
  for (const texture of [baseColor, normal, metallicRoughness]) texture.repeat.set(repeat, repeat);

  const applied = new Set<string>();
  const skippedMeshesWithoutUv: string[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
    if (!object.geometry.getAttribute('uv')) {
      skippedMeshesWithoutUv.push(object.name || object.uuid);
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshPhysicalMaterial) || options.materialFilter?.(material, object) === false) continue;
      material.map = baseColor;
      material.normalMap = normal;
      material.normalScale.set(
        THREE.MathUtils.clamp(derivation.analysis.metrics.normalSlopeRms * 1.35, 0.12, 0.7),
        THREE.MathUtils.clamp(derivation.analysis.metrics.normalSlopeRms * 1.35, 0.12, 0.7),
      );
      material.roughnessMap = metallicRoughness;
      material.metalnessMap = metallicRoughness;
      material.userData.morphloomSurface = {
        ...material.userData.morphloomSurface,
        referenceMaterialEvidence: {
          schema: 'morphloom.reference-material-channel-evidence/0.1',
          sourceId: derivation.selectedSourceId,
          evidenceFingerprint: derivation.selectedSourceFingerprint,
          baseColor: 'reference',
          albedoMode,
          normal: 'reference',
          roughness: 'reference',
          metallic: 'unverified',
          textureSize: derivation.textureSize,
          sourceForegroundPixels: derivation.sourceForegroundPixels,
          sourceInteriorPixels: derivation.sourceInteriorPixels,
        },
      };
      material.needsUpdate = true;
      applied.add(material.name || material.uuid);
    }
  });
  return {
    schema: 'morphloom.reference-material-application/0.1',
    sourceId: derivation.selectedSourceId,
    evidenceFingerprint: derivation.selectedSourceFingerprint,
    status: 'applied',
    appliedMaterials: [...applied].sort(),
    skippedMeshesWithoutUv: [...new Set(skippedMeshesWithoutUv)].sort(),
    blockers: [],
    albedoMode,
    channels: { baseColor: 'reference', normal: 'reference', roughness: 'reference', metallic: 'unverified' },
  };
}
