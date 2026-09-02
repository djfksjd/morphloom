import { Canvas, createCanvas } from '@napi-rs/canvas';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bridgeDataTexturesForUsdz } from '../src/engine/usdz-texture-bridge';

function canvasFactory(width: number, height: number): HTMLCanvasElement {
  return createCanvas(width, height) as unknown as HTMLCanvasElement;
}

describe('USDZ DataTexture bridge', () => {
  it('converts shared RGBA8 data maps to one DOM-backed canvas texture', () => {
    const texture = new THREE.DataTexture(new Uint8Array([
      12, 34, 56, 255,
      78, 90, 123, 255,
    ]), 2, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = 'deterministic-surface-map';
    texture.flipY = false;
    texture.repeat.set(3, 4);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));

    const result = bridgeDataTexturesForUsdz(root, canvasFactory);

    expect(result).toEqual({ converted: 1, reused: 1 });
    expect(material.map).toBe(material.roughnessMap);
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(material.map?.flipY).toBe(false);
    expect(material.map?.repeat.toArray()).toEqual([3, 4]);
    expect(material.map?.userData.morphloomUsdzTextureBridge).toBe('rgba8-canvas/0.1');
    const canvas = material.map?.image as unknown as Canvas;
    expect(Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 1).data)).toEqual([
      12, 34, 56, 255,
      78, 90, 123, 255,
    ]);
  });

  it('rejects non-RGBA8 payloads instead of silently dropping texture detail', () => {
    const texture = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: texture }));
    expect(() => bridgeDataTexturesForUsdz(root, canvasFactory)).toThrow(/must be an RGBA8 DataTexture/);
  });
});
