import { zlibSync } from 'fflate';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compileAssemblyIR, validateAssemblyIR } from '../src/engine/assembly-compiler';
import { ASPHALT_SURFACE_BENCHMARK_IR } from '../src/engine/asphalt-surface-benchmark';
import { snapshotScene } from '../src/engine/delivery-validation';
import {
  analyzeReferenceSurface,
  quantizeReferenceHeightField,
  sampleQuantizedReferenceHeight,
} from '../src/engine/reference-surface';
import { decodePng } from '../scripts/lib/png-decoder';

function makeRgba(width: number, height: number, valueAt: (x: number, y: number) => number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = Math.max(0, Math.min(255, Math.round(valueAt(x, y))));
      pixels.set([value, value, value, 255], offset);
    }
  }
  return pixels;
}

function deterministicIrregularRgba(width = 32, height = 32): Uint8ClampedArray {
  let state = 0x61c8_8647;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffff_ffff;
  };
  return makeRgba(width, height, (x, y) => {
    const angular = ((x * 17 + y * 29 + Math.floor(random() * 211)) % 256);
    const pit = ((x - 9) ** 2 + (y - 21) ** 2 < 18) ? -72 : 0;
    return angular + pit;
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffff_ffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffff_ffff) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  const chunk = new Uint8Array(12 + data.length);
  chunk.set(u32(data.length), 0);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  chunk.set(u32(crc32(crcInput)), 8 + data.length);
  return chunk;
}

function makeTinyRgbaPng(): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(2), 0);
  ihdr.set(u32(2), 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const scanlines = new Uint8Array([
    0, 255, 0, 0, 255, 0, 255, 0, 128,
    0, 0, 0, 255, 255, 255, 255, 255, 64,
  ]);
  const chunks = [pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibSync(scanlines)), pngChunk('IEND', new Uint8Array())];
  const bytes = new Uint8Array(signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  bytes.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

describe('reference-conditioned surface analysis', () => {
  it('is deterministic and distinguishes irregular aggregate from a flat swatch', () => {
    const pixels = deterministicIrregularRgba();
    const first = analyzeReferenceSurface(pixels, 32, 32, 1.25);
    const second = analyzeReferenceSurface(pixels, 32, 32, 1.25);
    const flat = analyzeReferenceSurface(makeRgba(32, 32, () => 96), 32, 32, 1.25);

    expect(first.metrics).toEqual(second.metrics);
    expect(Array.from(first.heights)).toEqual(Array.from(second.heights));
    expect(first.metrics.irregularity).toBeGreaterThan(0.7);
    expect(first.metrics.irregularity).toBeGreaterThan(flat.metrics.irregularity + 0.35);
    expect(first.metrics.multiScaleBalance).toBeGreaterThanOrEqual(2 / 3);
    expect(flat.metrics.heightDeviation).toBeLessThan(1e-6);
    expect(Array.from(flat.heights).every(Number.isFinite)).toBe(true);
  });

  it('derives bounded normal and roughness maps instead of trusting image luminance as colour-only detail', () => {
    const analysis = analyzeReferenceSurface(deterministicIrregularRgba(19, 23), 19, 23, 1.4);
    expect(analysis.normalRgba).toHaveLength(19 * 23 * 4);
    expect(analysis.roughnessRgba).toHaveLength(19 * 23 * 4);
    expect(Math.min(...analysis.normalRgba)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...analysis.normalRgba)).toBeLessThanOrEqual(255);
    expect(Math.min(...analysis.roughnessRgba)).toBeGreaterThanOrEqual(184);
    expect(Math.max(...analysis.roughnessRgba)).toBeLessThanOrEqual(255);
  });

  it('rejects malformed or unbounded image analysis requests before allocating large fields', () => {
    expect(() => analyzeReferenceSurface(new Uint8Array(4), 2, 2)).toThrow(/RGBA length/);
    expect(() => analyzeReferenceSurface(new Uint8Array(4), 4097, 4097)).toThrow(/pixel budget/);
    expect(() => analyzeReferenceSurface(makeRgba(2, 2, () => 0), 2, 2, 2.1)).toThrow(/strength/);
  });

  it('quantizes to a bounded portable field and samples with the texture-aligned vertical orientation', () => {
    const analysis = analyzeReferenceSurface(deterministicIrregularRgba(12, 10), 12, 10);
    const first = quantizeReferenceHeightField(analysis, 8, 6, 4.2, 0.9, 'a1b2c3d4');
    const second = quantizeReferenceHeightField(analysis, 8, 6, 4.2, 0.9, 'A1B2C3D4');
    expect(first).toEqual(second);
    expect(first.method).toBe('image-multiscale-height-v2');
    expect(first.samples).toHaveLength(48);
    expect(Math.max(...first.samples)).toBeLessThanOrEqual(32_767);
    expect(Math.min(...first.samples)).toBeGreaterThanOrEqual(-32_767);

    const orientationField = {
      ...first,
      width: 2,
      height: 2,
      samples: [0, 32_767, -32_767, 16_384],
      amplitudeMm: 2,
    };
    expect(sampleQuantizedReferenceHeight(orientationField, 0, 1)).toBeCloseTo(0);
    expect(sampleQuantizedReferenceHeight(orientationField, 1, 1)).toBeCloseTo(2);
    expect(sampleQuantizedReferenceHeight(orientationField, 0, 0)).toBeCloseTo(-2);
  });

  it('rejects height fields that exceed delivery or physical-safety bounds', () => {
    const analysis = analyzeReferenceSurface(deterministicIrregularRgba(8, 8), 8, 8);
    expect(() => quantizeReferenceHeightField(analysis, 129, 129, 4, 0.8, 'a1b2c3d4')).toThrow(/16384/);
    expect(() => quantizeReferenceHeightField(analysis, 8, 8, 0, 0.8, 'a1b2c3d4')).toThrow(/amplitude/);
    expect(() => quantizeReferenceHeightField(analysis, 8, 8, 4, 1.1, 'a1b2c3d4')).toThrow(/blend/);
    expect(() => quantizeReferenceHeightField(analysis, 8, 8, 4, 0.8, '../unsafe')).toThrow(/fingerprint/);
  });
});

describe('bounded PNG ingestion', () => {
  it('decodes a checksum-valid RGBA PNG including alpha', () => {
    const decoded = decodePng(makeTinyRgbaPng());
    expect(decoded).toMatchObject({ width: 2, height: 2 });
    expect(Array.from(decoded.rgba)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 255, 255, 255, 255, 64,
    ]);
  });

  it('fails closed when reference bytes are damaged', () => {
    const bytes = makeTinyRgbaPng();
    bytes[45] ^= 0xff;
    expect(() => decodePng(bytes)).toThrow(/CRC|inflated data/);
  });
});

describe('reference-conditioned surface compilation', () => {
  function referenceIr() {
    const ir = structuredClone(ASPHALT_SURFACE_BENCHMARK_IR);
    const component = ir.components[0]!;
    if (component.geometry.op !== 'surfacePatch') throw new Error('Missing surface fixture.');
    const analysis = analyzeReferenceSurface(deterministicIrregularRgba(), 32, 32, 1.25);
    component.geometry.referenceRelief = quantizeReferenceHeightField(analysis, 32, 32, 4.2, 0.9, '1234abcd');
    component.material.referenceProjection = {
      uri: '/local-references/fixture.png',
      mapping: 'assembly-xz',
      crop: [0, 0, 1, 1],
      boundsMm: [-300, -225, 300, 225],
      fingerprint: '1234abcd',
      relief: { strength: 1.25, maxResolution: 512 },
    };
    return ir;
  }

  it('compiles the same photo field identically with closed topology and assembly-XZ UVs', () => {
    const ir = referenceIr();
    validateAssemblyIR(ir);
    const first = compileAssemblyIR(ir, 'beauty');
    const second = compileAssemblyIR(structuredClone(ir), 'beauty');
    const firstMesh = first.root.getObjectByName('asphalt_core_sample') as THREE.Mesh;
    const secondMesh = second.root.getObjectByName('asphalt_core_sample') as THREE.Mesh;
    const audit = firstMesh.geometry.userData.morphloomSurfaceRelief as Record<string, unknown>;
    expect(audit).toMatchObject({
      method: 'reference-conditioned-multiscale-aggregate-height-field-v4',
      referenceFingerprint: '1234abcd',
      referenceSamples: 1024,
      referenceBlend: 0.9,
    });
    expect(audit).toEqual(secondMesh.geometry.userData.morphloomSurfaceRelief);
    expect(firstMesh.material).toBeInstanceOf(Array);
    expect((firstMesh.material as THREE.Material[])).toHaveLength(2);
    expect(firstMesh.geometry.groups).toEqual([
      { start: 0, count: 192 * 144 * 6, materialIndex: 0 },
      { start: 192 * 144 * 6, count: firstMesh.geometry.getAttribute('position').count - 192 * 144 * 6, materialIndex: 1 },
    ]);
    const position = firstMesh.geometry.getAttribute('position');
    const normal = firstMesh.geometry.getAttribute('normal');
    let inspectedSideTriangles = 0;
    for (let index = 0; index < position.count; index += 3) {
      const faceNormal = new THREE.Vector3(normal.getX(index), normal.getY(index), normal.getZ(index));
      if (Math.abs(faceNormal.y) > 0.2) continue;
      const center = new THREE.Vector3(
        (position.getX(index) + position.getX(index + 1) + position.getX(index + 2)) / 3,
        (position.getY(index) + position.getY(index + 1) + position.getY(index + 2)) / 3,
        (position.getZ(index) + position.getZ(index + 1) + position.getZ(index + 2)) / 3,
      );
      if (Math.abs(center.x) < 0.29 && Math.abs(center.z) < 0.215) continue;
      inspectedSideTriangles += 1;
      expect(faceNormal.x * center.x + faceNormal.z * center.z).toBeGreaterThan(0);
    }
    expect(inspectedSideTriangles).toBeGreaterThan(500);
    expect(Array.from(firstMesh.geometry.getAttribute('position').array)).toEqual(
      Array.from(secondMesh.geometry.getAttribute('position').array),
    );
    expect(first.metrics.topology).toMatchObject({
      pass: true,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      degenerateTriangles: 0,
      referenceReliefMeshes: 1,
      referenceReliefSamples: 1024,
    });
    expect(snapshotScene(first.root)).toMatchObject({
      meshes: 1,
      primitives: 2,
    });
    const uv = firstMesh.geometry.getAttribute('uv');
    const uValues = Array.from({ length: uv.count }, (_, index) => uv.getX(index));
    const vValues = Array.from({ length: uv.count }, (_, index) => uv.getY(index));
    expect(uValues.reduce((minimum, value) => Math.min(minimum, value), Infinity)).toBeCloseTo(0);
    expect(vValues.reduce((minimum, value) => Math.min(minimum, value), Infinity)).toBeCloseTo(0);
    expect(uValues.reduce((maximum, value) => Math.max(maximum, value), -Infinity)).toBeCloseTo(1);
    expect(vValues.reduce((maximum, value) => Math.max(maximum, value), -Infinity)).toBeCloseTo(1);
  });

  it('rejects malformed embedded photo fields at the IR boundary', () => {
    const wrongLength = referenceIr();
    const geometry = wrongLength.components[0]!.geometry;
    if (geometry.op !== 'surfacePatch' || !geometry.referenceRelief) throw new Error('Missing reference field.');
    geometry.referenceRelief.samples.pop();
    expect(() => validateAssemblyIR(wrongLength)).toThrow(/sample count/);

    const outOfRange = referenceIr();
    const invalidGeometry = outOfRange.components[0]!.geometry;
    if (invalidGeometry.op !== 'surfacePatch' || !invalidGeometry.referenceRelief) throw new Error('Missing reference field.');
    invalidGeometry.referenceRelief.samples[0] = 40_000;
    expect(() => validateAssemblyIR(outOfRange)).toThrow(/sample range/);
  });
});
