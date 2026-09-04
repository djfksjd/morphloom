import { describe, expect, it } from 'vitest';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { createCaseworkFurnitureIR } from '../src/engine/casework-furniture';
import { auditPartDecomposition } from '../src/engine/part-decomposition';
import * as THREE from 'three';

describe('casework furniture engine', () => {
  const create = () => createCaseworkFurnitureIR({
    name: 'Two drawer holdout fixture', widthMm: 610, depthMm: 430,
    bodyHeightMm: 455, legHeightMm: 190, drawerCount: 2, source: 'locked-four-view-fixture',
  });

  it('compiles independently editable drawers, veneer, hardware, legs, and rear service details', () => {
    const ir = create();
    const ids = new Set(ir.components.map((component) => component.id));
    expect(ids.size).toBe(41);
    for (const expected of [
      'top_slab', 'drawer_1_front', 'drawer_2_box', 'drawer_1_handle',
      'leg_front_left', 'rear_panel', 'rear_fastener_6',
    ]) expect(ids.has(expected)).toBe(true);
    expect(ir.components.find((component) => component.id === 'rear_panel')?.geometry).toMatchObject({
      op: 'extrude', ovalHoles: [{ radii: [14, 14] }],
    });
    expect(ir.components.filter((component) => component.id.includes('_inlay_'))).toHaveLength(12);
    expect(() => compileAssemblyIR(ir, 'beauty')).not.toThrow();
  });

  it('passes its evidence-first part decomposition without hiding repeated parts', () => {
    const ir = create();
    expect(ir.partDecomposition).toBeDefined();
    const audit = auditPartDecomposition(ir.partDecomposition!, ir);
    expect(audit.pass).toBe(true);
    expect(audit.requiredFeatureCoverage).toBe(1);
    expect(audit.mappedComponentCoverage).toBe(1);
  });

  it('rejects unsafe dimensions and drawer counts', () => {
    expect(() => createCaseworkFurnitureIR({
      name: 'invalid', widthMm: 0, depthMm: 430, bodyHeightMm: 455,
      legHeightMm: 190, drawerCount: 2, source: 'fixture',
    })).toThrow(/outside safe bounds/);
  });

  it('honors an evidence-backed overall width and height envelope', () => {
    const ir = createCaseworkFurnitureIR({
      name: 'Measured envelope fixture', widthMm: 610, depthMm: 430,
      bodyHeightMm: 455, legHeightMm: 150, overallHeightMm: 610,
      drawerCount: 2, source: 'measured-datasheet',
    });
    const build = compileAssemblyIR(ir, 'clay');
    const size = new THREE.Box3().setFromObject(build.root).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.61, 4);
    expect(Math.abs(size.y - 0.61)).toBeLessThan(0.002);
    expect(ir.metadata?.requestedEnvelopeHeightMm).toBe(610);
    expect(ir.components.filter((component) => component.id.includes('_inlay_'))
      .every((component) => component.geometry.op === 'extrude')).toBe(true);
  });
});
