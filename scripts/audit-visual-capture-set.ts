import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  auditSameInputVisualBenchmark,
  type SameInputVisualBenchmark,
  type VisualBenchmarkCandidate,
  type VisualBenchmarkView,
} from '../src/engine/visual-benchmark';
import {
  canonicalCameraCalibration,
  validateBrowserCaptureReceipt,
  validateVisualCaptureSetManifest,
} from '../src/engine/visual-capture-manifest';
import {
  normalizedFrame,
  sha256,
  TARGET_HEIGHT,
  TARGET_WIDTH,
} from './lib/visual-capture-frames';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}.`);
  return value;
}

const manifestPath = resolve(argument('manifest'));
const outputPath = resolve(argument('output'));
const manifestStat = await stat(manifestPath);
if (!manifestStat.isFile() || manifestStat.size < 1 || manifestStat.size > 1024 * 1024) {
  throw new Error('Visual capture manifest exceeds the 1 MB budget.');
}
const manifestBytes = new Uint8Array(await readFile(manifestPath));
const manifest = validateVisualCaptureSetManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
const baseDirectory = dirname(manifestPath);
const canonicalBaseDirectory = await realpath(baseDirectory);
const morphloomViews: VisualBenchmarkView[] = [];
const competitorViews: VisualBenchmarkView[] = [];
const captureEvidence = [];
const inputEvidence = [];
const receiptInputs: Array<{
  candidateId: 'morphloom' | 'img2threejs';
  viewId: string;
  rendererVersion: string;
  receiptPath: string;
  sceneSha256: string;
  cameraFingerprint: string;
  referenceSha256: string;
  renderSha256: string;
  sourceWidth: number;
  sourceHeight: number;
}> = [];
const sceneHashCache = new Map<string, Promise<string>>();

function sceneArtifactSha256(path: string): Promise<string> {
  const cached = sceneHashCache.get(path);
  if (cached) return cached;
  const pending = (async () => {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > 256 * 1024 * 1024) {
      throw new Error(`Scene artifact must be a 1 byte..256 MB file: ${basename(path)}`);
    }
    return new Promise<string>((resolveHash, rejectHash) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', rejectHash);
      stream.on('end', () => resolveHash(hash.digest('hex')));
    });
  })();
  sceneHashCache.set(path, pending);
  return pending;
}

async function boundedJson(path: string, label: string): Promise<{ bytes: Uint8Array; value: unknown }> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 64 * 1024) throw new Error(`${label} must be a 1 byte..64 KB JSON file.`);
  const bytes = new Uint8Array(await readFile(path));
  try {
    return { bytes, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function evidencePath(path: string, label: string): Promise<string> {
  const canonical = await realpath(resolve(baseDirectory, path));
  const fromBase = relative(canonicalBaseDirectory, canonical);
  if (!fromBase || isAbsolute(fromBase) || fromBase === '..' || fromBase.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${label} must resolve to a file inside the manifest directory.`);
  }
  return canonical;
}

for (const view of manifest.views) {
  const [referencePath, morphloomPath, competitorPath, morphloomScenePath, competitorScenePath, morphloomReceiptPath, competitorReceiptPath] = await Promise.all([
    evidencePath(view.reference, `${view.viewId} reference`),
    evidencePath(view.morphloom, `${view.viewId} Morphloom capture`),
    evidencePath(view.img2threejs, `${view.viewId} img2threejs capture`),
    evidencePath(view.sceneArtifacts.morphloom, `${view.viewId} Morphloom scene`),
    evidencePath(view.sceneArtifacts.img2threejs, `${view.viewId} img2threejs scene`),
    evidencePath(view.captureReceipts.morphloom, `${view.viewId} Morphloom receipt`),
    evidencePath(view.captureReceipts.img2threejs, `${view.viewId} img2threejs receipt`),
  ]);
  const reference = await normalizedFrame(referencePath, undefined, view.thresholds?.reference);
  const [morphloom, competitor, morphloomSceneHash, competitorSceneHash] = await Promise.all([
    normalizedFrame(morphloomPath, reference.aspect, view.thresholds?.morphloom),
    normalizedFrame(competitorPath, reference.aspect, view.thresholds?.img2threejs),
    sceneArtifactSha256(morphloomScenePath),
    sceneArtifactSha256(competitorScenePath),
  ]);
  const referenceHash = sha256(reference.bytes);
  const morphloomHash = sha256(morphloom.bytes);
  const competitorHash = sha256(competitor.bytes);
  const cameraFingerprint = sha256(new TextEncoder().encode(canonicalCameraCalibration(view.camera)));
  const shared = {
    viewId: view.viewId,
    cameraFingerprint,
    referenceSha256: referenceHash,
    referenceOrigin: view.referenceOrigin,
    renderOrigin: 'browser-webgl-canvas' as const,
    reference: reference.frame,
    regions: view.regions,
    materialExpectation: view.materialExpectation,
  };
  morphloomViews.push({
    ...shared,
    renderSha256: morphloomHash,
    sceneFingerprint: morphloomSceneHash,
    render: morphloom.frame,
  });
  competitorViews.push({
    ...shared,
    renderSha256: competitorHash,
    sceneFingerprint: competitorSceneHash,
    render: competitor.frame,
  });
  inputEvidence.push({ viewId: view.viewId, cameraFingerprint, referenceSha256: referenceHash });
  receiptInputs.push(
    {
      candidateId: 'morphloom', viewId: view.viewId, rendererVersion: manifest.rendererVersions.morphloom,
      receiptPath: morphloomReceiptPath, sceneSha256: morphloomSceneHash, cameraFingerprint,
      referenceSha256: referenceHash, renderSha256: morphloomHash,
      sourceWidth: morphloom.sourceWidth, sourceHeight: morphloom.sourceHeight,
    },
    {
      candidateId: 'img2threejs', viewId: view.viewId, rendererVersion: manifest.rendererVersions.img2threejs,
      receiptPath: competitorReceiptPath, sceneSha256: competitorSceneHash, cameraFingerprint,
      referenceSha256: referenceHash, renderSha256: competitorHash,
      sourceWidth: competitor.sourceWidth, sourceHeight: competitor.sourceHeight,
    },
  );
  captureEvidence.push({
    viewId: view.viewId,
    camera: view.camera,
    cameraFingerprint,
    reference: { file: basename(referencePath), sha256: referenceHash },
    morphloom: { file: basename(morphloomPath), sha256: morphloomHash },
    img2threejs: { file: basename(competitorPath), sha256: competitorHash },
    sceneArtifacts: {
      morphloom: { file: basename(morphloomScenePath), sha256: morphloomSceneHash },
      img2threejs: { file: basename(competitorScenePath), sha256: competitorSceneHash },
    },
    thresholds: {
      reference: reference.threshold,
      morphloom: morphloom.threshold,
      img2threejs: competitor.threshold,
    },
  });
}

const inputFingerprint = sha256(new TextEncoder().encode(JSON.stringify(inputEvidence)));
const receiptEvidence = [];
for (const input of receiptInputs) {
  const { bytes, value } = await boundedJson(input.receiptPath, `${input.candidateId}/${input.viewId} capture receipt`);
  const receipt = validateBrowserCaptureReceipt(value, {
    candidateId: input.candidateId,
    viewId: input.viewId,
    rendererVersion: input.rendererVersion,
    inputFingerprint,
    sceneSha256: input.sceneSha256,
    cameraFingerprint: input.cameraFingerprint,
    referenceSha256: input.referenceSha256,
    renderSha256: input.renderSha256,
  });
  if (receipt.canvas.width !== input.sourceWidth || receipt.canvas.height !== input.sourceHeight) {
    throw new Error(`${input.candidateId}/${input.viewId} capture receipt canvas does not match the PNG dimensions.`);
  }
  receiptEvidence.push({
    candidateId: input.candidateId,
    viewId: input.viewId,
    file: basename(input.receiptPath),
    sha256: sha256(bytes),
    canvas: receipt.canvas,
    renderSettingsFingerprint: receipt.renderSettingsFingerprint,
  });
}
const candidate = (
  id: VisualBenchmarkCandidate['id'],
  rendererVersion: string,
  views: VisualBenchmarkView[],
): VisualBenchmarkCandidate => ({ id, rendererVersion, inputFingerprint, views });
const benchmark: SameInputVisualBenchmark = {
  id: manifest.id,
  domain: manifest.domain,
  lockedInputFingerprint: inputFingerprint,
  candidates: [
    candidate('morphloom', manifest.rendererVersions.morphloom, morphloomViews),
    candidate('img2threejs', manifest.rendererVersions.img2threejs, competitorViews),
  ],
  blindRatings: manifest.blindRatings,
};
const report = auditSameInputVisualBenchmark(benchmark);
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  manifest: { file: basename(manifestPath), sha256: sha256(manifestBytes), schema: manifest.schema },
  normalization: { width: TARGET_WIDTH, height: TARGET_HEIGHT, method: 'coherent-connected-foreground-fit-v2' },
  inputFingerprint,
  captures: captureEvidence,
  captureReceipts: receiptEvidence,
  report,
}, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, status: report.status, claimAllowed: report.claimAllowed, scores: report.scores, blockers: report.blockers }, null, 2));
if (process.argv.includes('--require-claim') && !report.claimAllowed) {
  throw new Error(`Visual winner claim is blocked: ${report.blockers.join(' · ')}`);
}
