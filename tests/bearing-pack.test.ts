import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createElementDomainRegistry, DomainPackError } from '../src/engine/element-domain-packs';
import { bearingPack, generateBearingProject } from '../src/engine/bearing-pack';
import { validateProject, serializeProject, parseProject, migrateElementProject, editPart, detachPart, restorePart, ElementHistory } from '../src/engine/element-project';
import { createBirdProject } from '../src/engine/bird-element-demo';
import { buildElementScene, exportSelectedScene } from '../src/engine/element-renderer';
import { analyzeTopology } from '../src/engine/topology';

describe('bearing Domain Pack vertical slice', () => {
  it('generates true ring bores, raceway profiles and perforated cage with stable ball IDs', () => {
    const registry = createElementDomainRegistry(); registry.register(bearingPack);
    const p = registry.generate('mechanical.bearing.visual', {});
    expect(p.schema).toBe('morphloom.elements/0.2');
    expect(p.assemblies).toHaveLength(1);
    expect(p.parts.map(x => x.id)).toContain('ball_0000');
    expect(p.parts).toHaveLength(11);
    const inner = p.parts.find(x => x.id === 'inner_race')!;
    expect(inner.geometry?.op).toBe('lathe');
    const cage = p.parts.find(x => x.id === 'cage')!;
    if (cage.geometry?.op !== 'extrude') throw new Error('missing cage');
    expect(cage.geometry.holes).toHaveLength(9); // central bore + 8 real ball pockets
    expect(serializeProject(p)).toBe(serializeProject(generateBearingProject({})));
  });
  it.each([
    {}, { boreDiameterMm: 12, outerDiameterMm: 30, widthMm: 10, ballDiameterMm: 5, ballCount: 7 },
    { boreDiameterMm: 40, outerDiameterMm: 80, widthMm: 24, ballDiameterMm: 12, ballCount: 12 }
  ])('compiles closed geometry, finite UV and unit normals in a different size case %j', input => {
    const p = generateBearingProject(input), scene = buildElementScene(p, 'detail');
    try {
      const topology = analyzeTopology(scene.root);
      expect(topology.pass).toBe(true);
      expect(topology.boundaryEdges).toBe(0);
      expect(scene.stats.triangles).toBeLessThanOrEqual(100_000);
      expect(scene.root.getObjectByName('bearing_assembly')?.children).toHaveLength(p.parts.length);
      scene.root.traverse(o => { if (!(o instanceof THREE.Mesh)) return;
        expect(o.geometry.getAttribute('uv')).toBeDefined();
        expect(Array.from(o.geometry.getAttribute('uv').array).every(Number.isFinite)).toBe(true);
        const n = o.geometry.getAttribute('normal');
        for (let i = 0; i < n.count; i++) expect(new THREE.Vector3().fromBufferAttribute(n,i).length()).toBeCloseTo(1,4);
        const positions=o.geometry.getAttribute('position'),index=o.geometry.index;
        let minimumAlignment=1;
        for(let i=0;i<(index?.count??positions.count);i+=3) {
          const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);
          const a=new THREE.Vector3().fromBufferAttribute(positions,ids[0]);
          const b=new THREE.Vector3().fromBufferAttribute(positions,ids[1]);
          const c=new THREE.Vector3().fromBufferAttribute(positions,ids[2]);
          const face=b.sub(a).cross(c.sub(a)).normalize(),shading=new THREE.Vector3();
          for(const j of ids)shading.add(new THREE.Vector3().fromBufferAttribute(n,j));
          minimumAlignment=Math.min(minimumAlignment,face.dot(shading.normalize()));
        }
        expect(minimumAlignment).toBeGreaterThan(0); // unit normals alone cannot detect flipped shading

      });
      scene.root.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(new THREE.Vector3(0,0.1,0), new THREE.Vector3(0,-1,0));
      expect(ray.intersectObject(scene.root,true)).toHaveLength(0); // true bore, no black fake hole
    } finally { scene.dispose(); }
  });
  it('preserves ball edits and unrelated parts after extraction, save/reopen and restoration', () => {
    const p = generateBearingProject({}), snapshot = structuredClone(p);
    const edited = editPart(p, 'ball_0000', { geometry: { op: 'sphere', radius: 2.8, widthSegments: 48, heightSegments: 32 }, material: { roughness: 0.28, metalness: 0.9 }, color: '#baad91' });
    const h = new ElementHistory(p); h.commit(edited);
    expect(h.undo()).toEqual(p); expect(h.redo()).toEqual(edited);
    const detached = detachPart(edited, 'ball_0000');
    expect(detached.parts.find(x => x.id==='ball_0000')?.assemblyId).toBeUndefined();
    const restored = restorePart(parseProject(serializeProject(detached)), 'ball_0000');
    expect(restored).toEqual(edited);
    expect(restored.parts.filter(x=>x.id!=='ball_0000')).toEqual(snapshot.parts.filter(x=>x.id!=='ball_0000'));
    expect(p).toEqual(snapshot);
    const exported = exportSelectedScene(restored,['ball_0000']);
    try { expect(exported.root.getObjectByName('ball_0000')).toBeInstanceOf(THREE.Mesh); expect(analyzeTopology(exported.root).pass).toBe(true); }
    finally { exported.dispose(); }
  });
  it('migrates legacy projects without changing authored parts and rejects unversioned new fields', () => {
    const p = createBirdProject(), before = serializeProject(p);
    const migrated = migrateElementProject(p);
    expect(migrated.schema).toBe('morphloom.elements/0.2'); expect(migrated.parts).toEqual(p.parts);
    expect(serializeProject(p)).toBe(before); expect(migrateElementProject(migrated)).toEqual(migrated);
    const invalid = { ...generateBearingProject({}), schema: 'morphloom.elements/0.1' };
    expect(()=>validateProject(invalid)).toThrow();
  });
  it('rejects impossible packing, dimensions, versions and mismatched output representations', () => {
    const registry = createElementDomainRegistry(); registry.register(bearingPack);
    for (const input of [{ ballCount: 32 }, { ballCount: 8.5 }, { boreDiameterMm: 38 }, { widthMm: 2 }, { ballDiameterMm: 20 }, { seed: -1 }, { units:'cm' }]) {
      expect(()=>registry.generate('mechanical.bearing.visual',input)).toThrow(DomainPackError);
    }
    const p = generateBearingProject({}); p.parts[0].assemblyId = 'missing';
    expect(()=>validateProject(p)).toThrow();
    registry.register({metadata: { ...structuredClone(bearingPack.metadata), id:'lying.pack' }, generate:()=>createBirdProject()});
    expect(()=>registry.generate('lying.pack',{})).toThrow(DomainPackError);
    expect(registry.generate('morphloom.bird',{}).schema).toBe('morphloom.elements/0.1');
  });
});
