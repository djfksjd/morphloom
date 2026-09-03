import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateGlbStandard, type GltfStandardValidation } from '../src/engine/gltf-standard-validation';
import { DELIVERY_PIPELINE_REVISION } from '../src/engine/delivery-validation';
import { auditRiggedGlbPayload } from './lib/rigged-payload-audit';

type Domain = 'architecture' | 'industrial-design' | 'electronics' | 'animation-game' | '3d-printing';

interface FixtureManifest {
  pass: boolean;
  compilerRevision: string;
  results: Array<{
    id: string;
    domain: Domain;
    file: string;
    bytes: number;
    sha256: string;
    byteDeterministic: boolean;
    validation: GltfStandardValidation;
  }>;
}

interface EditAuditReceipt {
  schema: string;
  pass: boolean;
  blockers: string[];
  warnings: string[];
  input: { sha256: string };
  output: { path: string; bytes: number; sha256: string };
  stabilityOutput: { path: string; bytes: number; sha256: string };
  edit: Record<string, unknown> & { component: string; kind: string };
  meshCount: number;
  unchangedMeshes: number;
  maximumUnchangedCenterDriftMm: number;
  maximumUnchangedSizeDriftMm: number;
  topologyChanges: unknown[];
  stabilityChanges: unknown[];
  runtime: { armatures: number; actions: number; preserved: boolean };
  limitation: string;
}

interface RepairReceipt {
  pass: boolean;
  outputSha256: string;
  repairedTangents: number;
  removedUnusedTangentAccessors: number;
  restoredMaterials: number;
  materialSourceSha256: string | null;
  validation: GltfStandardValidation;
}

interface EditCase {
  fixtureId: string;
  domain: Domain;
  component: string;
  operationArguments: string[];
  purpose: string;
}

const EDIT_CASES: EditCase[] = [
  {
    fixtureId: 'laurel-homes-architecture',
    domain: 'architecture',
    component: 'west_north_window_1',
    operationArguments: ['50', '0', '0'],
    purpose: 'Move one named window 50 mm while preserving 320 other building meshes.',
  },
  {
    fixtureId: 'ornate-knife-product',
    domain: 'industrial-design',
    component: 'pommel_gem',
    operationArguments: ['0', '5', '0'],
    purpose: 'Move one pommel ornament 5 mm without blunting or reshaping the blade.',
  },
  {
    fixtureId: 'cooling-electronics-assembly',
    domain: 'electronics',
    component: 'power_usb_c',
    operationArguments: ['3', '0', '0'],
    purpose: 'Move one USB-C connector 3 mm while preserving the remaining assembly and wiring meshes.',
  },
  {
    fixtureId: 'field-human-runtime',
    domain: 'animation-game',
    component: 'hair_cap',
    operationArguments: ['0', '5', '0'],
    purpose: 'Move the separate hair mesh 5 mm while preserving the body skin, rig, and animation inventory.',
  },
  {
    fixtureId: 'asphalt-print-surface',
    domain: '3d-printing',
    component: 'asphalt_core_sample',
    operationArguments: ['local-relief', '1.5', '0.18', '0.57', '0.43'],
    purpose: 'Raise only a bounded center patch by up to 1.5 mm while preserving watertight topology and UVs.',
  },
];

const fixtureDirectoryArgument = process.argv[2];
if (!fixtureDirectoryArgument) {
  throw new Error('Usage: npm run benchmark:blender-cross-domain-edit -- <fixture-directory> [report.json]');
}
const fixtureDirectory = resolve(fixtureDirectoryArgument);
const reportPath = resolve(process.argv[3] ?? 'benchmarks/blender-cross-domain-edit-latest.json');
const editDirectory = resolve(fixtureDirectory, 'component-edits');
const blenderBinary = process.env.MORPHLOOM_BLENDER_BINARY || 'blender';
const blenderScript = resolve('scripts/blender-component-edit-audit.py');
const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
const repairScript = resolve('scripts/repair-glb-interchange.ts');
const manifestPath = resolve(fixtureDirectory, 'manifest.json');

function assertInside(directory: string, path: string): void {
  const prefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  if (!path.startsWith(prefix)) throw new Error(`Path escapes the benchmark directory: ${path}`);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command: string, arguments_: string[], label: string): void {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error([
      `${label} failed (status ${String(result.status)}, signal ${String(result.signal)}).`,
      `stdout:\n${result.stdout.slice(-4_000)}`,
      `stderr:\n${result.stderr.slice(-4_000)}`,
    ].join('\n'));
  }
}

if (!existsSync(manifestPath)) throw new Error(`Fixture manifest not found: ${manifestPath}`);
if (!existsSync(blenderScript)) throw new Error(`Blender audit script not found: ${blenderScript}`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest;
if (!manifest.pass || manifest.compilerRevision !== DELIVERY_PIPELINE_REVISION) {
  throw new Error('Cross-domain fixture manifest is incomplete or stale. Regenerate fixtures first.');
}
if (EDIT_CASES.length !== 5 || new Set(EDIT_CASES.map((item) => item.domain)).size !== 5) {
  throw new Error('The edit benchmark must contain exactly one case for every required domain.');
}
mkdirSync(editDirectory, { recursive: true });

const results: Array<Record<string, unknown>> = [];
for (const editCase of EDIT_CASES) {
  const fixture = manifest.results.find((item) => item.id === editCase.fixtureId && item.domain === editCase.domain);
  if (!fixture) {
    results.push({ ...editCase, pass: false, error: 'Matching deterministic fixture is missing.' });
    continue;
  }
  try {
    if (!fixture.byteDeterministic || fixture.validation.status !== 'pass') {
      throw new Error('Source fixture is not deterministic and delivery-valid.');
    }
    const sourcePath = resolve(fixtureDirectory, `${editCase.fixtureId}.glb`);
    assertInside(fixtureDirectory, sourcePath);
    if (!existsSync(sourcePath) || sha256(sourcePath) !== fixture.sha256) {
      throw new Error('Source fixture bytes do not match the locked manifest hash.');
    }
    const rawOutput = resolve(editDirectory, `${editCase.fixtureId}.edited.glb`);
    const receiptPath = resolve(editDirectory, `${editCase.fixtureId}.edit.json`);
    const stabilityOutput = resolve(editDirectory, `${editCase.fixtureId}.edited-stability.glb`);
    const deliveryOutput = resolve(editDirectory, `${editCase.fixtureId}.edited.delivery.glb`);
    const repairReceiptPath = resolve(editDirectory, `${editCase.fixtureId}.repair.json`);
    for (const path of [rawOutput, receiptPath, stabilityOutput, deliveryOutput, repairReceiptPath]) {
      assertInside(editDirectory, path);
    }

    run(blenderBinary, [
      '--background', '--python-exit-code', '1', '--python', blenderScript, '--',
      sourcePath, rawOutput, receiptPath, editCase.component, ...editCase.operationArguments,
    ], `${editCase.fixtureId} Blender component edit`);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as EditAuditReceipt;
    if (!receipt.pass || receipt.schema !== 'morphloom.blender-component-edit-audit/0.2') {
      throw new Error(`Blender edit audit failed: ${receipt.blockers.join('; ') || 'invalid receipt'}`);
    }
    if (receipt.input.sha256 !== fixture.sha256 || receipt.edit.component !== editCase.component) {
      throw new Error('Blender edit receipt does not match the locked source or requested component.');
    }
    if (!receipt.runtime.preserved) throw new Error('Rig or animation inventory was not preserved.');

    const rawBytes = readFileSync(rawOutput);
    const stabilityBytes = readFileSync(stabilityOutput);
    const [rawValidation, stabilityValidation] = await Promise.all([
      validateGlbStandard(rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength) as ArrayBuffer),
      validateGlbStandard(stabilityBytes.buffer.slice(
        stabilityBytes.byteOffset,
        stabilityBytes.byteOffset + stabilityBytes.byteLength,
      ) as ArrayBuffer),
    ]);
    run(process.execPath, [
      viteNode, repairScript, rawOutput, deliveryOutput, repairReceiptPath, sourcePath,
    ], `${editCase.fixtureId} interchange and material recovery`);
    const repair = JSON.parse(readFileSync(repairReceiptPath, 'utf8')) as RepairReceipt;
    if (!repair.pass || repair.validation.status !== 'pass') throw new Error('Interchange repair did not produce a valid GLB.');
    if (repair.materialSourceSha256 !== fixture.sha256
      || repair.restoredMaterials !== fixture.validation.independentRead.materials) {
      throw new Error('Portable PBR material recovery did not restore the locked source inventory.');
    }
    const finalPath = deliveryOutput;
    const finalBytes = readFileSync(finalPath);
    const finalValidation = await validateGlbStandard(
      finalBytes.buffer.slice(finalBytes.byteOffset, finalBytes.byteOffset + finalBytes.byteLength) as ArrayBuffer,
    );
    if (finalValidation.status !== 'pass' || finalValidation.independentRead.status !== 'pass') {
      throw new Error('Final edited delivery is not Khronos-valid and independently readable.');
    }
    const sourceInventory = fixture.validation.independentRead;
    const finalInventory = finalValidation.independentRead;
    const inventoryKeys = ['nodes', 'meshes', 'materials', 'animations'] as const;
    const inventoryPreserved = inventoryKeys.every((key) => sourceInventory[key] === finalInventory[key]);
    if (!inventoryPreserved) throw new Error('Final edit changed the portable scene inventory.');
    const riggedPayload = editCase.domain === 'animation-game'
      ? await auditRiggedGlbPayload(new Uint8Array(readFileSync(sourcePath)), new Uint8Array(finalBytes))
      : null;
    if (riggedPayload && !riggedPayload.pass) {
      throw new Error(`Rigged payload changed: ${riggedPayload.blockers.join('; ')}`);
    }

    results.push({
      id: editCase.fixtureId,
      domain: editCase.domain,
      purpose: editCase.purpose,
      pass: true,
      source: { file: basename(sourcePath), bytes: fixture.bytes, sha256: fixture.sha256 },
      edit: receipt.edit,
      isolation: {
        meshCount: receipt.meshCount,
        unchangedMeshes: receipt.unchangedMeshes,
        maximumUnchangedCenterDriftMm: receipt.maximumUnchangedCenterDriftMm,
        maximumUnchangedSizeDriftMm: receipt.maximumUnchangedSizeDriftMm,
        topologyChangeCount: receipt.topologyChanges.length,
        stabilityChangeCount: receipt.stabilityChanges.length,
      },
      runtime: receipt.runtime,
      riggedPayload,
      rawValidation,
      stabilityValidation,
      finalDelivery: {
        file: basename(finalPath),
        bytes: finalBytes.byteLength,
        sha256: sha256(finalPath),
        repairApplied: true,
        repair: {
          repairedTangents: repair.repairedTangents,
          removedUnusedTangentAccessors: repair.removedUnusedTangentAccessors,
          restoredMaterials: repair.restoredMaterials,
          materialSourceSha256: repair.materialSourceSha256,
        },
        inventoryPreserved,
        validation: finalValidation,
      },
      warnings: receipt.warnings,
      limitation: receipt.limitation,
    });
    console.log(`${editCase.fixtureId}: isolated edit + Blender reopen + final GLB pass`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ id: editCase.fixtureId, domain: editCase.domain, purpose: editCase.purpose, pass: false, error: message });
    console.error(`${editCase.fixtureId}: ${message}`);
  }
}

const report = {
  schema: 'morphloom.blender-cross-domain-edit-proof/0.1',
  compilerRevision: manifest.compilerRevision,
  generatedAt: new Date().toISOString(),
  pass: results.length === EDIT_CASES.length && results.every((item) => item.pass === true),
  scope: 'five-domain named or bounded-local edits, two Blender reopen cycles, non-target semantic invariants, and exact final GLB validation',
  cases: results,
  claimBoundary: 'This proves these five concrete edits. It does not prove arbitrary sculpting, CAD feature history, shader graph parity, or artistic approval.',
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Wrote ${reportPath}`);
if (!report.pass) process.exitCode = 1;
