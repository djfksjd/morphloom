import { statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compareSurfaceGeometry, sampleTriangleSurface } from '../src/engine/surface-geometry-fidelity';
import { collectGltfTriangles } from './lib/semantic-product-pilot';

const referencePath = resolve(process.argv[2] ?? '');
const candidatePath = resolve(process.argv[3] ?? '');
const requestedSamples = Number(process.argv[4] ?? 512);
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1] ?? '') : undefined;
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: npm run gltf:compare-surface -- <reference.glb> <candidate.glb> [samples] [--output report.json]');
}
if (!Number.isInteger(requestedSamples) || requestedSamples < 16 || requestedSamples > 4_096) {
  throw new Error('Surface sample count must be an integer within 16..4096.');
}
if (outputIndex >= 0 && (!process.argv[outputIndex + 1] || !outputPath || !outputPath.endsWith('.json'))) {
  throw new Error('Surface comparison output must be a JSON path.');
}
for (const path of [referencePath, candidatePath]) {
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size < 12 || metadata.size > 256 * 1024 * 1024) {
    throw new Error(`${path} is outside the 12-byte..256-MB GLB budget.`);
  }
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [referenceDocument, candidateDocument] = await Promise.all([
  io.read(referencePath), io.read(candidatePath),
]);
const reference = sampleTriangleSurface(collectGltfTriangles(referenceDocument), requestedSamples);
const candidate = sampleTriangleSurface(collectGltfTriangles(candidateDocument), requestedSamples);
const audit = compareSurfaceGeometry(reference.points, candidate.points);
const pointStatistics = (points: typeof reference.points) => {
  const minimum = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!)));
  const maximum = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!)));
  const center = minimum.map((value, axis) => (value + maximum[axis]!) * 0.5);
  const scale = Math.max(...maximum.map((value, axis) => value - minimum[axis]!));
  const quantiles = [0.05, 0.25, 0.5, 0.75, 0.95];
  return [0, 1, 2].map((axis) => {
    const values = points.map((point) => (point[axis]! - center[axis]!) / scale).sort((left, right) => left - right);
    return quantiles.map((fraction) => values[Math.floor((values.length - 1) * fraction)]!);
  });
};
const report = {
  schema: 'morphloom.glb-surface-comparison/0.1',
  reference: { path: referencePath, triangles: reference.sourceTriangles, surfaceArea: reference.surfaceArea },
  candidate: { path: candidatePath, triangles: candidate.sourceTriangles, surfaceArea: candidate.surfaceArea },
  requestedSamples,
  normalizedAxisQuantiles: { fractions: [0.05, 0.25, 0.5, 0.75, 0.95], reference: pointStatistics(reference.points), candidate: pointStatistics(candidate.points) },
  audit,
};
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--require-pass') && !audit.pass) process.exitCode = 1;
