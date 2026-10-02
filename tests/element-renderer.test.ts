import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBirdProject } from '../src/engine/bird-element-demo.js';
import { editElement, resolveElements, serializeProject } from '../src/engine/element-project.js';
import { minimalPack } from '../examples/domain-packs/minimal-pack.js';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs.js';
import { buildElementScene, exportSelectedScene } from '../src/engine/element-renderer.js';

describe('element renderer', () => {
  it('maps raycast instance IDs to stable source IDs', () => {
    const built = buildElementScene(createBirdProject(), 'detail');
    try {
      const mesh = built.root.children.find(x => x instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
      const id = mesh.userData.elementIds[0] as string;
      const m = new THREE.Matrix4(); mesh.getMatrixAt(0, m);
      const origin = new THREE.Vector3().setFromMatrixPosition(m);
      const ray = new THREE.Raycaster(origin.clone().add(new THREE.Vector3(0, 0.02, 1)), new THREE.Vector3(0, 0, -1));
      const hits = ray.intersectObject(mesh);
      expect(id).toBeTruthy();
      if (hits.length) expect(built.pickId(hits[0])).toBe(mesh.userData.elementIds[hits[0].instanceId!]);
      expect(built.pickId({ object: mesh, instanceId: 0 } as THREE.Intersection)).toBe(id);
    } finally { built.dispose(); }
  });
  it('retains IDs and source across LOD and unrelated edits', () => {
    const source = createBirdProject(); const before = serializeProject(source);
    const low = buildElementScene(source, 'low'), high = buildElementScene(source, 'detail');
    try {
      const ids = (b: typeof low): string[] => b.root.children.flatMap(o => o.userData.elementIds as string[] ?? []).sort();
      expect(ids(low)).toEqual(ids(high)); expect(low.stats.triangles).toBeLessThan(high.stats.triangles);
      expect(serializeProject(source)).toBe(before);
      const all = resolveElements(source); const changed = editElement(source, all[0].id, { params: { color: '#ffffff' } });
      const edited = buildElementScene(changed, 'low');
      try { expect(ids(edited)).toEqual(ids(low)); } finally { edited.dispose(); }
    } finally { low.dispose(); high.dispose(); }
  });
  it('exports separate selected meshes at canonical meter positions with metadata', () => {
    const p = createBirdProject(), e = resolveElements(p)[0];
    const built = exportSelectedScene(p, [e.id]);
    try {
      expect(built.root.children).toHaveLength(1);
      expect(built.root.children[0].name).toBe(e.id);
      expect(built.root.children[0].position.x).toBeCloseTo(e.position[0] / 1000);
      expect(built.root.userData.sourceUnits).toBe('mm');
      expect(built.root.userData.sourceSpec).toEqual(p);
      const g = (built.root.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry;
      const edges = new Map<string, number>(); const index = g.getIndex()!;
      for (let i = 0; i < index.count; i += 3) for (const [a,b] of [[0,1],[1,2],[2,0]]) {
        const edge = [index.getX(i+a), index.getX(i+b)].sort((x,y) => x-y).join(':');
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
      expect([...edges.values()].every(n => n === 2)).toBe(true);
    } finally { built.dispose(); }
  });
  it('rejects excessive batches before allocating meshes', () => {
    const p = createBirdProject();
    p.groups = []; p.elements = [];
    for (let i = 0; i < 129; i++) p.elements.push({ id: `unique_${i}`, kind: 'feather', partId: 'body', position: [0,0,0], rotation: [0,0,0], params: { length: 28, width: 7, thickness: 2, curvature: i / 129, twist: 0, roughness: 0.8, color: '#ffffff' }, visible: true, locked: false, evidence: { status: 'authored', source: 'test' } });
    expect(() => buildElementScene(p, 'low')).toThrow(/budget/i);
  });
});


describe('ellipsoid delivery curvature contract', () => {
  function maxFaceRadialError(g: THREE.BufferGeometry): number {
    const p = g.getAttribute('position'), index = g.getIndex()!;
    const center = new THREE.Vector3(), point = new THREE.Vector3();
    let error = 0;
    for (let i = 0; i < index.count; i += 3) {
      center.set(0, 0, 0);
      for (let j = 0; j < 3; j++) center.add(point.fromBufferAttribute(p, index.getX(i + j)));
      error = Math.max(error, 0.5 - center.divideScalar(3).length());
    }
    return error; // normalized to diameter 1; actual chord error scales with diameter
  }
  it.each([0.1, 8, 100])('honors detail curvature at diameter %s mm and exports identical attributes', diameter => {
    const registry = createElementDomainRegistry(); registry.register(minimalPack);
    const project = registry.generate('bearing.ball.preview', { diameterMm: diameter });
    const low = buildElementScene(project, 'low');
    const detail = buildElementScene(project, 'detail');
    const delivery = exportSelectedScene(project, ['bearing_ball']);
    try {
      const geometry = (s: typeof low) => (s.root.children[0] as THREE.Mesh).geometry;
      expect(maxFaceRadialError(geometry(detail))).toBeLessThanOrEqual(0.002);
      expect(detail.stats.triangles).toBeLessThanOrEqual(3000);
      expect(detail.stats.triangles).toBeGreaterThan(low.stats.triangles);
      for (const name of ['position', 'normal', 'uv']) {
        expect(Array.from(geometry(delivery).getAttribute(name).array))
          .toEqual(Array.from(geometry(detail).getAttribute(name).array));
      }
      expect(Array.from(geometry(delivery).index!.array)).toEqual(Array.from(geometry(detail).index!.array));
      geometry(detail).computeBoundingBox();
      expect(geometry(detail).boundingBox!.min.toArray()).toEqual([-0.5,-0.5,-0.5]);
      expect(geometry(detail).boundingBox!.max.toArray()).toEqual([0.5,0.5,0.5]);
      expect(detail.root.children[0].scale.toArray()).toEqual([diameter/1000, diameter/1000, diameter/1000]);
    } finally { low.dispose(); detail.dispose(); delivery.dispose(); }
  });
});
