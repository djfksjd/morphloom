import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs';
import { bearingPack } from '../src/engine/bearing-pack';
import { resolveElements } from '../src/engine/element-project';
import { appendWorkspaceAsset, buildWorkspaceScene, generateWorkspaceAsset, serializeWorkspace, type ElementWorkspace } from '../src/engine/element-workspace';

const workspace = (): ElementWorkspace => {
  const registry = createElementDomainRegistry(); registry.register(bearingPack);
  const empty: ElementWorkspace = { schema: 'morphloom.workspace/0.1', units: 'mm', coordinates: 'right-handed-y-up', assets: [] };
  return appendWorkspaceAsset(appendWorkspaceAsset(empty, generateWorkspaceAsset(registry, { id: 'a', packId: bearingPack.metadata.id, input: {}, requiredCapabilities: [], positionMm: [-150, 0, 0], rotationRad: [0, 0, 0] })),
    generateWorkspaceAsset(registry, { id: 'b', packId: bearingPack.metadata.id, input: {}, requiredCapabilities: [], positionMm: [150, 20, 30], rotationRad: [0.3, -0.2, 0.1] }));
};
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const rows: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh) rows.push(o); }); return rows; };
describe('namespaced workspace isolate preview', () => {
  it('keeps one selected ball and its world datum/parent while preserving source and whole delivery', () => {
    const w = workspace(), source = serializeWorkspace(w), all = buildWorkspaceScene(w, 'detail');
    const isolated = buildWorkspaceScene(w, 'detail', false, { isolate: { assetId: 'b', ids: ['ball_0000'] } });
    try {
      expect(meshes(isolated.root).map(o => o.name)).toEqual(['b::ball_0000']);
      all.root.updateMatrixWorld(true); isolated.root.updateMatrixWorld(true);
      const old = all.root.getObjectByName('b::ball_0000') as THREE.Mesh, selected = meshes(isolated.root)[0];
      expect(selected.matrixWorld.toArray()).toEqual(old.matrixWorld.toArray());
      expect(selected.parent?.name).toBe('b::bearing_assembly');
      for (const name of ['position', 'normal', 'uv']) expect(Array.from(selected.geometry.getAttribute(name).array)).toEqual(Array.from(old.geometry.getAttribute(name).array));
      expect(Array.from(selected.geometry.index!.array)).toEqual(Array.from(old.geometry.index!.array));
      expect(isolated.stats.triangles).toBeLessThan(all.stats.triangles);
      const hit = { object: selected } as THREE.Intersection;
      expect(isolated.pickId(hit)).toBe('b::ball_0000');
      expect(serializeWorkspace(w)).toBe(source);
      const delivery = buildWorkspaceScene(w, 'detail', true);
      try { expect(meshes(delivery.root)).toHaveLength(22); expect(delivery.root.userData.sourceSpec).toEqual(w); }
      finally { delivery.dispose(); }
    } finally { all.dispose(); isolated.dispose(); }
  });
  it.each([
    { isolate: { assetId: 'missing', ids: ['ball_0000'] } },
    { isolate: { assetId: 'b', ids: [] } },
    { isolate: { assetId: 'b', ids: ['missing'] } },
    { isolate: { assetId: 'b', ids: ['ball_0000', 'ball_0000'] } },
  ])('rejects invalid isolation %j without changing source', options => {
    const w = workspace(), before = serializeWorkspace(w);
    expect(() => buildWorkspaceScene(w, 'detail', false, options)).toThrow(/workspace:.*isolat/);
    expect(serializeWorkspace(w)).toBe(before);
  });
  it('refuses preview filters on a full-delivery call', () => {
    expect(() => buildWorkspaceScene(workspace(), 'detail', true, { isolate: { assetId: 'b', ids: ['ball_0000'] } })).toThrow('workspace:preview-not-delivery');
  });
  it('resolves a whole procedural group without adding its unselected base part', () => {
    const registry = createElementDomainRegistry(), w = workspace();
    const fur = generateWorkspaceAsset(registry, { id: 'fur', packId: 'morphloom.fur', input: {}, requiredCapabilities: [], positionMm: [0, 40, 0], rotationRad: [0, 0.2, 0] });
    const combined = appendWorkspaceAsset(w, fur), group = fur.source.groups[0];
    const selected = resolveElements(fur.source).filter(e => e.groupId === group.id && e.visible);
    expect(selected.length).toBeGreaterThan(0);
    const scene = buildWorkspaceScene(combined, 'low', false, { isolate: { assetId: 'fur', ids: [group.id] } });
    try {
      expect(scene.root.children.map(o => o.name)).toEqual(['fur']);
      expect(scene.stats.visibleElements).toBe(selected.length);
      for (const part of fur.source.parts) expect(scene.root.getObjectByName('fur::' + part.id)).toBeUndefined();
      expect(scene.root.userData.preview.revision).toBe('morphloom.workspace-isolate/0.1');
      expect(scene.root.userData.sourceSpec).toEqual(combined);
    } finally { scene.dispose(); }
  });
});
