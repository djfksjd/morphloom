import { DEFAULT_PARAMS, type ElementProject, type Part, type Vec3, type Group, validateProject } from './element-project.js';

const evidence = { status: 'authored' as const, source: 'Original Morphloom demo geometry; illustrative, not anatomy validation.' };
function part(id: string, position: Vec3, scale: Vec3, shape: Part['shape'] = 'ellipsoid', color = '#805b40', rotation: Vec3 = [0, 0, 0]): Part {
  return { id, name: id, position, rotation, scale, shape, color, evidence, visible: true, locked: false };
}
function group(id: string, count: number, rotation: Vec3, fan: number, values: Partial<Group['params']>, kind: Group['kind'] = 'feather'): Group {
  return { id, regionId: `${id}_region`, kind, count, distribution: 'ellipsoid-surface', root: [0, 0, 0], spread: [0, 0, 0], rotation, fan,
    params: { ...DEFAULT_PARAMS, ...values }, overrides: {}, deleted: [], evidence };
}
function base(seed: number, parts: Part[], groups: Group[], owners: string[]): ElementProject {
  return validateProject({ schema: 'morphloom.elements/0.1', seed, units: 'mm', coordinates: 'right-handed-y-up', parts,
    regions: groups.map((g, i) => ({ id: g.regionId, partId: owners[i], name: g.id })), groups, elements: [] });
}
export function createBirdProject(seed = 42): ElementProject {
  const parts = [
    part('body', [0, 90, 0], [55, 75, 110]), part('head', [0, 145, 45], [40, 40, 40]),
    part('eye_left', [-19, 151, 58], [8, 8, 8], 'ellipsoid', '#171717'),
    part('eye_right', [19, 151, 58], [8, 8, 8], 'ellipsoid', '#171717'),
    part('beak_upper', [0, 138, 85], [17, 35, 10], 'beak', '#e4a334', [Math.PI / 2, 0, 0]),
    part('beak_lower', [0, 127, 82], [15, 30, 7], 'beak', '#d58c26', [Math.PI / 2, 0, 0]),
    part('wing_left', [-32, 105, -5], [20, 12, 72]), part('wing_right', [32, 105, -5], [20, 12, 72]),
    part('tail', [0, 72, -65], [30, 15, 48]), part('leg_left', [-23, 35, -12], [8, 50, 8]),
    part('leg_right', [23, 35, -12], [8, 50, 8]), part('foot_left', [-23, 7, 10], [15, 7, 32]),
    part('foot_right', [23, 7, 10], [15, 7, 32])
  ];
  const groups = [
    group('left_primary', 12, [0.6, 0, 0.4], 0.045, { length: 65, width: 9, curvature: 0.2 }),
    group('right_primary', 12, [0.6, 0, -0.4], -0.045, { length: 65, width: 9, curvature: 0.2 }),
    group('tail_feathers', 12, [-0.8, 0, 0], 0.035, { length: 45, width: 7, curvature: 0.1 }),
    group('body_feathers', 50, [-0.9, 0, 0], 0.025, { length: 14, width: 5, curvature: 0.3 })
  ];
  return base(seed, parts, groups, ['wing_left', 'wing_right', 'tail', 'body']);
}
export function createFurProject(seed = 42): ElementProject {
  const groups = [group('body_fur', 50, [0.3, 0, 0], 0.08,
    { length: 16, width: 1, thickness: 0.5, curvature: 0.12 }, 'strand')];
  return base(seed, [part('animal_body', [0, 65, 0], [55, 55, 95])], groups, ['animal_body']);
}
