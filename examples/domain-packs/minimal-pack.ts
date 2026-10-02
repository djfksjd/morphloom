import type { ElementProject } from '../../src/engine/element-project.js';
import type { DomainPack } from '../../src/engine/element-domain-packs.js';

// A closed visual sphere, not a mechanically accurate bearing assembly.
export const minimalPack: DomainPack = {
  metadata: {
    version: 'morphloom.domain-pack/0.1', id: 'bearing.ball.preview',
    domain: 'mechanical-visualization', status: 'experimental',
    capabilities: ['generate', 'semantic-part-editing', 'selected-scene-export'],
    representation: { id: 'morphloom.elements/0.1', mode: 'native' },
    units: 'mm', coordinates: 'right-handed-y-up',
    parameters: { seed: 'uint-safe-integer', dimensions: {
      diameterMm: { min: 0.1, max: 100, default: 8 }
    } },
    constraints: { maxElements: 5000 }, operations: ['generate'],
    tools: ['generic-inspector'], evidencePaths: ['parts.*.evidence'],
    exportAdapters: [
      { id: 'source-json', editing: 'full' },
      { id: 'baked-glb', editing: 'baked-only' }
    ],
    dependencies: { engineApi: '0.1' }
  },
  generate(input) {
    const diameter = (input.diameterMm as number | undefined) ?? 8;
    return {
      schema: 'morphloom.elements/0.1', seed: (input.seed as number | undefined) ?? 42,
      units: 'mm', coordinates: 'right-handed-y-up',
      parts: [{ id: 'bearing_ball', name: 'bearing_ball', position: [0, 0, 0],
        rotation: [0, 0, 0], scale: [diameter, diameter, diameter],
        shape: 'ellipsoid', color: '#b8bec6',
        evidence: { status: 'authored', source: 'minimal-pack' },
        visible: true, locked: false }],
      regions: [], groups: [], elements: []
    } as ElementProject;
  }
};
