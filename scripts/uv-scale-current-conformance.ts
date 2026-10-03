import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { generateSpurGearProject } from '../src/engine/gear-pack';
import { parseProject, serializeProject, migrateElementProjectToV4, editPart } from '../src/engine/element-project';
import { exportSelectedScene, ELEMENT_RENDERER_REVISION } from '../src/engine/element-renderer';
import { inspectUvQuality } from '../src/engine/uv-quality';
import { inspectExportedUv } from '../src/engine/uv-delivery';
import { analyzeTopology } from '../src/engine/topology';

// Explicit paths: never consume yesterday's benchmark receipt as today's evidence.
const [input, output] = process.argv.slice(2);
assert(input && output, 'Usage: vite-node scripts/uv-scale-current-conformance.ts before.elements.json output-directory');
const out = path.resolve(output);
assert(!fs.existsSync(path.join(out, 'conformance.json')), 'Choose a new output directory');
fs.mkdirSync(out, { recursive: true });
class Reader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void { void blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
}
Object.assign(globalThis, { FileReader: Reader });
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function buffers(root: THREE.Object3D, includeUv: boolean): string {
  const rows: unknown[] = [];
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const g = object.geometry;
    const attributes = Object.fromEntries(Object.entries(g.attributes).filter(([name]) => includeUv || name !== 'uv').map(([name, a]) =>
      [name, { size: a.itemSize, values: Array.from(a.array) }]));
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(m => {
      assert(m instanceof THREE.MeshStandardMaterial);
      return { color: m.color.toArray(), metalness: m.metalness, roughness: m.roughness, side: m.side };
    });
    rows.push({ name: object.name, parent: object.parent?.name, world: object.matrixWorld.toArray(), attributes, index: g.index ? Array.from(g.index.array) : null, materials });
  });
  return hash(JSON.stringify(rows));
}
const cases = [
  { name: 'native-default', project: parseProject(fs.readFileSync(input, 'utf8')) },
  { name: 'small', project: generateSpurGearProject({ moduleMm: 0.5, toothCount: 18, faceWidthMm: 3, boreDiameterMm: 2 }) },
  { name: 'large', project: generateSpurGearProject({ moduleMm: 2.5, toothCount: 48, faceWidthMm: 20, boreDiameterMm: 20 }) },
];
const rows = [];
for (const { name, project } of cases) {
  assert(project.schema === 'morphloom.elements/0.3' && project.parts.length === 1);
  const migrated = migrateElementProjectToV4(project);
  assert.deepEqual(migrated.parts, project.parts);
  const edited = editPart(migrated, project.parts[0].id, { uvScale: 100 });
  const before = exportSelectedScene(project, project.parts.map(p => p.id));
  const after = exportSelectedScene(edited, edited.parts.map(p => p.id));
  try {
    const geometryBefore = buffers(before.root, false), geometryAfter = buffers(after.root, false);
    assert.equal(geometryBefore, geometryAfter, 'Non-UV generated data changed');
    assert.notEqual(buffers(before.root, true), buffers(after.root, true), 'UV bytes did not change');
    const oldUv = await inspectUvQuality(before.root), newUv = await inspectUvQuality(after.root);
    if (name !== 'large') assert(!oldUv.integrityPass, 'The native/default and small baseline failures must remain visible');
    // A larger legacy gear can already pass the unchanged 5% contract. Preserve that result.
    assert(newUv.integrityPass && newUv.meshes.every(m => m.features.every(f => f.integrityPass)));
    assert.deepEqual(oldUv.meshes.map(m => m.features.map(f => f.id)), newUv.meshes.map(m => m.features.map(f => f.id)));
    assert(analyzeTopology(before.root).pass && analyzeTopology(after.root).pass);
    const source = serializeProject(edited);
    const bytes = new Uint8Array(await new GLTFExporter().parseAsync(after.root, { binary: true, onlyVisible: false }) as ArrayBuffer);
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'glTF');
    const delivered = await inspectExportedUv(bytes.buffer, source);
    assert(delivered.report.integrityPass && delivered.report.meshes.every(m => m.features.every(f => f.integrityPass)));
    fs.writeFileSync(path.join(out, `${name}.glb`), bytes);
    fs.writeFileSync(path.join(out, `${name}.elements.json`), source);
    fs.writeFileSync(path.join(out, `${name}.uv.json`), JSON.stringify({ before: oldUv, after: newUv, delivered }, null, 2));
    rows.push({ name, geometryBefore, geometryAfter, sourceSha256: hash(source), glbSha256: hash(bytes), beforeIntegrityPass: oldUv.integrityPass, beforeDegenerate: oldUv.meshes.map(m => m.degenerateUvTriangles), afterDegenerate: newUv.meshes.map(m => m.degenerateUvTriangles), triangles: newUv.meshes.map(m => m.triangleCount), features: newUv.meshes.map(m => m.features.length), pass: true });
  } finally { before.dispose(); after.dispose(); }
}
fs.writeFileSync(path.join(out, 'conformance.json'), JSON.stringify({ pass: true, rendererRevision: ELEMENT_RENDERER_REVISION, inputSha256: hash(fs.readFileSync(input)), scope: 'Explicit UV0.4 scalar only; authored gear visualization; no atlas/manufacturing approval', rows }, null, 2));
console.log(JSON.stringify(rows));
