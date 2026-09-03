import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyReferenceMaterialEvidence,
  bindReferenceMaterialFactorEvidence,
  referenceMaterialProvenanceFromExtras,
} from '../src/engine/reference-material-evidence';
import { deriveMaskedReferenceSurface } from '../src/engine/reference-surface';

function fixture() {
  const size = 24;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const mask = new Uint8Array(size * size).fill(1);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const offset = (y * size + x) * 4;
    const value = (x * 31 + y * 47 + x * y * 3) % 210 + 20;
    rgba.set([value, value, value, 255], offset);
  }
  return deriveMaskedReferenceSurface([{
    id: 'photo-front', fingerprint: 'd'.repeat(64), width: size, height: size, rgba, mask,
  }], { textureSize: 32, strength: 1.1 });
}

describe('reference material evidence', () => {
  it('adds source-bound colour, normal and roughness maps while leaving metallic unverified', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({ color: '#6b737c', roughness: 0.42, metalness: 0.7 });
    material.name = 'fan-steel';
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    const receipt = applyReferenceMaterialEvidence(root, fixture(), { repeat: 2 });
    expect(receipt).toMatchObject({
      evidenceFingerprint: 'd'.repeat(64),
      status: 'applied',
      albedoMode: 'neutral-modulation',
      appliedMaterials: ['fan-steel'],
      channels: { baseColor: 'reference', normal: 'reference', roughness: 'reference', metallic: 'unverified' },
    });
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    expect(material.normalMap).toBeInstanceOf(THREE.DataTexture);
    expect(material.roughnessMap).toBe(material.metalnessMap);
    expect(material.color.getHexString()).toBe('6b737c');
    expect(material.metalness).toBe(0.7);
    expect(material.userData.morphloomSurface.referenceMaterialEvidence).toMatchObject({ metallic: 'unverified' });
  });

  it('preserves admitted full-frame material colour without changing authored material factors', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({ color: '#808080' });
    material.name = 'asphalt';
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
    const derivation = fixture();
    const receipt = applyReferenceMaterialEvidence(root, derivation, { repeat: 1, albedoMode: 'source-colour' });
    const texture = material.map as THREE.DataTexture;
    const textureBytes = texture.image.data as Uint8Array;
    expect(receipt.albedoMode).toBe('source-colour');
    expect(Array.from(textureBytes)).toEqual(Array.from(derivation.sourceAlbedoRgba));
    expect(Array.from(textureBytes)).not.toEqual(Array.from(derivation.albedoRgba));
    expect(material.color.getHexString()).toBe('808080');
    expect(material.userData.morphloomSurface.referenceMaterialEvidence).toMatchObject({
      albedoMode: 'source-colour',
      baseColor: 'reference',
    });
  });

  it('rejects structurally sparse photographs instead of tiling object outlines onto every part', () => {
    const derivation = fixture();
    derivation.materialSuitability = {
      pass: false, foregroundFillRatio: 0.2, interiorFillRatio: 0.1, seededTexelRatio: 0.2,
      blockers: ['foreground fill 0.200 is too sparse for a stationary material patch'],
    };
    const root = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    const receipt = applyReferenceMaterialEvidence(root, derivation);
    expect(receipt.status).toBe('rejected');
    expect(receipt.appliedMaterials).toEqual([]);
    expect(receipt.channels).toMatchObject({ baseColor: 'not-applied', normal: 'not-applied', roughness: 'not-applied' });
    expect(material.map).toBeNull();
  });

  it('does not claim evidence on geometry without UVs', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    root.add(new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial()));
    const receipt = applyReferenceMaterialEvidence(root, fixture());
    expect(receipt.appliedMaterials).toEqual([]);
    expect(receipt.skippedMeshesWithoutUv).toHaveLength(1);
  });

  it('rejects unsafe texture repeat settings', () => {
    expect(() => applyReferenceMaterialEvidence(new THREE.Group(), fixture(), { repeat: 0 })).toThrow(/repeat/);
  });

  it('binds source-derived factors without changing authored PBR values', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({ color: '#25313b', metalness: 0.74, roughness: 0.39 });
    material.name = 'coated-metal';
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    const before = { color: material.color.getHexString(), metalness: material.metalness, roughness: material.roughness };
    const receipt = bindReferenceMaterialFactorEvidence(root, {
      sourceId: 'photo-front', evidenceFingerprint: 'a'.repeat(64),
      channels: ['baseColor', 'metallic', 'roughness'],
    });
    expect(receipt).toMatchObject({ status: 'applied', calibration: 'appearance-estimated' });
    expect({ color: material.color.getHexString(), metalness: material.metalness, roughness: material.roughness }).toEqual(before);
    expect(referenceMaterialProvenanceFromExtras(material.userData)).toMatchObject({
      provenance: 'procedural',
      factorProvenanceByChannel: { baseColor: 'reference', metallic: 'reference', roughness: 'reference' },
      evidenceFingerprintByChannel: {
        baseColor: 'a'.repeat(64), metallic: 'a'.repeat(64), roughness: 'a'.repeat(64),
      },
    });
  });

  it('ignores malformed or uncalibrated extras instead of granting trusted provenance', () => {
    expect(referenceMaterialProvenanceFromExtras({ morphloomSurface: {
      referenceFactorEvidence: {
        schema: 'morphloom.reference-material-factor-evidence/0.1',
        calibration: 'measured',
        factorProvenanceByChannel: { baseColor: 'reference' },
        evidenceFingerprintByChannel: { baseColor: 'a'.repeat(64) },
      },
    } })).toEqual({ provenance: 'procedural' });
    expect(() => bindReferenceMaterialFactorEvidence(new THREE.Group(), {
      sourceId: '../escape', evidenceFingerprint: 'a'.repeat(64), channels: ['baseColor'],
    })).toThrow(/invalid|unsafe/);
  });
});
