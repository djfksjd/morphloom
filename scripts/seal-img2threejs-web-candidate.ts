import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Canvas, ImageData } from '@napi-rs/canvas';
import * as THREE from 'three';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { exportCanonicalGlb } from './lib/semantic-product-pilot';
import { isPathInside } from './lib/holdout-lock';

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => { this.result = result; queueMicrotask(() => this.onloadend?.()); });
  }
}
class NodeOffscreenCanvas extends Canvas {
  toBlob(callback: (blob: Blob) => void, type = 'image/png'): void {
    callback(new Blob([new Uint8Array(this.encodeSync(type === 'image/jpeg' ? 'jpeg' : 'png'))], { type }));
  }
}
Object.assign(globalThis, { FileReader: NodeFileReader, OffscreenCanvas: NodeOffscreenCanvas, ImageData });

const workspace = resolve('.');
const holdoutLock = JSON.parse(readFileSync(resolve(workspace, 'benchmarks/holdouts/abo-industrial-design-01-lock.json'), 'utf8')) as {
  caseId?: unknown;
  lockedInputSha256?: unknown;
};
if (typeof holdoutLock.caseId !== 'string' || typeof holdoutLock.lockedInputSha256 !== 'string'
  || !/^[a-f0-9]{64}$/.test(holdoutLock.lockedInputSha256)) {
  throw new Error('The industrial-design holdout lock is missing or invalid.');
}
const compiledPath = realpathSync(resolve(process.argv[2] ?? ''));
const sourcePath = realpathSync(resolve(process.argv[3] ?? ''));
const outputPath = resolve(process.argv[4] ?? 'benchmarks/holdouts/artifacts/abo-b075qmhyvd/img2threejs-web.glb');
const receiptPath = resolve(process.argv[5] ?? 'benchmarks/holdouts/abo-industrial-design-01-img2threejs-web.json');
const expectedSourceSha = process.argv[6] ?? '';
if (!compiledPath.endsWith('.mjs') || !sourcePath.endsWith('.ts')
  || lstatSync(compiledPath).isSymbolicLink() || lstatSync(sourcePath).isSymbolicLink()
  || !isPathInside(resolve(workspace, 'benchmarks/holdouts/artifacts'), outputPath)
  || !isPathInside(resolve(workspace, 'benchmarks/holdouts'), receiptPath)
  || !/^[a-f0-9]{64}$/.test(expectedSourceSha)) {
  throw new Error('Competitor source, compiled module, output, receipt, or expected hash is invalid.');
}
const sourceBytes = readFileSync(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== expectedSourceSha) throw new Error('Downloaded competitor source changed after capture.');

const moduleValue = await import(pathToFileURL(compiledPath).href) as {
  createImg2ThreeJsNightstand?: () => THREE.Group;
};
if (typeof moduleValue.createImg2ThreeJsNightstand !== 'function') {
  throw new Error('Competitor module does not export createImg2ThreeJsNightstand().');
}
const root = moduleValue.createImg2ThreeJsNightstand();
if (!root?.isGroup) throw new Error('Competitor factory did not return a Three.js Group.');
let meshCount = 0;
const names = new Set<string>();
root.traverse((object) => {
  if (!object.name || names.has(object.name)) throw new Error(`Missing or duplicate editable node name: ${object.name || '(empty)'}`);
  names.add(object.name);
  if ((object as THREE.Mesh).isMesh) meshCount += 1;
});
if (meshCount < 20) throw new Error(`Competitor output is too shallow for sealing: ${meshCount} meshes.`);

const bytes = new Uint8Array(await exportCanonicalGlb(root));
const digest = createHash('sha256').update(bytes).digest('hex');
const validation = await validateGlbStandard(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
if (validation.status !== 'pass') throw new Error(`Competitor GLB validation failed: ${validation.issueCodes.join(', ')}`);
const receipt = {
  schema: 'morphloom.competitor-candidate-seal/0.1',
  caseId: holdoutLock.caseId,
  lockedInputSha256: holdoutLock.lockedInputSha256,
  engine: 'img2threejs-web',
  engineRevision: '9fbd0ca5bbcc3b13bebe712745d6784d33db0b85',
  modelSurface: 'ChatGPT Free web',
  source: { fileName: 'createImg2ThreeJsNightstand.ts', sha256: sourceSha256, utf8: sourceBytes.toString('utf8') },
  artifact: { file: relative(workspace, outputPath), sha256: digest, bytes: bytes.byteLength, meshes: meshCount },
  validation,
  groundTruthRevealed: false,
  sealedAt: new Date().toISOString(),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, bytes, { flag: 'wx' });
mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ artifact: receipt.artifact, sourceSha256, validation: validation.status }, null, 2));
