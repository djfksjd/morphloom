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
  canonicalVisualRenderProtocol,
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
}> = [];
const sceneHashCache = new Map<string, Promise<string>>();

function artifactSha256(path: string, label: string, maximumBytes = 256 * 1024 * 1024): Promise<string> {
  const cached = sceneHashCache.get(path);
  if (cached) return cached;
  const pending = (async () => {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > maximumBytes) {
      throw new Error(`${label} exceeds its bounded file budget: ${basename(path)}`);
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

const lightingRigPath = await evidencePath(manifest.renderProtocol.lightingRigArtifact, 'render protocol lighting rig');
const lightingRigSha256 = await artifactSha256(lightingRigPath, 'Lighting rig artifact', 16 * 1024 * 1024);
if (lightingRigSha256 !== manifest.renderProtocol.lightingRigSha256) {
  throw new Error('Render protocol lighting rig SHA-256 does not match the local artifact.');
}
let environmentEvidence: { file: string; sha256: string } | 'none' = 'none';
if (manifest.renderProtocol.environmentArtifact !== 'none' && manifest.renderProtocol.environmentSha256 !== 'none') {
  const environmentPath = await evidencePath(manifest.renderProtocol.environmentArtifact, 'render protocol environment');
  const environmentSha256 = await artifactSha256(environmentPath, 'Environment artifact', 64 * 1024 * 1024);
  if (environmentSha256 !== manifest.renderProtocol.environmentSha256) {
    throw new Error('Render protocol environment SHA-256 does not match the local artifact.');
  }
  environmentEvidence = { file: basename(environmentPath), sha256: environmentSha256 };
}
const renderSettingsFingerprint = sha256(new TextEncoder().encode(canonicalVisualRenderProtocol(manifest.renderProtocol)));

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
    artifactSha256(morphloomScenePath, 'Morphloom scene artifact'),
    artifactSha256(competitorScenePath, 'img2threejs scene artifact'),
  ]);
  for (const [candidateId, capture] of [['morphloom', morphloom], ['img2threejs', competitor]] as const) {
    if (capture.sourceWidth !== manifest.renderProtocol.canvas.width
      || capture.sourceHeight !== manifest.renderProtocol.canvas.height) {
      throw new Error(`${candidateId}/${view.viewId} PNG dimensions do not match the locked render protocol.`);
    }
  }
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
    },
    {
      candidateId: 'img2threejs', viewId: view.viewId, rendererVersion: manifest.rendererVersions.img2threejs,
      receiptPath: competitorReceiptPath, sceneSha256: competitorSceneHash, cameraFingerprint,
      referenceSha256: referenceHash, renderSha256: competitorHash,
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

const inputFingerprint = sha256(new TextEncoder().encode(JSON.stringify({ renderSettingsFingerprint, views: inputEvidence })));
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
    canvas: manifest.renderProtocol.canvas,
    renderSettingsFingerprint,
  });
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
  captureProtocol: {
    verified: true,
    evidenceFingerprint: sha256(new TextEncoder().encode(JSON.stringify({
      renderSettingsFingerprint,
      receipts: receiptEvidence.map(({ candidateId, viewId, sha256: receiptSha256 }) => ({ candidateId, viewId, receiptSha256 })),
    }))),
  },
  blindRatings: manifest.blindRatings,
};
const report = auditSameInputVisualBenchmark(benchmark);
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  manifest: { file: basename(manifestPath), sha256: sha256(manifestBytes), schema: manifest.schema },
  renderProtocol: {
    ...manifest.renderProtocol,
    fingerprint: renderSettingsFingerprint,
    artifacts: {
      lightingRig: { file: basename(lightingRigPath), sha256: lightingRigSha256 },
      environment: environmentEvidence,
    },
  },
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
