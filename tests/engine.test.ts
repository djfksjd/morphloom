import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCharacter, deriveBodyTopology, poseCharacterPoint } from '../src/engine/character';
import { buildOrnateKnife, createOrnateKnifeIR } from '../src/engine/knife';
import { parseOhpk } from '../src/engine/ohpk';
import { buildProduct } from '../src/engine/product';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from '../src/engine/galaxy-fold8-exterior';
import { analyzeTopology } from '../src/engine/topology';
import { validateElectricalHarness } from '../src/engine/connectivity';
import { createSurfaceMaterial } from '../src/engine/surface-system';
import { buildPhysicalNetlist } from '../src/engine/netlist';
import { fitPerspectiveCameraToBounds } from '../src/engine/camera-framing';
import { applyProductPrompt, applyPrompt } from '../src/engine/prompt';
import { evaluateProductQuality, evaluateQuality } from '../src/engine/quality';
import {
  getPoseJoints,
  poseLandmarkRms,
  WEB_HERO_REFERENCE_POSE,
  WEB_HERO_VISUAL_INTERPRETATION,
} from '../src/engine/reference-pose';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, DEFAULT_SPEC, WEB_HERO_SPEC } from '../src/types';

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

  it('builds a reference-derived web hero as named editable meshes', async () => {
    const pack = await loadPack();
    const build = buildCharacter(pack, WEB_HERO_SPEC, 'beauty');
    expect(build.root.getObjectByName('mask_shell')).toBeTruthy();
    expect(build.root.getObjectByName('eye_lens_left')).toBeTruthy();
    expect(build.root.getObjectByName('eye_lens_right')).toBeTruthy();
    expect(build.root.getObjectByName('chest_spider_body')).toBeTruthy();
    expect(build.metrics.namedDetailParts).toBeGreaterThanOrEqual(100);
    expect(build.metrics.renderedTriangles).toBeGreaterThan(build.metrics.triangles + 10_000);
    expect(build.metrics.surfaces.finishes).toEqual(expect.arrayContaining([
      'hex-knit', 'optical-glass', 'molded-polymer', 'soft-touch-polymer',
    ]));
    const evidence = build.root.userData.characterIR.evidence as { inferredParts: string[]; posePolicy: string };
    expect(evidence.inferredParts).toEqual(expect.arrayContaining(['rear_mask_seam', 'rear_emblem']));
    expect(evidence.posePolicy).toContain('reference-action-estimate');
    expect(WEB_HERO_SPEC.pose).toBe('reference-action');
    const topology = analyzeTopology(build.root);
    expect(topology.boundaryEdges, JSON.stringify(topology.details.filter((item) => !item.watertight))).toBe(0);
    expect(topology.nonManifoldEdges, JSON.stringify(topology.details.filter((item) => !item.watertight))).toBe(0);
    expect(topology.degenerateTriangles).toBe(0);
    expect(topology.watertightMeshes).toBe(topology.meshes);
  });

  it('recognizes a web hero instruction without a dedicated 3D model', () => {
    const result = applyPrompt('슬림한 남성 스파이더맨을 적청 웹 슈트 게임 에셋으로', DEFAULT_SPEC);
    expect(result.spec).toMatchObject({
      outfit: 'web-hero',
      hairStyle: 'none',
      suitColor: '#8a1734',
      accentColor: '#073b70',
      pose: 'reference-action',
    });
  });

  it('turns an agent visual reading into explicit soft-body and posture controls', () => {
    const result = applyPrompt(
      '일반인이 스파이더맨을 코스튬함. 슬림형 똥배이고 가슴도 살짝 나옴. 엉덩이는 작고 약간 거북목. 무게중심은 뒤. 양손은 거미줄 쏘는 손 모양.',
      DEFAULT_SPEC,
    );
    expect(result.spec).toMatchObject({
      outfit: 'web-hero',
      abdominalProjection: 0.38,
      chestSoftness: 0.3,
      gluteScale: 0.86,
      forwardHead: 0.32,
      rearBalance: 0.35,
      handGesture: 'web-shooting',
    });
    expect(result.changes).toEqual(expect.arrayContaining([
      '약한 복부 돌출', '약한 가슴 연조직 볼륨', '작은 둔부 볼륨',
      '약한 전방 머리 자세', '뒤쪽 무게중심', '웹 슈팅 손동작',
    ]));
  });

  it('estimates the supplied forward-hand and staggered-knee action without breaking topology', () => {
    const height = 1.78;
    const wrist = new THREE.Vector3(-0.56, height * 0.6, 0);
    const posedWrist = poseCharacterPoint(wrist, height, 'reference-action');
    expect(posedWrist.z).toBeGreaterThan(height * 0.35);
    expect(Math.abs(posedWrist.x)).toBeLessThan(Math.abs(wrist.x));

    const leftKnee = poseCharacterPoint(new THREE.Vector3(-0.16, height * 0.29, 0), height, 'reference-action');
    const rightKnee = poseCharacterPoint(new THREE.Vector3(0.16, height * 0.29, 0), height, 'reference-action');
    expect(leftKnee.z).toBeGreaterThan(0);
    expect(rightKnee.z).toBeLessThan(0);
    expect(rightKnee.x).toBeGreaterThan(0);
    const joints = getPoseJoints(height, 'reference-action');
    expect(joints.wristL.z).toBeGreaterThan(joints.elbowL.z);
    expect(joints.wristR.z).toBeGreaterThan(joints.elbowR.z);
    expect(joints.ankleL.z).toBeGreaterThan(joints.hipL.z);
    expect(joints.ankleR.y).toBeCloseTo(joints.ankleL.y, 1);
    expect(joints.ankleR.z).toBeLessThan(joints.hipR.z);
    expect(WEB_HERO_VISUAL_INTERPRETATION.anatomicalScreenMapping).toEqual({
      anatomicalRight: 'viewer-left',
      anatomicalLeft: 'viewer-right',
    });
    // Anatomical right is viewer-left, represented by the negative-X L screen
    // joint in this projection coordinate system.
    expect(joints.wristL.z).toBeGreaterThan(joints.wristR.z);
    expect(joints.wristL.y).toBeGreaterThan(joints.wristR.y);
    expect(WEB_HERO_REFERENCE_POSE.sourcePixels).toEqual([960, 1280]);
    expect(poseLandmarkRms(height, 'reference-action')).toBeLessThan(0.04);
  });

  it('preserves agent observation provenance inside the editable character', async () => {
    const pack = await loadPack();
    const build = buildCharacter(pack, WEB_HERO_SPEC, 'beauty');
    expect(build.root.userData.characterIR.visualInterpretation).toMatchObject({
      source: 'agent-visual-judgment',
      subjectContext: 'ordinary-person-in-web-hero-cosplay',
      anatomicalScreenMapping: { anatomicalRight: 'viewer-left' },
    });
    expect(build.root.userData.characterIR.visualInterpretation.observations).toHaveLength(10);
  });

  it('does not hide incomplete single-view evidence behind a high morph score', async () => {
    const pack = await loadPack();
    const report = evaluateQuality(pack, DEFAULT_SPEC, {
      fileName: 'single-view character',
      width: 960,
      height: 1280,
      averageColor: '#555555',
      brightness: 0.5,
      portraitSuitability: 43,
      notes: ['후면·좌우측 시점이 누락되었습니다.'],
    });
    const evidenceCheck = report.checks.find((check) => check.id === 'silhouette');
    expect(evidenceCheck).toMatchObject({ label: '참조 증거 완성도', score: 43, status: 'blocked' });
  });

  it('keeps a web-hero likeness score blocked until same-view evidence exists', async () => {
    const pack = await loadPack();
    const build = buildCharacter(pack, WEB_HERO_SPEC, 'beauty');
    const report = evaluateQuality(pack, WEB_HERO_SPEC, undefined, build.metrics);
    expect(report.total).toBeLessThanOrEqual(59);
    expect(report.checks.find((check) => check.id === 'silhouette')).toMatchObject({
      label: '동일 시점 참조 충실도', status: 'blocked', score: 35,
    });
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
    expect(build.metrics.topology.pass).toBe(true);
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
    expect(COOLING_ASSEMBLY_IR.components.length).toBe(97);
    expect(connectivity?.wires).toBe(75);
    expect(connectivity?.ports).toBe(150);
    expect(connectivity?.connectedWires).toBe(connectivity?.wires);
    expect(connectivity?.connectedRequiredPorts).toBe(connectivity?.requiredPorts);
    expect(connectivity?.danglingWires).toBe(0);
    expect(connectivity?.openRequiredPorts).toBe(0);
    expect(connectivity?.documentedPhysicalPins).toBe(150);
    expect(connectivity?.specifiedGaugeWires).toBe(75);
    expect(connectivity?.documentedVerificationWires).toBe(75);
    expect(connectivity?.benchRequiredWires).toBe(6);
    expect(connectivity?.outstandingBenchChecks).toBe(5);
    expect(connectivity?.liveAnchors).toBe(true);
    expect(connectivity?.productionReady).toBe(false);
    expect(connectivity!.endpointErrorMaxMm).toBeLessThan(0.0001);
    expect(build.metrics.surfaces.distinctFinishes).toBeGreaterThanOrEqual(8);
    expect(build.metrics.surfaces.microNormalMaterials).toBeGreaterThanOrEqual(150);
    expect(build.metrics.topology.pass).toBe(true);
    expect(build.metrics.engineering).toMatchObject({
      digitalReady: true,
      productionReady: false,
      passiveNodes: 7,
      outstandingBenchChecks: 5,
    });
  });

  it('builds the official-dimension Galaxy Z Fold8 exterior as editable named parts', () => {
    const build = compileAssemblyIR(GALAXY_Z_FOLD8_EXTERIOR_IR, 'beauty');
    const size = build.metrics.bounds.getSize(new THREE.Vector3()).multiplyScalar(1000);
    expect(GALAXY_Z_FOLD8_EXTERIOR_IR.metadata).toMatchObject({
      scope: 'exterior-only',
      model: 'Galaxy Z Fold8',
      officialWidthMm: 161.4,
      officialHeightMm: 123.9,
      officialUnfoldedDepthMm: 4.5,
      officialFoldedWidthMm: 81.9,
      officialFoldedDepthMm: 9.7,
      nfcCenterFromRightMm: 34,
      nfcCenterFromTopMm: 34,
      wirelessCoilDiameterMm: 41,
      wirelessCoilCenterFromRightMm: 41.5,
      wirelessCoilCenterFromTopMm: 80.9,
      internalElectronicsIncluded: false,
    });
    expect(GALAXY_Z_FOLD8_EXTERIOR_IR.components).toHaveLength(48);
    expect(size.x).toBeGreaterThanOrEqual(161.35);
    expect(size.x).toBeLessThan(161.8);
    expect(size.y).toBeCloseTo(123.9, 0);
    expect(size.z).toBeGreaterThan(6);
    for (const id of [
      'left_armor_frame', 'right_armor_frame', 'flex_hinge_barrel',
      'main_flexible_display', 'cover_display', 'rear_graphite_glass',
      'rear_camera_island', 'ultrawide_camera_sapphire_window',
      'wide_camera_sapphire_window', 'rear_flash_diffuser', 'usb_c_opening',
    ]) expect(build.root.getObjectByName(id), id).toBeTruthy();
    expect(build.root.getObjectByName('rear_camera_island')!.position.x).toBeGreaterThan(0);
    expect(build.root.getObjectByName('cover_display')!.position.x).toBeLessThan(0);
    expect(build.metrics.connectivity).toBeUndefined();
    expect(build.metrics.engineering).toMatchObject({
      scope: 'exterior-only',
      electricalApplicable: false,
      digitalReady: true,
      productionReady: false,
    });
    expect(build.metrics.surfaces.finishes).toEqual(expect.arrayContaining([
      'anodized-metal', 'brushed-metal', 'ceramic-glass', 'optical-glass', 'sapphire',
    ]));
    expect(build.metrics.topology.pass).toBe(true);
  });

  it('keeps every conductor attached when an electronic component moves without rebuilding idle wires', () => {
    const build = compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty');
    const tec = build.root.getObjectByName('tec');
    const wire = build.root.getObjectByName('w_tec_pos_a') as THREE.Mesh;
    const terminal = build.root.getObjectByName('w_tec_pos_a_terminal_2') as THREE.Mesh;
    const update = build.root.userData.updateElectricalHarness as (() => void) | undefined;
    expect(tec).toBeTruthy();
    expect(wire).toBeTruthy();
    expect(terminal).toBeTruthy();
    expect(update).toBeTypeOf('function');
    const initialTerminalX = terminal.position.x;
    let disposed = false;
    wire.geometry.addEventListener('dispose', () => { disposed = true; });
    tec!.position.x += 0.01;
    update!();
    expect(terminal.position.x - initialTerminalX).toBeCloseTo(0.01, 6);
    expect(disposed).toBe(true);
    const settledGeometry = wire.geometry;
    update!();
    expect(wire.geometry).toBe(settledGeometry);
  });

  it('blocks a production-readiness score while hidden geometry and bench checks remain', () => {
    const build = compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty');
    const report = evaluateProductQuality(DEFAULT_PRODUCT_SPEC, undefined, build.metrics, COOLING_ASSEMBLY_IR);
    expect(report.total).toBeLessThanOrEqual(59);
    expect(report.checks.find((check) => check.id === 'silhouette')).toMatchObject({ status: 'blocked' });
    expect(report.checks.find((check) => check.id === 'rig')).toMatchObject({ status: 'warn' });
  });

  it('exports the assembler netlist from the same AssemblyIR without stale counts', () => {
    const netlist = buildPhysicalNetlist(COOLING_ASSEMBLY_IR);
    expect(netlist.summary).toEqual({
      components: 97,
      ports: 150,
      connections: 75,
      physicalPinLabels: 150,
      gauges: 75,
      verificationRecords: 75,
      pendingBenchChecks: 5,
    });
    expect(netlist.connections[0].from.physicalPin).toBeTruthy();
    expect(netlist.connections.filter((connection) => connection.verification === 'bench-required')).toHaveLength(6);
    expect(netlist.passiveNodes).toHaveLength(7);
  });

  it('rejects malformed imported harness collections with a bounded validation error', () => {
    expect(() => validateElectricalHarness({ ports: {} as never, wires: [] }, new Set())).toThrow(/connectivity failed/i);
  });

  it('keeps the detailed phone, Fold8 exterior, and image-derived cooling assembly closed and manifold', () => {
    for (const build of [
      buildProduct(DEFAULT_PRODUCT_SPEC, 'beauty'),
      compileAssemblyIR(GALAXY_Z_FOLD8_EXTERIOR_IR, 'beauty'),
      compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty'),
    ]) {
      const report = analyzeTopology(build.root);
      expect(report.boundaryEdges).toBe(0);
      expect(report.nonManifoldEdges).toBe(0);
      expect(report.degenerateTriangles).toBe(0);
      expect(report.watertightMeshes).toBe(report.meshes);
    }
  });

  it('rejects rounded boxes whose bevel would collapse a thin component', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    ir.components[0].geometry = { op: 'roundedBox', size: [100, 2, 40], radius: 1.5 };
    expect(() => compileAssemblyIR(ir, 'beauty')).toThrow(/safe half-dimension limit/);
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

describe('result viewer camera framing', () => {
  it('moves a wide product farther away when the viewport becomes narrow', () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-0.0807, -0.06195, -0.0035),
      new THREE.Vector3(0.0807, 0.06195, 0.0035),
    );
    const common = {
      bounds,
      direction: new THREE.Vector3(0, 0, 1),
      up: new THREE.Vector3(0, 1, 0),
      verticalFovDegrees: 31,
      padding: 1.32,
    };
    const wide = fitPerspectiveCameraToBounds({ ...common, aspect: 1.8 });
    const narrow = fitPerspectiveCameraToBounds({ ...common, aspect: 0.65 });
    expect(narrow.distance).toBeGreaterThan(wide.distance);
    expect(narrow.center.toArray()).toEqual([0, 0, 0]);
    expect(Number.isFinite(narrow.distance)).toBe(true);
  });
});
