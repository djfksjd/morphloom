import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { polygonizeImplicitSurface, validateImplicitSurfaceDescriptor, type ImplicitSurfaceDescriptor } from '../src/engine/implicit-surface';
import { analyzeTopology } from '../src/engine/topology';

const sphere: ImplicitSurfaceDescriptor = {
  bounds: { min: [-100, -100, -100], max: [100, 100, 100] },
  resolution: 24,
  triangleBudget: 50_000,
  primitives: [{ id: 'ball', type: 'sphere', radius: 60 }],
  output: 'ball',
};

describe('bounded implicit surface engine', () => {
  it('creates a deterministic smooth closed sphere instead of a voxel shell', () => {
    const first = polygonizeImplicitSurface(sphere);
    const second = polygonizeImplicitSurface(structuredClone(sphere));
    expect(first.geometry.getAttribute('position').array).toEqual(second.geometry.getAttribute('position').array);
    expect(first.geometry.getIndex()?.array).toEqual(second.geometry.getIndex()?.array);
    expect(analyzeTopology(new THREE.Mesh(first.geometry))).toMatchObject({
      pass: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0,
    });
    expect(first.enclosedVolumeMm3).toBeGreaterThan(0);
    expect(first.outwardFaceCoverage).toBeGreaterThanOrEqual(0.995);
    const position = first.geometry.getAttribute('position');
    const radii = Array.from({ length: position.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index).length());
    expect(radii.reduce((sum, value) => sum + value, 0) / radii.length).toBeCloseTo(60, 0);
    expect(Math.max(...radii.map((radius) => Math.abs(radius - 60)))).toBeLessThan(6);
    const step = 200 / sphere.resolution;
    const onGrid = Array.from(position.array).filter((value) => {
      const fraction = ((value + 100) / step) % 1;
      return Math.min(fraction, 1 - fraction) < 1e-5;
    }).length / position.array.length;
    expect(onGrid).toBeLessThan(0.5);
    first.geometry.dispose();
    second.geometry.dispose();
  });

  it('supports smooth unions and subtractive cavities as one editable operation graph', () => {
    const result = polygonizeImplicitSurface({
      bounds: { min: [-130, -100, -100], max: [130, 100, 100] },
      resolution: 32,
      triangleBudget: 100_000,
      primitives: [
        { id: 'left', type: 'sphere', radius: 58, transform: { position: [-38, 0, 0] } },
        { id: 'right', type: 'sphere', radius: 58, transform: { position: [38, 0, 0] } },
        { id: 'socket', type: 'sphere', radius: 20, transform: { position: [0, 36, 0] } },
      ],
      operations: [
        { id: 'body', type: 'smooth-union', left: 'left', right: 'right', radius: 24 },
        { id: 'body_with_socket', type: 'subtract', left: 'body', right: 'socket' },
      ],
      output: 'body_with_socket',
    });
    expect(result).toMatchObject({
      requestedResolution: 32,
      primitiveCount: 3, operationCount: 2, outputNode: 'body_with_socket',
    });
    expect(result.refinementSteps).toBeGreaterThan(0);
    expect(result.refinementSteps).toBeLessThanOrEqual(4);
    expect(result.resolution).toBe(result.requestedResolution + result.refinementSteps);
    expect(result.triangleCount).toBeGreaterThan(1_000);
    expect(result.enclosedVolumeMm3).toBeGreaterThan(0);
    expect(result.outwardFaceCoverage).toBeGreaterThanOrEqual(0.995);
    expect(analyzeTopology(new THREE.Mesh(result.geometry)).pass).toBe(true);
    result.geometry.dispose();
  });

  it('fails closed on unsafe graphs, clipped bounds, and insufficient triangle budgets', () => {
    expect(() => validateImplicitSurfaceDescriptor({ ...sphere, resolution: 128 })).toThrow(/resolution/);
    expect(() => validateImplicitSurfaceDescriptor({
      ...sphere,
      operations: [{ id: 'bad', type: 'subtract', left: 'missing', right: 'ball' }],
    })).toThrow(/unavailable node/);
    expect(() => polygonizeImplicitSurface({
      ...sphere, bounds: { min: [-50, -50, -50], max: [50, 50, 50] },
    })).toThrow(/intersects its sampling bounds/);
    expect(() => polygonizeImplicitSurface({ ...sphere, triangleBudget: 1 })).toThrow(/triangle budget exceeded/);
  });

  it('compiles millimetre-space implicit geometry into a named AssemblyIR delivery mesh', () => {
    const build = compileAssemblyIR({
      schema: 'morphloom.assembly/0.1', name: 'implicit delivery fixture', units: 'mm',
      components: [{
        id: 'organic_shell', name: 'Organic shell', category: 'mechanical', materialName: 'rubber',
        detail: 'Smooth evidence-bounded implicit form', geometry: { op: 'implicitSurface', descriptor: sphere },
        material: { color: '#665544', surface: 'rubber', microNormalStrength: 0.2 },
        evidence: { status: 'estimated', source: 'bounded implicit fixture' },
      }],
    }, 'beauty');
    const mesh = build.root.getObjectByName('organic_shell') as THREE.Mesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry.userData.implicitSurfaceEvidence).toMatchObject({
      schema: 'morphloom.implicit-surface/0.1', primitiveCount: 1, operationCount: 0,
    });
    expect(mesh.geometry.userData.implicitSurfaceEvidence.enclosedVolumeMm3).toBeGreaterThan(0);
    expect(mesh.geometry.userData.implicitSurfaceEvidence.outwardFaceCoverage).toBeGreaterThanOrEqual(0.995);
    expect(new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).x).toBeCloseTo(0.12, 2);
    expect(build.metrics.topology.pass).toBe(true);
  });
});
