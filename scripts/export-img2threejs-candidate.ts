import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Canvas, ImageData } from '@napi-rs/canvas';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { canonicalizeGlbBufferViews } from '../src/engine/glb-canonicalization';
import { createPortableGltfExportInput, preparePortableGltfGeometry } from '../src/engine/gltf-export-preparation';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_OBJECTS = 100_000;
const SHA256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      queueMicrotask(() => this.onloadend?.());
    });
  }
}

class NodeOffscreenCanvas extends Canvas {
  toBlob(callback: (blob: Blob) => void, type = 'image/png'): void {
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    callback(new Blob([new Uint8Array(this.encodeSync(format))], { type }));
  }

  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    return new Blob([new Uint8Array(this.encodeSync(format))], { type });
  }
}

Object.assign(globalThis, { FileReader: NodeFileReader, OffscreenCanvas: NodeOffscreenCanvas, ImageData });

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function fallbackPixel(url: string): [number, number, number, number] {
  if (/\/normal$/i.test(url)) return [128, 128, 255, 255];
  if (/\/roughness$/i.test(url)) return [160, 160, 160, 255];
  if (/\/(?:height|ao)$/i.test(url)) return [128, 128, 128, 255];
  if (/brushed-silver/i.test(url)) return [190, 194, 199, 255];
  if (/rubber-cable/i.test(url)) return [17, 18, 20, 255];
  if (/black-plastic/i.test(url)) return [32, 33, 36, 255];
  return [29, 29, 31, 255];
}

const substitutedTextureUris: string[] = [];
const originalTextureLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function loadCandidateTexture(
  url: string,
  onLoad?: (texture: THREE.Texture) => void,
  onProgress?: (event: ProgressEvent<EventTarget>) => void,
  onError?: (error: unknown) => void,
): THREE.Texture {
  if (!url.startsWith('procedural://')) {
    return originalTextureLoad.call(this, url, onLoad, onProgress, onError);
  }
  substitutedTextureUris.push(url);
  const pixel = fallbackPixel(url);
  const canvas = new NodeOffscreenCanvas(1, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})`;
  context.fillRect(0, 0, 1, 1);
  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.colorSpace = /\/albedo$/i.test(url) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  queueMicrotask(() => onLoad?.(texture));
  return texture;
};

const [sourceArgument, outputArgument, exportName = 'createIndustrialFloorFanModel'] = process.argv.slice(2);
if (!sourceArgument || !outputArgument || !process.argv.includes('--allow-trusted-local-candidate')) {
  throw new Error('Usage: vite-node scripts/export-img2threejs-candidate.ts <work/factory.ts> <tmp/output.glb> [factory export] --allow-trusted-local-candidate');
}
const workspaceRoot = realpathSync(resolve('.'));
const trustedSourceRoot = realpathSync(resolve(workspaceRoot, 'work'));
const trustedOutputRoot = realpathSync(resolve(workspaceRoot, 'tmp'));
const sourcePath = realpathSync(resolve(sourceArgument));
if (!isInside(trustedSourceRoot, sourcePath)) throw new Error('Candidate source must stay inside the workspace work directory.');
const sourceStats = await import('node:fs').then(({ statSync }) => statSync(sourcePath));
if (!sourceStats.isFile() || sourceStats.size < 1 || sourceStats.size > MAX_SOURCE_BYTES || extname(sourcePath) !== '.ts') {
  throw new Error('Candidate source must be a non-empty TypeScript file within the safe size budget.');
}
let outputPath = resolve(outputArgument);
if (extname(outputPath) !== '.glb' || basename(outputPath).length > 240) {
  throw new Error('Candidate output must use a bounded .glb filename.');
}
if (!isInside(trustedOutputRoot, outputPath)) throw new Error('Candidate output must stay inside the workspace tmp directory.');
mkdirSync(dirname(outputPath), { recursive: true });
const outputDirectory = realpathSync(dirname(outputPath));
if (!isInside(trustedOutputRoot, outputDirectory)) throw new Error('Candidate output directory resolves outside the workspace tmp directory.');
outputPath = resolve(outputDirectory, basename(outputPath));

const candidate = await import(pathToFileURL(sourcePath).href) as Record<string, unknown>;
const factory = candidate[exportName];
if (typeof factory !== 'function') throw new Error(`Candidate factory export ${exportName} was not found.`);
const root = factory({ textureSize: 256, textureAnisotropy: 1, qualityPriority: 'reference-fidelity' });
if (!(root instanceof THREE.Object3D)) throw new Error('Candidate factory did not return a Three.js Object3D.');
const circularRuntimeRemoved = Boolean(root.userData?.sculptRuntime);
if (circularRuntimeRemoved) delete root.userData.sculptRuntime;

let objectCount = 0;
let meshCount = 0;
let triangleCount = 0;
const componentIds = new Set<string>();
root.updateMatrixWorld(true);
root.traverse((object: THREE.Object3D) => {
  objectCount += 1;
  if (objectCount > MAX_OBJECTS) throw new Error('Candidate exceeds the safe object budget.');
  if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
  meshCount += 1;
  const position = object.geometry.getAttribute('position');
  const index = object.geometry.index;
  triangleCount += Math.floor((index?.count ?? position?.count ?? 0) / 3);
  const component = object.userData?.sculptComponent as { id?: unknown } | undefined;
  if (typeof component?.id === 'string' && component.id) componentIds.add(component.id);
});
if (meshCount < 1 || triangleCount < 1) throw new Error('Candidate contains no renderable mesh triangles.');

const preparation = preparePortableGltfGeometry(root);
if (preparation.unresolvedNormalMappedMeshes.length > 0) {
  throw new Error(`Candidate has ${preparation.unresolvedNormalMappedMeshes.length} unresolved normal-mapped meshes.`);
}
const exported = await new GLTFExporter().parseAsync(createPortableGltfExportInput(root), {
  binary: true,
  onlyVisible: true,
  includeCustomExtensions: true,
  maxTextureSize: 256,
});
if (!(exported instanceof ArrayBuffer)) throw new Error('Candidate did not export a binary GLB.');
const canonical = canonicalizeGlbBufferViews(exported);
const bytes = new Uint8Array(canonical);
writeFileSync(outputPath, bytes);
const validation = await validateGlbStandard(canonical);
const reportPath = `${outputPath}.receipt.json`;
writeFileSync(reportPath, `${JSON.stringify({
  schema: 'morphloom.competitor-execution-receipt/0.1',
  candidate: 'img2threejs-agent-output',
  sourcePath,
  sourceSha256: SHA256(new Uint8Array(await import('node:fs').then(({ readFileSync }) => readFileSync(sourcePath)))),
  factoryExport: exportName,
  outputPath,
  outputSha256: SHA256(bytes),
  outputBytes: bytes.byteLength,
  objectCount,
  meshCount,
  triangleCount,
  componentIds: [...componentIds].sort(),
  textureCompatibilityRecovery: {
    applied: substitutedTextureUris.length > 0 || circularRuntimeRemoved,
    reason: 'Generated procedural:// references are not fetchable texture payloads and sculptRuntime is circular; deterministic 1x1 channel-safe placeholders and metadata removal were applied only to permit geometry/export inspection.',
    substitutedUris: [...new Set(substitutedTextureUris)].sort(),
    circularRuntimeRemoved,
    visualMaterialClaimEligible: false,
  },
  validation,
  outputExists: existsSync(outputPath),
}, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  reportPath,
  meshCount,
  triangleCount,
  outputSha256: SHA256(bytes),
  validation: { status: validation.status, errors: validation.errors, warnings: validation.warnings },
}, null, 2));
