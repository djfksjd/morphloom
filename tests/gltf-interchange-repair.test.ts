import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  const primitive = document.createPrimitive().setAttribute('POSITION', positions).setIndices(indices).setMaterial(material);
  const mesh = document.createMesh('fixture-mesh').addPrimitive(primitive);
  const node = document.createNode(options.nodeName).setMesh(mesh)
    .setExtras({ morphloomStableNodeId: 'stable-part' });
  document.createScene('fixture-scene').addChild(node);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
}

describe('glTF interchange material recovery', () => {
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
