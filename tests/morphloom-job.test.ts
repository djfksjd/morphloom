import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import { fingerprintAssemblyIR } from '../src/engine/assembly-edit';
import { buildSemiProfessionalEvidencePack } from '../src/engine/evidence-readiness';
import type { ReferenceView } from '../src/engine/reference-set';
import { inspectMorphloomJob, runMorphloomJob, type MorphloomJob } from '../scripts/lib/morphloom-job';

mkdirSync(resolve('tmp'), { recursive: true });
const sourceRoot = mkdtempSync(resolve('tmp/morphloom-source-'));
const sourcePath = resolve(sourceRoot, 'fixture-drawing.png');
const sourceCanvas = createCanvas(2, 2);
sourceCanvas.getContext('2d').fillRect(0, 0, 2, 2);
const sourceBytes = new Uint8Array(sourceCanvas.toBuffer('image/png'));
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
writeFileSync(sourcePath, sourceBytes);
afterAll(() => rmSync(sourceRoot, { recursive: true, force: true }));

const drawing: ReferenceView = {
  id: 'source-drawing',
  assetKind: 'product',
  url: 'blob:source-drawing',
  fileName: 'fixture-drawing.png',
  fileSize: sourceBytes.byteLength,
  mimeType: 'image/png',
  lastModified: 1,
  role: 'measurement',
  coveredRoles: ['front', 'rear', 'left', 'right', 'material'],
  capabilities: ['shape', 'depth', 'scale', 'surface', 'interfaces'],
  sourceType: 'technical-drawing',
  evidence: {
    fileName: 'fixture-drawing.png',
    width: 2,
    height: 2,
    averageColor: '#777777',
    brightness: 0.5,
    portraitSuitability: 96,
    notes: ['test fixture'],
  },
};

const evidencePack = buildSemiProfessionalEvidencePack([drawing], {
  profile: 'product-visualization',
  dimensions: [{
    id: 'body-width', property: 'body_width', valueMm: 80, toleranceMm: 0.1,
    status: 'measured', sourceViewId: drawing.id,
  }],
  sourceAudits: [{
    viewId: drawing.id,
    provenance: 'professional-drawing',
    geometryConsistency: 'verified',
    dimensionLegibility: 'verified',
  }],
});

const assembly: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'standard-job-fixture',
  units: 'mm',
  components: [{
    id: 'body',
    name: 'Fixture body',
    category: 'enclosure',
    materialName: 'molded polymer',
    detail: 'independently editable review fixture',
    geometry: { op: 'roundedBox', size: [80, 50, 12], radius: 2, segments: 3 },
    material: { color: '#777777', surface: 'molded-polymer', roughness: 0.58, metalness: 0 },
    evidence: { status: 'estimated', source: 'drawing outline' },
  }],
  dimensionContracts: [{
    id: 'body-width',
    label: 'Body width',
    target: { kind: 'component', componentId: 'body' },
    axis: 'x',
    measurement: 'size',
    space: 'component-local',
    expectedMm: 80,
    toleranceMm: 0.1,
    evidence: { status: 'measured', sourceViewId: 'view_01', source: 'fixture drawing' },
  }],
};

function job(target: MorphloomJob['target']): MorphloomJob {
  return {
    schema: 'morphloom.job/0.1',
    id: `fixture-${target}`,
    request: '실측 도면으로 편집 가능한 제품 검토 모델을 만들어줘',
    target,
    sources: [{
      viewId: 'view_01',
      path: relative(process.cwd(), sourcePath),
      sha256: sourceSha256,
    }],
    evidencePack: structuredClone(evidencePack),
    assembly: structuredClone(assembly),
  };
}

describe('standard Morphloom job runner', () => {
  it('exports and independently validates byte-deterministic review GLB bytes', async () => {
    const result = await runMorphloomJob(job('review'));
    expect(result).toMatchObject({
      status: 'review-pass',
      releaseAllowed: false,
      byteDeterministic: true,
      validation: { status: 'pass', errors: 0, independentRead: { status: 'pass', meshes: 1 } },
    });
    expect(result.glb?.byteLength).toBeGreaterThan(1_000);
    expect(result.glbSha256).toBe(result.repeatGlbSha256);
  });

  it('does not relabel a review asset as delivery-ready without locked detail contracts', async () => {
    const result = await runMorphloomJob(job('delivery'));
    expect(result.status).toBe('blocked');
    expect(result.glb).toBeUndefined();
    expect(result.blockers).toEqual(expect.arrayContaining([
      'locked fidelity contract is required',
      'evidence-first part decomposition contract is required',
    ]));
  });

  it('applies a source-fingerprinted component edit and preserves a receipt', async () => {
    const editedJob = job('review');
    editedJob.patches = [{
      schema: 'morphloom.component-patch/0.1',
      operationId: 'raise-body',
      componentId: 'body',
      expectedInputFingerprint: await fingerprintAssemblyIR(editedJob.assembly),
      translateMm: [0, 12, 0],
    }];
    const { inspection, assembly: resolved } = await inspectMorphloomJob(editedJob);
    expect(inspection.patchReceipts).toHaveLength(1);
    expect(inspection.patchReceipts[0]).toMatchObject({
      componentId: 'body', unaffectedComponentsPreserved: true, changedFields: ['position'],
    });
    expect(resolved.components[0].position).toEqual([0, 12, 0]);
  });

  it('rejects a stale edit fingerprint before compiling geometry', async () => {
    const editedJob = job('review');
    editedJob.patches = [{
      schema: 'morphloom.component-patch/0.1',
      operationId: 'stale-edit',
      componentId: 'body',
      expectedInputFingerprint: 'a'.repeat(64),
      translateMm: [0, 12, 0],
    }];
    await expect(inspectMorphloomJob(editedJob)).rejects.toThrow('stale AssemblyIR fingerprint');
  });

  it('provides one fixed CLI command that writes a real GLB and machine-readable receipt', () => {
    mkdirSync(resolve('tmp'), { recursive: true });
    const root = mkdtempSync(resolve('tmp/morphloom-cli-'));
    try {
      const jobPath = resolve(root, 'job.json');
      const outputPath = resolve(root, 'result');
      writeFileSync(jobPath, JSON.stringify(job('review')), 'utf8');
      const run = spawnSync(resolve('node_modules/.bin/vite-node'), [
        'scripts/morphloom.ts', 'build',
        '--job', relative(process.cwd(), jobPath),
        '--out', relative(process.cwd(), outputPath),
      ], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 });
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(existsSync(resolve(outputPath, 'asset.glb'))).toBe(true);
      expect(readFileSync(resolve(outputPath, 'asset.glb')).byteLength).toBeGreaterThan(1_000);
      const report = JSON.parse(readFileSync(resolve(outputPath, 'run-report.json'), 'utf8')) as MorphloomJobResult;
      expect(report).toMatchObject({ status: 'review-pass', byteDeterministic: true, releaseAllowed: false });
      expect(report.glb).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('blocks a relabelled or changed source before geometry is compiled', async () => {
    const changed = job('review');
    changed.sources[0].sha256 = '0'.repeat(64);
    const result = await runMorphloomJob(changed);
    expect(result.status).toBe('blocked');
    expect(result.sourceAudit.pass).toBe(false);
    expect(result.blockers).toContain('source view_01 SHA-256 mismatch');
    expect(result.glb).toBeUndefined();
  });
});
