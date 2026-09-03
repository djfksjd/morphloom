import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { Canvas, ImageData } from '@napi-rs/canvas';
import type * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { compileAssemblyIR, waitForReferenceProjections } from '../src/engine/assembly-compiler';
import { ASPHALT_SURFACE_BENCHMARK_IR } from '../src/engine/asphalt-surface-benchmark';
import { buildCharacter } from '../src/engine/character';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { createPortableGltfExportInput, preparePortableGltfGeometry } from '../src/engine/gltf-export-preparation';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { canonicalizeGlbBufferViews } from '../src/engine/glb-canonicalization';
import { exportMillimetreStlBytes } from '../src/engine/static-mesh-roundtrip';
import { buildOrnateKnife } from '../src/engine/knife';
import { LAUREL_HOMES_BUILDING_B_IR } from '../src/engine/laurel-homes-building-b';
import { parseOhpk } from '../src/engine/ohpk';
import { DEFAULT_KNIFE_SPEC, FIELD_HUMAN_SPEC } from '../src/types';
import { DELIVERY_PIPELINE_REVISION } from '../src/engine/delivery-validation';

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
    const bytes = this.encodeSync(format);
    callback(new Blob([new Uint8Array(bytes)], { type }));
  }

  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    // GLTFExporter assigns image buffer views when encoding promises settle.
    // Native parallel encoders can finish in a different order, producing
    // byte-different (but semantically equal) GLBs. Synchronous encoding keeps
    // fixture order stable so a source hash is meaningful across clean runs.
    const bytes = this.encodeSync(format);
    return new Blob([new Uint8Array(bytes)], { type });
  }
}

Object.assign(globalThis, {
  FileReader: NodeFileReader,
  OffscreenCanvas: NodeOffscreenCanvas,
  ImageData,
});

interface Fixture {
  id: string;
  domain: 'architecture' | 'industrial-design' | 'electronics' | 'animation-game' | '3d-printing';
  build: () => Promise<THREE.Object3D>;
}

const outputDirectoryArgument = process.argv[2];
if (!outputDirectoryArgument) {
  throw new Error('Usage: npm run benchmark:fixtures -- <output-directory>');
}
const outputDirectory = resolve(outputDirectoryArgument);
mkdirSync(outputDirectory, { recursive: true });

const fixtures: Fixture[] = [
  {
    id: 'laurel-homes-architecture',
    domain: 'architecture',
    build: async () => compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR, 'beauty').root,
  },
  {
    id: 'ornate-knife-product',
    domain: 'industrial-design',
    build: async () => buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty').root,
  },
  {
    id: 'cooling-electronics-assembly',
    domain: 'electronics',
    build: async () => compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty').root,
  },
  {
    id: 'field-human-runtime',
    domain: 'animation-game',
    build: async () => {
      const bytes = new Uint8Array(readFileSync(resolve('public/assets/oxihuman-core-v1.ohpk')));
      const pack = await parseOhpk(bytes, async (payload) => new Uint8Array(inflateRawSync(payload)));
      return buildCharacter(pack, FIELD_HUMAN_SPEC, 'beauty').root;
    },
  },
  {
    id: 'asphalt-print-surface',
    domain: '3d-printing',
    build: async () => compileAssemblyIR(ASPHALT_SURFACE_BENCHMARK_IR, 'beauty').root,
  },
];

async function generateFixture(fixture: Fixture) {
  const root = await fixture.build();
  await waitForReferenceProjections(root);
  const preparation = preparePortableGltfGeometry(root);
  if (preparation.unresolvedNormalMappedMeshes.length > 0) {
    throw new Error(`${fixture.id} has normal-mapped meshes without portable tangent inputs: ${preparation.unresolvedNormalMappedMeshes.join(', ')}`);
  }
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args[0] === 'THREE.GLTFExporter: Merged metalnessMap and roughnessMap textures.') return;
    originalWarn(...args);
  };
  let result: ArrayBuffer | Record<string, unknown>;
  try {
    result = await new GLTFExporter().parseAsync(createPortableGltfExportInput(root), {
      binary: true,
      onlyVisible: true,
      includeCustomExtensions: true,
      animations: root.animations,
    });
  } finally {
    console.warn = originalWarn;
  }
  if (!(result instanceof ArrayBuffer)) throw new Error(`${fixture.id} did not export binary GLB.`);
  return { deliveryBytes: canonicalizeGlbBufferViews(result), preparation, root };
}

async function exportFixture(fixture: Fixture) {
  const { deliveryBytes, preparation, root } = await generateFixture(fixture);
  const validation = await validateGlbStandard(deliveryBytes);
  if (validation.status !== 'pass') {
    writeFileSync(resolve(outputDirectory, `${fixture.id}.rejected.glb`), Buffer.from(deliveryBytes));
    throw new Error(`${fixture.id} failed exact-byte validation: ${validation.issueCodes.join(', ') || validation.status}`);
  }
  const sha256 = createHash('sha256').update(new Uint8Array(deliveryBytes)).digest('hex');
  const repeat = await generateFixture(fixture);
  const repeatSha256 = createHash('sha256').update(new Uint8Array(repeat.deliveryBytes)).digest('hex');
  if (sha256 !== repeatSha256) {
    throw new Error(`${fixture.id} produced byte-different GLBs from the same input.`);
  }
  const path = resolve(outputDirectory, `${fixture.id}.glb`);
  writeFileSync(path, Buffer.from(deliveryBytes));
  let printDelivery: {
    file: string;
    bytes: number;
    sha256: string;
    repeatSha256: string;
    byteDeterministic: true;
    coordinateUnit: 'mm';
    axisConvention: 'print-z-up';
  } | undefined;
  if (fixture.domain === '3d-printing') {
    const stlBytes = exportMillimetreStlBytes(root);
    const repeatStlBytes = exportMillimetreStlBytes(repeat.root);
    const stlSha256 = createHash('sha256').update(stlBytes).digest('hex');
    const repeatStlSha256 = createHash('sha256').update(repeatStlBytes).digest('hex');
    if (stlSha256 !== repeatStlSha256) {
      throw new Error(`${fixture.id} produced byte-different STL files from the same input.`);
    }
    const stlPath = resolve(outputDirectory, `${fixture.id}.stl`);
    writeFileSync(stlPath, stlBytes);
    printDelivery = {
      file: stlPath,
      bytes: stlBytes.byteLength,
      sha256: stlSha256,
      repeatSha256: repeatStlSha256,
      byteDeterministic: true,
      coordinateUnit: 'mm',
      axisConvention: 'print-z-up',
    };
  }
  return {
    id: fixture.id,
    domain: fixture.domain,
    file: path,
    bytes: deliveryBytes.byteLength,
    sha256,
    repeatSha256,
    byteDeterministic: true,
    preparation,
    validation,
    ...(printDelivery ? { printDelivery } : {}),
  };
}

const startedAt = new Date().toISOString();
const results = [];
for (const fixture of fixtures) {
  const result = await exportFixture(fixture);
  results.push(result);
  console.log(`${result.id}: ${result.bytes.toLocaleString()} bytes · exact GLB pass`);
}
const manifest = {
  schema: 'morphloom.cross-domain-glb-fixtures/0.1',
  compilerRevision: DELIVERY_PIPELINE_REVISION,
  generatedAt: startedAt,
  pass: results.length === fixtures.length,
  fixtureCount: results.length,
  results,
};
writeFileSync(resolve(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
