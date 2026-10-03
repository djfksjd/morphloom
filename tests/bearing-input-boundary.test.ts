import { describe, expect, it } from 'vitest';
import { bearingPack, generateBearingProject } from '../src/engine/bearing-pack';
import { createElementDomainRegistry, DomainPackError } from '../src/engine/element-domain-packs';

const invalid: unknown[] = [null, undefined, [], new Date(0), Object.create({ ballCount: 8 }),
  { ballDiameterMm: null }, { ballDiameterMm: undefined }, { ballDiameterMm: NaN },
  { ballDiameterMm: Infinity }, { ballDiameterMm: 60, outerDiameterMm: 400, boreDiameterMm: 1, widthMm: 90 },
  { boreDiameterMm: 300, outerDiameterMm: 400 }, { widthMm: 0.5, ballDiameterMm: 0.4, boreDiameterMm: 2, outerDiameterMm: 4 },
  { units: undefined }, { units: 'cm' }, { coordinates: 'left-handed-y-up' }, { seed: null }, { seed: -1 }, { extra: true }];

describe('direct bearing generation matches the registered input boundary', () => {
  it.each(invalid.map((input, index) => ({ input, index })))('rejects invalid input $index with the same structured code', ({ input }) => {
    const registry = createElementDomainRegistry(); registry.register(bearingPack);
    for (const run of [() => registry.generate(bearingPack.metadata.id, input), () => generateBearingProject(input as Record<string, unknown>)]) {
      let caught: unknown;
      try { run(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(DomainPackError);
      expect((caught as DomainPackError).code).toBe('invalid-input');
      expect((caught as DomainPackError).packId).toBe(bearingPack.metadata.id);
    }
    expect(registry.generate('morphloom.bird', {}).parts.length).toBeGreaterThan(0);
  });
  it('preserves supported plain/null-prototype records and does not mutate input', () => {
    const plain = { ballCount: 8, seed: 9, units: 'mm', coordinates: 'right-handed-y-up' };
    const snapshot = structuredClone(plain), nullPrototype = Object.assign(Object.create(null), plain);
    expect(generateBearingProject(nullPrototype)).toEqual(generateBearingProject(plain));
    expect(plain).toEqual(snapshot);
    const registry = createElementDomainRegistry(); registry.register(bearingPack);
    expect(registry.generate(bearingPack.metadata.id, plain)).toEqual(generateBearingProject(plain));
  });
});
