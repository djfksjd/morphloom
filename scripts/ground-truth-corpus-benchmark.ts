import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import {
  auditGroundTruthCorpus,
  type GroundTruthAssetReceipt,
  type GroundTruthCorpusManifest,
  type GroundTruthModelExpectation,
} from '../src/engine/ground-truth-corpus';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';

const args = process.argv.slice(2);

function argument(name: string, fallback: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : fallback;
  if (!value) throw new Error(`Missing value for ${name}.`);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeLocalAsset(root: string, relativePath: string): string {
  const rootPath = realpathSync(root);
  const requested = resolve(rootPath, relativePath);
  if (requested !== rootPath && !requested.startsWith(`${rootPath}${sep}`)) {
    throw new Error(`Ground-truth asset escapes the configured root: ${relativePath}`);
  }
  if (!existsSync(requested)) throw new Error(`Ground-truth asset is missing: ${relativePath}`);
  const stat = lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Ground-truth asset is not a regular file: ${relativePath}`);
  const actual = realpathSync(requested);
  if (!actual.startsWith(`${rootPath}${sep}`)) throw new Error(`Ground-truth asset resolves outside the configured root: ${relativePath}`);
  return actual;
}

function transformedBounds(document: Document): [number, number, number] {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (const scene of document.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      matrix.fromArray(node.getWorldMatrix());
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        const minimum = position.getMinNormalized([]);
        const maximum = position.getMaxNormalized([]);
        for (const x of [minimum[0], maximum[0]]) for (const y of [minimum[1], maximum[1]]) {
          for (const z of [minimum[2], maximum[2]]) bounds.expandByPoint(point.set(x, y, z).applyMatrix4(matrix));
        }
      }
    });
  }
  const size = bounds.getSize(new THREE.Vector3()).toArray();
  if (size.length !== 3 || size.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Ground-truth GLB has empty or invalid transformed bounds.');
  }
  return [size[0]!, size[1]!, size[2]!];
}

function inspectModel(document: Document): GroundTruthModelExpectation {
  const root = document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    vertices: primitives.reduce((sum, primitive) => sum + (primitive.getAttribute('POSITION')?.getCount() ?? 0), 0),
    triangles: primitives.reduce((sum, primitive) => sum + Math.floor(
      (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3,
    ), 0),
    boundsMeters: transformedBounds(document),
  };
}

const manifestPath = resolve(argument('--manifest', 'benchmarks/corpora/abo-pilot.json'));
const assetRoot = resolve(argument('--assets', 'work/abo/pilot'));
const outputPath = resolve(argument('--output', 'benchmarks/ground-truth-corpus-latest.json'));
const manifestBytes = readFileSync(manifestPath);
if (manifestBytes.byteLength > 2 * 1024 * 1024) throw new Error('Ground-truth manifest exceeds the 2MB safety limit.');
const manifest = JSON.parse(manifestBytes.toString('utf8')) as GroundTruthCorpusManifest;
const receipts: GroundTruthAssetReceipt[] = [];
let totalBytes = 0;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const item of manifest.cases) {
  for (const asset of item.assets) {
    const path = safeLocalAsset(assetRoot, asset.relativePath);
    const bytes = readFileSync(path);
    totalBytes += bytes.byteLength;
    if (totalBytes > 768 * 1024 * 1024) throw new Error('Ground-truth corpus exceeds the 768MB verification budget.');
    const base = { caseId: item.id, assetId: asset.id, sha256: sha256(bytes), bytes: bytes.byteLength };
    if (asset.kind === 'input-image') {
      const decoded = await loadImage(bytes);
      receipts.push({ ...base, width: decoded.width, height: decoded.height });
      continue;
    }
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const [validation, document] = await Promise.all([
      validateGlbStandard(payload),
      io.readBinary(new Uint8Array(payload)),
    ]);
    receipts.push({
      ...base,
      model: {
        ...inspectModel(document),
        validatorStatus: validation.status,
        validatorErrors: validation.errors,
        validatorWarnings: validation.warnings,
        issueCodes: validation.issueCodes,
        independentRead: validation.independentRead.status === 'pass',
      },
    });
  }
}

const report = auditGroundTruthCorpus(manifest, receipts, sha256(manifestBytes));
writeFileSync(outputPath, `${JSON.stringify({
  ...report,
  manifestPath: manifestPath.startsWith(`${process.cwd()}${sep}`) ? manifestPath.slice(process.cwd().length + 1) : manifestPath,
  assetRoot: assetRoot.startsWith(`${process.cwd()}${sep}`) ? assetRoot.slice(process.cwd().length + 1) : assetRoot,
  sourceDataset: manifest.sourceDataset,
  sourceDatasetUrl: manifest.sourceDatasetUrl,
  totalVerifiedBytes: totalBytes,
}, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  pass: report.pass,
  verifiedCases: `${report.verifiedCases}/${report.cases.length}`,
  verifiedAssets: report.verifiedAssets,
  warnings: report.cases.flatMap((item) => item.warnings),
}, null, 2));
if (args.includes('--require-pass') && !report.pass) process.exitCode = 1;
