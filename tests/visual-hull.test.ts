import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { carveVisualHull, validateVisualHullDescriptor, visualHullToBufferGeometry, type VisualHullDescriptor } from '../src/engine/visual-hull';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';

function solidMask(size: number): string[] {
  return Array.from({ length: size }, () => '1'.repeat(size));
}

function discMask(size: number): string[] {
  const center = (size - 1) / 2;
  const radius = size * 0.45;
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (
    (x - center) ** 2 + (y - center) ** 2 <= radius ** 2 ? '1' : '0'
  )).join(''));
}

function descriptor(views: VisualHullDescriptor['views'], resolution = 8): VisualHullDescriptor {
  return {
    projection: 'orthographic',
    boundsSpace: 'component-local',
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    resolution,
    triangleBudget: 400_000,
    views,
  };
}

function edgeCounts(indices: Uint32Array): { boundary: number; nonManifold: number } {
  const edges = new Map<string, number>();
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index], indices[index + 1], indices[index + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return {
    boundary: [...edges.values()].filter((count) => count === 1).length,
    nonManifold: [...edges.values()].filter((count) => count > 2).length,
  };
}

describe('visual hull space carving', () => {
  it('produces a deterministic welded watertight boundary from three silhouettes', () => {
    const input = descriptor(['front', 'side', 'top'].map((axis) => ({ axis: axis as 'front' | 'side' | 'top', confidence: 0.9, mask: discMask(16) })));
    const first = carveVisualHull(input);
    const second = carveVisualHull(structuredClone(input));
    expect(first.positions).toEqual(second.positions);
    expect(first.indices).toEqual(second.indices);
    expect(first.status).toBe('carved');
    expect(first.occupiedFraction).toBeGreaterThan(0.15);
    expect(first.occupiedFraction).toBeLessThan(0.75);
    expect(first.unconstrainedAxes).toEqual([]);
    expect(first.viewAgreement).toHaveLength(3);
    expect(first.minimumViewIoU).toBeGreaterThan(0.8);
    expect(first.confidenceWeightedIoU).toBeGreaterThan(0.8);
    expect(edgeCounts(first.indices)).toEqual({ boundary: 0, nonManifold: 0 });
    const geometry = visualHullToBufferGeometry(first);
    expect(geometry.getAttribute('normal').count).toBe(first.positions.length / 3);
    geometry.dispose();
  });

  it('intersects every view and reports a loose axis for two views', () => {
    const half = Array.from({ length: 16 }, () => '0'.repeat(8) + '1'.repeat(8));
    const full = carveVisualHull(descriptor([
      { axis: 'front', confidence: 1, mask: solidMask(16) },
      { axis: 'side', confidence: 1, mask: solidMask(16) },
    ]));
    const carved = carveVisualHull(descriptor([
      { axis: 'front', confidence: 1, mask: half },
      { axis: 'side', confidence: 1, mask: solidMask(16) },
    ]));
    expect(carved.occupiedVoxelCount / full.occupiedVoxelCount).toBeCloseTo(0.5, 1);
    expect(carved.unconstrainedAxes).toEqual(['y']);
    expect(carved.limitations.join(' ')).toMatch(/loose/);
  });

  it('returns explicit empty evidence and rejects unsafe descriptors', () => {
    const left = Array.from({ length: 16 }, () => '1'.repeat(8) + '0'.repeat(8));
    const right = Array.from({ length: 16 }, () => '0'.repeat(8) + '1'.repeat(8));
    const empty = carveVisualHull(descriptor([
      { axis: 'front', confidence: 1, mask: left },
      { axis: 'top', confidence: 1, mask: right },
    ]));
    expect(empty).toMatchObject({ status: 'empty', occupiedVoxelCount: 0, triangleCount: 0 });
    expect(() => validateVisualHullDescriptor(descriptor([{ axis: 'front', confidence: 1, mask: solidMask(16) }]))).toThrow(/two or three/);
    expect(() => validateVisualHullDescriptor({ ...descriptor([
      { axis: 'front', confidence: 1, mask: solidMask(16) },
      { axis: 'side', confidence: 1, mask: solidMask(16) },
    ]), resolution: 64 })).toThrow(/resolution/);
    expect(() => validateVisualHullDescriptor({ ...descriptor([
      { axis: 'front', confidence: 1, mask: solidMask(16) },
      { axis: 'side', confidence: 1, mask: solidMask(16) },
    ]), silhouetteToleranceVoxels: 3 })).toThrow(/silhouetteToleranceVoxels/);
    expect(() => validateVisualHullDescriptor(descriptor([
      { axis: 'front', confidence: 0, mask: solidMask(16) },
      { axis: 'side', confidence: 1, mask: solidMask(16) },
    ]))).toThrow(/confidence.*\(0, 1\]/);
  });

  it('uses a bounded tolerance for one-voxel calibration disagreement and reports the residual projection error', () => {
    const left = Array.from({ length: 16 }, () => '1'.repeat(8) + '0'.repeat(8));
    const right = Array.from({ length: 16 }, () => '0'.repeat(8) + '1'.repeat(8));
    const strict = carveVisualHull(descriptor([
      { axis: 'front', confidence: 1, mask: left },
      { axis: 'top', confidence: 1, mask: right },
    ]));
    const tolerant = carveVisualHull({
      ...descriptor([
        { axis: 'front', confidence: 1, mask: left },
        { axis: 'top', confidence: 1, mask: right },
      ]),
      silhouetteToleranceVoxels: 1,
    });
    expect(strict.status).toBe('empty');
    expect(tolerant.status).toBe('carved');
    expect(tolerant.minimumViewIoU).toBeLessThan(0.75);
    expect(tolerant.limitations.join(' ')).toMatch(/dilated.*require review/);
    expect(tolerant.viewAgreement.every((view) => view.falsePositiveFraction <= 0.5)).toBe(true);
  });

  it('maps the first image rows to positive world y', () => {
    const topHalf = [...Array.from({ length: 8 }, () => '1'.repeat(16)), ...Array.from({ length: 8 }, () => '0'.repeat(16))];
    const result = carveVisualHull(descriptor([
      { axis: 'front', confidence: 1, mask: topHalf },
      { axis: 'side', confidence: 1, mask: solidMask(16) },
    ]));
    const ys = Array.from(result.positions).filter((_, index) => index % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });

  it('compiles visualHull as a real AssemblyIR geometry operation in millimetres', () => {
    const hull = descriptor([
      { axis: 'front', confidence: 1, mask: solidMask(8) },
      { axis: 'side', confidence: 1, mask: solidMask(8) },
    ]);
    hull.bounds = { min: [-500, -250, -100], max: [500, 250, 100] };
    const build = compileAssemblyIR({
      schema: 'morphloom.assembly/0.1',
      name: 'visual-hull-fixture',
      units: 'mm',
      components: [{
        id: 'carved-shell', name: 'Carved shell', category: 'enclosure', materialName: 'shell',
        detail: 'Two-view deterministic visual hull', geometry: { op: 'visualHull', descriptor: hull },
        material: { color: '#445566', surface: 'molded-polymer' },
        evidence: { status: 'estimated', source: 'test-silhouettes' },
      }],
    }, 'beauty');
    const mesh = build.root.getObjectByName('carved-shell');
    expect(mesh).toBeDefined();
    expect(build.root.userData.assemblyIR.components[0].geometry.op).toBe('visualHull');
    const evidence = (mesh as THREE.Mesh).geometry.userData.visualHullEvidence;
    expect(evidence.minimumViewIoU).toBe(1);
    expect(evidence.viewAgreement).toHaveLength(2);
    expect(build.metrics.topology.pass).toBe(true);
    expect(build.metrics.parts).toBe(1);
  });
});
