import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { DELIVERY_PIPELINE_REVISION } from '../src/engine/delivery-validation';
import { STATIC_DELIVERY_REVISION } from '../src/engine/static-mesh-roundtrip';

interface PrintDelivery {
  file: string;
  bytes: number;
  sha256: string;
  repeatSha256: string;
  byteDeterministic: boolean;
  coordinateUnit: 'mm';
  axisConvention: 'print-z-up';
}

interface FixtureManifest {
  pass: boolean;
  compilerRevision: string;
  results: Array<{
    id: string;
    domain: string;
    printDelivery?: PrintDelivery;
  }>;
}

interface MeshInfo {
  size: number[];
  minimum: number[];
  maximum: number[];
  facets: number;
  manifold: boolean;
  parts: number;
  volumeMm3: number;
}

const MAXIMUM_STL_BYTES = 256 * 1024 * 1024;
const MAXIMUM_GCODE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_LOG_BYTES = 8 * 1024 * 1024;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseInfo(output: string): MeshInfo {
  if (output.length < 32 || output.length > 64 * 1024) throw new Error('PrusaSlicer info output exceeds its byte budget.');
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([a-z_]+)\s*=\s*(.+)$/.exec(line.trim());
    if (match) fields.set(match[1]!, match[2]!.trim());
  }
  const finite = (name: string): number => {
    const value = Number(fields.get(name));
    if (!Number.isFinite(value)) throw new Error(`PrusaSlicer omitted finite ${name}.`);
    return value;
  };
  const integer = (name: string): number => {
    const value = finite(name);
    if (!Number.isInteger(value) || value < 0) throw new Error(`PrusaSlicer returned invalid ${name}.`);
    return value;
  };
  return {
    size: ['size_x', 'size_y', 'size_z'].map(finite),
    minimum: ['min_x', 'min_y', 'min_z'].map(finite),
    maximum: ['max_x', 'max_y', 'max_z'].map(finite),
    facets: integer('number_of_facets'),
    manifold: fields.get('manifold') === 'yes',
    parts: integer('number_of_parts'),
    volumeMm3: finite('volume'),
  };
}

function inspectBinaryStl(bytes: Uint8Array): { facets: number; minimum: number[]; maximum: number[]; size: number[] } {
  if (bytes.byteLength < 84 || bytes.byteLength > MAXIMUM_STL_BYTES) throw new Error('STL is outside the byte budget.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const facets = view.getUint32(80, true);
  if (facets < 1 || facets > 10_000_000 || 84 + facets * 50 !== bytes.byteLength) {
    throw new Error('STL facet count does not match its exact binary byte contract.');
  }
  const minimum = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let facet = 0; facet < facets; facet += 1) {
    const offset = 84 + facet * 50 + 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(offset + vertex * 12 + axis * 4, true);
        if (!Number.isFinite(value)) throw new Error('STL contains a non-finite vertex.');
        minimum[axis] = Math.min(minimum[axis]!, value);
        maximum[axis] = Math.max(maximum[axis]!, value);
      }
    }
  }
  return { facets, minimum, maximum, size: maximum.map((value, axis) => value - minimum[axis]!) };
}

function maximumVectorError(left: number[], right: number[]): number {
  return Math.max(...left.map((value, axis) => Math.abs(value - right[axis]!)));
}

const fixtureDirectoryArgument = process.argv[2];
if (!fixtureDirectoryArgument) {
  throw new Error('Usage: npm run benchmark:prusaslicer -- <fixture-directory> [report.json]');
}
const fixtureDirectory = resolve(fixtureDirectoryArgument);
const reportPath = resolve(process.argv[3] ?? 'benchmarks/prusaslicer-latest.json');
const manifestPath = resolve(fixtureDirectory, 'manifest.json');
const manifestInfo = statSync(manifestPath);
if (!manifestInfo.isFile() || manifestInfo.size < 32 || manifestInfo.size > 2 * 1024 * 1024) {
  throw new Error('Cross-domain fixture manifest exceeds its byte budget.');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest;
const fixture = manifest.results.find((item) => item.domain === '3d-printing');
const delivery = fixture?.printDelivery;
if (!manifest.pass || manifest.compilerRevision !== DELIVERY_PIPELINE_REVISION || !fixture || !delivery
  || delivery.byteDeterministic !== true || delivery.sha256 !== delivery.repeatSha256
  || delivery.coordinateUnit !== 'mm' || delivery.axisConvention !== 'print-z-up') {
  throw new Error('Revision-bound deterministic Z-up print fixture is missing.');
}
const stlPath = resolve(fixtureDirectory, `${fixture.id}.stl`);
if (resolve(delivery.file) !== stlPath || !/^[a-z0-9-]{1,80}$/.test(fixture.id)) {
  throw new Error('Print fixture path or id is unsafe.');
}
const stlInfo = statSync(stlPath);
if (!stlInfo.isFile() || stlInfo.size !== delivery.bytes || stlInfo.size > MAXIMUM_STL_BYTES) {
  throw new Error('Print fixture size does not match its signed manifest.');
}
const stlBytes = readFileSync(stlPath);
if (sha256(stlBytes) !== delivery.sha256) throw new Error('Print fixture bytes do not match its signed manifest.');
const binary = inspectBinaryStl(stlBytes);

const configuredSlicerBinary = process.env.MORPHLOOM_PRUSASLICER_BINARY?.trim();
const slicerCandidates = [
  configuredSlicerBinary,
  '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
  resolve(homedir(), 'Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer'),
  '/private/tmp/morphloom-prusaslicer-2.9.6/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
].filter((candidate): candidate is string => Boolean(candidate));
const selectedSlicerBinary = slicerCandidates.find((candidate) => existsSync(resolve(candidate)));
if (!selectedSlicerBinary) {
  throw new Error(`PrusaSlicer binary is missing. Checked: ${slicerCandidates.map((candidate) => resolve(candidate)).join(', ')}`);
}
const slicerBinary = resolve(selectedSlicerBinary);
const slicerInfo = statSync(slicerBinary);
if (!slicerInfo.isFile() || slicerInfo.size < 1_000_000 || slicerInfo.size > 1024 * 1024 * 1024) {
  throw new Error('PrusaSlicer binary is missing or outside the executable byte budget.');
}
const help = spawnSync(slicerBinary, ['--help'], { encoding: 'utf8', timeout: 30_000, maxBuffer: MAXIMUM_LOG_BYTES });
const versionMatch = /PrusaSlicer-([0-9][0-9A-Za-z.-]+)/.exec(`${help.stdout}\n${help.stderr}`);
if (help.status !== 0 || !versionMatch) throw new Error('Could not identify the native PrusaSlicer version.');

const infoRun = spawnSync(slicerBinary, ['--info', stlPath], {
  encoding: 'utf8', timeout: 120_000, maxBuffer: MAXIMUM_LOG_BYTES,
});
if (infoRun.status !== 0) throw new Error(`PrusaSlicer --info failed: ${infoRun.stderr.slice(-6_000)}`);
const native = parseInfo(infoRun.stdout);
const blockers: string[] = [];
if (!native.manifold) blockers.push('PrusaSlicer reports a non-manifold mesh.');
if (native.parts !== 1) blockers.push(`PrusaSlicer reports ${native.parts} disconnected parts.`);
if (native.volumeMm3 <= 0) blockers.push('PrusaSlicer reports no positive enclosed volume.');
if (native.facets !== binary.facets) blockers.push(`facet drift ${binary.facets} -> ${native.facets}`);
const boundsErrorMm = Math.max(
  maximumVectorError(native.minimum, binary.minimum),
  maximumVectorError(native.maximum, binary.maximum),
  maximumVectorError(native.size, binary.size),
);
if (boundsErrorMm > 0.001) blockers.push(`native bounds drift ${boundsErrorMm.toFixed(6)} mm exceeds 0.001 mm.`);
if (!(native.size[2]! < native.size[0]! && native.size[2]! < native.size[1]!)) {
  blockers.push('Z-up print profile is not lying on its two largest dimensions.');
}

const dataDirectory = resolve(fixtureDirectory, '.morphloom-prusaslicer-data');
mkdirSync(dataDirectory, { recursive: true });
const gcodePath = resolve(fixtureDirectory, `${fixture.id}.gcode`);
if (existsSync(gcodePath)) unlinkSync(gcodePath);
const sliced = spawnSync(slicerBinary, [
  '--datadir', dataDirectory,
  '--threads', '2',
  '--bed-shape', '0x0,650x0,650x500,0x500',
  '--center', '325,250',
  '--brim-width', '5',
  '--nozzle-diameter', '2',
  '--layer-height', '1',
  '--first-layer-height', '1',
  '--fill-density', '0%',
  '--perimeters', '1',
  '--top-solid-layers', '1',
  '--bottom-solid-layers', '1',
  '--export-gcode',
  '--output', gcodePath,
  stlPath,
], { encoding: 'utf8', timeout: 180_000, maxBuffer: MAXIMUM_LOG_BYTES });
if (sliced.status !== 0 || !existsSync(gcodePath)) {
  blockers.push(`native G-code slicing failed (${String(sliced.status)}, ${String(sliced.signal)}).`);
}
let gcode: { bytes: number; sha256: string | null; layers: number; extrusionMoves: number } = {
  bytes: 0, sha256: null, layers: 0, extrusionMoves: 0,
};
if (existsSync(gcodePath)) {
  const outputInfo = statSync(gcodePath);
  if (!outputInfo.isFile() || outputInfo.size < 1_024 || outputInfo.size > MAXIMUM_GCODE_BYTES) {
    blockers.push('Generated G-code is outside the delivery byte budget.');
  } else {
    const outputBytes = readFileSync(gcodePath);
    const text = outputBytes.toString('utf8');
    const layers = (text.match(/^;LAYER_CHANGE$/gm) ?? []).length;
    const extrusionMoves = (text.match(/^G1\s+[^\r\n]*\bE-?[0-9.]+/gm) ?? []).length;
    if (layers < 2) blockers.push('Generated G-code has fewer than two layers.');
    if (extrusionMoves < 10) blockers.push('Generated G-code has too few extrusion moves.');
    gcode = { bytes: outputInfo.size, sha256: sha256(outputBytes), layers, extrusionMoves };
  }
}

const report = {
  schema: 'morphloom.prusaslicer-print-proof/0.1',
  compilerRevision: manifest.compilerRevision,
  staticDeliveryRevision: STATIC_DELIVERY_REVISION,
  generatedAt: new Date().toISOString(),
  pass: blockers.length === 0,
  status: blockers.length === 0 ? 'pass' : 'blocked',
  source: {
    file: basename(stlPath), bytes: stlInfo.size, sha256: delivery.sha256,
    byteDeterministic: delivery.byteDeterministic, coordinateUnit: delivery.coordinateUnit,
    axisConvention: delivery.axisConvention, binary,
  },
  native: {
    application: 'prusa-slicer', version: versionMatch[1],
    binary: slicerBinary, binarySha256: sha256(readFileSync(slicerBinary)),
    info: native, boundsErrorMm,
    sliceProfile: {
      bedMm: [650, 500], centeredAtMm: [325, 250], brimWidthMm: 5,
      nozzleDiameterMm: 2, layerHeightMm: 1, infillPercent: 0, perimeters: 1,
      coarseValidationProfile: true,
    },
    gcode,
  },
  blockers,
  limitation: 'This proves native manifold reopen and bounded coarse toolpath generation under a declared generic 650 × 500 mm virtual FFF envelope. It is not a production print profile; a real printer, nozzle, filament, tolerances, supports, orientation and safety still require target-machine validation.',
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ reportPath, pass: report.pass, native: report.native.info, gcode }, null, 2));
if (!report.pass) process.exitCode = 1;
