import { Canvas, createCanvas, ImageData, loadImage } from '@napi-rs/canvas';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { compareGlbRoundTrip, snapshotScene } from '../src/engine/delivery-validation';
import { auditDomainReadiness } from '../src/engine/domain-readiness';
import { createPortableGltfExportInput, preparePortableGltfGeometry } from '../src/engine/gltf-export-preparation';

function texturedScene(texture: THREE.Texture): THREE.Group {
  texture.name = 'surface_payload';
  const root = new THREE.Group();
  root.name = 'texture_fingerprint_fixture';
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.08 });
  material.name = 'measured_surface';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = 'textured_part';
  root.add(mesh);
  return root;
}

function materialScene(material: THREE.Material): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pbr_texture_roundtrip_fixture';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = 'painted_shell_mesh';
  root.add(mesh);
  return root;
}

function dataTexture(red: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([
    red, 40, 80, 255,
    20, 60, 100, 255,
    30, 70, 110, 255,
    40, 80, 120, 255,
  ]), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

describe('scene texture-content fingerprint', () => {
  it('changes when one DataTexture pixel changes at the same dimensions', () => {
    const first = snapshotScene(texturedScene(dataTexture(10)));
    const repeated = snapshotScene(texturedScene(dataTexture(10)));
    const changed = snapshotScene(texturedScene(dataTexture(11)));
    expect(repeated.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('changes when CanvasTexture pixels change without changing material values', () => {
    const canvas = createCanvas(2, 2);
    const context = canvas.getContext('2d');
    context.fillStyle = '#204060';
    context.fillRect(0, 0, 2, 2);
    const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
    const root = texturedScene(texture);
    const first = snapshotScene(root);
    context.fillStyle = '#214060';
    context.fillRect(0, 0, 1, 1);
    texture.needsUpdate = true;
    expect(snapshotScene(root).fingerprint).not.toBe(first.fingerprint);
  });

  it('changes when texture sampling transforms change', () => {
    const baseline = dataTexture(10);
    const transformed = dataTexture(10);
    transformed.repeat.set(2, 1);
    transformed.rotation = 0.25;
    expect(snapshotScene(texturedScene(transformed)).fingerprint)
      .not.toBe(snapshotScene(texturedScene(baseline)).fingerprint);
  });

  it('normalizes the row flip that glTF bakes into image pixels', () => {
    const source = dataTexture(10);
    source.flipY = true;
    const image = source.image as { data: Uint8Array; width: number; height: number };
    const rowBytes = image.width * 4;
    const baked = new Uint8Array(image.data.length);
    baked.set(image.data.subarray(rowBytes), 0);
    baked.set(image.data.subarray(0, rowBytes), rowBytes);
    const reopened = new THREE.DataTexture(baked, image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    reopened.name = source.name;
    reopened.colorSpace = source.colorSpace;
    reopened.flipY = false;
    expect(snapshotScene(texturedScene(reopened)).fingerprint)
      .toBe(snapshotScene(texturedScene(source)).fingerprint);
    expect(snapshotScene(texturedScene(dataTexture(10))).fingerprint)
      .not.toBe(snapshotScene(texturedScene(source)).fingerprint);
  });

  it('blocks a GLB receipt when a texture payload changes behind equal geometry', () => {
    const source = snapshotScene(texturedScene(dataTexture(10)));
    const reopened = structuredClone(source);
    reopened.texturePayloads[0]!.contentFingerprint = 'f'.repeat(16);
    const audit = compareGlbRoundTrip(source, reopened, 4_096, 2);
    expect(audit.texturePayloadParity).toBe(false);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers).toContain('texture content or sampling semantics changed during GLB round-trip');
  });

  it('fails closed when texture pixels cannot be inspected', () => {
    const texture = new THREE.Texture({ width: 2, height: 2 } as TexImageSource);
    const source = snapshotScene(texturedScene(texture));
    expect(source.texturePayloadCoverage).toBe(0);
    const audit = compareGlbRoundTrip(source, structuredClone(source), 4_096, 2);
    expect(audit.status).toBe('blocked');
    expect(audit.blockers).toContain('source texture payload is not fully inspectable or glTF-serializable');
  });

  it('blocks model readiness when an authored texture is not inspectable', () => {
    const texture = new THREE.Texture({ width: 2, height: 2 } as TexImageSource);
    const report = auditDomainReadiness({
      domain: 'industrial-design', root: texturedScene(texture), evidenceScore: 90,
      deterministic: true, browserGlbRoundTrip: true,
    });
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'texture-payload', pass: false, blocking: true }));
    expect(report.blockers.join(' ')).toMatch(/texture-payload/);
  });

  it('blocks model readiness when sampler semantics cannot survive glTF', () => {
    const texture = dataTexture(10);
    texture.anisotropy = 8;
    const report = auditDomainReadiness({
      domain: 'industrial-design', root: texturedScene(texture), evidenceScore: 90,
      deterministic: true, browserGlbRoundTrip: true,
    });
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'texture-payload', pass: false, blocking: true }));
    expect(snapshotScene(texturedScene(texture)).texturePayloads[0]?.unsupportedSemantics).toContain(
      'texture anisotropy is not serialized by the glTF exporter',
    );
  });

  it('does not deduplicate an unsupported sampler behind a supported texture with the same identity', () => {
    const unsupported = dataTexture(10);
    unsupported.anisotropy = 8;
    const root = new THREE.Group();
    root.add(texturedScene(unsupported), texturedScene(dataTexture(10)));
    const snapshot = snapshotScene(root);
    expect(snapshot.texturePayloads).toHaveLength(2);
    expect(snapshot.texturePayloadCoverage).toBe(0.5);
    expect(snapshot.texturePayloads.some((payload) => !payload.samplerSerializable)).toBe(true);
  });

  it('preserves lossless PBR texture pixels, slots and sampling through an actual binary GLB', async () => {
    const albedo = dataTexture(17);
    albedo.name = 'paint_albedo';
    albedo.repeat.set(2, 3);
    albedo.offset.set(0.125, 0.25);
    albedo.rotation = 0.2;
    albedo.updateMatrix();
    const normal = dataTexture(128);
    normal.name = 'paint_normal';
    normal.colorSpace = THREE.NoColorSpace;
    const packedMetalRough = dataTexture(0);
    packedMetalRough.name = 'paint_metal_rough';
    packedMetalRough.colorSpace = THREE.NoColorSpace;
    const material = new THREE.MeshPhysicalMaterial({
      color: '#8a929a', map: albedo, normalMap: normal,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughness: 0.61, roughnessMap: packedMetalRough,
      metalness: 0.23, metalnessMap: packedMetalRough,
      clearcoat: 0.38, clearcoatRoughness: 0.27,
    });
    material.name = 'painted_shell';
    const root = materialScene(material);
    preparePortableGltfGeometry(root);

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
    const globals = {
      document: globalThis.document,
      FileReader: globalThis.FileReader,
      ImageData: globalThis.ImageData,
      HTMLCanvasElement: globalThis.HTMLCanvasElement,
      createImageBitmap: globalThis.createImageBitmap,
      self: globalThis.self,
    };
    Object.assign(globalThis, {
      document: { createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element request: ${tag}`);
        return createCanvas(1, 1);
      } },
      FileReader: TestFileReader,
      ImageData,
      HTMLCanvasElement: Canvas,
      createImageBitmap: async (blob: Blob) => {
        const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
        Object.assign(image, { close: () => undefined });
        return image;
      },
      self: globalThis,
    });
    try {
      const result = await new GLTFExporter().parseAsync(createPortableGltfExportInput(root), {
        binary: true, onlyVisible: true, includeCustomExtensions: true,
      });
      if (!(result instanceof ArrayBuffer)) throw new Error('Expected binary GLB output.');
      const reopened = await new GLTFLoader().parseAsync(result.slice(0), '');
      const sourceSnapshot = snapshotScene(root);
      const reopenedSnapshot = snapshotScene(reopened.scene);
      expect(reopenedSnapshot.texturePayloads).toEqual(sourceSnapshot.texturePayloads);
      expect(compareGlbRoundTrip(sourceSnapshot, reopenedSnapshot, result.byteLength, 1)).toMatchObject({
        status: 'pass', texturePayloadParity: true, materialPayloadParity: true,
      });
    } finally {
      Object.assign(globalThis, globals);
    }
  });
});
