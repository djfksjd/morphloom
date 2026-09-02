import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  auditSameInputVisualBenchmark,
  type SameInputVisualBenchmark,
  type VisualBenchmarkCandidate,
  type VisualBenchmarkView,
} from '../src/engine/visual-benchmark';
import {
  canonicalCameraCalibration,
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
const morphloomViews: VisualBenchmarkView[] = [];
const competitorViews: VisualBenchmarkView[] = [];
const captureEvidence = [];
const inputEvidence = [];
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

for (const view of manifest.views) {
  const referencePath = resolve(baseDirectory, view.reference);
  const morphloomPath = resolve(baseDirectory, view.morphloom);
  const competitorPath = resolve(baseDirectory, view.img2threejs);
  const morphloomScenePath = resolve(baseDirectory, view.sceneArtifacts.morphloom);
  const competitorScenePath = resolve(baseDirectory, view.sceneArtifacts.img2threejs);
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
  report,
}, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, status: report.status, claimAllowed: report.claimAllowed, scores: report.scores, blockers: report.blockers }, null, 2));
if (process.argv.includes('--require-claim') && !report.claimAllowed) {
  throw new Error(`Visual winner claim is blocked: ${report.blockers.join(' · ')}`);
}
