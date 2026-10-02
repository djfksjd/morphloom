import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs.js';
import { minimalPack } from '../examples/domain-packs/minimal-pack.js';
import { editPart, detachPart, restorePart, ElementHistory, serializeProject, parseProject } from '../src/engine/element-project.js';
import { buildElementScene, exportSelectedScene } from '../src/engine/element-renderer.js';
import { analyzeTopology } from '../src/engine/topology.js';

class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }, error => this.onerror?.(error));
  }
}
Object.assign(globalThis, { FileReader: NodeFileReader });
const out = path.resolve(process.argv[2] ?? 'outputs/ball-slice-20261002/current');
mkdirSync(out, { recursive: true });
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const outputs: Record<string, unknown> = {};
function write(name: string, value: Uint8Array | string): void {
  writeFileSync(path.join(out, name), value);
  outputs[name] = { sha256: sha(value), bytes: Buffer.byteLength(value) };
}
const registry = createElementDomainRegistry(); registry.register(minimalPack);
const project = registry.generate('bearing.ball.preview', { diameterMm: 8 });
project.parts.push({ ...structuredClone(project.parts[0]), id: 'witness', name: 'untouched ellipsoid', position: [16,0,0], scale: [6,10,4] });
const baselineText = serializeProject(project);
const history = new ElementHistory(project);
const edited = editPart(project, 'bearing_ball', { scale: [10,10,10], color: '#c5b68a' });
history.commit(edited);
assert.equal(serializeProject(history.undo()), baselineText);
assert.equal(serializeProject(history.redo()), serializeProject(edited));
assert.deepEqual(edited.parts[1], project.parts[1]);
assert.equal(serializeProject(parseProject(serializeProject(edited))), serializeProject(edited));
const extracted = detachPart(edited, 'bearing_ball');
assert.deepEqual(restorePart(extracted, 'bearing_ball'), edited);
write('project.elements.json', serializeProject(edited));
const before = exportSelectedScene(project, ['witness']);
const after = exportSelectedScene(edited, ['witness']);
function meshFingerprint(root: THREE.Object3D): string {
  const hash = createHash('sha256');
  root.updateMatrixWorld(true);
  root.traverse(o => { if (!(o instanceof THREE.Mesh)) return;
    hash.update(JSON.stringify([o.name, o.matrixWorld.toArray(), (o.material as THREE.MeshStandardMaterial).toJSON()]));
    for (const key of Object.keys(o.geometry.attributes).sort()) {
      const array = o.geometry.getAttribute(key).array;
      hash.update(key); hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    }
    const array = o.geometry.index?.array;
    if (array) hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  });
  return hash.digest('hex');
}
// Material UUIDs differ between compiles; compare authored material values and geometry separately.
function stableWitness(root: THREE.Object3D): string {
  root.traverse(o => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).uuid = 'witness-material'; });
  return meshFingerprint(root);
}
let witnessFingerprint: string;
try { witnessFingerprint = stableWitness(before.root); assert.equal(stableWitness(after.root), witnessFingerprint); }
finally { before.dispose(); after.dispose(); }
const metrics: unknown[] = [];
for (const scale of [[0.1,0.1,0.1], [8,8,8], [100,100,100], [6,10,4]] as [number,number,number][]) {
  const p = editPart(project, 'bearing_ball', { scale });
  const scene = buildElementScene(p, 'detail', { onlyIds: ['bearing_ball'] });
  try {
    const mesh = scene.root.children[0] as THREE.Mesh, g = mesh.geometry;
    const positions = g.getAttribute('position'), index = g.index!;
    let error = 0;
    const center = new THREE.Vector3(), point = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      center.set(0,0,0);
      for (let j = 0; j < 3; j++) center.add(point.fromBufferAttribute(positions, index.getX(i+j)));
      error = Math.max(error, 0.5 - center.divideScalar(3).length());
    }
    assert.ok(error <= 0.002); assert.ok(scene.stats.triangles <= 3000);
    const topology = analyzeTopology(scene.root); assert.ok(topology.pass);
    assert.ok(g.getAttribute('uv') && g.getAttribute('normal'));
    metrics.push({ scaleMm: scale, normalizedFaceCenterError: error, maximumFaceCenterErrorBoundMm: error * Math.max(...scale), stats: scene.stats, topology });
  } finally { scene.dispose(); }
}
for (const [name, p, ids] of [
  ['edited-assembly.glb', edited, ['bearing_ball','witness']],
  ['selected-ball.glb', edited, ['bearing_ball']]
] as const) {
  const scene = exportSelectedScene(p, [...ids]);
  try {
    assert.ok(analyzeTopology(scene.root).pass);
    const data = await new GLTFExporter().parseAsync(scene.root, { binary: true, onlyVisible: false });
    assert.ok(data instanceof ArrayBuffer); write(name, new Uint8Array(data));
  } finally { scene.dispose(); }
}
const sources = ['src/engine/element-renderer.ts','src/engine/element-project.ts','src/engine/element-domain-packs.ts', 'scripts/ball-curvature-evidence.ts'];
write('evidence.json', JSON.stringify({ status: 'passed', engineSourceHashes: Object.fromEntries(sources.map(file => [file, sha(readFileSync(file))])),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  contract: { normalizedFaceCenterErrorMax: 0.002, trianglesPerEllipsoidMax: 3000, reference: 'authored ideal ellipsoid; no real bearing reference', uv: 'latitude-longitude seam and pole distortion are intentional; no texture or texel-density certification' },
  checks: { undo: true, redo: true, saveReload: true, detachRestore: true, nonTargetAuthoredPreserved: true, nonTargetGeometryUvMaterialTransformPreserved: true }, witnessFingerprint, metrics, outputs,
  limitations: ['Face-center samples do not certify maximum Hausdorff error.', 'No mechanical bearing assembly, cage, gear, tolerance or physical simulation.', 'No independent human expert evaluation.'] }, null, 2));
console.log(JSON.stringify({ status: 'passed', outputs, witnessFingerprint }));
