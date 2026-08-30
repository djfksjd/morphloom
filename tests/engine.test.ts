import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildCharacter, deriveBodyTopology } from '../src/engine/character';
import { buildOrnateKnife, createOrnateKnifeIR } from '../src/engine/knife';
import { parseOhpk } from '../src/engine/ohpk';
import { buildProduct } from '../src/engine/product';
import { analyzeTopology } from '../src/engine/topology';
import { applyProductPrompt, applyPrompt } from '../src/engine/prompt';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, DEFAULT_SPEC } from '../src/types';

async function loadPack() {
  const bytes = new Uint8Array(readFileSync('public/assets/oxihuman-core-v1.ohpk'));
  return parseOhpk(bytes, async (payload) => new Uint8Array(inflateRawSync(payload)));
}

describe('OHPK human pipeline', () => {
  it('reconstructs the CC0 base and excludes helper geometry', async () => {
    const pack = await loadPack();
    expect(pack.positions.length / 3).toBe(21_833);
    expect(pack.targets).toHaveLength(38);
    const topology = deriveBodyTopology(pack);
    expect(topology.boundary).toBeGreaterThan(14_000);
    expect(topology.boundary).toBeLessThan(21_833);
    expect(topology.indices.length / 3).toBeGreaterThan(20_000);
    const build = buildCharacter(pack, DEFAULT_SPEC, 'beauty');
    expect(build.metrics.vertices).toBe(topology.boundary);
    expect(build.metrics.heightMeters).toBeCloseTo(1.78, 2);
  });

  it('turns Korean agent directions into deterministic CharacterIR changes', () => {
    const result = applyPrompt('185cm의 근육질 남성, 짧은 머리와 검정 전투복', DEFAULT_SPEC);
    expect(result.spec.heightCm).toBe(185);
    expect(result.spec.muscle).toBeGreaterThan(DEFAULT_SPEC.muscle);
    expect(result.spec.genderBlend).toBe(0.1);
    expect(result.spec.suitColor).toBe('#17191f');
  });
});

describe('AssemblyIR product pipeline', () => {
  it('builds a detailed phone as independently named parts', () => {
    const build = buildProduct(DEFAULT_PRODUCT_SPEC, 'beauty');
    expect(build.metrics.parts).toBeGreaterThanOrEqual(90);
    expect(build.parts.filter((part) => part.category === 'camera').length).toBeGreaterThanOrEqual(20);
    expect(build.parts.some((part) => part.id === 'soc')).toBe(true);
    expect(build.parts.some((part) => part.id === 'smd_24')).toBe(true);
  });

  it('compiles the ornate knife from the public generic AssemblyIR', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    expect(ir.schema).toBe('morphloom.assembly/0.1');
    expect(ir.components.some((part) => part.geometry.op === 'bladeLoft')).toBe(true);
    expect(ir.components.some((part) => part.id === 'grip_wrap')).toBe(true);
    const build = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    expect(build.metrics.parts).toBeGreaterThanOrEqual(15);
    expect(build.metrics.heightMeters).toBeGreaterThan(0.4);
  });

  it('keeps every knife component closed and manifold', () => {
    const build = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    const report = analyzeTopology(build.root);
    expect(report.boundaryEdges).toBe(0);
    expect(report.nonManifoldEdges).toBe(0);
    expect(report.degenerateTriangles).toBe(0);
    expect(report.watertightMeshes).toBe(report.meshes);
  });

  it('switches product families from a single Korean prompt', () => {
    const knife = applyProductPrompt('장식 단검을 만들어줘', DEFAULT_PRODUCT_SPEC);
    expect(knife.spec.kind).toBe('ornate-knife');
    const phone = applyProductPrompt('스마트폰 부품 분해도로 바꿔줘', knife.spec);
    expect(phone.spec.kind).toBe('smartphone');
  });
});
