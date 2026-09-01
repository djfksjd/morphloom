import type { AssemblyIR } from './assembly-ir';

/** Deterministic material/geometry regression fixture for rough paved surfaces. */
export const ASPHALT_SURFACE_BENCHMARK_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'Rough Asphalt Surface — layered relief benchmark',
  units: 'mm',
  metadata: {
    assetKind: 'product',
    scope: 'surface-material-benchmark',
    evidenceScore: 72,
    sourceBoundary: 'procedural physical appearance test; not a surveyed road sample',
    deterministicSeed: 260901,
  },
  components: [
    {
      id: 'asphalt_core_sample',
      name: 'Coarse hot-mix asphalt sample',
      category: 'mechanical',
      materialName: 'Dense-graded bituminous asphalt with exposed aggregate',
      detail: 'Closed 600 × 450 mm pavement sample with real macro undulation, deterministic coarse and fine angular crushed aggregate, binder troughs, micro-normal grain, spatial roughness variation, and diffuse aggregate colour breakup.',
      geometry: {
        op: 'surfacePatch',
        size: [600, 450],
        baseThickness: 40,
        segments: [192, 144],
        seed: 260901,
        macroAmplitude: 3,
        aggregateAmplitude: 3.5,
        aggregateScale: 15,
      },
      material: {
        color: '#484b4b',
        surface: 'asphalt',
        roughness: 0.94,
        metalness: 0,
        clearcoat: 0,
        specularIntensity: 0.34,
        microNormalStrength: 0.95,
        textureScale: [3, 2.25],
      },
      evidence: {
        status: 'estimated',
        source: 'Morphloom deterministic surface regression fixture',
        notes: [
          'Macro and aggregate amplitudes are authored test parameters, not field measurements.',
          'A calibrated scan or owned reference set is required for site-specific asphalt fidelity.',
        ],
      },
    },
  ],
};
