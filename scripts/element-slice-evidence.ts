import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createBirdProject, createFurProject } from '../src/engine/bird-element-demo.js';
import { buildElementScene, exportSelectedScene } from '../src/engine/element-renderer.js';
import { createElementDomainRegistry } from '../src/engine/element-domain-packs.js';
import { minimalPack } from '../examples/domain-packs/minimal-pack.js';
import { analyzeTopology } from '../src/engine/topology.js';
import { ElementHistory, detachPart, restorePart, detachElement, restoreElement, editPart, editElement, editGroup, resolveElements, serializeProject, parseProject, slotId, validateProject } from '../src/engine/element-project.js';

class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: ((event: { target: NodeFileReader }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  async readAsArrayBuffer(blob: Blob): Promise<void> {
    try { this.result = await blob.arrayBuffer(); queueMicrotask(() => this.onloadend?.({ target: this })); }
    catch (error) { queueMicrotask(() => this.onerror?.(error)); }
  }
}
(globalThis as unknown as { FileReader: typeof NodeFileReader }).FileReader = NodeFileReader;

const out = path.resolve(process.argv[2] ?? 'outputs/element-slice');
fs.mkdirSync(out, { recursive: true });
const receipt: Record<string, unknown> = { schema: 'morphloom.element-slice-evidence/0.1', status: 'failed', checks: {}, outputs: {}, environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, osRelease: os.release(), heapMetric: 'noisy process heapUsed delta; excludes GPU memory' } };
const checks = receipt.checks as Record<string, boolean>;
const outputs = receipt.outputs as Record<string, unknown>;
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
function write(name: string, data: Uint8Array | string): void {
  fs.writeFileSync(path.join(out, name), data);
  outputs[name] = { bytes: Buffer.byteLength(data), sha256: sha(data) };
}
function check(name: string, condition: unknown): void { checks[name] = Boolean(condition); assert.ok(condition, name); }
function percentile(values: number[], fraction: number): number { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]; }
async function exportGlb(name: string, project: ReturnType<typeof createBirdProject>, ids: string[]): Promise<void> {
  const scene = exportSelectedScene(project, ids);
  try {
    const topology = analyzeTopology(scene.root);
    (receipt.topology as Record<string, unknown>)[name] = topology;
    check(`${name}:topology`, topology.pass);
    const glb = await new GLTFExporter().parseAsync(scene.root, { binary: true, onlyVisible: false, trs: false });
    check(`${name}:binaryGLB`, glb instanceof ArrayBuffer);
    write(name, new Uint8Array(glb as ArrayBuffer));
    (receipt.exportStats as Record<string, unknown>)[name] = scene.stats;
  } finally { scene.dispose(); }
}

async function main(): Promise<void> {
  receipt.topology = {}; receipt.exportStats = {};
  let bird = validateProject(createBirdProject());
  const initial = resolveElements(bird);
  check('bird:99-resolved', bird.parts.length === 13 && initial.length === 86);
  const eye = bird.parts.find(p => p.id.includes('left') && p.id.includes('eye'))!;
  const lower = bird.parts.find(p => p.id.includes('lower') && p.id.includes('beak'))!;
  const upper = bird.parts.find(p => p.id.includes('upper') && p.id.includes('beak'))!;
  check('bird:part-identification', !!eye && !!lower && !!upper);
  const otherBefore = structuredClone(bird.parts.find(p => p.id !== eye.id));
  const moved: [number, number, number] = [eye.position[0] + 10, eye.position[1], eye.position[2]];
  bird = editPart(bird, eye.id, { position: moved });
  bird = detachPart(bird, eye.id);
  bird = restorePart(bird, eye.id);
  check('bird:eye-restored-at-edited-position', JSON.stringify(bird.parts.find(p => p.id === eye.id)?.position) === JSON.stringify(moved));
  check('bird:other-part-preserved', JSON.stringify(bird.parts.find(p => p.id === otherBefore?.id)) === JSON.stringify(otherBefore));
  const lowerBefore = structuredClone(bird.parts.find(p => p.id === lower.id));
  bird = editPart(bird, upper.id, { scale: [upper.scale[0] * 1.1, upper.scale[1], upper.scale[2]] });
  check('bird:lower-beak-preserved', JSON.stringify(bird.parts.find(p => p.id === lower.id)) === JSON.stringify(lowerBefore));
  const featherId = slotId('left_primary', 0);
  bird = editElement(bird, featherId, { params: { length: 72, curvature: 0.4, color: '#5ca0bb', roughness: 0.35 } });
  const changed = resolveElements(bird).find(e => e.id === featherId)!;
  check('bird:feather-override', changed?.params.length === 72 && changed.params.curvature === 0.4 && changed.params.color === '#5ca0bb' && changed.params.roughness === 0.35);
  bird = editGroup(bird, 'left_primary', { params: { length: 60 } }).project;
  check('bird:group-edit-preserves-override', resolveElements(bird).find(e => e.id === featherId)?.params.length === 72);
  let fur = validateProject(createFurProject());
  const strandId = slotId('body_fur', 0);
  fur = editElement(fur, strandId, { params: { length: 24, curvature: 0.35 } });
  const strandBefore = resolveElements(fur).find(e => e.id === strandId)!;
  fur = restoreElement(detachElement(fur, strandId), strandId);
  const strandAfter = resolveElements(fur).find(e => e.id === strandId);
  check('fur:restore-id-and-params', strandAfter?.id === strandId && JSON.stringify(strandAfter.params) === JSON.stringify(strandBefore.params));
  const h = new ElementHistory(createBirdProject()); h.commit(bird);
  check('history:undo', serializeProject(h.undo()) === serializeProject(createBirdProject()));
  check('history:redo', serializeProject(h.redo()) === serializeProject(bird));
  const birdText = serializeProject(bird), furText = serializeProject(fur);
  check('bird:json-roundtrip', serializeProject(parseProject(birdText)) === birdText);
  check('fur:json-roundtrip', serializeProject(parseProject(furText)) === furText);
  write('bird.elements.json', birdText); write('fur.elements.json', furText);
  const allIds = [...bird.parts.map(p => p.id), ...resolveElements(bird).map(e => e.id)];
  check('bird:export-id-count', allIds.length === 99 && new Set(allIds).size === 99);
  await exportGlb('bird.glb', bird, allIds);
  await exportGlb('selected-feather.glb', bird, [featherId]);
  await exportGlb('selected-strand.glb', fur as ReturnType<typeof createBirdProject>, [strandId]);
  await exportGlb('selected-left-eye.glb', bird, [eye.id]);
  write('selected-feather.source.json', birdText);
  write('selection-manifest.json', JSON.stringify({ source: 'selected-feather.source.json', sourceScope: 'complete original edited bird project, not a selective project', selectedIds: [featherId], recovery: 'Load source JSON and resolve selectedIds; GLB alone does not reconstruct authored parameters.' }, null, 2));
  const registry = createElementDomainRegistry(); registry.register(minimalPack);
  let ball = registry.generate('bearing.ball.preview', { diameterMm: 8 }, ['selected-scene-export']);
  ball = editPart(ball, 'bearing_ball', { position: [10,0,0] });
  ball = restorePart(detachPart(ball, 'bearing_ball'), 'bearing_ball');
  check('bearing-ball:independent-restoration', ball.parts[0].id === 'bearing_ball' && ball.parts[0].position[0] === 10);
  write('bearing-ball.elements.json', serializeProject(ball));
  await exportGlb('selected-bearing-ball.glb', ball, ['bearing_ball']);
  receipt.loss = { preserved: ['GLB baked mesh positions, materials and separately named stable IDs', 'authored project, overrides and evidence in companion JSON'], approximate: ['procedural curve represented by baked mesh'], lostFromGlb: ['native procedural groom and editable group/override semantics'], recovery: 'Use complete companion project JSON and selection manifest; no textures are used.' };
  const metrics: Record<string, unknown> = {};
  let lodIds: string[] | undefined;
  for (const lod of ['low', 'detail'] as const) {
    const before = process.memoryUsage().heapUsed;
    const scene = buildElementScene(bird, lod);
    try { const ids = scene.root.children.flatMap(o => o.userData.elementIds ?? []).sort(); if (lodIds) check('lod:ids-preserved', JSON.stringify(ids) === JSON.stringify(lodIds)); lodIds = ids; check('lod:source-preserved', serializeProject(bird) === birdText); metrics[lod] = { ...scene.stats, heapUsedDeltaBytesNoisy: process.memoryUsage().heapUsed - before }; }
    finally { scene.dispose(); }
  }
  receipt.metrics = metrics;
  const one = buildElementScene(bird, 'low', { onlyIds: [featherId] });
  try {
    one.root.updateMatrixWorld(true);
    const mesh = one.root.children.find(o => o instanceof THREE.InstancedMesh && (o.userData.elementIds as string[]).includes(featherId)) as THREE.InstancedMesh | undefined;
    check('raycast:target-instance-exists', !!mesh);
    const index = (mesh!.userData.elementIds as string[]).indexOf(featherId);
    const matrix = new THREE.Matrix4(); mesh!.getMatrixAt(index, matrix); matrix.premultiply(mesh!.matrixWorld);
    const center = new THREE.Vector3(0, 0.5, 0).applyMatrix4(matrix);
    const origin = new THREE.Vector3(0, 0.5, 5).applyMatrix4(matrix);
    const direction = center.clone().sub(origin).normalize();
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const hits = new THREE.Raycaster(origin, direction).intersectObject(mesh!, false);
      times.push(performance.now() - start);
      check(`raycast:trial-${i}`, hits.length > 0 && one.pickId(hits[0]) === featherId);
    }
    receipt.raycast = { trials: 30, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), scope: 'engine raycast, not browser UI latency' };
  } finally { one.dispose(); }
  const group = bird.groups.find(g => g.id === 'left_primary')!;
  const stress = structuredClone(bird);
  for (const g of stress.groups) { g.count = g.id === group.id ? 5000 : 0; g.overrides = {}; g.deleted = []; }
  stress.elements = [];
  const stressIds = resolveElements(stress);
  check('stress:5000-resolved', stressIds.length === 5000);
  const low = buildElementScene(stress, 'low');
  try { receipt.stress = { scope: 'one 5000-member group, not 5000 independent meshes', ...low.stats }; }
  finally { low.dispose(); }
  const over = structuredClone(stress); over.groups.find(g => g.id === group.id)!.count = 5001;
  let countRejected = false; try { resolveElements(over); } catch { countRejected = true; }
  check('stress:5001-rejected', countRejected);
  let detailRejected = false; try { const scene = buildElementScene(stress, 'detail'); scene.dispose(); } catch { detailRejected = true; }
  check('stress:detail-triangle-budget-rejected', detailRejected);
  receipt.limitations = ['Inter-object collisions in the full bird were not tested by per-mesh topology analysis.', 'No browser UI, GPU memory, or sizes beyond those recorded were tested.'];
  receipt.status = 'passed';
}

try { await main(); }
catch (error) { receipt.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error); process.exitCode = 1; }
finally { fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(receipt, null, 2) + '\n'); }
