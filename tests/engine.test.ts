import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildCharacter, deriveBodyTopology } from '../src/engine/character';
import { buildOrnateKnife, createOrnateKnifeIR } from '../src/engine/knife';
import { parseOhpk } from '../src/engine/ohpk';
import { buildProduct } from '../src/engine/product';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { analyzeTopology } from '../src/engine/topology';
import { validateElectricalHarness } from '../src/engine/connectivity';
import { createSurfaceMaterial } from '../src/engine/surface-system';
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
    expect(build.body.geometry.groups).toHaveLength(0);
    expect(build.metrics.surfaces.finishes).toEqual(expect.arrayContaining(['skin', 'hair']));
    expect(build.metrics.surfaces.microNormalMaterials).toBeGreaterThanOrEqual(2);
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
    expect(build.metrics.parts).toBeGreaterThanOrEqual(160);
    expect(build.parts.filter((part) => part.category === 'camera').length).toBeGreaterThanOrEqual(35);
    expect(build.parts.filter((part) => part.category === 'interconnect')).toHaveLength(28);
    expect(build.metrics.surfaces.distinctFinishes).toBeGreaterThanOrEqual(12);
    expect(build.metrics.surfaces.microNormalMaterials).toBeGreaterThanOrEqual(200);
    expect(build.metrics.surfaces.anisotropicMaterials).toBeGreaterThanOrEqual(100);
    for (const id of [
      'soc', 'smd_24', 'camera_island', 'wide_outer_bezel', 'wide_sapphire_window',
      'flash_diffuser', 'selfie_camera_window', 'power_button', 'sim_tray',
      'usb_c_throat', 'bottom_acoustic_port_12',
    ]) expect(build.parts.some((part) => part.id === id), id).toBe(true);
    expect(build.metrics.connectivity).toMatchObject({
      ports: 56,
      requiredPorts: 56,
      connectedRequiredPorts: 56,
      wires: 28,
      connectedWires: 28,
      danglingWires: 0,
      openRequiredPorts: 0,
      overloadedPorts: 0,
      offComponentPorts: 0,
      errors: [],
    });
    expect(build.metrics.connectivity!.endpointErrorMaxMm).toBeLessThan(0.0001);
  });

  it('rejects a conductor with a missing physical endpoint', () => {
    expect(() => validateElectricalHarness({
      ports: [{
        id: 'source_vdd', componentId: 'source', pin: 'VDD', signal: 'power',
        position: [0, 0, 0], required: true,
      }],
      wires: [{
        id: 'floating_wire', name: 'Floating wire', net: 'VBUS', signal: 'power',
        from: 'source_vdd', to: 'missing_sink', diameter: 0.4, color: '#ff0000',
      }],
    }, new Set(['source']))).toThrow(/missing destination port/);
  });

  it('compiles the supplied exploded electronics image into a connected assembly regression case', () => {
    const build = compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty');
    const connectivity = build.metrics.connectivity;
    expect(COOLING_ASSEMBLY_IR.metadata).toMatchObject({ sourceWidth: 2038, sourceHeight: 1268 });
    expect(COOLING_ASSEMBLY_IR.components.length).toBeGreaterThanOrEqual(24);
    expect(connectivity?.wires).toBeGreaterThanOrEqual(35);
    expect(connectivity?.connectedWires).toBe(connectivity?.wires);
    expect(connectivity?.connectedRequiredPorts).toBe(connectivity?.requiredPorts);
    expect(connectivity?.danglingWires).toBe(0);
    expect(connectivity?.openRequiredPorts).toBe(0);
    expect(connectivity!.endpointErrorMaxMm).toBeLessThan(0.0001);
    expect(build.metrics.surfaces.distinctFinishes).toBeGreaterThanOrEqual(8);
    expect(build.metrics.surfaces.microNormalMaterials).toBeGreaterThanOrEqual(150);
  });

  it('compiles the ornate knife from the public generic AssemblyIR', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    expect(ir.schema).toBe('morphloom.assembly/0.1');
    expect(ir.components.some((part) => part.geometry.op === 'bladeLoft')).toBe(true);
    expect(ir.components.some((part) => part.id === 'grip_wrap')).toBe(true);
    const build = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    expect(build.metrics.parts).toBeGreaterThanOrEqual(15);
    expect(build.metrics.heightMeters).toBeGreaterThan(0.4);
    expect(build.metrics.surfaces.finishes).toEqual(expect.arrayContaining(['polished-metal', 'leather', 'wood', 'sapphire']));
  });

  it('rejects unsafe physical material values before allocating a mesh', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    ir.components[0].material.ior = 3.2;
    expect(() => compileAssemblyIR(ir, 'beauty')).toThrow(/Unsafe ior/);
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

describe('PBR micro-surface system', () => {
  it('creates angle-dependent brushed metal with deterministic export metadata', () => {
    const first = createSurfaceMaterial({ color: '#aeb1b4', surface: 'brushed-metal' }, {
      mode: 'beauty', category: 'mechanical', materialName: 'brushed aluminium',
    });
    const second = createSurfaceMaterial({ color: '#aeb1b4', surface: 'brushed-metal' }, {
      mode: 'beauty', category: 'mechanical', materialName: 'brushed aluminium',
    });
    expect(first.anisotropy).toBeGreaterThan(0.7);
    expect(first.normalMap).toBeTruthy();
    expect(first.roughnessMap).toBeTruthy();
    expect(first.normalMap).toBe(second.normalMap);
    expect(first.userData.morphloomSurface).toMatchObject({ finish: 'brushed-metal', procedural: true });
  });

  it('uses optical IOR, transmission, clearcoat, and micro-normal for sapphire', () => {
    const sapphire = createSurfaceMaterial({ color: '#17344c', surface: 'sapphire' }, {
      mode: 'beauty', category: 'camera', materialName: 'AR sapphire lens window',
    });
    expect(sapphire.ior).toBeCloseTo(1.76, 2);
    expect(sapphire.transmission).toBeGreaterThan(0.5);
    expect(sapphire.clearcoat).toBe(1);
    expect(sapphire.iridescence).toBeGreaterThan(0.2);
    expect(sapphire.normalMap).toBeTruthy();
  });
});
