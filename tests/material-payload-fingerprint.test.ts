import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { compareGlbRoundTrip, snapshotScene } from '../src/engine/delivery-validation';

function fixture(material: THREE.Material): THREE.Group {
  material.name = 'painted_shell';
  const root = new THREE.Group();
  root.name = 'material_payload_fixture';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = 'shell';
  root.add(mesh);
  return root;
}

function physical(overrides: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#777777',
    roughness: 0.45,
    metalness: 0.1,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    ...overrides,
  });
}

function normalMap(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

describe('material scalar and optical delivery payloads', () => {
  it.each([
    ['normal strength', physical({ normalMap: normalMap(), normalScale: new THREE.Vector2(1, 1) }), physical({ normalMap: normalMap(), normalScale: new THREE.Vector2(0.2, 0.2) })],
    ['clearcoat roughness', physical({ clearcoatRoughness: 0.1 }), physical({ clearcoatRoughness: 0.8 })],
    ['opacity', physical({ transparent: true, opacity: 0.9 }), physical({ transparent: true, opacity: 0.25 })],
    ['emission', physical({ emissive: '#110000', emissiveIntensity: 0.5 }), physical({ emissive: '#ff2200', emissiveIntensity: 3 })],
  ])('changes the deterministic scene fingerprint when %s changes', (_label, left, right) => {
    expect(snapshotScene(fixture(left)).fingerprint).not.toBe(snapshotScene(fixture(right)).fingerprint);
  });

  it('blocks a reopened GLB whose material payload changed while geometry stayed identical', () => {
    const source = snapshotScene(fixture(physical()));
    const reopened = structuredClone(source);
    reopened.materialPayloads[0]!.fingerprint = '0000000000000000';
    const audit = compareGlbRoundTrip(source, reopened, 1024, 1);
    expect(audit.materialPayloadParity).toBe(false);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers).toContain('material scalar or optical semantics changed during GLB round-trip');
  });

  it.each([
    ['shader material', new THREE.ShaderMaterial()],
    ['back-side-only material', physical({ side: THREE.BackSide })],
    ['asymmetric normal scale', physical({ normalMap: normalMap(), normalScale: new THREE.Vector2(1, 0.25) })],
  ])('fails closed for a %s that glTF cannot preserve', (_label, material) => {
    const source = snapshotScene(fixture(material));
    expect(source.materialPayloadCoverage).toBe(0);
    const audit = compareGlbRoundTrip(source, structuredClone(source), 1024, 1);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers).toContain('source material contains glTF-incompatible render semantics');
  });

  it('does not deduplicate an unsupported material behind a supported material with the same identity', () => {
    const root = new THREE.Group();
    root.add(fixture(physical({ side: THREE.BackSide })), fixture(physical()));
    const snapshot = snapshotScene(root);
    expect(snapshot.materialPayloads).toHaveLength(2);
    expect(snapshot.materialPayloadCoverage).toBe(0.5);
    expect(snapshot.materialPayloads.some((payload) => !payload.serializable)).toBe(true);
  });

  it('preserves physical optical scalars through an actual binary GLB export and reopen', async () => {
    const material = physical({
      color: '#6f7882',
      roughness: 0.37,
      metalness: 0.22,
      clearcoat: 0.73,
      clearcoatRoughness: 0.18,
      emissive: '#210400',
      emissiveIntensity: 1.7,
      transmission: 0.16,
      thickness: 0.04,
      attenuationDistance: 2.4,
      attenuationColor: '#d8e9ff',
      ior: 1.42,
      specularIntensity: 0.82,
      specularColor: '#f3f7ff',
      iridescence: 0.24,
      iridescenceIOR: 1.34,
      iridescenceThicknessRange: [120, 310],
      sheen: 1,
      sheenRoughness: 0.46,
      sheenColor: '#161b22',
      anisotropy: 0.31,
      anisotropyRotation: 0.27,
    });
    const root = fixture(material);
    class TestFileReader {
      result: ArrayBuffer | string | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob): void {
        void blob.arrayBuffer().then((result) => {
          this.result = result;
          queueMicrotask(() => this.onloadend?.());
        });
      }
    }
    const previousFileReader = globalThis.FileReader;
    Object.assign(globalThis, { FileReader: TestFileReader });
    try {
      const bytes = await new GLTFExporter().parseAsync(root, {
        binary: true, onlyVisible: true, includeCustomExtensions: true,
      });
      if (!(bytes instanceof ArrayBuffer)) throw new Error('Expected binary GLB output.');
      const reopened = await new GLTFLoader().parseAsync(bytes.slice(0), '');
      const sourceSnapshot = snapshotScene(root);
      const reopenedSnapshot = snapshotScene(reopened.scene);
      expect(reopenedSnapshot.materialPayloads).toEqual(sourceSnapshot.materialPayloads);
      expect(compareGlbRoundTrip(sourceSnapshot, reopenedSnapshot, bytes.byteLength, 1)).toMatchObject({
        status: 'pass', materialPayloadParity: true,
      });
    } finally {
      Object.assign(globalThis, { FileReader: previousFileReader });
    }
  });
});
