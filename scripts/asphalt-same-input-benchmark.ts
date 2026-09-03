import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, ImageData } from '@napi-rs/canvas';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { applyReferenceMaterialEvidence } from '../src/engine/reference-material-evidence';
import {
  auditReferenceSurfaceEvidence,
  deriveMaskedReferenceSurface,
  quantizeReferenceHeightField,
} from '../src/engine/reference-surface';
import {
  delightReferenceProjection,
  extendOpaqueProjectionColors,
  isReferenceDelightAccepted,
} from '../src/engine/reference-projection-image';
import { exportCanonicalGlb } from './lib/semantic-product-pilot';
import { decodeReferenceImage } from './lib/reference-image-decoder';

const SOURCE = resolve('public/local-references/7e754a7eebdfefdb-morphloom-asphalt-reference.jpg');
const IR = resolve('outputs/asphalt-reference-conditioned.json');
const COMPETITOR_REPORT = resolve('tmp/asphalt-same-input/img2threejs-report.json');
const OUT = resolve('tmp/asphalt-same-input');
const BENCHMARK = resolve('benchmarks/asphalt-same-input-latest.json');
const IMG2THREEJS_COMMIT = '9fbd0ca5bbcc3b13bebe712745d6784d33db0b85';

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

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function makeTexture(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  colourSpace: THREE.ColorSpace,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = colourSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function packRoughness(source: Uint8ClampedArray): Uint8ClampedArray {
  const packed = new Uint8ClampedArray(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    packed[offset] = 255;
    packed[offset + 1] = source[offset]!;
    packed[offset + 2] = 255;
    packed[offset + 3] = 255;
  }
  return packed;
}

function disposeRoot(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry instanceof THREE.BufferGeometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.Material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  root.clear();
}

function luminanceStats(rgba: Uint8ClampedArray): { mean: number; p05: number; p50: number; p95: number } {
  const values = new Uint8Array(rgba.length / 4);
  let sum = 0;
  for (let offset = 0, index = 0; offset < rgba.length; offset += 4, index += 1) {
    const value = Math.round(rgba[offset]! * 0.2126 + rgba[offset + 1]! * 0.7152 + rgba[offset + 2]! * 0.0722);
    values[index] = value;
    sum += value;
  }
  values.sort();
  const percentile = (fraction: number) => values[Math.floor((values.length - 1) * fraction)]! / 255;
  return { mean: sum / values.length / 255, p05: percentile(0.05), p50: percentile(0.5), p95: percentile(0.95) };
}

function loadNeutralRenderEvidence(expectedSources: { morphloom: string; img2threejs: string }) {
  const paths = {
    morphloomTop: resolve(OUT, 'renders/morphloom/top.json'),
    img2threejsTop: resolve(OUT, 'renders/img2threejs/top.json'),
    morphloomGrazing: resolve(OUT, 'renders/morphloom/grazing.json'),
    img2threejsGrazing: resolve(OUT, 'renders/img2threejs/grazing.json'),
  };
  if (Object.values(paths).some((path) => !existsSync(path))) {
    return { status: 'pending' as const, blockers: ['top and grazing Blender render reports are required'] };
  }
  const reports = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, JSON.parse(readFileSync(path, 'utf8'))])) as Record<string, {
    protocol: string;
    viewId: string;
    blenderVersion: string;
    sourceSha256: string;
    renderSha256: string;
    camera: unknown;
    renderSettings: unknown;
    studio: unknown;
  }>;
  const values = Object.values(reports);
  const locked = (report: typeof values[number]) => JSON.stringify({
    protocol: report.protocol,
    viewId: report.viewId,
    blenderVersion: report.blenderVersion,
    camera: report.camera,
    renderSettings: report.renderSettings,
    studio: report.studio,
  });
  const blockers = [
    reports.morphloomTop?.sourceSha256 !== expectedSources.morphloom
      || reports.morphloomGrazing?.sourceSha256 !== expectedSources.morphloom
      ? 'Morphloom render does not match the latest GLB hash' : undefined,
    reports.img2threejsTop?.sourceSha256 !== expectedSources.img2threejs
      || reports.img2threejsGrazing?.sourceSha256 !== expectedSources.img2threejs
      ? 'img2threejs render does not match the latest GLB hash' : undefined,
    locked(reports.morphloomTop!) !== locked(reports.img2threejsTop!) ? 'top render protocols differ' : undefined,
    locked(reports.morphloomGrazing!) !== locked(reports.img2threejsGrazing!) ? 'grazing render protocols differ' : undefined,
  ].filter((value): value is string => Boolean(value));
  return {
    status: blockers.length === 0 ? 'pass' as const : 'blocked' as const,
    blockers,
    protocol: reports.morphloomTop!.protocol,
    blenderVersion: reports.morphloomTop!.blenderVersion,
    renders: Object.fromEntries(Object.entries(reports).map(([id, report]) => [id, {
      viewId: report.viewId,
      sourceSha256: report.sourceSha256,
      renderSha256: report.renderSha256,
    }])),
    limitation: 'Locked renders prove comparable delivery views; perceptual preference still needs a blind rating.',
  };
}

async function deliveredRelief(path: string) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const primitives = document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives()).map((primitive) => {
    const positions = primitive.getAttribute('POSITION')?.getArray();
    const normals = primitive.getAttribute('NORMAL')?.getArray();
    if (!positions || positions.length < 9) return undefined;
    const y: number[] = [];
    let normalY = 0;
    let minimumY = Infinity;
    let maximumY = -Infinity;
    for (let offset = 0; offset < positions.length; offset += 3) {
      const vertexNormalY = normals ? Number(normals[offset + 1]) : 0;
      normalY += vertexNormalY;
      if (vertexNormalY <= 0.5) continue;
      const value = Number(positions[offset + 1]);
      y.push(value);
      minimumY = Math.min(minimumY, value);
      maximumY = Math.max(maximumY, value);
    }
    if (y.length < 3) return undefined;
    const meanNormalY = normalY / (positions.length / 3);
    const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
    const deviation = Math.sqrt(y.reduce((sum, value) => sum + (value - meanY) ** 2, 0) / y.length);
    return {
      vertices: y.length,
      meanNormalY,
      minimumMm: minimumY * 1_000,
      maximumMm: maximumY * 1_000,
      rmsDeviationMm: deviation * 1_000,
      peakToValleyMm: (maximumY - minimumY) * 1_000,
    };
  }).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const top = [...primitives].sort((left, right) => right.meanNormalY - left.meanNormalY || right.vertices - left.vertices)[0];
  if (!top) throw new Error(`No delivered primitive was found in ${path}.`);
  return { top, primitives };
}

async function writeVerifiedGlb(
  root: THREE.Object3D,
  repeatRootFactory: () => THREE.Object3D,
  outputPath: string,
) {
  const first = await exportCanonicalGlb(root);
  const firstBytes = new Uint8Array(first);
  const firstHash = sha256(firstBytes);
  writeFileSync(outputPath, firstBytes);
  const validation = await validateGlbStandard(first);
  const relief = await deliveredRelief(outputPath);
  disposeRoot(root);
  const repeatRoot = repeatRootFactory();
  const second = await exportCanonicalGlb(repeatRoot);
  const secondBytes = new Uint8Array(second);
  const secondHash = sha256(secondBytes);
  disposeRoot(repeatRoot);
  return {
    path: outputPath,
    bytes: firstBytes.byteLength,
    sha256: firstHash,
    repeatSha256: secondHash,
    byteDeterministic: firstHash === secondHash,
    validation,
    relief,
  };
}

async function main(): Promise<void> {
  const phase = (label: string) => process.stderr.write(`[asphalt-same-input] ${label}\n`);
  phase('load-source');
  mkdirSync(resolve(OUT, 'morphloom'), { recursive: true });
  mkdirSync(resolve(OUT, 'img2threejs-delivery'), { recursive: true });
  const sourceBytes = new Uint8Array(readFileSync(SOURCE));
  const sourceFingerprint = sha256(sourceBytes);
  const source = await decodeReferenceImage(sourceBytes);
  const opaque = extendOpaqueProjectionColors(source.rgba, source.width, source.height);
  const delighted = delightReferenceProjection(opaque.rgba, source.width, source.height);
  if (!isReferenceDelightAccepted(delighted.metrics)) throw new Error('Morphloom de-lighting failed its acceptance contract.');
  const mask = new Uint8Array(source.width * source.height).fill(1);
  const derivation = deriveMaskedReferenceSurface([{
    id: 'same-input-asphalt',
    fingerprint: sourceFingerprint,
    width: source.width,
    height: source.height,
    rgba: delighted.rgba,
    mask,
  }], { textureSize: 512, strength: 1.25 });
  const surfaceAudit = auditReferenceSurfaceEvidence(derivation.analysis);
  if (!derivation.materialSuitability.pass || !surfaceAudit.pass) {
    throw new Error([...derivation.materialSuitability.blockers, ...surfaceAudit.blockers].join('; '));
  }

  const morphloomIr = JSON.parse(readFileSync(IR, 'utf8')) as AssemblyIR;
  const morphloomComponent = morphloomIr.components[0]!;
  if (morphloomComponent.geometry.op !== 'surfacePatch') throw new Error('Asphalt IR must contain a surface patch.');
  morphloomComponent.geometry.referenceRelief = quantizeReferenceHeightField(
    derivation.analysis,
    99,
    128,
    2.6,
    0.8,
    sourceFingerprint,
  );
  morphloomComponent.material.color = '#ffffff';
  if (!morphloomComponent.material.referenceProjection) throw new Error('Asphalt IR must retain its observed/unobserved surface partition.');
  morphloomComponent.material.referenceProjection.unobservedSurface = {
    pattern: 'grain',
    color: '#252729',
    roughness: 0.96,
    metalness: 0,
    colorVariation: 0.12,
    microNormalStrength: 0.6,
    textureScale: [3, 3],
  };
  const morphloomBuild = compileAssemblyIR(morphloomIr, 'beauty');
  phase('morphloom-compiled');
  const morphloomMaterial = applyReferenceMaterialEvidence(morphloomBuild.root, derivation, {
    repeat: 1,
    albedoMode: 'source-colour',
    materialFilter: (material) => !material.name.endsWith('_cut_edges'),
  });
  if (morphloomMaterial.status !== 'applied') throw new Error(morphloomMaterial.blockers.join('; '));
  const morphloomPath = resolve(OUT, 'morphloom/morphloom-asphalt.glb');
  phase('morphloom-export-start');
  const morphloomDelivery = await writeVerifiedGlb(morphloomBuild.root, () => {
    const repeatBuild = compileAssemblyIR(structuredClone(morphloomIr), 'beauty');
    const receipt = applyReferenceMaterialEvidence(repeatBuild.root, derivation, {
      repeat: 1,
      albedoMode: 'source-colour',
      materialFilter: (material) => !material.name.endsWith('_cut_edges'),
    });
    if (receipt.status !== 'applied') throw new Error(receipt.blockers.join('; '));
    return repeatBuild.root;
  }, morphloomPath);
  phase('morphloom-export-complete');
  phase('morphloom-disposed');

  const competitor = JSON.parse(readFileSync(COMPETITOR_REPORT, 'utf8')) as {
    confidence: number;
    verdict: string;
    diagnostics: { mask: { foregroundCoverage: number }; mapStats: { roughnessBase: number; normalStrength: number } };
    maps: Record<'albedo' | 'roughness' | 'height' | 'normal' | 'ao', { path: string }>;
  };
  const decodedMaps = Object.fromEntries(await Promise.all(Object.entries(competitor.maps).map(async ([channel, map]) => {
    const bytes = new Uint8Array(readFileSync(map.path));
    return [channel, { ...await decodeReferenceImage(bytes), sha256: sha256(bytes) }];
  }))) as Record<'albedo' | 'roughness' | 'height' | 'normal' | 'ao', Awaited<ReturnType<typeof decodeReferenceImage>> & { sha256: string }>;

  // Use the exact same closed carrier and bounds for delivery comparison.
  // img2threejs applies its height map as a runtime bump/displacement shader;
  // glTF has no portable bump/displacement channel, so no Morphloom-only bake
  // is granted to the competitor before the DCC reopen check.
  const competitorIr = structuredClone(morphloomIr);
  const competitorComponent = competitorIr.components[0]!;
  if (competitorComponent.geometry.op !== 'surfacePatch') throw new Error('Competitor carrier must contain a surface patch.');
  competitorComponent.geometry.macroAmplitude = 0;
  competitorComponent.geometry.aggregateAmplitude = 0;
  delete competitorComponent.geometry.referenceRelief;
  competitorComponent.material.color = '#ffffff';
  competitorComponent.material.roughness = competitor.diagnostics.mapStats.roughnessBase;
  competitorComponent.material.microNormalStrength = competitor.diagnostics.mapStats.normalStrength;
  const createCompetitorBuild = () => {
    const build = compileAssemblyIR(structuredClone(competitorIr), 'beauty');
    build.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
        if (material.name.endsWith('_cut_edges')) continue;
        material.map = makeTexture(decodedMaps.albedo.rgba, decodedMaps.albedo.width, decodedMaps.albedo.height, THREE.SRGBColorSpace);
        const packed = packRoughness(decodedMaps.roughness.rgba);
        material.roughnessMap = makeTexture(packed, decodedMaps.roughness.width, decodedMaps.roughness.height, THREE.NoColorSpace);
        material.metalnessMap = material.roughnessMap;
        material.normalMap = makeTexture(decodedMaps.normal.rgba, decodedMaps.normal.width, decodedMaps.normal.height, THREE.NoColorSpace);
        material.normalScale.setScalar(competitor.diagnostics.mapStats.normalStrength);
        // A bump map has no portable glTF core channel. Preserve its source
        // hash in the receipt, but do not emit Three's optional
        // EXT_materials_bump payload as if Blender/Unity/Unreal were required
        // to reproduce it.
        material.bumpMap = null;
        // Three's exporter emits EXT_materials_bump even without a map when
        // bumpScale differs from its default. Reset the delivery material to
        // the default so the portable GLB does not advertise an empty custom
        // extension.
        material.bumpScale = 1;
        material.aoMap = makeTexture(decodedMaps.ao.rgba, decodedMaps.ao.width, decodedMaps.ao.height, THREE.NoColorSpace);
        material.aoMapIntensity = 0.38;
        material.metalness = 0;
        material.userData.img2threejsNativeSurfaceDelivery = {
          pinnedCommit: IMG2THREEJS_COMMIT,
          bumpMapRuntimeOnly: true,
          bumpMapOmittedFromPortableGlb: true,
          bumpScale: 0.05,
          noForeignGeometryBakeGranted: true,
        };
        material.needsUpdate = true;
      }
    });
    return build;
  };
  const competitorBuild = createCompetitorBuild();
  phase('img2threejs-compiled');
  const competitorPath = resolve(OUT, 'img2threejs-delivery/img2threejs-asphalt.glb');
  const competitorDelivery = await writeVerifiedGlb(
    competitorBuild.root,
    () => createCompetitorBuild().root,
    competitorPath,
  );
  phase('img2threejs-export-complete');

  const sourceLuma = luminanceStats(delighted.rgba);
  const morphloomLuma = luminanceStats(derivation.sourceAlbedoRgba);
  const competitorLuma = luminanceStats(decodedMaps.albedo.rgba);
  const neutralRenderEvidence = loadNeutralRenderEvidence({
    morphloom: morphloomDelivery.sha256,
    img2threejs: competitorDelivery.sha256,
  });
  const report = {
    schema: 'morphloom.asphalt-same-input/0.1',
    generatedAt: new Date().toISOString(),
    claimScope: 'Same-source asphalt appearance extraction and delivered GLB surface relief only; not all-domain superiority.',
    protocol: {
      sameSourceBytes: true,
      source: SOURCE,
      sourceSha256: sourceFingerprint,
      sourcePixels: [source.width, source.height],
      equalClosedCarrierBounds: true,
      dccInspectionInput: 'canonical exported GLB reopened through @gltf-transform/core',
      competitorPinnedCommit: IMG2THREEJS_COMMIT,
      competitorNativePolicy: 'reference maps preserved; runtime bump is not converted with Morphloom geometry code',
    },
    morphloom: {
      materialReceipt: morphloomMaterial,
      materialSuitability: derivation.materialSuitability,
      surfaceAudit,
      referenceMetrics: derivation.analysis.metrics,
      albedoLuminance: morphloomLuma,
      delivery: morphloomDelivery,
    },
    img2threejs: {
      extractorVerdict: competitor.verdict,
      extractorConfidence: competitor.confidence,
      foregroundCoverage: competitor.diagnostics.mask.foregroundCoverage,
      warnings: (JSON.parse(readFileSync(COMPETITOR_REPORT, 'utf8')) as { warnings?: string[] }).warnings ?? [],
      albedoLuminance: competitorLuma,
      mapSha256: Object.fromEntries(Object.entries(decodedMaps).map(([channel, map]) => [channel, map.sha256])),
      delivery: competitorDelivery,
    },
    sourceAlbedoLuminance: sourceLuma,
    neutralRenderEvidence,
    comparison: {
      morphloomMeanLumaAbsoluteError: Math.abs(morphloomLuma.mean - sourceLuma.mean),
      img2threejsMeanLumaAbsoluteError: Math.abs(competitorLuma.mean - sourceLuma.mean),
      morphloomDeliveredReliefMm: morphloomDelivery.relief.top.peakToValleyMm,
      img2threejsDeliveredReliefMm: competitorDelivery.relief.top.peakToValleyMm,
      morphloomPreservesDccRelief: morphloomDelivery.relief.top.peakToValleyMm > 0.25,
      img2threejsPreservesDccRelief: competitorDelivery.relief.top.peakToValleyMm > 0.25,
      technicalWinnerForThisSurfaceCase: morphloomDelivery.validation.status === 'pass'
        && competitorDelivery.validation.status === 'pass'
        && morphloomDelivery.byteDeterministic
        && morphloomLuma.mean !== competitorLuma.mean
        && Math.abs(morphloomLuma.mean - sourceLuma.mean) < Math.abs(competitorLuma.mean - sourceLuma.mean)
        && morphloomDelivery.relief.top.peakToValleyMm > 0.25
        && competitorDelivery.relief.top.peakToValleyMm <= 0.25
        ? 'morphloom' : 'unresolved',
      blindPerceptualWinner: 'pending',
    },
  };
  writeFileSync(BENCHMARK, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
