import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { DELIVERY_PIPELINE_REVISION } from '../src/engine/delivery-validation';

type Format = 'obj' | 'stl' | 'ply';

interface BlenderStaticReport {
  schema: 'morphloom.blender-static-mesh-audit/0.1';
  status: 'pass';
  blenderVersion: string;
  format: Format;
  source: string;
  sourceBytes: number;
  sourceSha256: string;
  meshes: number;
  vertices: number;
  triangles: number;
  bounds: { min: number[]; max: number[]; size: number[] };
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}.`);
  return value;
}

async function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readReport(format: Format): Promise<{ report: BlenderStaticReport; sourcePath: string }> {
  const reportPath = resolve(argument(`${format}-report`));
  const sourcePath = resolve(argument(`${format}-file`));
  const reportInfo = await stat(reportPath);
  const sourceInfo = await stat(sourcePath);
  if (!reportInfo.isFile() || reportInfo.size < 32 || reportInfo.size > 64 * 1024) throw new Error(`${format} report exceeds its budget.`);
  if (!sourceInfo.isFile() || sourceInfo.size < 32 || sourceInfo.size > 256 * 1024 * 1024) throw new Error(`${format} file exceeds its budget.`);
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as BlenderStaticReport;
  if (report.schema !== 'morphloom.blender-static-mesh-audit/0.1' || report.status !== 'pass' || report.format !== format
    || report.source !== basename(sourcePath) || report.sourceBytes !== sourceInfo.size || report.sourceSha256 !== await sha256(sourcePath)
    || !Number.isInteger(report.triangles) || report.triangles < 1 || !Number.isInteger(report.vertices) || report.vertices < 3
    || !Array.isArray(report.bounds?.size) || report.bounds.size.length !== 3
    || report.bounds.size.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${format} Blender receipt is invalid or does not match its file.`);
  }
  return { report, sourcePath };
}

const formats = await Promise.all((['obj', 'stl', 'ply'] as const).map(readReport));
const assetId = argument('asset-id');
if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(assetId)) throw new Error('Asset id must be a bounded lowercase slug.');
const assetPackPath = resolve(argument('asset-pack'));
const assetPackInfo = await stat(assetPackPath);
if (!assetPackInfo.isFile() || assetPackInfo.size < 1_024 || assetPackInfo.size > 256 * 1024 * 1024) {
  throw new Error('Browser asset pack is outside the 1 KB..256 MB budget.');
}
const assetPackBytes = await readFile(assetPackPath);
const wantedEntries = new Set([
  'metadata/asset-manifest.json',
  'model/morphloom-cad-mesh.obj',
  'model/morphloom-cad-mesh.stl',
  'model/morphloom-static-mesh.ply',
]);
let selectedUnpackedBytes = 0;
const packedFiles = unzipSync(assetPackBytes, {
  filter(entry) {
    if (!wantedEntries.has(entry.name)) return false;
    selectedUnpackedBytes += entry.originalSize;
    if (entry.originalSize > 256 * 1024 * 1024 || selectedUnpackedBytes > 512 * 1024 * 1024) {
      throw new Error('Selected asset-pack entries exceed the unpacked budget.');
    }
    return true;
  },
});
if ([...wantedEntries].some((name) => !packedFiles[name])) throw new Error('Browser asset pack is missing a required delivery entry.');
const manifestBytes = packedFiles['metadata/asset-manifest.json']!;
if (manifestBytes.byteLength > 2 * 1024 * 1024) throw new Error('Browser asset manifest exceeds the 2 MB budget.');
const manifest = JSON.parse(strFromU8(manifestBytes)) as {
  deliveryAudit?: {
    status?: string;
    inputFingerprint?: string;
    source?: { triangles?: number };
    standardValidation?: { status?: string; errors?: number; warnings?: number; independentRead?: { status?: string } };
  };
  staticMeshAudits?: Array<{
    format?: Format;
    status?: string;
    bytes?: number;
    triangleParity?: boolean;
    sourceTriangles?: number;
    reopenedTriangles?: number;
    boundsErrorMm?: number;
    blockers?: string[];
  }>;
};
const expectedTriangles = manifest.deliveryAudit?.source?.triangles;
if (!Number.isInteger(expectedTriangles) || Number(expectedTriangles) < 1 || Number(expectedTriangles) > 10_000_000
  || manifest.deliveryAudit?.status !== 'pass'
  || manifest.deliveryAudit.standardValidation?.status !== 'pass'
  || manifest.deliveryAudit.standardValidation.errors !== 0
  || manifest.deliveryAudit.standardValidation.warnings !== 0
  || manifest.deliveryAudit.standardValidation.independentRead?.status !== 'pass'
  || !/^[a-f0-9]{16}$/.test(manifest.deliveryAudit.inputFingerprint ?? '')) {
  throw new Error('Browser asset-pack GLB receipt is invalid.');
}
const blockers: string[] = [];
const triangleCounts = new Set(formats.map(({ report }) => report.triangles));
if (triangleCounts.size !== 1) blockers.push('OBJ/STL/PLY triangle counts differ after Blender import.');
if (formats.some(({ report }) => report.triangles !== expectedTriangles)) {
  blockers.push(`One or more static formats differ from the browser source count of ${expectedTriangles} triangles.`);
}
for (const format of ['obj', 'stl', 'ply'] as const) {
  const audit = manifest.staticMeshAudits?.find((item) => item.format === format);
  const packedName = format === 'ply' ? 'model/morphloom-static-mesh.ply' : `model/morphloom-cad-mesh.${format}`;
  const packed = packedFiles[packedName]!;
  const external = formats.find(({ report }) => report.format === format)!;
  if (!audit || audit.status !== 'pass' || audit.triangleParity !== true
    || audit.sourceTriangles !== expectedTriangles || audit.reopenedTriangles !== expectedTriangles
    || Number(audit.boundsErrorMm) > 0.1 || (audit.blockers?.length ?? 0) !== 0
    || audit.bytes !== packed.byteLength || sha256Bytes(packed) !== external.report.sourceSha256) {
    blockers.push(`${format.toUpperCase()} browser receipt or packed bytes do not match the Blender-audited file.`);
  }
}
const blenderVersions = new Set(formats.map(({ report }) => report.blenderVersion));
if (blenderVersions.size !== 1) blockers.push('OBJ/STL/PLY were not audited by one Blender version.');
const canonicalSizes = formats.map(({ report }) => [...report.bounds.size].sort((left, right) => left - right));
const baselineSize = canonicalSizes[0]!;
let maximumEnvelopeDriftMm = 0;
for (const size of canonicalSizes.slice(1)) {
  for (let axis = 0; axis < 3; axis += 1) maximumEnvelopeDriftMm = Math.max(maximumEnvelopeDriftMm, Math.abs(size[axis]! - baselineSize[axis]!) * 1_000);
}
if (maximumEnvelopeDriftMm > 0.1) blockers.push(`Static format envelope drift ${maximumEnvelopeDriftMm.toFixed(3)} mm exceeds 0.100 mm.`);

const usdzPath = resolve(argument('usdz-file'));
const usdzInfo = await stat(usdzPath);
if (!usdzInfo.isFile() || usdzInfo.size < 32 || usdzInfo.size > 256 * 1024 * 1024) throw new Error('USDZ file exceeds its budget.');
const usdcheckerBinary = process.env.USD_CHECKER_BINARY || '/usr/bin/usdchecker';
const usdchecker = spawnSync(usdcheckerBinary, [usdzPath], { encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
const usdOutput = `${usdchecker.stdout ?? ''}\n${usdchecker.stderr ?? ''}`;
const usdPass = usdchecker.status === 0 && /Validation Result[\s\S]*Success!/i.test(usdOutput);
if (!usdPass) blockers.push(`usdchecker failed with status ${String(usdchecker.status)}${usdchecker.error ? `: ${usdchecker.error.message}` : ''}.`);

const report = {
  schema: 'morphloom.static-delivery-proof/0.3',
  generatedAt: new Date().toISOString(),
  compilerRevision: DELIVERY_PIPELINE_REVISION,
  assetId,
  expectedSourceTriangles: expectedTriangles,
  assetPack: {
    source: basename(assetPackPath),
    bytes: assetPackInfo.size,
    sha256: sha256Bytes(assetPackBytes),
    inputFingerprint: manifest.deliveryAudit.inputFingerprint,
    browserRoundTrip: 'pass',
  },
  status: blockers.length === 0 ? 'pass' : 'blocked',
  blenderVersion: formats[0]!.report.blenderVersion,
  formats: Object.fromEntries(formats.map(({ report }) => [report.format, {
    source: report.source,
    bytes: report.sourceBytes,
    sha256: report.sourceSha256,
    meshes: report.meshes,
    vertices: report.vertices,
    triangles: report.triangles,
    bounds: report.bounds,
  }])),
  parity: {
    triangles: triangleCounts.size === 1 ? formats[0]!.report.triangles : null,
    maximumAxisNormalizedEnvelopeDriftMm: maximumEnvelopeDriftMm,
  },
  usdz: {
    source: basename(usdzPath),
    bytes: usdzInfo.size,
    sha256: await sha256(usdzPath),
    validator: usdcheckerBinary,
    status: usdPass ? 'pass' : 'blocked',
  },
  blockers,
  limitation: 'OBJ/STL/PLY are static mesh handoffs, not STEP/BREP, rig or PBR interchange. USDZ is Apple AR scene interchange.',
};
const outputPath = resolve(argument('output'));
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (blockers.length > 0) process.exitCode = 1;
