import type { AssemblyIR } from './assembly-ir';

/** Editable organic-form regression case for Surface Nets and CSG delivery. */
export const IMPLICIT_SURFACE_BENCHMARK_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'Implicit Surface Lab — smooth union and recessed socket',
  units: 'mm',
  metadata: {
    assetKind: 'product',
    scope: 'implicit-surface-benchmark',
    evidenceBoundary: 'Procedural topology regression; dimensions and form are not a physical product claim.',
  },
  components: [{
    id: 'organic_shell',
    name: 'Organic shell with recessed socket',
    category: 'mechanical',
    materialName: 'molded rubber',
    detail: 'Two blended lobes with a real subtractive socket; Surface Nets resolves ambiguous cells within a bounded deterministic refinement window.',
    geometry: {
      op: 'implicitSurface',
      descriptor: {
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
      },
    },
    material: {
      color: '#6f4738',
      surface: 'rubber',
      roughness: 0.72,
      metalness: 0,
      microNormalStrength: 0.24,
      textureScale: [4, 4],
    },
    evidence: {
      status: 'estimated',
      source: 'deterministic implicit-surface regression fixture',
      notes: ['Use for topology/export verification, not source likeness or manufacturing approval.'],
    },
  }],
};
