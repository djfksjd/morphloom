import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const [beforeFile, afterFile, target, output, changedAttribute = 'position'] = process.argv.slice(2);
assert(['position','normal'].includes(changedAttribute), 'Supported changed attribute: position or normal');
assert(beforeFile && afterFile && target && output && !fs.existsSync(output), 'Usage: vite-node script before.glb after.glb target-name new-report.json');
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const loaded: THREE.Object3D[] = [];
async function read(file: string): Promise<{ sha256: string; rows: Map<string, { position: string; rest: string }> }> {
  const raw = fs.readFileSync(file); assert(raw.byteLength <= 256_000_000 && raw.subarray(0, 4).toString() === 'glTF');
  const gltf = await new GLTFLoader().parseAsync(new Uint8Array(raw).buffer, ''); loaded.push(...gltf.scenes);
  gltf.scene.updateMatrixWorld(true);
  const rows = new Map<string, { position: string; rest: string }>();
  // Three sanitizes namespace punctuation for animation bindings. Compare the
  // actual interchange node names through parser associations instead.
  const wireName = (object: THREE.Object3D): string => {
    const node = gltf.parser.associations.get(object)?.nodes;
    return node === undefined ? object.name : gltf.parser.json.nodes[node].name;
  };
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const name = wireName(object);
    assert(!rows.has(name), 'Names must remain unique');
    const g = object.geometry;
    const attributes = Object.fromEntries(Object.entries(g.attributes).filter(([key]) => key !== changedAttribute).map(([key, a]) => [key, { size: a.itemSize, values: Array.from(a.array) }]));
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(m => {
      assert(m instanceof THREE.MeshStandardMaterial); return { color: m.color.toArray(), roughness: m.roughness, metalness: m.metalness, side: m.side };
    });
    rows.set(name, { position: hash(JSON.stringify(Array.from(g.getAttribute(changedAttribute).array))),
      rest: hash(JSON.stringify({ parent: object.parent ? wireName(object.parent) : null, world: object.matrixWorld.toArray(), attributes, index: g.index ? Array.from(g.index.array) : null, materials })) });
  });
  assert(rows.size <= 128); return { sha256: hash(raw), rows };
}
try {
  const before = await read(beforeFile), after = await read(afterFile);
  assert.deepEqual([...before.rows.keys()].sort(), [...after.rows.keys()].sort());
  assert(before.rows.has(target)); const unchanged = [];
  for (const [id, row] of before.rows) {
    const current = after.rows.get(id)!;
    assert.equal(row.rest, current.rest, id + ': non-target attributes/UV/index/PBR/world/parent changed');
    if (id === target) assert.notEqual(row.position, current.position, 'Target '+changedAttribute+' buffers did not change');
    else { assert.deepEqual(current, row, id + ': unrelated generated mesh changed'); unchanged.push(id); }
  }
  fs.writeFileSync(output, JSON.stringify({ pass: true, method: 'Reopen actual GLB bytes; inspect all mesh attributes, world matrices, parent names and PBR factors', beforeSha256: before.sha256, afterSha256: after.sha256, target, changedAttribute, unchangedMeshes: unchanged.length, unchanged, scope: 'One explicitly selected mesh attribute edit; no manufacturing or general shader/texture certification' }, null, 2)+'\n');
  console.log('PASS target only changed '+changedAttribute+' buffers;', unchanged.length, 'unrelated meshes exact');
} finally {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  for (const root of loaded) root.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const m of Array.isArray(object.material) ? object.material : [object.material]) { materials.add(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v); } } });
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
}
