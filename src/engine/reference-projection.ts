import * as THREE from 'three';
import type { CharacterBuild } from './character';

const MAX_REFERENCE_EDGE = 1024;

interface LoadedPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function loadPixels(url: string, signal?: AbortSignal): Promise<LoadedPixels> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Reference projection was cancelled.', 'AbortError'));
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('Reference projection was cancelled.', 'AbortError'));
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('The local reference image could not be decoded.'));
    };
    image.onload = () => {
      cleanup();
      const sourceWidth = image.naturalWidth;
      const sourceHeight = image.naturalHeight;
      if (sourceWidth < 16 || sourceHeight < 16) {
        reject(new Error('The local reference image is too small for surface projection.'));
        return;
      }
      const scale = Math.min(1, MAX_REFERENCE_EDGE / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!context) {
        reject(new Error('The browser could not allocate a reference projection canvas.'));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      resolve({ data: pixels.data, width, height });
    };
    signal?.addEventListener('abort', abort, { once: true });
    image.src = url;
  });
}

interface SuitSample {
  family: 'red' | 'blue';
  luminance: number;
}

function sampleSuitPixel(pixels: LoadedPixels, u: number, v: number): SuitSample | undefined {
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) return undefined;
  const x = Math.round(u * (pixels.width - 1));
  const y = Math.round(v * (pixels.height - 1));
  const offset = (y * pixels.width + x) * 4;
  const red = pixels.data[offset];
  const green = pixels.data[offset + 1];
  const blue = pixels.data[offset + 2];
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  if (luminance < 7 || luminance > 212) return undefined;
  if (red > green * 1.18 && red > blue * 1.05) return { family: 'red', luminance };
  if (blue > red * 1.08 && blue > green * 1.02) return { family: 'blue', luminance };
  return undefined;
}

/**
 * Projects the supplied front-three-quarter photograph onto the existing
 * editable body as vertex colour. It is a same-view surface observation, not
 * replacement geometry; rear-facing vertices keep their authored inferred
 * material instead of copying unseen pixels to the back.
 */
export async function applyReferenceColorProjection(
  build: CharacterBuild,
  referenceUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!referenceUrl) return;
  const pixels = await loadPixels(referenceUrl, signal);
  if (signal?.aborted) return;
  const geometry = build.body.geometry;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors = geometry.getAttribute('color');
  if (!positions || !normals || !colors || positions.count !== colors.count || normals.count !== colors.count) {
    throw new Error('Reference projection requires aligned position, normal, and colour attributes.');
  }

  const height = Math.max(0.001, build.metrics.heightMeters);
  const sampled = new THREE.Color();
  const redSuit = new THREE.Color('#8a1734');
  const blueSuit = new THREE.Color('#073b70');
  let projectedVertices = 0;
  for (let index = 0; index < positions.count; index += 1) {
    if (normals.getZ(index) < -0.08) continue;
    const x = positions.getX(index);
    const y = positions.getY(index);
    const u = 0.49 + (x / height) * 0.9;
    const v = 1 - (y / height) * 0.78;
    const sample = sampleSuitPixel(pixels, u, v);
    if (!sample) continue;
    sampled.copy(sample.family === 'red' ? redSuit : blueSuit);
    sampled.multiplyScalar(THREE.MathUtils.clamp(0.64 + sample.luminance / 310, 0.66, 1.16));
    colors.setXYZ(
      index,
      THREE.MathUtils.lerp(colors.getX(index), sampled.r, 0.88),
      THREE.MathUtils.lerp(colors.getY(index), sampled.g, 0.88),
      THREE.MathUtils.lerp(colors.getZ(index), sampled.b, 0.88),
    );
    projectedVertices += 1;
  }
  colors.needsUpdate = true;
  build.root.userData.characterIR.referenceProjection = {
    kind: 'front-three-quarter-vertex-colour',
    projectedVertices,
    totalVertices: positions.count,
    sourceSize: [pixels.width, pixels.height],
    mapping: { uCenter: 0.49, uScalePerHeight: 0.9, vScalePerHeight: 0.78 },
    rearSurface: 'inferred-authored-material',
  };
}
