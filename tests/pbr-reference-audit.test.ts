import { describe, expect, it } from 'vitest';
import {
  auditPbrReferenceEvidence,
  type PbrMaterialEvidence,
  type PbrTextureProvenance,
} from '../src/engine/pbr-reference-audit';

function texture(provenance: PbrTextureProvenance, deviation = 0.12) {
  return {
    width: 512,
    height: 512,
    payloadFingerprint: 'f'.repeat(64),
    encodedBytes: 4096,
    mean: [0.4, 0.42, 0.44, 1] as [number, number, number, number],
    standardDeviation: [deviation, deviation, deviation, 0] as [number, number, number, number],
    range: [0.6, 0.6, 0.6, 0] as [number, number, number, number],
    provenance,
  };
}

function material(provenance: PbrTextureProvenance): PbrMaterialEvidence {
  return {
    id: 'surface', weight: 1,
    baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.8, roughnessFactor: 0.5,
    normalScale: 1, emissiveFactor: [0, 0, 0],
    factorProvenance: provenance,
    evidenceFingerprint: provenance === 'reference' || provenance === 'measured' ? 'a'.repeat(64) : undefined,
    baseColorTexture: texture(provenance),
    metallicRoughnessTexture: texture(provenance),
    normalTexture: texture(provenance),
  };
}

describe('PBR reference evidence audit', () => {
  it('accepts spatial channels that retain trusted reference provenance', () => {
    const audit = auditPbrReferenceEvidence([material('reference')], [material('reference')]);
    expect(audit.pass).toBe(true);
    expect(audit.blockers).toEqual([]);
  });

  it('does not mistake procedural noise for reference-matched appearance', () => {
    const audit = auditPbrReferenceEvidence([material('reference')], [material('procedural')]);
    expect(audit.pass).toBe(false);
    expect(audit.channels.find((channel) => channel.channel === 'baseColor')).toMatchObject({
      slotPass: true, evidencePass: false,
    });
    expect(audit.blockers).toContainEqual(expect.stringMatching(/baseColor evidence-mapped coverage/));
  });

  it('requires trusted provenance to bind to the locked evidence set', () => {
    const candidate = material('reference');
    candidate.evidenceFingerprint = 'b'.repeat(64);
    const audit = auditPbrReferenceEvidence([material('reference')], [candidate], {
      acceptedEvidenceFingerprints: ['a'.repeat(64)],
    });
    expect(audit.pass).toBe(false);
    expect(audit.evidenceBinding).toEqual({ enforced: true, acceptedFingerprints: ['a'.repeat(64)] });
    expect(audit.blockers).toContainEqual(expect.stringMatching(/baseColor evidence-mapped coverage/));

    const missing = material('reference');
    delete missing.evidenceFingerprint;
    expect(() => auditPbrReferenceEvidence([material('reference')], [missing])).toThrow(/evidenceFingerprint/);
  });

  it('does not erase PBR requirements when the reference hash is outside the locked set', () => {
    const audit = auditPbrReferenceEvidence([material('reference')], [material('reference')], {
      acceptedEvidenceFingerprints: ['b'.repeat(64)],
    });
    expect(audit.pass).toBe(false);
    expect(audit.channels.find((channel) => channel.channel === 'baseColor')?.requiredCoverage).toBe(1);
    expect(audit.blockers).toContain('reference material surface channel baseColor is not bound to the accepted evidence set');
  });

  it('catches a constant candidate where the reference contains spatial PBR detail', () => {
    const candidate = material('reference');
    delete candidate.baseColorTexture;
    delete candidate.normalTexture;
    const audit = auditPbrReferenceEvidence([material('reference')], [candidate]);
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toEqual(expect.arrayContaining([
      expect.stringMatching(/baseColor spatial slot coverage/),
      expect.stringMatching(/normal spatial slot coverage/),
    ]));
  });

  it('ignores an inactive emissive texture rather than inventing light output', () => {
    const reference = material('reference');
    reference.emissiveTexture = texture('reference');
    reference.emissiveFactor = [0, 0, 0];
    const audit = auditPbrReferenceEvidence([reference], [material('reference')]);
    expect(audit.channels.find((channel) => channel.channel === 'emissive')?.requiredCoverage).toBe(0);
    expect(audit.pass).toBe(true);
  });

  it('accepts measured material segmentation as a spatial metallic response', () => {
    const reference = material('reference');
    const metal = material('measured');
    const rubber = material('measured');
    rubber.id = 'rubber';
    rubber.metallicFactor = 0;
    delete metal.metallicRoughnessTexture;
    delete rubber.metallicRoughnessTexture;
    const audit = auditPbrReferenceEvidence([reference], [metal, rubber]);
    expect(audit.channels.find((channel) => channel.channel === 'metallic')).toMatchObject({
      slotPass: true, evidencePass: true,
    });
  });

  it('does not let a photographed base color prove inferred roughness or metallic factors', () => {
    const referenceMetal = material('measured');
    const referenceRubber = material('measured');
    referenceMetal.id = 'reference-metal';
    referenceRubber.id = 'reference-rubber';
    referenceRubber.baseColorFactor = [0.1, 0.1, 0.1, 1];
    referenceRubber.metallicFactor = 0;
    referenceRubber.roughnessFactor = 0.9;
    const candidateMetal = material('procedural');
    const candidateRubber = material('procedural');
    candidateMetal.id = 'candidate-metal';
    candidateRubber.id = 'candidate-rubber';
    candidateRubber.baseColorFactor = [0.1, 0.1, 0.1, 1];
    candidateRubber.metallicFactor = 0;
    candidateRubber.roughnessFactor = 0.9;
    for (const candidate of [candidateMetal, candidateRubber]) {
      candidate.factorProvenanceByChannel = { baseColor: 'reference' };
      candidate.evidenceFingerprintByChannel = { baseColor: 'a'.repeat(64) };
    }
    const audit = auditPbrReferenceEvidence([referenceMetal, referenceRubber], [candidateMetal, candidateRubber], {
      acceptedEvidenceFingerprints: ['a'.repeat(64)],
    });
    expect(audit.channels.find((channel) => channel.channel === 'baseColor')?.evidencePass).toBe(true);
    expect(audit.channels.find((channel) => channel.channel === 'metallic')?.evidencePass).toBe(false);
    expect(audit.channels.find((channel) => channel.channel === 'roughness')?.evidencePass).toBe(false);
    expect(audit.pass).toBe(false);
  });

  it('separates roughness from metallic provenance in a shared glTF packed texture', () => {
    const candidate = material('procedural');
    candidate.factorProvenanceByChannel = { baseColor: 'reference', roughness: 'reference', normal: 'reference' };
    candidate.textureProvenanceByChannel = {
      baseColor: 'reference', roughness: 'reference', normal: 'reference', metallic: 'procedural',
    };
    candidate.evidenceFingerprintByChannel = {
      baseColor: 'a'.repeat(64), roughness: 'a'.repeat(64), normal: 'a'.repeat(64),
    };
    const audit = auditPbrReferenceEvidence([material('reference')], [candidate], {
      acceptedEvidenceFingerprints: ['a'.repeat(64)],
    });
    expect(audit.channels.find((channel) => channel.channel === 'roughness')?.evidencePass).toBe(true);
    expect(audit.channels.find((channel) => channel.channel === 'metallic')?.evidencePass).toBe(false);
  });

  it('requires candidate segmentation when trusted reference factors vary spatially', () => {
    const referenceMetal = material('measured');
    const referenceRubber = material('measured');
    referenceMetal.id = 'reference-metal';
    referenceRubber.id = 'reference-rubber';
    referenceRubber.metallicFactor = 0;
    delete referenceMetal.metallicRoughnessTexture;
    delete referenceRubber.metallicRoughnessTexture;
    const candidate = material('measured');
    delete candidate.metallicRoughnessTexture;

    const audit = auditPbrReferenceEvidence([referenceMetal, referenceRubber], [candidate]);
    expect(audit.channels.find((channel) => channel.channel === 'metallic')).toMatchObject({
      requiredCoverage: 1, slotPass: false, evidencePass: false,
    });
  });

  it('fails closed on unsafe weights, dimensions and non-finite values', () => {
    const invalidWeight = material('reference');
    invalidWeight.weight = 0;
    expect(() => auditPbrReferenceEvidence([invalidWeight], [material('reference')])).toThrow(/weight/);
    const overflowingA = material('reference');
    const overflowingB = material('reference');
    overflowingA.id = 'overflow-a';
    overflowingB.id = 'overflow-b';
    overflowingA.weight = 1e308;
    overflowingB.weight = 1e308;
    expect(() => auditPbrReferenceEvidence([overflowingA, overflowingB], [material('reference')])).toThrow(/weight total/);
    const invalidTexture = material('reference');
    invalidTexture.normalTexture!.width = 9_000;
    expect(() => auditPbrReferenceEvidence([material('reference')], [invalidTexture])).toThrow(/texture budget/);
    const missingPayload = material('reference');
    missingPayload.normalTexture!.payloadFingerprint = 'procedural://normal' as never;
    expect(() => auditPbrReferenceEvidence([material('reference')], [missingPayload])).toThrow(/payloadFingerprint/);
    const emptyPayload = material('reference');
    emptyPayload.normalTexture!.encodedBytes = 0;
    expect(() => auditPbrReferenceEvidence([material('reference')], [emptyPayload])).toThrow(/actual encoded payload/);
    const excessivePixels = material('reference');
    excessivePixels.normalTexture!.width = 5_000;
    excessivePixels.normalTexture!.height = 4_000;
    expect(() => auditPbrReferenceEvidence([material('reference')], [excessivePixels])).toThrow(/texture budget/);
    const invalidFactor = material('reference');
    invalidFactor.roughnessFactor = Number.NaN;
    expect(() => auditPbrReferenceEvidence([material('reference')], [invalidFactor])).toThrow(/0\.\.1/);
    const duplicate = material('reference');
    expect(() => auditPbrReferenceEvidence([duplicate, { ...duplicate }], [material('reference')])).toThrow(/duplicate material id/);
  });
});
