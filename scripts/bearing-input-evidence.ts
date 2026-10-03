import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { generateBearingProject } from '../src/engine/bearing-pack';
import { serializeProject } from '../src/engine/element-project';
import { exportSelectedScene, ELEMENT_RENDERER_REVISION } from '../src/engine/element-renderer';
const [output, baseline] = process.argv.slice(2);
assert(output, 'Usage: vite-node scripts/bearing-input-evidence.ts new-directory [before/evidence.json]');
const out = path.resolve(output); assert(!fs.existsSync(out), 'Choose a new output directory'); fs.mkdirSync(out, { recursive: true });
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
class Reader { result: ArrayBuffer | null = null; onloadend: (() => void) | null = null; readAsArrayBuffer(blob: Blob): void { void blob.arrayBuffer().then(v => { this.result = v; this.onloadend?.(); }); } }
Object.assign(globalThis, { FileReader: Reader });
const rows = [];
for (const [name, input] of [
  ['default', {}], ['small', { boreDiameterMm: 12, outerDiameterMm: 30, widthMm: 10, ballDiameterMm: 5, ballCount: 7 }],
  ['large', { boreDiameterMm: 40, outerDiameterMm: 80, widthMm: 24, ballDiameterMm: 12, ballCount: 12 }],
] as const) {
  const p = generateBearingProject(input), source = serializeProject(p), scene = exportSelectedScene(p, p.parts.map(part => part.id));
  try {
    const meshes: unknown[] = []; scene.root.updateMatrixWorld(true);
    scene.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const g = object.geometry;
      meshes.push({ name: object.name, parent: object.parent?.name, world: object.matrixWorld.toArray(),
        attributes: Object.fromEntries(Object.entries(g.attributes).map(([name, a]) => [name, { size: a.itemSize, values: Array.from(a.array) }])),
        index: g.index ? Array.from(g.index.array) : null,
        materials: (Array.isArray(object.material) ? object.material : [object.material]).map(m => {
          assert(m instanceof THREE.MeshStandardMaterial); return { color: m.color.toArray(), roughness: m.roughness, metalness: m.metalness, side: m.side };
        }) });
    });
    const bytes = new Uint8Array(await new GLTFExporter().parseAsync(scene.root, { binary: true, onlyVisible: false }) as ArrayBuffer);
    fs.writeFileSync(path.join(out, name + '.glb'), bytes); fs.writeFileSync(path.join(out, name + '.elements.json'), source);
    rows.push({ name, meshes: meshes.length, sourceSha256: hash(source), generatedDataSha256: hash(JSON.stringify(meshes)), glbSha256: hash(bytes) });
  } finally { scene.dispose(); }
}
if (baseline) assert.deepEqual(rows, JSON.parse(fs.readFileSync(baseline, 'utf8')).rows, 'Valid input changed generated data or GLB bytes');
fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({ pass: true, rendererRevision: ELEMENT_RENDERER_REVISION, baseline: baseline ?? null, rows }, null, 2));
console.log(JSON.stringify(rows));
