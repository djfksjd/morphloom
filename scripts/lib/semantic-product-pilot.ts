import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Material, Texture } from '@gltf-transform/core';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { canonicalizeGlbBufferViews } from '../../src/engine/glb-canonicalization';
import { createPortableGltfExportInput, preparePortableGltfGeometry } from '../../src/engine/gltf-export-preparation';
import type {
  PbrMaterialEvidence,
  PbrSpatialChannel,
  PbrTextureProvenance,
  PbrTextureSignal,
} from '../../src/engine/pbr-reference-audit';
import type { ComparisonFrame } from '../../src/engine/reference-comparison';
import type { SurfaceTriangle3 } from '../../src/engine/surface-geometry-fidelity';

const MAX_ENCODED_TEXTURE_BYTES = 32 * 1024 * 1024;
const MAX_TEXTURE_DIMENSION = 8_192;
const MAX_TEXTURE_PIXELS = 16_777_216;

export function silhouetteFrame(
  root: THREE.Object3D,
  azimuthDegrees: number,
  width = 512,
  height = 512,
  camera: SilhouetteCamera = {},
): ComparisonFrame & { png: Uint8Array } {
  return silhouetteFrameFromTriangles(collectThreeTriangles(root), azimuthDegrees, width, height, camera);
}

export interface SilhouetteCamera {
  projection?: 'orthographic' | 'perspective';
  elevationDegrees?: number;
  /** Camera distance divided by the object's largest half-extent. */
  distanceMultiplier?: number;
}

export function silhouetteFrameFromTriangles(
  surfaceTriangles: SurfaceTriangle3[],
  azimuthDegrees: number,
  width = 512,
  height = 512,
  camera: SilhouetteCamera = {},
): ComparisonFrame & { png: Uint8Array } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16
    || width * height > MAX_TEXTURE_PIXELS || surfaceTriangles.length < 1 || surfaceTriangles.length > 500_000) {
    throw new Error('Semantic product silhouette request is outside safe bounds.');
  }
  const projection = camera.projection ?? 'orthographic';
  const elevationDegrees = camera.elevationDegrees ?? 0;
  const distanceMultiplier = camera.distanceMultiplier ?? 4;
  if (!['orthographic', 'perspective'].includes(projection)
    || !Number.isFinite(elevationDegrees) || Math.abs(elevationDegrees) > 60
    || !Number.isFinite(distanceMultiplier) || distanceMultiplier < 1.25 || distanceMultiplier > 100) {
    throw new Error('Semantic product silhouette camera is outside safe bounds.');
  }
  let sourceMinX = Number.POSITIVE_INFINITY;
  let sourceMaxX = Number.NEGATIVE_INFINITY;
  let sourceMinY = Number.POSITIVE_INFINITY;
  let sourceMaxY = Number.NEGATIVE_INFINITY;
  let sourceMinZ = Number.POSITIVE_INFINITY;
  let sourceMaxZ = Number.NEGATIVE_INFINITY;
  for (const source of surfaceTriangles) for (const position of [source.a, source.b, source.c]) {
    sourceMinX = Math.min(sourceMinX, position[0]); sourceMaxX = Math.max(sourceMaxX, position[0]);
    sourceMinY = Math.min(sourceMinY, position[1]); sourceMaxY = Math.max(sourceMaxY, position[1]);
    sourceMinZ = Math.min(sourceMinZ, position[2]); sourceMaxZ = Math.max(sourceMaxZ, position[2]);
  }
  const center: [number, number, number] = [
    (sourceMinX + sourceMaxX) * 0.5, (sourceMinY + sourceMaxY) * 0.5, (sourceMinZ + sourceMaxZ) * 0.5,
  ];
  const halfExtent = Math.max(sourceMaxX - sourceMinX, sourceMaxY - sourceMinY, sourceMaxZ - sourceMinZ) * 0.5;
  const triangles: Array<Array<[number, number]>> = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const angle = azimuthDegrees * Math.PI / 180;
  const elevation = elevationDegrees * Math.PI / 180;
  const right: [number, number, number] = [Math.cos(angle), 0, -Math.sin(angle)];
  const view: [number, number, number] = [
    Math.sin(angle) * Math.cos(elevation), Math.sin(elevation), Math.cos(angle) * Math.cos(elevation),
  ];
  const up: [number, number, number] = [
    -Math.sin(elevation) * Math.sin(angle), Math.cos(elevation), -Math.sin(elevation) * Math.cos(angle),
  ];
  const cameraDistance = halfExtent * distanceMultiplier;
  const project = (position: [number, number, number]): [number, number] => {
    const relative: [number, number, number] = [
      position[0] - center[0], position[1] - center[1], position[2] - center[2],
    ];
    const horizontal = relative[0] * right[0] + relative[1] * right[1] + relative[2] * right[2];
    const vertical = relative[0] * up[0] + relative[1] * up[1] + relative[2] * up[2];
    if (projection === 'orthographic') return [horizontal, vertical];
    const towardCamera = relative[0] * view[0] + relative[1] * view[1] + relative[2] * view[2];
    const depth = cameraDistance - towardCamera;
    if (depth <= halfExtent * 0.05) throw new Error('Semantic product geometry crosses the silhouette camera plane.');
    const perspectiveScale = cameraDistance / depth;
    return [horizontal * perspectiveScale, vertical * perspectiveScale];
  };
  for (const source of surfaceTriangles) {
    const triangle: Array<[number, number]> = [];
    for (const position of [source.a, source.b, source.c]) {
        const point = project(position);
        minX = Math.min(minX, point[0]);
        maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]);
        maxY = Math.max(maxY, point[1]);
        triangle.push(point);
    }
    triangles.push(triangle);
  }
  if (triangles.length === 0) throw new Error('Semantic product projected geometry is empty.');
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    throw new Error('Semantic product projected bounds are unsafe.');
  }
  const padding = 12;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#000000';
  for (const triangle of triangles) {
    context.beginPath();
    triangle.forEach((point, index) => {
      const x = offsetX + (point[0] - minX) * scale;
      const y = height - (offsetY + (point[1] - minY) * scale);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
  }
  const rgba = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = Number(rgba[pixel * 4]! < 128);
  return { width, height, rgba, mask, png: new Uint8Array(canvas.encodeSync('png')) };
}

export function collectThreeTriangles(root: THREE.Object3D): SurfaceTriangle3[] {
  root.updateMatrixWorld(true);
  const triangles: SurfaceTriangle3[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
    const position = object.geometry.getAttribute('position');
    const indices = object.geometry.index;
    const count = indices ? indices.count : position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const vertices = [0, 1, 2].map((corner) => {
        const index = indices ? indices.getX(offset + corner) : offset + corner;
        const point = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        return point.toArray() as [number, number, number];
      });
      triangles.push({ a: vertices[0]!, b: vertices[1]!, c: vertices[2]! });
    }
  });
  return triangles;
}

export function collectGltfTriangles(document: import('@gltf-transform/core').Document): SurfaceTriangle3[] {
  const triangles: SurfaceTriangle3[] = [];
  for (const scene of document.getRoot().listScenes()) scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = node.getWorldMatrix();
    const transform = (array: ArrayLike<number>, index: number): [number, number, number] => {
      const x = array[index * 3]!;
      const y = array[index * 3 + 1]!;
      const z = array[index * 3 + 2]!;
      return [
        matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
      ];
    };
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const positions = position.getArray();
      const indices = primitive.getIndices()?.getArray();
      const count = indices?.length ?? position.getCount();
      for (let offset = 0; offset + 2 < count; offset += 3) {
        const index = (corner: number) => Number(indices?.[offset + corner] ?? offset + corner);
        triangles.push({
          a: transform(positions, index(0)),
          b: transform(positions, index(1)),
          c: transform(positions, index(2)),
        });
      }
    }
  });
  return triangles;
}

function triangleArea(a: [number, number, number], b: [number, number, number], c: [number, number, number]): number {
  const ab = new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
  const ac = new THREE.Vector3().fromArray(c).sub(new THREE.Vector3().fromArray(a));
  return ab.cross(ac).length() * 0.5;
}

function materialSurfaceAreas(document: import('@gltf-transform/core').Document): Map<Material, number> {
  const areas = new Map<Material, number>();
  for (const scene of document.getRoot().listScenes()) scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = node.getWorldMatrix();
    const transform = (array: ArrayLike<number>, index: number): [number, number, number] => {
      const x = array[index * 3]!;
      const y = array[index * 3 + 1]!;
      const z = array[index * 3 + 2]!;
      return [
        matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
      ];
    };
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      const position = primitive.getAttribute('POSITION');
      if (!material || !position) continue;
      const positions = position.getArray();
      const indices = primitive.getIndices()?.getArray();
      const count = indices?.length ?? position.getCount();
      let area = 0;
      for (let offset = 0; offset + 2 < count; offset += 3) {
        const index = (corner: number) => Number(indices?.[offset + corner] ?? offset + corner);
        area += triangleArea(transform(positions, index(0)), transform(positions, index(1)), transform(positions, index(2)));
      }
      if (Number.isFinite(area) && area > 0) areas.set(material, (areas.get(material) ?? 0) + area);
    }
  });
  if (areas.size < 1 || areas.size > 4_096) throw new Error('Semantic product material surface collection is unsafe.');
  return areas;
}

async function textureSignal(
  texture: Texture | null,
  provenance: PbrTextureProvenance,
  cache: Map<Texture, Promise<PbrTextureSignal>>,
): Promise<PbrTextureSignal | undefined> {
  if (!texture) return undefined;
  const cached = cache.get(texture);
  if (cached) return cached;
  const pending = (async () => {
    const bytes = texture.getImage();
    if (!bytes || bytes.byteLength < 1 || bytes.byteLength > MAX_ENCODED_TEXTURE_BYTES) {
      throw new Error(`PBR texture ${texture.getName() || '<unnamed>'} exceeds the encoded budget.`);
    }
    const size = texture.getSize();
    if (!size || size[0] < 1 || size[1] < 1 || size[0] > MAX_TEXTURE_DIMENSION
      || size[1] > MAX_TEXTURE_DIMENSION || size[0] * size[1] > MAX_TEXTURE_PIXELS) {
      throw new Error(`PBR texture ${texture.getName() || '<unnamed>'} dimensions are unsafe.`);
    }
    const image = await loadImage(bytes);
    if (image.width !== size[0] || image.height !== size[1]) throw new Error('PBR texture decoded dimensions changed.');
    const width = Math.min(image.width, 512);
    const height = Math.min(image.height, 512);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const minimum = [255, 255, 255, 255];
    const maximum = [0, 0, 0, 0];
    const sum = [0, 0, 0, 0];
    const squared = [0, 0, 0, 0];
    for (let offset = 0; offset < pixels.length; offset += 4) {
      for (let channel = 0; channel < 4; channel += 1) {
        const value = pixels[offset + channel]!;
        minimum[channel] = Math.min(minimum[channel]!, value);
        maximum[channel] = Math.max(maximum[channel]!, value);
        sum[channel] += value;
        squared[channel] += value * value;
      }
    }
    const count = pixels.length / 4;
    const mean = sum.map((value) => value / count / 255) as PbrTextureSignal['mean'];
    const standardDeviation = squared.map((value, channel) => Math.sqrt(Math.max(
      0, value / count - (sum[channel]! / count) ** 2,
    )) / 255) as PbrTextureSignal['standardDeviation'];
    const range = maximum.map((value, channel) => (value - minimum[channel]!) / 255) as PbrTextureSignal['range'];
    return {
      width: image.width,
      height: image.height,
      payloadFingerprint: createHash('sha256').update(bytes).digest('hex'),
      encodedBytes: bytes.byteLength,
      mean,
      standardDeviation,
      range,
      provenance,
    };
  })();
  cache.set(texture, pending);
  return pending;
}

export async function collectPbrEvidence(
  document: import('@gltf-transform/core').Document,
  provenanceFor: (material: Material) => {
    provenance: PbrTextureProvenance;
    evidenceFingerprint?: string;
    factorProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
    evidenceFingerprintByChannel?: Partial<Record<PbrSpatialChannel, string>>;
    textureProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
  },
): Promise<PbrMaterialEvidence[]> {
  const areas = materialSurfaceAreas(document);
  const cache = new Map<Texture, Promise<PbrTextureSignal>>();
  return Promise.all([...areas].map(async ([material, weight], materialIndex) => {
    const receipt = provenanceFor(material);
    const [baseColorTexture, metallicRoughnessTexture, normalTexture, emissiveTexture] = await Promise.all([
      textureSignal(material.getBaseColorTexture(), receipt.textureProvenanceByChannel?.baseColor ?? receipt.provenance, cache),
      textureSignal(material.getMetallicRoughnessTexture(), receipt.textureProvenanceByChannel?.roughness ?? receipt.provenance, cache),
      textureSignal(material.getNormalTexture(), receipt.textureProvenanceByChannel?.normal ?? receipt.provenance, cache),
      textureSignal(material.getEmissiveTexture(), receipt.textureProvenanceByChannel?.emissive ?? receipt.provenance, cache),
    ]);
    return {
      id: material.getName() || `material-${materialIndex + 1}`,
      weight,
      baseColorFactor: material.getBaseColorFactor(),
      metallicFactor: material.getMetallicFactor(),
      roughnessFactor: material.getRoughnessFactor(),
      normalScale: material.getNormalScale(),
      emissiveFactor: material.getEmissiveFactor(),
      factorProvenance: receipt.provenance,
      evidenceFingerprint: receipt.evidenceFingerprint,
      factorProvenanceByChannel: receipt.factorProvenanceByChannel,
      evidenceFingerprintByChannel: receipt.evidenceFingerprintByChannel,
      textureProvenanceByChannel: receipt.textureProvenanceByChannel,
      baseColorTexture,
      metallicRoughnessTexture,
      normalTexture,
      emissiveTexture,
    };
  }));
}

export async function exportCanonicalGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  const preparation = preparePortableGltfGeometry(root);
  if (preparation.unresolvedNormalMappedMeshes.length > 0) throw new Error('Semantic product has unresolved tangent inputs.');
  const result = await new GLTFExporter().parseAsync(createPortableGltfExportInput(root), {
    binary: true,
    onlyVisible: true,
    includeCustomExtensions: true,
  });
  if (!(result instanceof ArrayBuffer)) throw new Error('Semantic product did not export a binary GLB.');
  return canonicalizeGlbBufferViews(result);
}
