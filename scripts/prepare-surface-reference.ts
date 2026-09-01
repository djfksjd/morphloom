import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { ASPHALT_SURFACE_BENCHMARK_IR } from '../src/engine/asphalt-surface-benchmark';
import { analyzeReferenceSurface, quantizeReferenceHeightField } from '../src/engine/reference-surface';
import { decodePng } from './lib/png-decoder';

interface Arguments {
  input: string;
  output: string;
}

function parseArguments(values: string[]): Arguments {
  let input = '';
  let output = 'outputs/morphloom-reference-surface.json';
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--input') input = values[index + 1] ?? '';
    if (value === '--output') output = values[index + 1] ?? '';
    if (value === '--input' || value === '--output') index += 1;
  }
  if (!input || !output) throw new Error('Usage: npm run surface:prepare -- --input reference.png [--output outputs/reference-surface.json]');
  return { input, output };
}

function assertProjectOutput(projectRoot: string, output: string): string {
  const absolute = resolve(projectRoot, output);
  const rel = relative(projectRoot, absolute);
  if (rel.startsWith('..') || rel === '' || rel.includes('\0')) throw new Error('Output must be a file inside the Morphloom project.');
  return absolute;
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const args = parseArguments(process.argv.slice(2));
  if (extname(args.input).toLowerCase() !== '.png') throw new Error('Reference preparation currently accepts non-interlaced 8-bit PNG input.');
  const sourceBytes = await readFile(resolve(args.input));
  const decoded = decodePng(sourceBytes);
  const fingerprint = createHash('sha256').update(sourceBytes).digest('hex');
  const analysis = analyzeReferenceSurface(decoded.rgba, decoded.width, decoded.height, 1.25);
  const aspect = decoded.width / decoded.height;
  // A 128-sample long edge preserves individual 3–6 mm aggregate clusters in
  // a 600 mm swatch while staying far below the geometry and JSON budgets.
  const fieldWidth = aspect >= 1 ? 128 : Math.max(2, Math.round(128 * aspect));
  const fieldHeight = aspect >= 1 ? Math.max(2, Math.round(128 / aspect)) : 128;
  const physicalWidth = aspect >= 1 ? 600 : 600 * aspect;
  const physicalDepth = aspect >= 1 ? 600 / aspect : 600;
  const referenceRelief = quantizeReferenceHeightField(
    analysis,
    fieldWidth,
    fieldHeight,
    2.6,
    0.8,
    fingerprint,
  );
  const assetDirectory = resolve(projectRoot, 'public/local-references');
  await mkdir(assetDirectory, { recursive: true });
  const assetName = `${fingerprint.slice(0, 16)}-${basename(args.input).replaceAll(/[^a-zA-Z0-9._-]/g, '_')}`;
  await copyFile(resolve(args.input), resolve(assetDirectory, assetName));
  const ir = structuredClone(ASPHALT_SURFACE_BENCHMARK_IR);
  ir.name = 'Reference-conditioned asphalt surface';
  ir.metadata = {
    ...ir.metadata,
    evidenceScore: 84,
    sourceBoundary: 'local user-supplied photograph; relief is photometric and remains estimated until height-calibrated',
    referenceFingerprint: fingerprint,
    referenceSurfaceMetrics: analysis.metrics,
  };
  const component = ir.components[0]!;
  component.name = 'Photo-conditioned coarse asphalt sample';
  component.detail = 'Local reference albedo, image-derived normal and roughness, and a bounded high-resolution high-pass height field blended with closed angular aggregate geometry.';
  component.evidence = {
    status: 'estimated',
    source: `Local reference ${fingerprint.slice(0, 16)}`,
    notes: ['Visible aggregate layout is image-conditioned.', 'Absolute height remains estimated until calibrated scan or measured roughness is supplied.'],
  };
  if (component.geometry.op !== 'surfacePatch') throw new Error('Asphalt benchmark geometry is unavailable.');
  component.geometry.size = [Number(physicalWidth.toFixed(3)), Number(physicalDepth.toFixed(3))];
  component.geometry.segments = [
    Math.max(32, Math.min(208, Math.round(physicalWidth / 3))),
    Math.max(32, Math.min(208, Math.round(physicalDepth / 3))),
  ];
  component.geometry.macroAmplitude = 1.1;
  component.geometry.aggregateAmplitude = 2.4;
  component.geometry.aggregateScale = 11;
  component.geometry.referenceRelief = referenceRelief;
  component.material.referenceProjection = {
    uri: `/local-references/${assetName}`,
    mapping: 'assembly-xz',
    crop: [0, 0, 1, 1],
    boundsMm: [-physicalWidth / 2, -physicalDepth / 2, physicalWidth / 2, physicalDepth / 2],
    fingerprint,
    relief: { strength: 1.25, maxResolution: 1024 },
  };
  const output = assertProjectOutput(projectRoot, args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(ir, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    output: relative(projectRoot, output),
    localReference: `public/local-references/${assetName}`,
    sourcePixels: [decoded.width, decoded.height],
    heightField: [fieldWidth, fieldHeight],
    fingerprint,
    metrics: analysis.metrics,
  }, null, 2)}\n`);
}

await main();
