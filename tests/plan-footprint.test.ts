import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  auditPlanFootprint,
  type PlanFootprintDescriptor,
  validatePlanFootprintDescriptor,
} from '../src/engine/plan-footprint';

const U_POLYGON_MM: Array<[number, number]> = [
  [0, 0], [10_000, 0], [10_000, 10_000], [7_000, 10_000],
  [7_000, 3_000], [3_000, 3_000], [3_000, 10_000], [0, 10_000],
];

function descriptor(): PlanFootprintDescriptor {
  return {
    schema: 'morphloom.plan-footprint/0.1',
    componentIds: ['plan_carrier'],
    targetRegions: [{ id: 'concave_u_shell', polygonMm: U_POLYGON_MM }],
    voidRegions: [{ id: 'courtyard', boundsMm: [3_000, 3_000, 7_000, 10_000] }],
    resolution: 128,
    minimumIoU: 0.98,
    maximumFalsePositiveFraction: 0.01,
    maximumFalseNegativeFraction: 0.01,
    maximumVoidOccupancy: 0.01,
    evidence: { status: 'measured', source: 'plan fixture A-101', note: 'Measured concave U plan with protected courtyard.' },
  };
}

function addSlab(parent: THREE.Object3D, widthM: number, depthM: number, xM: number, zM: number): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(widthM, 0.1, depthM), new THREE.MeshBasicMaterial());
  mesh.position.set(xM, 0, zM);
  parent.add(mesh);
}

function uPlan(): THREE.Group {
  const root = new THREE.Group();
  const carrier = new THREE.Group();
  carrier.name = 'plan_carrier';
  addSlab(carrier, 10, 3, 5, 1.5);
  addSlab(carrier, 3, 7, 1.5, 6.5);
  addSlab(carrier, 3, 7, 8.5, 6.5);
  root.add(carrier);
  return root;
}

describe('polygon plan-footprint audit', () => {
  it('accepts a concave measured U plan and protects its courtyard', () => {
    const audit = auditPlanFootprint(uPlan(), descriptor());
    expect(audit.pass).toBe(true);
    expect(audit.iou).toBeGreaterThanOrEqual(0.98);
    expect(audit.falsePositiveFraction).toBeLessThanOrEqual(0.01);
    expect(audit.falseNegativeFraction).toBeLessThanOrEqual(0.01);
    expect(audit.voidOccupancy).toEqual([
      expect.objectContaining({ id: 'courtyard', occupiedCells: 0, fraction: 0 }),
    ]);
  });

  it('blocks a model that fills a protected polygon-plan void', () => {
    const root = uPlan();
    const carrier = root.getObjectByName('plan_carrier');
    if (!carrier) throw new Error('missing fixture carrier');
    addSlab(carrier, 4, 7, 5, 6.5);
    const audit = auditPlanFootprint(root, descriptor());
    expect(audit.pass).toBe(false);
    expect(audit.falsePositiveFraction).toBeGreaterThan(0.01);
    expect(audit.voidOccupancy[0]?.fraction).toBeGreaterThan(0.99);
    expect(audit.blockers.some((blocker) => blocker.startsWith('void courtyard occupancy'))).toBe(true);
  });

  it('rejects self-intersecting polygons before raster or ray allocation', () => {
    const invalid = descriptor();
    invalid.targetRegions = [{
      id: 'bow_tie',
      polygonMm: [[0, 0], [10_000, 10_000], [0, 10_000], [10_000, 0]],
    }];
    expect(() => validatePlanFootprintDescriptor(invalid)).toThrow(/regions are invalid/);
  });
});
