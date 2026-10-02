import type { ElementProject } from './element-project.js';
import { validateProject } from './element-project.js';
import { createBirdProject, createFurProject } from './bird-element-demo.js';

export const DOMAIN_PACK_VERSION = 'morphloom.domain-pack/0.1' as const;
export type DomainPackErrorCode = 'invalid-pack' | 'duplicate-pack' | 'unsupported' | 'invalid-input' | 'invalid-project' | 'provider-error';

export class DomainPackError extends Error {
  constructor(readonly code: DomainPackErrorCode, readonly packId: string) {
    super(`${code}: ${packId}`);
    this.name = 'DomainPackError';
  }
}

interface DomainPackMetadataBase {
  id: string;
  domain: string;
  status: 'experimental';
  capabilities: string[];
  units: 'mm';
  coordinates: 'right-handed-y-up';
  parameters: { seed: 'uint-safe-integer'; dimensions: Record<string, { min: number; max: number; default: number }> };
  constraints: { maxElements: 5000 };
  operations: ['generate'];
  tools: ['generic-inspector'];
  evidencePaths: string[];
  parameterNotes?: string[];
  exportAdapters: [
    { id: 'source-json'; editing: 'full' },
    { id: 'baked-glb'; editing: 'baked-only' }
  ];
}

/** API compatibility and source schema are independent only in the new contract. */
export type DomainPackMetadata = DomainPackMetadataBase & (
  | { version: typeof DOMAIN_PACK_VERSION; representation: { id: 'morphloom.elements/0.1'; mode: 'native' }; dependencies: { engineApi: '0.1' } }
  | { version: 'morphloom.domain-pack/0.2'; representation: { id: 'morphloom.elements/0.2'; mode: 'native' }; dependencies: { engineApi: '0.2' } }
  | { version: 'morphloom.domain-pack/0.3'; representation: { id: 'morphloom.elements/0.3'; mode: 'native' }; dependencies: { engineApi: '0.3' } }
  | { version: 'morphloom.domain-pack/0.4'; representation: { id: ElementProject['schema']; mode: 'native' }; dependencies: { engineApi: '0.4' } }
);

const nativeSchemas: readonly ElementProject['schema'][] = [
  'morphloom.elements/0.1', 'morphloom.elements/0.2', 'morphloom.elements/0.3',
  'morphloom.elements/0.4', 'morphloom.elements/0.5', 'morphloom.elements/0.6'
];

export interface DomainPack {
  metadata: DomainPackMetadata;
  generate(input: Readonly<Record<string, unknown>>): ElementProject;
}

const idPattern = /^[A-Za-z0-9]+(?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const copy = <T>(value: T): T => structuredClone(value);

function checkMetadata(m: DomainPackMetadata): void {
  const fail = (): never => { throw new DomainPackError('invalid-pack', String(m?.id ?? 'unknown')); };
  if (!m || ![DOMAIN_PACK_VERSION, 'morphloom.domain-pack/0.2', 'morphloom.domain-pack/0.3', 'morphloom.domain-pack/0.4'].includes(m.version) || typeof m.id !== 'string' || !idPattern.test(m.id) ||
      typeof m.domain !== 'string' || !m.domain.trim() || m.status !== 'experimental' ||
      (m.version === 'morphloom.domain-pack/0.4'
        ? !nativeSchemas.includes(m.representation?.id)
        : m.representation?.id !== ('morphloom.elements/'+m.version.split('/')[1])) || m.representation.mode !== 'native' ||
      m.units !== 'mm' || m.coordinates !== 'right-handed-y-up' ||
      m.constraints?.maxElements !== 5000 || m.dependencies?.engineApi !== m.version.split('/')[1] ||
      !Array.isArray(m.capabilities) || !m.capabilities.every(x => typeof x === 'string' && x.length > 0) ||
      new Set(m.capabilities).size !== m.capabilities.length ||
      !Array.isArray(m.operations) || m.operations.length !== 1 || m.operations[0] !== 'generate' ||
      !Array.isArray(m.tools) || m.tools.length !== 1 || m.tools[0] !== 'generic-inspector' ||
      m.parameters?.seed !== 'uint-safe-integer' || !record(m.parameters.dimensions) ||
      !Object.values(m.parameters.dimensions).every(d => record(d) &&
        (['min', 'max', 'default'] as const).every(k => typeof d[k] === 'number' && Number.isFinite(d[k])) &&
        (d.min as number) <= (d.default as number) && (d.default as number) <= (d.max as number)) ||
      (m.parameterNotes !== undefined && (m.version === DOMAIN_PACK_VERSION || !Array.isArray(m.parameterNotes) || m.parameterNotes.length > 8 || !m.parameterNotes.every(x => typeof x === 'string' && x.length <= 256))) ||
      !Array.isArray(m.evidencePaths) || !m.evidencePaths.every(x => typeof x === 'string') ||
      !Array.isArray(m.exportAdapters) || m.exportAdapters.length !== 2 ||
      m.exportAdapters[0]?.id !== 'source-json' || m.exportAdapters[0].editing !== 'full' ||
      m.exportAdapters[1]?.id !== 'baked-glb' || m.exportAdapters[1].editing !== 'baked-only') fail();
  try { copy(m); } catch { fail(); }
}

function checkInput(input: unknown, m: DomainPackMetadata): Record<string, unknown> {
  function fail(): never { throw new DomainPackError('invalid-input', m.id); }
  if (!record(input) || Object.keys(input).length > 10) fail();
  const allowed = new Set(['seed', 'units', 'coordinates', ...Object.keys(m.parameters.dimensions)]);
  if (Object.keys(input).some(k => !allowed.has(k)) ||
      (own(input, 'units') && input.units !== 'mm') ||
      (own(input, 'coordinates') && input.coordinates !== 'right-handed-y-up') ||
      (own(input, 'seed') && (!Number.isSafeInteger(input.seed) || (input.seed as number) < 0))) fail();
  for (const [key, bounds] of Object.entries(m.parameters.dimensions)) {
    if (own(input, key) && (typeof input[key] !== 'number' ||
        !Number.isFinite(input[key]) || (input[key] as number) < bounds.min ||
        (input[key] as number) > bounds.max)) fail();
  }
  return input;
}

export class ElementDomainRegistry {
  private readonly packs = new Map<string, DomainPack>();

  register(pack: DomainPack): void {
    checkMetadata(pack?.metadata);
    const id = pack.metadata.id;
    if (this.packs.size >= 256) throw new DomainPackError('invalid-pack', id);
    if (this.packs.has(id)) throw new DomainPackError('duplicate-pack', id);
    if (typeof pack.generate !== 'function') throw new DomainPackError('invalid-pack', id);
    this.packs.set(id, { metadata: copy(pack.metadata), generate: pack.generate });
  }

  list(): ReadonlyArray<DomainPackMetadata> {
    return [...this.packs.values()].map(p => copy(p.metadata))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  generate(id: string, input: unknown, requiredCapabilities: readonly string[] = []): ElementProject {
    const pack = this.packs.get(id);
    if (!pack) throw new DomainPackError('unsupported', id);
    if (!Array.isArray(requiredCapabilities) ||
        requiredCapabilities.some(c => !pack.metadata.capabilities.includes(c)))
      throw new DomainPackError('unsupported', id);
    const checked = checkInput(input, pack.metadata);
    let project: ElementProject;
    try { project = copy(pack.generate(copy(checked))); }
    catch (error) {
      if (error instanceof DomainPackError && error.code === 'invalid-input') throw new DomainPackError('invalid-input', id);
      throw new DomainPackError('provider-error', id);
    }
    try {
      validateProject(project);
      if (project.schema !== pack.metadata.representation.id) throw new Error('Representation mismatch');
    } catch { throw new DomainPackError('invalid-project', id); }
    return project;
  }
}

const builtin = (id: string, domain: string): DomainPackMetadata => ({
  version: DOMAIN_PACK_VERSION, id, domain, status: 'experimental',
  capabilities: ['generate', 'semantic-part-editing', 'selected-scene-export'],
  representation: { id: 'morphloom.elements/0.1', mode: 'native' },
  units: 'mm', coordinates: 'right-handed-y-up',
  parameters: { seed: 'uint-safe-integer', dimensions: {} },
  constraints: { maxElements: 5000 }, operations: ['generate'], tools: ['generic-inspector'],
  evidencePaths: ['parts.*.evidence'],
  exportAdapters: [{ id: 'source-json', editing: 'full' }, { id: 'baked-glb', editing: 'baked-only' }],
  dependencies: { engineApi: '0.1' }
});

export function createElementDomainRegistry(): ElementDomainRegistry {
  const registry = new ElementDomainRegistry();
  registry.register({ metadata: builtin('morphloom.bird', 'bird'),
    generate: input => createBirdProject((input.seed as number | undefined) ?? 42) });
  registry.register({ metadata: builtin('morphloom.fur', 'fur'),
    generate: input => createFurProject((input.seed as number | undefined) ?? 42) });
  return registry;
}
