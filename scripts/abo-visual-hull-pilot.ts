import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, ImageData } from '@napi-rs/canvas';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { AssemblyIR, SurfaceFinishIR } from '../src/engine/assembly-ir';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { canonicalizeGlbBufferViews } from '../src/engine/glb-canonicalization';
import { preparePortableGltfGeometry, createPortableGltfExportInput } from '../src/engine/gltf-export-preparation';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import type { GroundTruthCorpusManifest } from '../src/engine/ground-truth-corpus';
import { inferScaleFromAzimuthSilhouettes } from '../src/engine/multiview-scale';
import { prepareVisualHullMask } from '../src/engine/silhouette-mask';
import { carveVisualHull, type VisualHullDescriptor } from '../src/engine/visual-hull';
import { normalizedFrame, sha256 } from './lib/visual-capture-frames';

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      queueMicrotask(() => this.onloadend?.());
    });
  }
}

class NodeOffscreenCanvas extends Canvas {
  toBlob(callback: (blob: Blob) => void, type = 'image/png'): void {
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    callback(new Blob([new Uint8Array(this.encodeSync(format))], { type }));
  }

  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    return new Blob([new Uint8Array(this.encodeSync(format))], { type });
  }
}

Object.assign(globalThis, { FileReader: NodeFileReader, OffscreenCanvas: NodeOffscreenCanvas, ImageData });

const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const manifestPath = resolve(positional[0] ?? 'benchmarks/corpora/abo-pilot.json');
const assetRoot = resolve(positional[1] ?? 'work/abo/pilot');
const artifactRoot = resolve(positional[2] ?? 'tmp/abo-visual-hull');
const outputPath = resolve(positional[3] ?? 'benchmarks/abo-visual-hull-pilot-latest.json');
mkdirSync(artifactRoot, { recursive: true });
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GroundTruthCorpusManifest;
const cases = [];

function averageForegroundColour(frames: Awaited<ReturnType<typeof normalizedFrame>>[]): string {
  const totals = [0, 0, 0];
  let selected = 0;
  for (const frame of frames) {
    const mask = frame.frame.mask!;
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      if (!mask[pixel]) continue;
      const offset = pixel * 4;
      totals[0] += frame.frame.rgba[offset]!;
      totals[1] += frame.frame.rgba[offset + 1]!;
      totals[2] += frame.frame.rgba[offset + 2]!;
      selected += 1;
    }
  }
  return `#${totals.map((value) => Math.round(value / Math.max(1, selected)).toString(16).padStart(2, '0')).join('')}`;
}

async function exportGlb(ir: AssemblyIR): Promise<{ bytes: ArrayBuffer; sha256: string; validation: Awaited<ReturnType<typeof validateGlbStandard>> }> {
  const build = compileAssemblyIR(ir, 'beauty');
  const preparation = preparePortableGltfGeometry(build.root);
  if (preparation.unresolvedNormalMappedMeshes.length > 0) throw new Error(`${ir.name} has unresolved tangent inputs.`);
  const originalWarning = console.warn;
  console.warn = (...warning: unknown[]) => {
    if (warning[0] === 'THREE.GLTFExporter: Merged metalnessMap and roughnessMap textures.') return;
    originalWarning(...warning);
  };
  let exported: ArrayBuffer | Record<string, unknown>;
  try {
    exported = await new GLTFExporter().parseAsync(createPortableGltfExportInput(build.root), {
      binary: true, onlyVisible: true, includeCustomExtensions: true,
    });
  } finally {
    console.warn = originalWarning;
  }
  if (!(exported instanceof ArrayBuffer)) throw new Error(`${ir.name} did not export a binary GLB.`);
  const bytes = canonicalizeGlbBufferViews(exported);
  return { bytes, sha256: sha256(new Uint8Array(bytes)), validation: await validateGlbStandard(bytes) };
}

for (const item of manifest.cases) {
  if (!item.domains.includes('industrial-design')) continue;
  const frames = [];
  const views: Array<{ assetId: string; azimuthDegrees: number; mask: ReturnType<typeof prepareVisualHullMask> }> = [];
  for (const assetId of item.inputAssetIds) {
    const asset = item.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.kind !== 'input-image' || asset.relativeAzimuthDegrees === undefined) throw new Error(`${item.id}/${assetId} is not a relative-azimuth image.`);
    const frame = await normalizedFrame(resolve(assetRoot, asset.relativePath));
    frames.push(frame);
    views.push({
      assetId,
      azimuthDegrees: asset.relativeAzimuthDegrees,
      mask: prepareVisualHullMask(frame.frame.mask!, frame.frame.width, frame.frame.height),
    });
  }
  const scale = inferScaleFromAzimuthSilhouettes(views.map((view, index) => ({
    id: view.assetId,
    azimuthDegrees: view.azimuthDegrees,
    aspectWidthOverHeight: frames[index]!.aspect,
    confidence: 0.9,
  })), item.listingDimensionsMm.height);
  if (scale.status !== 'measured') throw new Error(`${item.id} metric scale is blocked: ${scale.blockers.join(', ')}`);
  const bounds: VisualHullDescriptor['bounds'] = {
    min: [-scale.widthMm / 2, -scale.heightMm / 2, -scale.depthMm / 2],
    max: [scale.widthMm / 2, scale.heightMm / 2, scale.depthMm / 2],
  };
  const baseDescriptor: VisualHullDescriptor = {
    projection: 'orthographic',
    boundsSpace: 'component-local',
    bounds,
    resolution: 48,
    triangleBudget: 1_400_000,
    views: views.map((view) => ({
      axis: 'azimuth', azimuthDegrees: view.azimuthDegrees, confidence: 0.9, mask: view.mask.rows,
    })),
  };
  const candidates = [0, 1, 2].map((toleranceVoxels) => {
    const descriptor: VisualHullDescriptor = toleranceVoxels === 0
      ? baseDescriptor
      : { ...baseDescriptor, silhouetteToleranceVoxels: toleranceVoxels };
    return { toleranceVoxels, descriptor, result: carveVisualHull(descriptor) };
  }).sort((left, right) => Number(right.result.status === 'carved') - Number(left.result.status === 'carved')
    || right.result.minimumViewIoU - left.result.minimumViewIoU
    || left.toleranceVoxels - right.toleranceVoxels);
  const selected = candidates[0]!;
  const descriptor = selected.descriptor;
  const carved = selected.result;
  const recoveryAttempts = candidates.slice().sort((left, right) => left.toleranceVoxels - right.toleranceVoxels)
    .map((attempt) => ({
      toleranceVoxels: attempt.toleranceVoxels,
      status: attempt.result.status,
      minimumViewIoU: attempt.result.minimumViewIoU,
      confidenceWeightedIoU: attempt.result.confidenceWeightedIoU,
      selected: attempt === selected,
    }));
  if (carved.status !== 'carved') throw new Error(`${item.id} has no shared visual-hull volume after bounded recovery.`);
  const surface: SurfaceFinishIR = /lamp|fan/i.test(item.title) ? 'coated-metal' : 'molded-polymer';
  const ir: AssemblyIR = {
    schema: 'morphloom.assembly/0.1',
    name: `${item.id}-multiview-blockout`,
    units: 'mm',
    metadata: {
      assetKind: 'product',
      qualityTarget: 'semi-professional-editable',
      evidenceDeliveryReady: false,
      evidenceUnresolvedCapabilities: 'semantic part decomposition, concavity, physical material zones, production interfaces',
      benchmarkSource: manifest.id,
      benchmarkCase: item.id,
    },
    components: [{
      id: 'visual_hull_blockout',
      name: `${item.title} visual hull blockout`,
      category: 'enclosure',
      materialName: surface,
      detail: 'Four-view metric silhouette envelope; semantic parts and concavities remain unresolved.',
      geometry: { op: 'visualHull', descriptor },
      material: {
        color: averageForegroundColour(frames), surface,
        roughness: surface === 'coated-metal' ? 0.48 : 0.72,
        metalness: surface === 'coated-metal' ? 0.72 : 0.02,
        microNormalStrength: 0.12,
      },
      evidence: { status: 'measured', source: `${manifest.id}/${item.id}/four-spin-silhouettes` },
    }],
  };
  const first = await exportGlb(ir);
  const repeat = await exportGlb(structuredClone(ir));
  const artifactPath = resolve(artifactRoot, `${item.id}.glb`);
  writeFileSync(artifactPath, Buffer.from(first.bytes));
  cases.push({
    id: item.id,
    status: first.validation.status === 'pass' && first.sha256 === repeat.sha256
      && carved.minimumViewIoU >= 0.75 && carved.confidenceWeightedIoU >= 0.85 ? 'blockout-ready' : 'blocked',
    artifactPath,
    artifactBytes: first.bytes.byteLength,
    artifactSha256: first.sha256,
    deterministic: first.sha256 === repeat.sha256,
    validation: first.validation,
    metricScale: scale,
    silhouettePreparation: views.map((view) => ({ assetId: view.assetId, ...view.mask })),
    visualHull: {
      triangles: carved.triangleCount,
      occupiedVoxelCount: carved.occupiedVoxelCount,
      minimumViewIoU: carved.minimumViewIoU,
      confidenceWeightedIoU: carved.confidenceWeightedIoU,
      viewAgreement: carved.viewAgreement,
      recoveryAttempts,
    },
    productionRelease: false,
    productionBlockers: [
      'single visual-hull blockout is not semantic editable part decomposition',
      'concavity and internal interfaces are not resolved by silhouettes',
      'average foreground colour is not a calibrated PBR material reconstruction',
      'candidate has not yet been compared with the reference GLB or img2threejs',
    ],
  });
}

const report = {
  schema: 'morphloom.abo-visual-hull-pilot/0.1',
  pass: cases.length === 2 && cases.every((item) => item.status === 'blockout-ready'),
  productionReady: false,
  cases,
  inputManifestSha256: createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
  limitation: 'Passing means deterministic, standards-valid multi-view blockouts only. Production and competitor claims remain blocked by the listed semantic, concavity, PBR, and same-input comparison gaps.',
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  pass: report.pass,
  productionReady: report.productionReady,
  cases: cases.map((item) => ({ id: item.id, status: item.status, minimumViewIoU: item.visualHull.minimumViewIoU })),
}, null, 2));
if (process.argv.includes('--require-pass') && !report.pass) process.exitCode = 1;
