import { describe, expect, it } from 'vitest';
import { buildElementScene, exportSelectedScene } from '../src/engine/element-renderer.js';
import { createElementDomainRegistry, DomainPackError } from '../src/engine/element-domain-packs.js';
import { editPart, ElementHistory } from '../src/engine/element-project.js';
import { minimalPack } from '../examples/domain-packs/minimal-pack.js';

describe('element domain packs', () => {
  it('lists detached metadata and generates default builtins', () => {
    const registry = createElementDomainRegistry();
    const listing = registry.list();
    expect(listing.map(p => p.id)).toEqual(['morphloom.bird', 'morphloom.fur']);
    listing[0]!.capabilities.push('invented');
    expect(registry.list()[0]!.capabilities).not.toContain('invented');
    expect(registry.generate('morphloom.bird', {}).seed).toBe(42);
    expect(registry.generate('morphloom.fur', {}).seed).toBe(42);
  });

  it('registers a second-domain sphere without changing core', () => {
    const registry = createElementDomainRegistry();
    registry.register(minimalPack);
    const ball = registry.generate('bearing.ball.preview', { diameterMm: 8 },
      ['semantic-part-editing', 'selected-scene-export']);
    expect(ball.parts[0]?.id).toBe('bearing_ball');
    const preview = buildElementScene(ball, 'low');
    const exported = exportSelectedScene(ball, ['bearing_ball']);
    try { expect(preview.root.children[0].name).toBe('bearing_ball'); expect(exported.root.children[0].name).toBe('bearing_ball'); } finally { preview.dispose(); exported.dispose(); }
    const history = new ElementHistory(ball);
    history.commit(editPart(ball, 'bearing_ball', { position: [10,0,0] }));
    expect(history.current.parts[0].position[0]).toBe(10);
    expect(history.undo().parts[0].position[0]).toBe(0);
    expect(registry.generate('bearing.ball.preview', {}).parts[0]!.position[0]).toBe(0);
  });

  it('rejects conflicts, unsupported capabilities and duplicate registration', () => {
    const registry = createElementDomainRegistry();
    registry.register(minimalPack);
    expect(() => registry.register(minimalPack)).toThrow(DomainPackError);
    for (const input of [{ units: 'cm' }, { coordinates: 'z-up' }, { seed: -1 },
      { diameterMm: 101 }]) {
      expect(() => registry.generate('bearing.ball.preview', input)).toThrow(DomainPackError);
    }
    expect(() => registry.generate('bearing.ball.preview', {}, ['nurbs']))
      .toThrow(DomainPackError);
  });

  it('isolates a throwing provider', () => {
    const registry = createElementDomainRegistry();
    registry.register({ metadata: structuredClone(minimalPack.metadata),
      generate() { throw new Error('private provider detail'); } });
    expect(() => registry.generate('bearing.ball.preview', {})).toThrow(DomainPackError);
    try { registry.generate('bearing.ball.preview', {}); }
    catch (error) {
      expect(error).toBeInstanceOf(DomainPackError);
      expect((error as DomainPackError).code).toBe('provider-error');
      expect(String(error)).not.toContain('private provider detail');
    }
    expect(registry.generate('morphloom.bird', {}).parts.length).toBeGreaterThan(0);
  });

  it('rejects incompatible metadata', () => {
    const registry = createElementDomainRegistry();
    for (const change of [{ version: 'morphloom.domain-pack/9' }, { units: 'cm' },
      { coordinates: 'left-handed-z-up' }, { dependencies: { engineApi: '9' } }]) {
      const metadata = { ...structuredClone(minimalPack.metadata), ...change };
      expect(() => registry.register({ ...minimalPack, metadata: metadata as typeof minimalPack.metadata }))
        .toThrow(DomainPackError);
    }
  });
});
