import { createCanvas } from '@napi-rs/canvas';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compareGlbRoundTrip, snapshotScene } from '../src/engine/delivery-validation';
import { auditDomainReadiness } from '../src/engine/domain-readiness';

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
    expect(audit.blockers).toContain('source texture pixels are not fully inspectable');
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
});
