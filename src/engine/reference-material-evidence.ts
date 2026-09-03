import * as THREE from 'three';
import type { PbrSpatialChannel, PbrTextureProvenance } from './pbr-reference-audit';
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

export interface ReferenceMaterialFactorBindingReceipt {
  schema: 'morphloom.reference-material-factor-binding/0.1';
  sourceId: string;
  evidenceFingerprint: string;
  status: 'applied' | 'rejected';
  calibration: 'appearance-estimated';
  channels: PbrSpatialChannel[];
  appliedMaterials: string[];
  blockers: string[];
}

export interface ReferenceMaterialProvenanceReceipt {
  provenance: PbrTextureProvenance;
  evidenceFingerprint?: string;
  factorProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
  evidenceFingerprintByChannel?: Partial<Record<PbrSpatialChannel, string>>;
  textureProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
}

const SAFE_SOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PBR_CHANNELS: PbrSpatialChannel[] = ['baseColor', 'metallic', 'roughness', 'normal', 'emissive'];

/**
 * Records which authored PBR factors were estimated from a locked visual
 * reference without pretending that image-only evidence is calibrated BRDF
 * measurement. Geometry and material values are intentionally left unchanged.
 */
export function bindReferenceMaterialFactorEvidence(
  root: THREE.Object3D,
  evidence: {
    sourceId: string;
    evidenceFingerprint: string;
    channels: PbrSpatialChannel[];
    materialFilter?: (material: THREE.MeshPhysicalMaterial, mesh: THREE.Mesh) => boolean;
  },
): ReferenceMaterialFactorBindingReceipt {
  if (!SAFE_SOURCE_ID.test(evidence.sourceId) || !SHA256.test(evidence.evidenceFingerprint)
    || !Array.isArray(evidence.channels) || evidence.channels.length < 1
    || evidence.channels.length > PBR_CHANNELS.length
    || new Set(evidence.channels).size !== evidence.channels.length
    || evidence.channels.some((channel) => !PBR_CHANNELS.includes(channel))) {
    throw new Error('Reference material factor evidence is invalid or unsafe.');
  }
  const applied = new Set<string>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshPhysicalMaterial) || evidence.materialFilter?.(material, object) === false) continue;
      const previous = material.userData.morphloomSurface?.referenceFactorEvidence as {
        evidenceFingerprintByChannel?: Partial<Record<PbrSpatialChannel, string>>;
        factorProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
        sourceIdByChannel?: Partial<Record<PbrSpatialChannel, string>>;
      } | undefined;
      const evidenceFingerprintByChannel = { ...previous?.evidenceFingerprintByChannel };
      const factorProvenanceByChannel = { ...previous?.factorProvenanceByChannel };
      const sourceIdByChannel = { ...previous?.sourceIdByChannel };
      for (const channel of evidence.channels) {
        evidenceFingerprintByChannel[channel] = evidence.evidenceFingerprint;
        factorProvenanceByChannel[channel] = 'reference';
        sourceIdByChannel[channel] = evidence.sourceId;
      }
      material.userData.morphloomSurface = {
        ...material.userData.morphloomSurface,
        referenceFactorEvidence: {
          schema: 'morphloom.reference-material-factor-evidence/0.1',
          calibration: 'appearance-estimated',
          evidenceFingerprintByChannel,
          factorProvenanceByChannel,
          sourceIdByChannel,
        },
      };
      material.needsUpdate = true;
      applied.add(material.name || material.uuid);
    }
  });
  const blockers = applied.size > 0 ? [] : ['no eligible MeshPhysicalMaterial was found'];
  return {
    schema: 'morphloom.reference-material-factor-binding/0.1',
    sourceId: evidence.sourceId,
    evidenceFingerprint: evidence.evidenceFingerprint,
    status: blockers.length === 0 ? 'applied' : 'rejected',
    calibration: 'appearance-estimated',
    channels: [...evidence.channels],
    appliedMaterials: [...applied].sort(),
    blockers,
  };
}

/** Resolves only schema-checked, SHA-bound provenance from exported glTF extras. */
export function referenceMaterialProvenanceFromExtras(extras: unknown): ReferenceMaterialProvenanceReceipt {
  if (!extras || typeof extras !== 'object') return { provenance: 'procedural' };
  const surface = (extras as { morphloomSurface?: unknown }).morphloomSurface;
  if (!surface || typeof surface !== 'object') return { provenance: 'procedural' };
  const record = surface as {
    referenceProjectionState?: unknown;
    referenceFingerprint?: unknown;
    referenceMaterialEvidence?: unknown;
    referenceFactorEvidence?: unknown;
  };
  if (record.referenceProjectionState === 'loaded' && typeof record.referenceFingerprint === 'string'
    && SHA256.test(record.referenceFingerprint)) {
    return { provenance: 'reference', evidenceFingerprint: record.referenceFingerprint };
  }
  const receipt: ReferenceMaterialProvenanceReceipt = { provenance: 'procedural' };
  const textureEvidence = record.referenceMaterialEvidence;
  if (textureEvidence && typeof textureEvidence === 'object') {
    const value = textureEvidence as { schema?: unknown; evidenceFingerprint?: unknown };
    if (value.schema === 'morphloom.reference-material-channel-evidence/0.1'
      && typeof value.evidenceFingerprint === 'string' && SHA256.test(value.evidenceFingerprint)) {
      receipt.factorProvenanceByChannel = { baseColor: 'reference', roughness: 'reference', normal: 'reference' };
      receipt.textureProvenanceByChannel = {
        baseColor: 'reference', roughness: 'reference', normal: 'reference', metallic: 'procedural',
      };
      receipt.evidenceFingerprintByChannel = {
        baseColor: value.evidenceFingerprint, roughness: value.evidenceFingerprint, normal: value.evidenceFingerprint,
      };
    }
  }
  const factorEvidence = record.referenceFactorEvidence;
  if (factorEvidence && typeof factorEvidence === 'object') {
    const value = factorEvidence as {
      schema?: unknown;
      calibration?: unknown;
      evidenceFingerprintByChannel?: unknown;
      factorProvenanceByChannel?: unknown;
    };
    if (value.schema === 'morphloom.reference-material-factor-evidence/0.1'
      && value.calibration === 'appearance-estimated'
      && value.evidenceFingerprintByChannel && typeof value.evidenceFingerprintByChannel === 'object'
      && value.factorProvenanceByChannel && typeof value.factorProvenanceByChannel === 'object') {
      const fingerprints = value.evidenceFingerprintByChannel as Record<string, unknown>;
      const provenances = value.factorProvenanceByChannel as Record<string, unknown>;
      for (const channel of PBR_CHANNELS) {
        if (provenances[channel] !== 'reference' || typeof fingerprints[channel] !== 'string'
          || !SHA256.test(fingerprints[channel])) continue;
        receipt.factorProvenanceByChannel = { ...receipt.factorProvenanceByChannel, [channel]: 'reference' };
        receipt.evidenceFingerprintByChannel = {
          ...receipt.evidenceFingerprintByChannel, [channel]: fingerprints[channel] as string,
        };
      }
    }
  }
  return receipt;
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
    /** Scalar repeat remains backward compatible; a pair preserves directional materials such as wood grain. */
    repeat?: number | [number, number];
    /**
     * `source-colour` is reserved for admitted stationary material close-ups.
     * Object photographs should keep the default neutral modulation so baked
     * lighting and structural outlines cannot overwrite authored colours.
     */
    albedoMode?: 'neutral-modulation' | 'source-colour';
  } = {},
): ReferenceMaterialApplicationReceipt {
  const repeat = options.repeat ?? 3;
  const repeatPair: [number, number] = typeof repeat === 'number' ? [repeat, repeat] : repeat;
  const albedoMode = options.albedoMode ?? 'neutral-modulation';
  if (!Array.isArray(repeatPair) || repeatPair.length !== 2
    || repeatPair.some((value) => !Number.isFinite(value) || value < 0.25 || value > 64)) {
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
  for (const texture of [baseColor, normal, metallicRoughness]) texture.repeat.set(repeatPair[0], repeatPair[1]);

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
          sourceRegion: { ...derivation.sourceRegion },
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
