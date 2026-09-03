import { describe, expect, it } from 'vitest';
import {
  applyAssemblyComponentBatchPatch,
  applyAssemblyComponentPatch,
  fingerprintAssemblyIR,
} from '../src/engine/assembly-edit';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from '../src/engine/galaxy-fold8-exterior';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { createOrnateKnifeIR } from '../src/engine/knife';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { analyzeTopology } from '../src/engine/topology';
import { DEFAULT_KNIFE_SPEC } from '../src/types';

describe('isolated AssemblyIR component edits', () => {
  it('moves and refinishes one named component while preserving every other component byte-for-byte', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const inputFingerprint = await fingerprintAssemblyIR(source);
    const result = await applyAssemblyComponentPatch(source, {
      schema: 'morphloom.component-patch/0.1', operationId: 'move-camera-001',
      componentId: 'rear_camera_island', expectedInputFingerprint: inputFingerprint,
      translateMm: [1.25, 0, -0.5], material: { roughness: 0.31, clearcoat: 0.4 },
    });
    expect(result.receipt).toMatchObject({
      componentId: 'rear_camera_island', unaffectedComponentsPreserved: true,
      changedFields: ['position', 'material'], inputFingerprint,
    });
    expect(result.receipt.outputFingerprint).not.toBe(inputFingerprint);
    expect(source).toEqual(GALAXY_Z_FOLD8_EXTERIOR_IR);
  });

  it('rejects stale, empty, missing-target, and unbounded edits', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const expectedInputFingerprint = await fingerprintAssemblyIR(source);
    const base = {
      schema: 'morphloom.component-patch/0.1' as const,
      operationId: 'edit-001', componentId: 'rear_camera_island', expectedInputFingerprint,
    };
    await expect(applyAssemblyComponentPatch(source, { ...base, expectedInputFingerprint: '0'.repeat(64), translateMm: [1, 0, 0] }))
      .rejects.toThrow(/stale/);
    await expect(applyAssemblyComponentPatch(source, base)).rejects.toThrow(/no edit operation/);
    await expect(applyAssemblyComponentPatch(source, { ...base, componentId: 'missing', translateMm: [1, 0, 0] }))
      .rejects.toThrow(/does not exist/);
    await expect(applyAssemblyComponentPatch(source, { ...base, scaleMultiplier: [0, 1, 1] }))
      .rejects.toThrow(/unsafe/);
  });

  it('applies a multi-component recovery atomically while preserving every undeclared component', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const inputFingerprint = await fingerprintAssemblyIR(source);
    const targets = source.components.slice(0, 2).map((component) => component.id);
    const result = await applyAssemblyComponentBatchPatch(source, {
      schema: 'morphloom.component-batch-patch/0.1',
      operationId: 'camera-stack-recovery-001',
      expectedInputFingerprint: inputFingerprint,
      edits: targets.map((componentId, index) => ({
        componentId,
        translateMm: [index + 0.25, 0, 0],
      })),
    });
    expect(result.receipt).toMatchObject({
      editedComponentIds: [...targets].sort(),
      unaffectedComponentsPreserved: true,
      inputFingerprint,
    });
    expect(result.receipt.componentReceipts).toHaveLength(2);
    expect(result.ir.components.filter((component) => !targets.includes(component.id)))
      .toEqual(source.components.filter((component) => !targets.includes(component.id)));
    expect(source).toEqual(GALAXY_Z_FOLD8_EXTERIOR_IR);
  });

  it('rejects duplicate batch targets and leaves the source unchanged after a later edit fails', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const snapshot = structuredClone(source);
    const expectedInputFingerprint = await fingerprintAssemblyIR(source);
    const componentId = source.components[0]!.id;
    await expect(applyAssemblyComponentBatchPatch(source, {
      schema: 'morphloom.component-batch-patch/0.1', operationId: 'duplicate-001', expectedInputFingerprint,
      edits: [{ componentId, translateMm: [1, 0, 0] }, { componentId, translateMm: [2, 0, 0] }],
    })).rejects.toThrow(/duplicated/);
    await expect(applyAssemblyComponentBatchPatch(source, {
      schema: 'morphloom.component-batch-patch/0.1', operationId: 'atomic-001', expectedInputFingerprint,
      edits: [{ componentId, translateMm: [1, 0, 0] }, { componentId: 'missing', translateMm: [1, 0, 0] }],
    })).rejects.toThrow(/does not exist/);
    expect(source).toEqual(snapshot);
  });

  it('edits only declared tube control points and preserves every other point and component', async () => {
    const source = structuredClone(COOLING_ASSEMBLY_IR);
    const tube = source.components.find((component) => component.geometry.op === 'tube')!;
    const originalPoints = structuredClone(tube.geometry.op === 'tube' ? tube.geometry.points : []);
    const expectedInputFingerprint = await fingerprintAssemblyIR(source);
    const result = await applyAssemblyComponentPatch(source, {
      schema: 'morphloom.component-patch/0.1', operationId: 'route-endpoint-001',
      componentId: tube.id, expectedInputFingerprint,
      geometry: { operation: 'tube-point-deltas', deltas: [{ pointIndex: 0, deltaMm: [1, 2, 3] }] },
    });
    const edited = result.ir.components.find((component) => component.id === tube.id)!;
    expect(edited.geometry.op).toBe('tube');
    if (edited.geometry.op !== 'tube') throw new Error('fixture tube changed type');
    expect(edited.geometry.points[0]).toEqual(originalPoints[0]!.map((value, axis) => value + [1, 2, 3][axis]!));
    expect(edited.geometry.points.slice(1)).toEqual(originalPoints.slice(1));
    expect(result.receipt.changedFields).toEqual(['geometry']);
    expect(source).toEqual(COOLING_ASSEMBLY_IR);
  });

  it('rejects tube point edits on incompatible geometry and missing point indices', async () => {
    const source = structuredClone(GALAXY_Z_FOLD8_EXTERIOR_IR);
    const expectedInputFingerprint = await fingerprintAssemblyIR(source);
    const component = source.components.find((entry) => entry.geometry.op !== 'tube')!;
    const base = {
      schema: 'morphloom.component-patch/0.1' as const, operationId: 'bad-route-001',
      componentId: component.id, expectedInputFingerprint,
    };
    await expect(applyAssemblyComponentPatch(source, {
      ...base, geometry: { operation: 'tube-point-deltas', deltas: [{ pointIndex: 0, deltaMm: [1, 0, 0] }] },
    })).rejects.toThrow(/incompatible/);
    const tubeSource = structuredClone(COOLING_ASSEMBLY_IR);
    const tubeFingerprint = await fingerprintAssemblyIR(tubeSource);
    const tube = tubeSource.components.find((entry) => entry.geometry.op === 'tube')!;
    await expect(applyAssemblyComponentPatch(tubeSource, {
      schema: 'morphloom.component-patch/0.1', operationId: 'bad-route-002',
      componentId: tube.id, expectedInputFingerprint: tubeFingerprint,
      geometry: { operation: 'tube-point-deltas', deltas: [{ pointIndex: 4_096, deltaMm: [1, 0, 0] }] },
    })).rejects.toThrow(/missing tube point/);
  });

  it('edits existing extrude, lathe, and blade profile controls without changing topology inventory', async () => {
    const source = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const snapshot = structuredClone(source);
    const expectedInputFingerprint = await fingerprintAssemblyIR(source);
    const result = await applyAssemblyComponentBatchPatch(source, {
      schema: 'morphloom.component-batch-patch/0.1', operationId: 'profile-controls-001',
      expectedInputFingerprint,
      edits: [
        { componentId: 'blade_core', geometry: {
          operation: 'blade-section-deltas', deltas: [{ pointIndex: 9, deltaMm: [4, 0] }],
        } },
        { componentId: 'fuller_front', geometry: {
          operation: 'extrude-point-deltas', deltas: [{ pointIndex: 3, deltaMm: [1, 2] }],
        } },
        { componentId: 'grip_core', geometry: {
          operation: 'lathe-profile-deltas', deltas: [{ pointIndex: 3, deltaMm: [1, 2] }],
        } },
      ],
    });
    const blade = result.ir.components.find((component) => component.id === 'blade_core')!;
    const fuller = result.ir.components.find((component) => component.id === 'fuller_front')!;
    const grip = result.ir.components.find((component) => component.id === 'grip_core')!;
    expect(blade.geometry.op === 'bladeLoft' && blade.geometry.sections[9]).toEqual([330, 0.28]);
    expect(fuller.geometry.op === 'extrude' && fuller.geometry.points[3]).toEqual([1, 294]);
    expect(grip.geometry.op === 'lathe' && grip.geometry.profile[3]).toEqual([16, -23]);
    expect(result.ir.components).toHaveLength(source.components.length);
    expect(result.receipt.unaffectedComponentsPreserved).toBe(true);
    const topology = analyzeTopology(compileAssemblyIR(result.ir, 'beauty').root);
    expect(topology.boundaryEdges).toBe(0);
    expect(topology.nonManifoldEdges).toBe(0);
    expect(topology.degenerateTriangles).toBe(0);
    expect(source).toEqual(snapshot);
  });
});
