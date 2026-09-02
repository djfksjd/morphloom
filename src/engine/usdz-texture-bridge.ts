import * as THREE from 'three';

type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularColorMap',
  'specularIntensityMap',
  'thicknessMap',
  'transmissionMap',
  'anisotropyMap',
] as const;

function browserCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') throw new Error('USDZ texture export requires a browser canvas.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function rgba8Canvas(texture: THREE.DataTexture, createCanvas: CanvasFactory): HTMLCanvasElement {
  const image = texture.image as { data?: ArrayBufferView; width?: number; height?: number };
  const width = Number(image?.width);
  const height = Number(image?.height);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error(`USDZ texture ${texture.name || texture.uuid} has invalid dimensions.`);
  }
  if (texture.format !== THREE.RGBAFormat || texture.type !== THREE.UnsignedByteType || !ArrayBuffer.isView(image.data)) {
    throw new Error(`USDZ texture ${texture.name || texture.uuid} must be an RGBA8 DataTexture.`);
  }
  const source = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  if (source.byteLength !== width * height * 4) {
    throw new Error(`USDZ texture ${texture.name || texture.uuid} has an invalid RGBA8 payload length.`);
  }
  const canvas = createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('USDZ texture export could not create a 2D canvas context.');
  const pixels = context.createImageData(width, height);
  pixels.data.set(source);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function bridgeTexture(
  texture: THREE.Texture,
  createCanvas: CanvasFactory,
  cache: Map<THREE.Texture, THREE.Texture>,
): THREE.Texture {
  const cached = cache.get(texture);
  if (cached) return cached;
  if (!(texture instanceof THREE.DataTexture)) {
    cache.set(texture, texture);
    return texture;
  }

  const canvas = rgba8Canvas(texture, createCanvas);
  const bridged = new THREE.CanvasTexture(canvas);
  bridged.copy(texture);
  bridged.image = canvas;
  bridged.userData = { ...texture.userData, morphloomUsdzTextureBridge: 'rgba8-canvas/0.1' };
  bridged.needsUpdate = true;
  cache.set(texture, bridged);
  return bridged;
}

/**
 * Three's USDZExporter accepts DOM-backed images but not DataTexture payloads.
 * The delivery scene is an isolated build, so its material slots can safely be
 * replaced with exact RGBA8 canvas copies without mutating the live viewer.
 */
export function bridgeDataTexturesForUsdz(
  root: THREE.Object3D,
  createCanvas: CanvasFactory = browserCanvas,
): { converted: number; reused: number } {
  const cache = new Map<THREE.Texture, THREE.Texture>();
  let converted = 0;
  let reused = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      const slots = material as unknown as Record<string, unknown>;
      for (const key of MATERIAL_TEXTURE_KEYS) {
        const texture = slots[key];
        if (!(texture instanceof THREE.Texture) || !(texture instanceof THREE.DataTexture)) continue;
        const hadTexture = cache.has(texture);
        slots[key] = bridgeTexture(texture, createCanvas, cache);
        if (hadTexture) reused += 1;
        else converted += 1;
      }
    }
  });
  return { converted, reused };
}
