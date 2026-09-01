import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { DELIVERY_PIPELINE_REVISION } from '../src/engine/delivery-validation';

interface FixtureManifest {
  pass: boolean;
  compilerRevision: string;
  results: Array<{
    id: string;
    domain: string;
    bytes: number;
    sha256: string;
    repeatSha256: string;
    byteDeterministic: boolean;
    preparation: { tangentSpacesGenerated: number; unresolvedNormalMappedMeshes: string[] };
    validation: { status: string; errors: number; warnings: number };
  }>;
}

interface BlenderReport {
  pass: boolean;
  blenderVersion: string;
  sourceSha256: string;
  roundTripSha256: string;
  boundsErrorMm: number;
  boundsToleranceMm: number;
  geometryParity: boolean;
  imageParity: boolean;
  skinningParity: boolean;
  imported: Record<string, unknown>;
  reopened: Record<string, unknown>;
}

interface RepairReport {
  pass: boolean;
  outputSha256: string;
  repairedTangents: number;
  removedUnusedTangentAccessors: number;
  validation: { status: string; errors: number; warnings: number; infos: number };
}

const fixtureDirectoryArgument = process.argv[2];
if (!fixtureDirectoryArgument) {
  throw new Error('Usage: npm run benchmark:blender-cross-domain -- <fixture-directory> [report.json]');
}
const fixtureDirectory = resolve(fixtureDirectoryArgument);
const reportPath = resolve(process.argv[3] ?? 'benchmarks/blender-cross-domain-latest.json');
const manifest = JSON.parse(readFileSync(resolve(fixtureDirectory, 'manifest.json'), 'utf8')) as FixtureManifest;
if (!manifest.pass || manifest.compilerRevision !== DELIVERY_PIPELINE_REVISION || manifest.results.length !== 5
  || manifest.results.some((result) => !result.byteDeterministic || result.sha256 !== result.repeatSha256)) {
  throw new Error('Cross-domain fixture manifest is incomplete or nondeterministic.');
}
const requiredDomains = new Set(['architecture', 'industrial-design', 'electronics', 'animation-game', '3d-printing']);
if (new Set(manifest.results.map((result) => result.domain)).size !== requiredDomains.size
  || manifest.results.some((result) => !requiredDomains.has(result.domain))) {
  throw new Error('Cross-domain fixture coverage is incomplete.');
}

const blenderScript = resolve('scripts/blender-glb-roundtrip.py');
const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
const repairScript = resolve('scripts/repair-glb-interchange.ts');
const blenderBinary = process.env.MORPHLOOM_BLENDER_BINARY || 'blender';
const cases = [];
for (const fixture of manifest.results) {
  if (!/^[a-z0-9-]{1,80}$/.test(fixture.id)) throw new Error(`Unsafe fixture id: ${fixture.id}`);
  const source = resolve(fixtureDirectory, `${fixture.id}.glb`);
  const rawRoundTrip = resolve(fixtureDirectory, `${fixture.id}.blender.glb`);
  const blenderReportPath = resolve(fixtureDirectory, `${fixture.id}.blender.json`);
  const repaired = resolve(fixtureDirectory, `${fixture.id}.blender.repaired.glb`);
  const repairReportPath = resolve(fixtureDirectory, `${fixture.id}.repair.json`);
  const blender = spawnSync(blenderBinary, [
    '--background', '--python-exit-code', '1', '--python', blenderScript, '--',
    source, rawRoundTrip, blenderReportPath,
  ], { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  if (blender.status !== 0) {
    throw new Error([
      `Blender failed for ${fixture.id} (status ${String(blender.status)}, signal ${String(blender.signal)}).`,
      `stdout:\n${blender.stdout.slice(-4_000)}`,
      `stderr:\n${blender.stderr.slice(-4_000)}`,
    ].join('\n'));
  }
  const rawBytes = readFileSync(rawRoundTrip);
  const rawStandard = await validateGlbStandard(
    rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength) as ArrayBuffer,
  );
  const repair = spawnSync(process.execPath, [viteNode, repairScript, rawRoundTrip, repaired, repairReportPath], {
    encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
  });
  if (repair.status !== 0) {
    throw new Error([
      `Interchange repair failed for ${fixture.id} (status ${String(repair.status)}, signal ${String(repair.signal)}).`,
      `stdout:\n${repair.stdout.slice(-4_000)}`,
      `stderr:\n${repair.stderr.slice(-4_000)}`,
    ].join('\n'));
  }
  const blenderReport = JSON.parse(readFileSync(blenderReportPath, 'utf8')) as BlenderReport;
  const repairReport = JSON.parse(readFileSync(repairReportPath, 'utf8')) as RepairReport;
  if (!blenderReport.pass || blenderReport.sourceSha256 !== fixture.sha256 || !repairReport.pass) {
    throw new Error(`Cross-domain delivery proof mismatch for ${fixture.id}.`);
  }
  cases.push({
    id: fixture.id,
    domain: fixture.domain,
    pass: true,
    source: {
      bytes: fixture.bytes,
      sha256: fixture.sha256,
      byteDeterministic: fixture.byteDeterministic,
      standard: fixture.validation,
      portableTangents: fixture.preparation.tangentSpacesGenerated,
    },
    blender: {
      version: blenderReport.blenderVersion,
      semanticRoundTrip: {
        pass: blenderReport.pass,
        geometryParity: blenderReport.geometryParity,
        imageParity: blenderReport.imageParity,
        skinningParity: blenderReport.skinningParity,
        boundsErrorMm: blenderReport.boundsErrorMm,
        boundsToleranceMm: blenderReport.boundsToleranceMm,
        imported: blenderReport.imported,
        reopened: blenderReport.reopened,
      },
      rawReexportStandard: rawStandard,
      deliveryRepair: {
        applied: rawStandard.status !== 'pass' || rawStandard.infos > 0,
        repairedTangents: repairReport.repairedTangents,
        removedUnusedTangentAccessors: repairReport.removedUnusedTangentAccessors,
        outputSha256: repairReport.outputSha256,
        standard: repairReport.validation,
      },
    },
  });
  console.log(`${fixture.id}: Blender semantic pass · final Khronos pass`);
}

const report = {
  schema: 'morphloom.blender-cross-domain-proof/0.1',
  compilerRevision: manifest.compilerRevision,
  generatedAt: new Date().toISOString(),
  pass: cases.length === 5 && cases.every((item) => item.pass),
  scope: 'actual Blender import, export, reopen, semantic parity, and exact repaired-byte validation',
  cases,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Wrote ${reportPath}`);
