import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Canvas, ImageData } from '@napi-rs/canvas';
import * as THREE from 'three';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { createCaseworkFurnitureIR } from '../src/engine/casework-furniture';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { applyReferenceMaterialEvidence, bindReferenceMaterialFactorEvidence } from '../src/engine/reference-material-evidence';
import { deriveMaskedReferenceSurface } from '../src/engine/reference-surface';
import { auditAssemblyDetail } from '../src/engine/generation-policy';
import { normalizedFrame } from './lib/visual-capture-frames';
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

const positionalArguments = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const lockPath = resolve(positionalArguments[0] ?? 'benchmarks/holdouts/abo-industrial-design-01-lock.json');
const outputPath = resolve(positionalArguments[1] ?? 'tmp/holdouts/abo-nightstand/morphloom-nightstand.glb');
const receiptPath = resolve(positionalArguments[2] ?? 'benchmarks/holdouts/abo-industrial-design-01-morphloom-candidate.json');
const workspace = resolve('.');
const postReveal = process.argv.includes('--post-reveal');
if (!postReveal) {
  throw new Error('This holdout ground truth has been revealed. Further candidates must use --post-reveal and cannot be reported as blind evidence.');
}
const outputRoots = [resolve(workspace, 'tmp/holdouts'), resolve(workspace, 'benchmarks/holdouts/artifacts')];
if (!isPathInside(resolve(workspace, 'benchmarks/holdouts'), lockPath)
  || !outputRoots.some((root) => isPathInside(root, outputPath))
  || !isPathInside(resolve(workspace, 'benchmarks/holdouts'), receiptPath)) {
  throw new Error('Holdout lock, artifact, and receipt paths must stay inside their dedicated directories.');
}
if (existsSync(outputPath) || existsSync(receiptPath)) {
  throw new Error('Holdout artifact and receipt paths must be new; refusing to overwrite sealed evidence.');
}
const engineFiles = [
  'src/engine/casework-furniture.ts',
  'src/engine/reference-material-evidence.ts',
  'scripts/abo-nightstand-holdout-candidate.ts',
];
try {
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...engineFiles], { cwd: workspace, stdio: 'ignore', timeout: 5_000 });
} catch {
  throw new Error('Candidate engine files must be committed before a final holdout seal is created.');
}
const engineRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: workspace, encoding: 'utf8', timeout: 5_000,
}).trim();
const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
  caseId?: unknown; lockedInputSha256?: unknown;
  source?: { title?: unknown };
  views?: Array<{ id?: unknown; file?: unknown; sha256?: unknown }>;
};
if (typeof lock.caseId !== 'string' || !/^[a-zA-Z0-9_.-]{1,96}$/.test(lock.caseId)
  || typeof lock.lockedInputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(lock.lockedInputSha256)
  || typeof lock.source?.title !== 'string' || lock.source.title.length < 1 || lock.source.title.length > 240
  || !Array.isArray(lock.views) || lock.views.length !== 4
  || lock.views.some((view) => typeof view.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,96}$/.test(view.id)
    || typeof view.file !== 'string' || view.file.length < 1 || view.file.length > 500
    || typeof view.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(view.sha256))) {
  throw new Error('Holdout lock is invalid or incomplete.');
}
for (const view of lock.views) {
  const sourcePath = resolve(view.file as string);
  const sourceRoot = realpathSync(resolve(workspace, 'work/abo/holdouts'));
  if (lstatSync(sourcePath).isSymbolicLink() || !isPathInside(sourceRoot, realpathSync(sourcePath))) {
    throw new Error(`Locked source escapes the holdout input directory: ${view.id}`);
  }
  const actual = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  if (actual !== view.sha256) throw new Error(`Locked source changed: ${String(view.id)}`);
}
const frames = await Promise.all(lock.views.map((view) => normalizedFrame(resolve(view.file))));
const surface = deriveMaskedReferenceSurface(lock.views.slice(0, 2).map((view, index) => ({
  id: view.id as string,
  fingerprint: view.sha256 as string,
  width: frames[index]!.rawFrame.width,
  height: frames[index]!.rawFrame.height,
  rgba: frames[index]!.rawFrame.rgba,
  mask: frames[index]!.rawFrame.mask!,
})), { textureSize: 256, strength: 0.22, localizedPatch: true });
if (!surface.materialSuitability.pass) throw new Error(`Reference wood surface is unsuitable: ${surface.materialSuitability.blockers.join('; ')}`);

const ir = createCaseworkFurnitureIR({
  name: lock.source.title,
  widthMm: 610,
  depthMm: 430,
  bodyHeightMm: 455,
  legHeightMm: 180,
  overallHeightMm: 610,
  drawerCount: 2,
  source: lock.caseId,
});
const build = compileAssemblyIR(ir, 'beauty');
const materialReceipt = applyReferenceMaterialEvidence(build.root, surface, {
  albedoMode: 'neutral-modulation', repeat: [2, 10],
  materialFilter: (material) => /walnut|wood/i.test(material.name),
});
const factorReceipt = bindReferenceMaterialFactorEvidence(build.root, {
  sourceId: 'abo-nightstand-wood', evidenceFingerprint: surface.selectedSourceFingerprint,
  channels: ['baseColor', 'roughness', 'normal'],
  materialFilter: (material) => /walnut|wood/i.test(material.name),
});
if (materialReceipt.status !== 'applied' || factorReceipt.status !== 'applied') {
  throw new Error('Reference-derived wood material could not be bound to the candidate.');
}
const bytes = new Uint8Array(await exportCanonicalGlb(build.root));
const validation = await validateGlbStandard(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
if (validation.status !== 'pass') throw new Error(`Candidate GLB validation failed: ${validation.issueCodes.join(', ')}`);
const repeatBuild = compileAssemblyIR(structuredClone(ir), 'beauty');
applyReferenceMaterialEvidence(repeatBuild.root, surface, {
  albedoMode: 'neutral-modulation', repeat: [2, 10],
  materialFilter: (material) => /walnut|wood/i.test(material.name),
});
bindReferenceMaterialFactorEvidence(repeatBuild.root, {
  sourceId: 'abo-nightstand-wood', evidenceFingerprint: surface.selectedSourceFingerprint,
  channels: ['baseColor', 'roughness', 'normal'],
  materialFilter: (material) => /walnut|wood/i.test(material.name),
});
const repeatBytes = new Uint8Array(await exportCanonicalGlb(repeatBuild.root));
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const digest = sha256(bytes);
if (digest !== sha256(repeatBytes)) throw new Error('Candidate export is not byte deterministic.');
const sourceHash = createHash('sha256');
for (const file of engineFiles) {
  const sourceBytes = readFileSync(resolve(file));
  sourceHash.update(file, 'utf8');
  sourceHash.update('\0');
  sourceHash.update(String(sourceBytes.byteLength), 'utf8');
  sourceHash.update('\0');
  sourceHash.update(sourceBytes);
  sourceHash.update('\0');
}
const receipt = {
  schema: 'morphloom.holdout-candidate-seal/0.1',
  caseId: lock.caseId,
  engine: 'morphloom',
  engineRevision,
  engineSourceSha256: sourceHash.digest('hex'),
  lockedInputSha256: lock.lockedInputSha256,
  artifact: { file: relative(workspace, outputPath), sha256: digest, bytes: bytes.byteLength },
  deterministicRepeatSha256: sha256(repeatBytes),
  validation,
  detailAudit: auditAssemblyDetail(ir),
  materialReceipt,
  factorReceipt,
  candidateKind: 'post-seal-engine-iteration',
  baselineBlindArtifactSha256: 'd84d75ffc727d98db6f248473810bff98e7648fe0af948a400a526e9b188749d',
  groundTruthRevealed: true,
  sealedAt: new Date().toISOString(),
};
let artifactWritten = false;
try {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes, { flag: 'wx' });
  artifactWritten = true;
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
} catch (error) {
  if (artifactWritten) rmSync(outputPath, { force: true });
  throw error;
}
console.log(JSON.stringify({ receiptPath, artifact: receipt.artifact, parts: build.metrics.parts, triangles: build.metrics.triangles, detailPass: receipt.detailAudit.pass }, null, 2));
