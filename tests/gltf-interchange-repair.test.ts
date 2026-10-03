import { mkdtemp, readFile, rm, writeFile, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Accessor, Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, type Iridescence, KHRMaterialsIridescence } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';

async function fixture(options: { alpha: 'OPAQUE' | 'BLEND'; iridescence: number; nodeName: string }): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document.createAccessor('positions')
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indices = document.createAccessor('indices')
    .setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const material = document.createMaterial(options.alpha === 'BLEND' ? 'source-glass' : 'blender-glass')
    .setAlphaMode(options.alpha)
    .setBaseColorFactor([0.2, 0.4, 0.7, 1])
    .setRoughnessFactor(0.21);
  if (options.iridescence > 0) {
    const extension = document.createExtension(KHRMaterialsIridescence);
    material.setExtension('KHR_materials_iridescence', extension.createIridescence()
      .setIridescenceFactor(options.iridescence));
  }
  const uv = document.createAccessor('uv').setType(Accessor.Type.VEC2)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer);
  const normal = document.createAccessor('normal').setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer);
  const unusedTangent = document.createAccessor('unused tangent').setType(Accessor.Type.VEC4)
    .setArray(new Float32Array([2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1])).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute('POSITION', positions).setAttribute('NORMAL', normal)
    .setAttribute('TEXCOORD_0', uv).setAttribute('TANGENT', unusedTangent).setIndices(indices).setMaterial(material);
  const mesh = document.createMesh('fixture-mesh').addPrimitive(primitive);
  const node = document.createNode(options.nodeName).setMesh(mesh)
    .setExtras({ morphloomStableNodeId: 'stable-part' });
  document.createScene('fixture-scene').addChild(node);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
}

describe('glTF interchange material recovery', () => {
  it.each(['report-input', 'report-source', 'report-output', 'existing-output', 'existing-report', 'symlink-report', 'missing-report-parent', 'canonical-output-alias'])('rejects %s without overwriting input or leaving partial output', async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), 'morphloom-interchange-preserve-'));
    try {
      const input = join(directory, 'input.glb');
      const source = join(directory, 'source.glb');
      const output = join(directory, 'output.glb');
      let report = join(directory, 'receipt.json');
      const original = await fixture({ alpha: 'OPAQUE', iridescence: 0, nodeName: 'stable-part' });
      await Promise.all([writeFile(input, original), writeFile(source, original)]);
      if (kind === 'report-input') report = input;
      if (kind === 'report-source') report = source;
      if (kind === 'report-output') report = output;
      if (kind === 'existing-output') await writeFile(output, 'user output');
      if (kind === 'existing-report') await writeFile(report, 'user receipt');
      if (kind === 'symlink-report') await symlink(input, report);
      if (kind === 'missing-report-parent') report = join(directory, 'absent', 'receipt.json');
      if (kind === 'canonical-output-alias') { await symlink(directory, join(directory, 'alias')); report = join(directory, 'alias', 'output.glb'); }
      const result = spawnSync(process.execPath, [resolve('node_modules/vite-node/vite-node.mjs'), resolve('scripts/repair-glb-interchange.ts'), input, output, report, source], { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      expect(result.status, result.stderr || result.stdout).not.toBe(0);
      expect(new Uint8Array(await readFile(input))).toEqual(original);
      expect(new Uint8Array(await readFile(source))).toEqual(original);
      if (kind === 'existing-output') expect(await readFile(output, 'utf8')).toBe('user output');
      else await expect(access(output)).rejects.toThrow();
      if (kind === 'existing-report') expect(await readFile(report, 'utf8')).toBe('user receipt');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each([false, true])('rolls back only owned files after a late report conflict (output replaced: %s)', async (replaceOutput) => {
    const directory = await mkdtemp(join(tmpdir(), 'morphloom-interchange-race-'));
    try {
      const input = join(directory, 'input.glb');
      const output = join(directory, 'output.glb');
      const report = join(directory, 'receipt.json');
      const hook = join(directory, 'controlled-race.mjs');
      const original = await fixture({ alpha: 'OPAQUE', iridescence: 0, nodeName: 'stable-part' });
      await writeFile(input, original);
      // Only the test process simulates another writer at the actual publication boundary.
      await writeFile(hook, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const nativeOpen = fs.openSync;
fs.openSync = function(path, flags, ...args) {
  if (path === ${JSON.stringify(report)} && flags === 'wx') {
    fs.writeFileSync(path, 'concurrent receipt');
    ${replaceOutput ? `fs.renameSync(${JSON.stringify(output)}, ${JSON.stringify(output + '.owned')}); fs.writeFileSync(${JSON.stringify(output)}, 'concurrent output');` : ''}
  }
  return nativeOpen.call(this, path, flags, ...args);
}; syncBuiltinESMExports();`);
      const result = spawnSync(process.execPath, ['--import', hook, resolve('node_modules/vite-node/vite-node.mjs'), resolve('scripts/repair-glb-interchange.ts'), input, output, report], { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      expect(result.status, result.stderr || result.stdout).not.toBe(0);
      expect(new Uint8Array(await readFile(input))).toEqual(original);
      expect(await readFile(report, 'utf8')).toBe('concurrent receipt');
      if (replaceOutput) expect(await readFile(output, 'utf8')).toBe('concurrent output');
      else await expect(access(output)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('restores source optical PBR semantics by stable part id after a DCC rename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morphloom-interchange-'));
    try {
      const sourcePath = join(directory, 'source.glb');
      const editedPath = join(directory, 'edited.glb');
      const outputPath = join(directory, 'delivery.glb');
      const reportPath = join(directory, 'receipt.json');
      await Promise.all([
        writeFile(sourcePath, await fixture({ alpha: 'BLEND', iridescence: 0.64, nodeName: 'stable-part' })),
        writeFile(editedPath, await fixture({ alpha: 'OPAQUE', iridescence: 0, nodeName: 'Mesh_0' })),
      ]);
      const result = spawnSync(process.execPath, [
        resolve('node_modules/vite-node/vite-node.mjs'),
        resolve('scripts/repair-glb-interchange.ts'),
        editedPath,
        outputPath,
        reportPath,
        sourcePath,
      ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
      const output = await io.readBinary(new Uint8Array(await readFile(outputPath)));
      const node = output.getRoot().listNodes().find((candidate) => candidate.getMesh());
      const material = node?.getMesh()?.listPrimitives()[0]?.getMaterial();
      const iridescence = material?.getExtension<Iridescence>('KHR_materials_iridescence');
      expect(node?.getName()).toBe('stable-part');
      expect(material?.getName()).toBe('source-glass');
      expect(material?.getAlphaMode()).toBe('BLEND');
      expect(material?.getRoughnessFactor()).toBeCloseTo(0.21, 6);
      expect(iridescence?.getIridescenceFactor()).toBeCloseTo(0.64, 6);
      // An untextured material does not authorize discarding editable UVs.
      const primitive = node?.getMesh()?.listPrimitives()[0];
      expect(Array.from(primitive?.getAttribute('TEXCOORD_0')?.getArray() ?? [])).toEqual([0, 0, 1, 0, 0, 1]);
      expect(Array.from(primitive?.getAttribute('NORMAL')?.getArray() ?? [])).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
      expect(primitive?.getAttribute('TANGENT')).toBeNull();

      const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
        pass: boolean;
        restoredMaterials: number;
        materialSourceSha256: string | null;
        validation: { status: string; errors: number; warnings: number };
      };
      expect(report).toMatchObject({
        pass: true,
        restoredMaterials: 1,
        validation: { status: 'pass', errors: 0, warnings: 0 },
      });
      expect(report.materialSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
