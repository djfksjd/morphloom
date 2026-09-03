import { describe, expect, it } from 'vitest';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { createCaseworkFurnitureIR } from '../src/engine/casework-furniture';
import { auditPartDecomposition } from '../src/engine/part-decomposition';

describe('casework furniture engine', () => {
  const create = () => createCaseworkFurnitureIR({
    name: 'Two drawer holdout fixture', widthMm: 610, depthMm: 430,
    bodyHeightMm: 455, legHeightMm: 190, drawerCount: 2, source: 'locked-four-view-fixture',
  });

  it('compiles independently editable drawers, veneer, hardware, legs, and rear service details', () => {
    const ir = create();
    const ids = new Set(ir.components.map((component) => component.id));
    expect(ids.size).toBe(39);
    for (const expected of [
      'top_slab', 'drawer_1_front', 'drawer_2_box', 'drawer_1_handle',
      'leg_front_left', 'rear_panel', 'rear_fastener_6',
    ]) expect(ids.has(expected)).toBe(true);
    expect(ir.components.find((component) => component.id === 'rear_panel')?.geometry).toMatchObject({
      op: 'extrude', ovalHoles: [{ radii: [14, 14] }],
    });
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
});
