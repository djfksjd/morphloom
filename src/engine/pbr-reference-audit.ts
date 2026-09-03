export type PbrTextureProvenance = 'reference' | 'measured' | 'procedural' | 'unknown';

export interface PbrTextureSignal {
  width: number;
  height: number;
  /** SHA-256 and byte count of the encoded image actually embedded in the delivery artifact. */
  payloadFingerprint: string;
  encodedBytes: number;
  /** Per-channel normalized 0..1 mean, standard deviation and range. */
  mean: [number, number, number, number];
  standardDeviation: [number, number, number, number];
  range: [number, number, number, number];
  provenance: PbrTextureProvenance;
}

export interface PbrMaterialEvidence {
  id: string;
  /** Relative visible surface contribution. Values are normalized by the audit. */
  weight: number;
  baseColorFactor: [number, number, number, number];
  metallicFactor: number;
  roughnessFactor: number;
  normalScale: number;
  emissiveFactor: [number, number, number];
  /** Legacy fallback used when channel-specific provenance is not supplied. */
  factorProvenance: PbrTextureProvenance;
  factorProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
  /** SHA-256 of the locked source image, scan, measurement receipt, or reference asset. */
  evidenceFingerprint?: string;
  evidenceFingerprintByChannel?: Partial<Record<PbrSpatialChannel, string>>;
  /** Overrides provenance for a packed texture channel (notably glTF G=roughness/B=metallic). */
  textureProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
  baseColorTexture?: PbrTextureSignal;
  metallicRoughnessTexture?: PbrTextureSignal;
  normalTexture?: PbrTextureSignal;
  emissiveTexture?: PbrTextureSignal;
}

export type PbrSpatialChannel = 'baseColor' | 'metallic' | 'roughness' | 'normal' | 'emissive';

export interface PbrReferenceAuditOptions {
  minimumSlotCoverage?: number;
  minimumEvidenceCoverage?: number;
  minimumSpatialDeviation?: number;
  /** When supplied, trusted provenance must bind to one of these locked SHA-256 values. */
  acceptedEvidenceFingerprints?: string[];
}

export interface PbrChannelAudit {
  channel: PbrSpatialChannel;
  requiredCoverage: number;
  slotCoverage: number;
  evidenceMappedCoverage: number;
  slotPass: boolean;
  evidencePass: boolean;
}

export interface PbrReferenceAudit {
  schema: 'morphloom.pbr-reference-audit/0.2';
  pass: boolean;
  channels: PbrChannelAudit[];
  thresholds: {
    minimumSlotCoverage: number;
    minimumEvidenceCoverage: number;
    minimumSpatialDeviation: number;
  };
  evidenceBinding: {
    enforced: boolean;
    acceptedFingerprints: string[];
  };
  blockers: string[];
  limitation: string;
}

const MAX_MATERIALS = 4_096;
const MAX_TEXTURE_DIMENSION = 8_192;
const MAX_TEXTURE_PIXELS = 16_777_216;
const SHA256 = /^[a-f0-9]{64}$/;
const CHANNELS: PbrSpatialChannel[] = ['baseColor', 'metallic', 'roughness', 'normal', 'emissive'];

function finiteUnit(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be within 0..1.`);
  return value;
}

function validateTuple(values: readonly number[], size: number, label: string): void {
  if (values.length !== size) throw new Error(`${label} must contain ${size} values.`);
  values.forEach((value, index) => finiteUnit(value, `${label}[${index}]`));
}

function validateTexture(texture: PbrTextureSignal | undefined, label: string): void {
  if (!texture) return;
  if (!Number.isInteger(texture.width) || !Number.isInteger(texture.height)
    || texture.width < 1 || texture.height < 1
    || texture.width > MAX_TEXTURE_DIMENSION || texture.height > MAX_TEXTURE_DIMENSION
    || texture.width * texture.height > MAX_TEXTURE_PIXELS) {
    throw new Error(`${label} dimensions are outside the safe texture budget.`);
  }
  validateTuple(texture.mean, 4, `${label}.mean`);
  validateTuple(texture.standardDeviation, 4, `${label}.standardDeviation`);
  validateTuple(texture.range, 4, `${label}.range`);
  if (!['reference', 'measured', 'procedural', 'unknown'].includes(texture.provenance)) {
    throw new Error(`${label} provenance is unsupported.`);
  }
  if (!SHA256.test(texture.payloadFingerprint)) throw new Error(`${label}.payloadFingerprint must be SHA-256.`);
  if (!Number.isInteger(texture.encodedBytes) || texture.encodedBytes < 1 || texture.encodedBytes > 32 * 1024 * 1024) {
    throw new Error(`${label}.encodedBytes must identify an actual encoded payload within 32 MB.`);
  }
}

function validateMaterials(materials: PbrMaterialEvidence[], label: string): void {
  if (materials.length < 1 || materials.length > MAX_MATERIALS) {
    throw new Error(`${label} must contain 1..${MAX_MATERIALS} materials.`);
  }
  const ids = new Set<string>();
  for (const material of materials) {
    if (!material.id || material.id.length > 256) throw new Error(`${label} material id is invalid.`);
    if (ids.has(material.id)) throw new Error(`${label} contains duplicate material id ${material.id}.`);
    ids.add(material.id);
    if (!Number.isFinite(material.weight) || material.weight <= 0) throw new Error(`${label} material weight must be positive.`);
    validateTuple(material.baseColorFactor, 4, `${label}.${material.id}.baseColorFactor`);
    finiteUnit(material.metallicFactor, `${label}.${material.id}.metallicFactor`);
    finiteUnit(material.roughnessFactor, `${label}.${material.id}.roughnessFactor`);
    if (!Number.isFinite(material.normalScale) || material.normalScale < 0 || material.normalScale > 4) {
      throw new Error(`${label}.${material.id}.normalScale must be within 0..4.`);
    }
    validateTuple(material.emissiveFactor, 3, `${label}.${material.id}.emissiveFactor`);
    if (!['reference', 'measured', 'procedural', 'unknown'].includes(material.factorProvenance)) {
      throw new Error(`${label}.${material.id}.factorProvenance is unsupported.`);
    }
    for (const channel of CHANNELS) {
      const provenance = material.factorProvenanceByChannel?.[channel];
      if (provenance !== undefined && !['reference', 'measured', 'procedural', 'unknown'].includes(provenance)) {
        throw new Error(`${label}.${material.id}.factorProvenanceByChannel.${channel} is unsupported.`);
      }
      const textureProvenance = material.textureProvenanceByChannel?.[channel];
      if (textureProvenance !== undefined
        && !['reference', 'measured', 'procedural', 'unknown'].includes(textureProvenance)) {
        throw new Error(`${label}.${material.id}.textureProvenanceByChannel.${channel} is unsupported.`);
      }
      const fingerprint = material.evidenceFingerprintByChannel?.[channel];
      if (fingerprint !== undefined && !SHA256.test(fingerprint)) {
        throw new Error(`${label}.${material.id}.evidenceFingerprintByChannel.${channel} must be SHA-256.`);
      }
      const texture = textureFor(material, channel);
      const resolvedTextureProvenance = textureProvenanceFor(material, channel, texture);
      const trustedFactor = ['reference', 'measured'].includes(provenance ?? material.factorProvenance);
      const trustedTexture = Boolean(texture && ['reference', 'measured'].includes(resolvedTextureProvenance));
      if ((trustedFactor || trustedTexture) && !SHA256.test(fingerprint ?? material.evidenceFingerprint ?? '')) {
        throw new Error(`${label}.${material.id}.${channel} evidenceFingerprint must bind trusted provenance to SHA-256 evidence.`);
      }
    }
    validateTexture(material.baseColorTexture, `${label}.${material.id}.baseColorTexture`);
    validateTexture(material.metallicRoughnessTexture, `${label}.${material.id}.metallicRoughnessTexture`);
    validateTexture(material.normalTexture, `${label}.${material.id}.normalTexture`);
    validateTexture(material.emissiveTexture, `${label}.${material.id}.emissiveTexture`);
  }
}

function factorProvenanceFor(material: PbrMaterialEvidence, channel: PbrSpatialChannel): PbrTextureProvenance {
  return material.factorProvenanceByChannel?.[channel] ?? material.factorProvenance;
}

function evidenceFingerprintFor(material: PbrMaterialEvidence, channel: PbrSpatialChannel): string | undefined {
  return material.evidenceFingerprintByChannel?.[channel] ?? material.evidenceFingerprint;
}

function textureFor(material: PbrMaterialEvidence, channel: PbrSpatialChannel): PbrTextureSignal | undefined {
  if (channel === 'baseColor') return material.baseColorTexture;
  if (channel === 'normal') return material.normalTexture;
  if (channel === 'emissive') return material.emissiveTexture;
  return material.metallicRoughnessTexture;
}

function textureProvenanceFor(
  material: PbrMaterialEvidence,
  channel: PbrSpatialChannel,
  texture = textureFor(material, channel),
): PbrTextureProvenance {
  return material.textureProvenanceByChannel?.[channel] ?? texture?.provenance ?? 'unknown';
}

function activeFactor(material: PbrMaterialEvidence, channel: PbrSpatialChannel): number {
  if (channel === 'baseColor') return Math.max(...material.baseColorFactor.slice(0, 3));
  if (channel === 'metallic') return material.metallicFactor;
  if (channel === 'roughness') return material.roughnessFactor;
  if (channel === 'normal') return material.normalScale;
  return Math.max(...material.emissiveFactor);
}

function spatialDeviation(texture: PbrTextureSignal, channel: PbrSpatialChannel): number {
  if (channel === 'roughness') return texture.standardDeviation[1];
  if (channel === 'metallic') return texture.standardDeviation[2];
  if (channel === 'normal') return Math.max(texture.standardDeviation[0], texture.standardDeviation[1]);
  return Math.max(...texture.standardDeviation.slice(0, 3));
}

function spatialRange(texture: PbrTextureSignal, channel: PbrSpatialChannel): number {
  if (channel === 'roughness') return texture.range[1];
  if (channel === 'metallic') return texture.range[2];
  if (channel === 'normal') return Math.max(texture.range[0], texture.range[1]);
  return Math.max(...texture.range.slice(0, 3));
}

function hasSpatialSignal(material: PbrMaterialEvidence, channel: PbrSpatialChannel, threshold: number): boolean {
  const texture = textureFor(material, channel);
  return Boolean(texture && activeFactor(material, channel) > 1e-4
    && spatialDeviation(texture, channel) >= threshold && spatialRange(texture, channel) >= threshold * 4);
}

function coverage(
  materials: PbrMaterialEvidence[],
  predicate: (material: PbrMaterialEvidence) => boolean,
): number {
  const total = materials.reduce((sum, material) => sum + material.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('PBR material weight total is unsafe.');
  return materials.reduce((sum, material) => sum + (predicate(material) ? material.weight : 0), 0) / total;
}

function scalarFactor(material: PbrMaterialEvidence, channel: PbrSpatialChannel): number {
  if (channel === 'baseColor') {
    return material.baseColorFactor[0] * 0.2126 + material.baseColorFactor[1] * 0.7152 + material.baseColorFactor[2] * 0.0722;
  }
  if (channel === 'metallic') return material.metallicFactor;
  if (channel === 'roughness') return material.roughnessFactor;
  if (channel === 'normal') return material.normalScale;
  return material.emissiveFactor[0] * 0.2126 + material.emissiveFactor[1] * 0.7152 + material.emissiveFactor[2] * 0.0722;
}

function segmentedFactorSignal(
  materials: PbrMaterialEvidence[],
  channel: PbrSpatialChannel,
  threshold: number,
  acceptedEvidence: ReadonlySet<string> | undefined,
): {
  spatial: boolean;
  evidenceMapped: boolean;
} {
  if (materials.length < 2) return { spatial: false, evidenceMapped: false };
  const total = materials.reduce((sum, material) => sum + material.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('PBR material weight total is unsafe.');
  const mean = materials.reduce((sum, material) => sum + scalarFactor(material, channel) * material.weight, 0) / total;
  const deviation = Math.sqrt(materials.reduce((sum, material) => {
    const delta = scalarFactor(material, channel) - mean;
    return sum + delta * delta * material.weight;
  }, 0) / total);
  const spatial = deviation >= threshold;
  return {
    spatial,
    evidenceMapped: spatial && materials.every((material) => (
      ['reference', 'measured'].includes(factorProvenanceFor(material, channel))
    ) && (!acceptedEvidence || acceptedEvidence.has(evidenceFingerprintFor(material, channel)!))),
  };
}

/**
 * Verifies that spatial PBR evidence present in a trusted reference is not
 * silently replaced by constants or generic noise. This is deliberately not
 * a BRDF calibration claim: lighting-calibrated capture is still required for
 * physically measured roughness, IOR and reflectance.
 */
export function auditPbrReferenceEvidence(
  reference: PbrMaterialEvidence[],
  candidate: PbrMaterialEvidence[],
  options: PbrReferenceAuditOptions = {},
): PbrReferenceAudit {
  validateMaterials(reference, 'reference');
  validateMaterials(candidate, 'candidate');
  const minimumSlotCoverage = finiteUnit(options.minimumSlotCoverage ?? 0.8, 'minimumSlotCoverage');
  const minimumEvidenceCoverage = finiteUnit(options.minimumEvidenceCoverage ?? 0.6, 'minimumEvidenceCoverage');
  const minimumSpatialDeviation = finiteUnit(options.minimumSpatialDeviation ?? 0.01, 'minimumSpatialDeviation');
  const acceptedValues = options.acceptedEvidenceFingerprints;
  if (acceptedValues !== undefined && (!Array.isArray(acceptedValues) || acceptedValues.length < 1
    || acceptedValues.length > 128 || new Set(acceptedValues).size !== acceptedValues.length
    || acceptedValues.some((value) => !SHA256.test(value)))) {
    throw new Error('acceptedEvidenceFingerprints must contain 1..128 unique SHA-256 values.');
  }
  const acceptedEvidence = acceptedValues ? new Set(acceptedValues) : undefined;
  const provenanceIsTrusted = (provenance: PbrTextureProvenance): boolean => (
    provenance === 'reference' || provenance === 'measured'
  );
  const evidenceIsAccepted = (
    material: PbrMaterialEvidence,
    channel: PbrSpatialChannel,
    provenance: PbrTextureProvenance,
  ): boolean => (
    provenanceIsTrusted(provenance)
    && (!acceptedEvidence || acceptedEvidence.has(evidenceFingerprintFor(material, channel)!))
  );
  const referenceBindingBlockers = acceptedEvidence
    ? reference.flatMap((material) => CHANNELS.filter((channel) => {
      const texture = textureFor(material, channel);
      return (provenanceIsTrusted(factorProvenanceFor(material, channel))
        || Boolean(texture && provenanceIsTrusted(textureProvenanceFor(material, channel, texture))))
        && !acceptedEvidence.has(evidenceFingerprintFor(material, channel)!);
    }).map((channel) => `reference material ${material.id} channel ${channel} is not bound to the accepted evidence set`))
    : [];

  const channels = CHANNELS.map((channel): PbrChannelAudit => {
    const referenceSegmented = segmentedFactorSignal(reference, channel, minimumSpatialDeviation, undefined);
    const referenceTextureCoverage = coverage(reference, (material) => {
      const texture = textureFor(material, channel);
      return hasSpatialSignal(material, channel, minimumSpatialDeviation)
        && Boolean(texture && provenanceIsTrusted(textureProvenanceFor(material, channel, texture)));
    });
    const requiredCoverage = referenceSegmented.evidenceMapped ? 1 : referenceTextureCoverage;
    const segmented = segmentedFactorSignal(candidate, channel, minimumSpatialDeviation, acceptedEvidence);
    const textureSlotCoverage = coverage(candidate, (material) => hasSpatialSignal(material, channel, minimumSpatialDeviation));
    const textureEvidenceCoverage = coverage(candidate, (material) => {
      const texture = textureFor(material, channel);
      return hasSpatialSignal(material, channel, minimumSpatialDeviation)
        && Boolean(texture && evidenceIsAccepted(material, channel, textureProvenanceFor(material, channel, texture)));
    });
    const slotCoverage = segmented.spatial ? 1 : textureSlotCoverage;
    const evidenceMappedCoverage = segmented.evidenceMapped ? 1 : textureEvidenceCoverage;
    const required = requiredCoverage >= 0.05;
    return {
      channel,
      requiredCoverage,
      slotCoverage,
      evidenceMappedCoverage,
      slotPass: !required || slotCoverage >= minimumSlotCoverage,
      evidencePass: !required || evidenceMappedCoverage >= minimumEvidenceCoverage,
    };
  });
  const blockers = [...referenceBindingBlockers, ...channels.flatMap((channel) => {
    if (channel.requiredCoverage < 0.05) return [];
    const failures: string[] = [];
    if (!channel.slotPass) failures.push(`${channel.channel} spatial slot coverage ${channel.slotCoverage.toFixed(3)} < ${minimumSlotCoverage.toFixed(3)}`);
    if (!channel.evidencePass) failures.push(`${channel.channel} evidence-mapped coverage ${channel.evidenceMappedCoverage.toFixed(3)} < ${minimumEvidenceCoverage.toFixed(3)}`);
    return failures;
  })];
  return {
    schema: 'morphloom.pbr-reference-audit/0.2',
    pass: blockers.length === 0,
    channels,
    thresholds: { minimumSlotCoverage, minimumEvidenceCoverage, minimumSpatialDeviation },
    evidenceBinding: {
      enforced: acceptedEvidence !== undefined,
      acceptedFingerprints: acceptedValues ? [...acceptedValues] : [],
    },
    blockers,
    limitation: 'Texture signals are bound to actual embedded encoded payload bytes and prove delivered spatial variation and provenance, not calibrated physical BRDF parameters.',
  };
}
