import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GroundTruthCorpusManifest } from '../src/engine/ground-truth-corpus';
import { inferScaleFromAzimuthSilhouettes } from '../src/engine/multiview-scale';
import { normalizedFrame } from './lib/visual-capture-frames';

const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const manifestPath = resolve(positional[0] ?? 'benchmarks/corpora/abo-pilot.json');
const assetRoot = resolve(positional[1] ?? 'work/abo/pilot');
const outputPath = resolve(positional[2] ?? 'benchmarks/abo-multiview-scale-pilot-latest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GroundTruthCorpusManifest;
const cases = [];

function maximumAxisErrorMm(observed: number[], expected: number[]): number {
  return Math.max(...observed.map((value, index) => Math.abs(value - expected[index]!)));
}

for (const item of manifest.cases) {
  if (!item.domains.includes('industrial-design')) {
    cases.push({
      id: item.id,
      status: 'not-applicable',
      reason: 'The selected surface reference is not upright; its image height is not the physical thickness axis.',
    });
    continue;
  }
  const observations = [];
  for (const assetId of item.inputAssetIds) {
    const asset = item.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.kind !== 'input-image' || asset.relativeAzimuthDegrees === undefined) {
      throw new Error(`${item.id}/${assetId} is not a verified relative-azimuth image.`);
    }
    const frame = await normalizedFrame(resolve(assetRoot, asset.relativePath));
    observations.push({
      id: asset.id,
      azimuthDegrees: asset.relativeAzimuthDegrees,
      aspectWidthOverHeight: frame.aspect,
      confidence: 0.9,
    });
  }
  const estimate = inferScaleFromAzimuthSilhouettes(observations, item.listingDimensionsMm.height);
  const expectedMm = item.expectedModel.boundsMeters.map((value) => value * 1_000);
  const listingMm = [item.listingDimensionsMm.width, item.listingDimensionsMm.height, item.listingDimensionsMm.depth];
  const recoveredMm = [estimate.widthMm, estimate.heightMm, estimate.depthMm];
  const listingMaximumErrorMm = maximumAxisErrorMm(listingMm, expectedMm);
  const recoveredMaximumErrorMm = maximumAxisErrorMm(recoveredMm, expectedMm);
  cases.push({
    id: item.id,
    status: estimate.status,
    observations: estimate.observations,
    dimensions: {
      listingMm,
      recoveredMm,
      groundTruthMm: expectedMm,
      listingMaximumErrorMm,
      recoveredMaximumErrorMm,
      errorReductionMm: listingMaximumErrorMm - recoveredMaximumErrorMm,
    },
    residual: {
      rms: estimate.normalizedRmsResidual,
      maximum: estimate.maximumNormalizedResidual,
      confidence: estimate.confidence,
    },
    blockers: estimate.blockers,
    limitations: estimate.limitations,
  });
}

const measured = cases.filter((item) => item.status !== 'not-applicable');
const improved = measured.filter((item) => 'dimensions' in item && item.dimensions.errorReductionMm > 0);
const report = {
  schema: 'morphloom.abo-multiview-scale-pilot/0.1',
  pass: measured.length > 0 && measured.every((item) => item.status === 'measured') && improved.length === measured.length,
  cases,
  measuredCases: measured.length,
  improvedCases: improved.length,
  limitation: 'This pilot tests metric envelope recovery from four licensed spin silhouettes, verified relative turntable offsets, and a listing height. The absolute object-frame yaw and camera intrinsics remain uncalibrated. It does not test semantic part decomposition, concavity, PBR recovery, or either engine against the reference GLB surface.',
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, pass: report.pass, measuredCases: report.measuredCases, improvedCases: report.improvedCases }, null, 2));
if (process.argv.includes('--require-pass') && !report.pass) process.exitCode = 1;
