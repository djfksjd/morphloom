import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  auditSameInputVisualBenchmark,
  type SameInputVisualBenchmark,
  type VisualBenchmarkCandidate,
} from '../src/engine/visual-benchmark';
import {
  normalizedFrame,
  sha256,
  TARGET_HEIGHT,
  TARGET_WIDTH,
  validateCaptureThreshold,
  type NormalizedCapture,
} from './lib/visual-capture-frames';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}.`);
  return value;
}

function numericArgument(name: string): number | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : validateCaptureThreshold(Number(process.argv[index + 1]), `--${name}`);
}

const referencePath = resolve(argument('reference'));
const morphloomPath = resolve(argument('morphloom'));
const competitorPath = resolve(argument('competitor'));
const outputPath = resolve(argument('output'));
const morphloomThreshold = numericArgument('morphloom-threshold');
const competitorThreshold = numericArgument('competitor-threshold');
const reference = await normalizedFrame(referencePath);
const [morphloom, competitor] = await Promise.all([
  normalizedFrame(morphloomPath, reference.aspect, morphloomThreshold),
  normalizedFrame(competitorPath, reference.aspect, competitorThreshold),
]);
const referenceHash = sha256(reference.bytes);
const cameraFingerprint = sha256(new TextEncoder().encode('broadside-foreground-normalized-v1'));
const regions = [
  { featureId: 'whole-silhouette', x: 0, y: 0, width: TARGET_WIDTH, height: TARGET_HEIGHT },
  { featureId: 'blade-and-openings', x: 8, y: 24, width: 242, height: 208 },
  { featureId: 'grip-fasteners-and-ring', x: 242, y: 24, width: 262, height: 208 },
];
const candidate = (
  id: VisualBenchmarkCandidate['id'],
  rendererVersion: string,
  capture: NormalizedCapture,
): VisualBenchmarkCandidate => ({
  id,
  rendererVersion,
  inputFingerprint: referenceHash,
  views: [{
    viewId: 'broadside',
    cameraFingerprint,
    referenceSha256: referenceHash,
    renderSha256: sha256(capture.bytes),
    sceneFingerprint: sha256(capture.bytes),
    referenceOrigin: 'redistributable-reference',
    renderOrigin: 'browser-webgl-canvas',
    reference: reference.frame,
    render: capture.frame,
    regions,
    materialExpectation: { family: 'coating', roughness: 0.28, surfaceCharacter: 'smooth' },
  }],
});
const benchmark: SameInputVisualBenchmark = {
  id: 'talon-broadside-live-capture',
  domain: 'industrial-design',
  lockedInputFingerprint: referenceHash,
  candidates: [
    candidate('morphloom', 'morphloom-local-webgl', morphloom),
    candidate('img2threejs', 'img2threejs-live-webgl', competitor),
  ],
};
const report = auditSameInputVisualBenchmark(benchmark);
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  captures: {
    reference: { file: basename(referencePath), sha256: referenceHash },
    morphloom: { file: basename(morphloomPath), sha256: sha256(morphloom.bytes) },
    img2threejs: { file: basename(competitorPath), sha256: sha256(competitor.bytes) },
  },
  normalization: {
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    method: 'coherent-connected-foreground-fit-v2',
    thresholds: { reference: reference.threshold, morphloom: morphloom.threshold, img2threejs: competitor.threshold },
  },
  report,
}, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, status: report.status, scores: report.scores, blockers: report.blockers }, null, 2));
