import { gearPack, generateSpurGearProject } from '../../src/engine/gear-pack';
import { editPart, migrateElementProjectToV6 } from '../../src/engine/element-project';
import type { DomainPack } from '../../src/engine/element-domain-packs';

// Declarative composition of existing engine operations, not measured metal or CAD.
export const surfaceGearPack: DomainPack = {
  metadata: {
    ...structuredClone(gearPack.metadata),
    version: 'morphloom.domain-pack/0.4',
    id: 'example.surface-gear.visual',
    representation: { id: 'morphloom.elements/0.6', mode: 'native' },
    dependencies: { engineApi: '0.4' },
    capabilities: [...gearPack.metadata.capabilities, 'native-uv-scaling', 'authored-roughness-surface'],
    parameters: { seed: 'uint-safe-integer', dimensions: {
      ...gearPack.metadata.parameters.dimensions,
      uvScale: { min: .001, max: 1000, default: 100 },
      surfaceRepeat: { min: .125, max: 1024, default: 8 }
    } },
    parameterNotes: [...gearPack.metadata.parameterNotes!,
      'UV scale multiplies native UVs; repeat is per UV tile, not measured texel density.',
      'Authored roughness-only metal recipe; normal map, manufacturing and atlas approval are unsupported.']
  },
  generate(input) {
    const { uvScale = 100, surfaceRepeat = 8, ...gearInput } = input;
    const p = migrateElementProjectToV6(generateSpurGearProject(gearInput));
    const part = p.parts[0];
    return editPart(p, part.id, {
      uvScale: uvScale as number,
      material: { ...part.material!, surface: {
        finish: 'brushed-metal', channels: 'roughness-only',
        repeat: [surfaceRepeat as number, surfaceRepeat as number]
      } }
    });
  }
};
