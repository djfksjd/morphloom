import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCharacter, deriveBodyTopology, poseCharacterPoint } from '../src/engine/character';
import { buildOrnateKnife, createOrnateKnifeIR } from '../src/engine/knife';
import { parseOhpk } from '../src/engine/ohpk';
import { buildProduct } from '../src/engine/product';
import { compileAssemblyIR, validateAssemblyIR } from '../src/engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from '../src/engine/galaxy-fold8-exterior';
import { POOR_COYOTES_CABIN_IR } from '../src/engine/poor-coyotes-cabin';
import { LAUREL_HOMES_BUILDING_B_IR } from '../src/engine/laurel-homes-building-b';
import { MODERNCAT_CONCEPT_RESIDENCE_IR } from '../src/engine/moderncat-concept-residence';
import { analyzeTopology } from '../src/engine/topology';
import { validateElectricalHarness } from '../src/engine/connectivity';
import { createSurfaceMaterial } from '../src/engine/surface-system';
import { buildPhysicalNetlist } from '../src/engine/netlist';
import { fitPerspectiveCameraToBounds, fogDensityForAssetRadius } from '../src/engine/camera-framing';
import { calculateMeasurement, formatMeasurement, valueInUnit } from '../src/engine/measurement';
import { editAssemblyLayout, isLayoutEditable } from '../src/engine/layout-edit';
import { auditAssemblyDetail, expandGenerationBrief } from '../src/engine/generation-policy';
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

  it('adds bounded pose-driven garment wrinkles without changing the closed body topology', async () => {
    const pack = await loadPack();
    const first = buildCharacter(pack, WEB_HERO_SPEC, 'beauty');
    const second = buildCharacter(pack, structuredClone(WEB_HERO_SPEC), 'beauty');
    expect(first.metrics.garmentWrinkles).toMatchObject({
      method: 'deterministic-pose-zones-v1',
      zones: ['waist', 'left-elbow', 'right-elbow', 'left-knee', 'right-knee'],
    });
    expect(first.metrics.garmentWrinkles?.affectedVertices).toBeGreaterThan(300);
    expect(first.metrics.garmentWrinkles?.maximumDisplacementMm).toBeGreaterThan(1);
    expect(first.metrics.garmentWrinkles?.maximumDisplacementMm).toBeLessThanOrEqual(4.2);
    expect(first.metrics.garmentWrinkles?.rmsDisplacementMm).toBeGreaterThan(0.1);
    expect(first.metrics.garmentWrinkles?.evidenceIds).toEqual([
      'cloth3d', 'deepwrinkles', 'garment-wrinkle-transfer', 'deep-fashion3d',
    ]);
    expect(second.metrics.garmentWrinkles).toEqual(first.metrics.garmentWrinkles);
    const topology = analyzeTopology(first.body);
    expect(topology.pass, JSON.stringify(topology)).toBe(true);
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
  it('compiles a complete nine-apartment HABS floor with rooms, stairs and façade openings', () => {
    const build = compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR, 'beauty');
    expect(LAUREL_HOMES_BUILDING_B_IR.metadata).toMatchObject({
      assetKind: 'building',
      buildingType: 'multifamily-apartment',
      documentedFloors: 4,
      documentedApartments: 36,
      modeledApartments: 9,
      documentedStairwells: 3,
      measuredLengthMm: 42367.2,
      measuredMainDepthMm: 14122.4,
      footprintForm: 'u-courtyard-with-opposed-center-wing',
      courtyardVoids: 1,
      planProjectionRelationship: 'side-wings-north-center-wing-south',
    });
    expect(build.parts.length).toBeGreaterThan(180);
    expect(build.parts.filter((part) => /^unit_\d+_(living|bedroom|kitchen|bath|passage)_floor$/.test(part.id))).toHaveLength(45);
    expect(build.parts.filter((part) => /_step_/.test(part.id))).toHaveLength(66);
    expect(build.parts.filter((part) => /_window_\d+$/.test(part.id))).toHaveLength(36);
    expect(build.root.getObjectByName('south_connector_bar_floor_slab')).toBeTruthy();
    expect(build.root.getObjectByName('west_wing_floor_slab')).toBeTruthy();
    expect(build.root.getObjectByName('east_wing_floor_slab')).toBeTruthy();
    expect(build.root.getObjectByName('center_entry_wing_floor_slab')).toBeTruthy();
    expect(build.root.getObjectByName('entrance_door_west')).toBeTruthy();
    expect(build.root.getObjectByName('stair_2_landing')).toBeTruthy();
    expect(build.root.getObjectByName('unit_9_bath_floor')).toBeTruthy();
    expect(build.metrics.topology).toMatchObject({
      pass: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0,
    });
    expect(build.metrics.engineering.componentEvidenceCoverage).toBe(1);
    expect(build.metrics.engineering).toMatchObject({
      scope: 'architectural-shell-only', electricalApplicable: false, digitalReady: true, productionReady: false,
    });

    const componentZ = (id: string) => LAUREL_HOMES_BUILDING_B_IR.components
      .find((component) => component.id === id)?.position?.[2];
    const connectorZ = componentZ('south_connector_bar_floor_slab') ?? 0;
    expect(componentZ('west_wing_floor_slab')).toBeGreaterThan(connectorZ);
    expect(componentZ('east_wing_floor_slab')).toBeGreaterThan(connectorZ);
    expect(componentZ('center_entry_wing_floor_slab')).toBeLessThan(connectorZ);
  });

  it('compiles a measured HABS cabin with explicit openings and evidence boundaries', () => {
    const build = compileAssemblyIR(POOR_COYOTES_CABIN_IR, 'beauty');
    expect(POOR_COYOTES_CABIN_IR.metadata).toMatchObject({
      assetKind: 'building',
      measuredLengthMm: 5283.2,
      measuredWidthMm: 4216.4,
      estimatedRoofPitchDegrees: 38,
    });
    expect(build.parts.length).toBeGreaterThan(80);
    expect(build.root.getObjectByName('west_door_trim_head')).toBeTruthy();
    expect(build.root.getObjectByName('north_casement_vertical')).toBeTruthy();
    expect(build.root.getObjectByName('cedar_shake_roof_north')).toBeTruthy();
    expect(build.metrics.topology.pass).toBe(true);
    expect(build.metrics.engineering.componentEvidence.measured).toBeGreaterThan(40);
    expect(build.metrics.engineering).toMatchObject({
      scope: 'architectural-shell-only', electricalApplicable: false, digitalReady: true, productionReady: false,
    });
    const report = evaluateProductQuality(DEFAULT_PRODUCT_SPEC, undefined, build.metrics, POOR_COYOTES_CABIN_IR);
    expect(report.checks.find((check) => check.id === 'rig')).toMatchObject({
      label: '건축 셸 범위 검수', status: 'pass', score: 100,
    });
  });

  it('builds the Pinterest concept residence but keeps semi-professional delivery blocked', () => {
    expect(() => validateAssemblyIR(MODERNCAT_CONCEPT_RESIDENCE_IR)).not.toThrow();
    const build = compileAssemblyIR(MODERNCAT_CONCEPT_RESIDENCE_IR, 'beauty');
    expect(build.parts.length).toBeGreaterThan(90);
    expect(build.root.getObjectByName('ground_floor_slab')).toBeTruthy();
    expect(build.root.getObjectByName('living_front_glazing')).toBeTruthy();
    expect(build.root.getObjectByName('garage_door')).toBeTruthy();
    expect(build.root.getObjectByName('front_balcony_glass')).toBeTruthy();
    expect(build.root.getObjectByName('roof_hip_shell')).toBeTruthy();
    expect(build.root.getObjectByName('upper_bath_toilet')).toBeTruthy();
    expect(build.root.getObjectByName('upper_bath_shower_glass')).toBeTruthy();
    expect(build.root.getObjectByName('living_ceiling_light')?.children.some((child) => child instanceof THREE.PointLight)).toBe(true);
    expect(build.metrics.topology).toMatchObject({
      pass: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0,
    });
    const detail = auditAssemblyDetail(MODERNCAT_CONCEPT_RESIDENCE_IR);
    expect(detail.footprintVerified).toBe(true);
    expect(detail.blockers).toContain('evidence pack not delivery-ready: verified-provenance,verified-section,field-measured-height,dimension-arithmetic');
    const report = evaluateProductQuality(DEFAULT_PRODUCT_SPEC, undefined, build.metrics, MODERNCAT_CONCEPT_RESIDENCE_IR);
    expect(report.total).toBeGreaterThanOrEqual(90);
    expect(report.checks.find((check) => check.id === 'silhouette')).toMatchObject({ status: 'pass', score: 100 });
    expect(report.deliveryReady).toBe(false);
    expect(report.evidenceScore).toBeLessThan(100);
  });

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

  it('does not score a procedural phone as reference-accurate without source evidence', () => {
    const build = buildProduct(DEFAULT_PRODUCT_SPEC, 'beauty');
    const report = evaluateProductQuality(DEFAULT_PRODUCT_SPEC, undefined, build.metrics);
    expect(report.total).toBeLessThanOrEqual(59);
    expect(report.checks.find((check) => check.id === 'silhouette')).toMatchObject({
      label: '부품 근거 완성도', score: 45, status: 'blocked',
    });
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
  }, 20_000);

  it('rejects rounded boxes whose bevel would collapse a thin component', () => {
    const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    ir.components[0].geometry = { op: 'roundedBox', size: [100, 2, 40], radius: 1.5 };
    expect(() => compileAssemblyIR(ir, 'beauty')).toThrow(/safe half-dimension limit/);
  });

  it('bounds imported metadata depth and invalid primitive dimensions before compilation', () => {
    const nested = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC) as unknown as Record<string, unknown>;
    let cursor: Record<string, unknown> = {};
    nested.metadata = cursor;
    for (let depth = 0; depth < 18; depth += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    expect(() => validateAssemblyIR(nested)).toThrow(/nesting is too deep/);

    const invalidTube = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    invalidTube.components[0].geometry = { op: 'tube', points: [[0, 0, 0]], radius: 0 };
    expect(() => validateAssemblyIR(invalidTube)).toThrow(/Tube path is invalid/);

    const inactiveBevel = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
    const fuller = inactiveBevel.components.find((component) => component.id === 'fuller_front');
    if (fuller?.geometry.op === 'extrude') {
      fuller.geometry.bevelSegments = 0;
      fuller.geometry.bevelSize = 0;
      fuller.geometry.bevelThickness = 0;
    }
    expect(() => validateAssemblyIR(inactiveBevel)).not.toThrow();

    if (fuller?.geometry.op === 'extrude') fuller.geometry.bevelSize = 0.5;
    expect(() => validateAssemblyIR(inactiveBevel)).toThrow(/bevel segments are invalid/);
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
    expect(first.metalnessMap).toBe(first.roughnessMap);
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
  it('reduces atmospheric fog for building-scale bounds without removing product depth', () => {
    expect(fogDensityForAssetRadius(23)).toBeLessThan(0.003);
    expect(fogDensityForAssetRadius(4)).toBeCloseTo(0.01625, 5);
    expect(fogDensityForAssetRadius(0.12)).toBe(0.055);
    expect(() => fogDensityForAssetRadius(0)).toThrow(/positive and finite/);
  });

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

describe('CAD-style surface measurement', () => {
  it('reports spatial distance, vertical height, and signed XYZ deltas in model meters', () => {
    const result = calculateMeasurement(
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 6, z: 15 },
    );
    expect(result.deltaMeters).toEqual({ x: 3, y: 4, z: 12 });
    expect(result.distanceMeters).toBe(13);
    expect(result.heightMeters).toBe(4);
  });

  it('converts the same result to millimetres, centimetres, and metres', () => {
    expect(valueInUnit(1.234, 'mm')).toBeCloseTo(1234, 8);
    expect(valueInUnit(1.234, 'cm')).toBeCloseTo(123.4, 8);
    expect(valueInUnit(1.234, 'm')).toBeCloseTo(1.234, 8);
    expect(formatMeasurement(1.234, 'mm')).toBe('1,234.0 mm');
    expect(formatMeasurement(1.234, 'cm')).toBe('123.40 cm');
    expect(formatMeasurement(1.234, 'm')).toBe('1.234 m');
  });

  it('rejects invalid coordinates instead of showing a false measurement', () => {
    expect(() => calculateMeasurement(
      { x: 0, y: 0, z: 0 },
      { x: Number.NaN, y: 1, z: 2 },
    )).toThrow(/finite coordinates/);
  });
});

describe('short-prompt generation contract', () => {
  it('expands a minimal drawing request into footprint, material, and validation requirements', () => {
    const brief = expandGenerationBrief('이 건축 도면으로 3D 만들어줘');
    expect(brief.domain).toBe('architecture');
    expect(brief.domains).toEqual(['architecture']);
    expect(brief.completionPolicy).toBe('all-evidence-supported-blockers-pass');
    expect(brief.reviewModes).toEqual(expect.arrayContaining([
      'source-camera', 'orthographic', 'clay', 'grazing-light', 'wire', 'x-ray',
    ]));
    expect(brief.requiredChecks).toEqual(expect.arrayContaining([
      'drawing-orientation', 'footprint-voids', 'projection-and-entrance',
      'visible-feature-ledger', 'spatial-relationship-constraints',
      'strict-detail-inventory', 'locked-fidelity-passes', 'per-feature-acceptance',
      'pbr-micro-surface', 'watertight-topology', 'reference-comparison', 'interior-reference-difference',
      'autonomous-refinement-loop', 'bounded-cost-stop-policy', 'attachment-integrity',
    ]));
    expect(brief.agentPrompt).toContain('Never fill a visible void');
    expect(brief.agentPrompt).toContain('estimated or inferred');
    expect(brief.agentPrompt).toContain('blockout → structure → form → material → surface → lighting → interaction → optimization');
    expect(brief.agentPrompt).toContain('average score cannot hide a missing critical feature');
  });

  it('applies human and product gates together for a held device', () => {
    const brief = expandGenerationBrief('사람이 스마트폰을 들고 있는 사진으로 게임 캐릭터를 만들어줘');
    expect(brief.domain).toBe('human');
    expect(brief.domains).toEqual(['human', 'product']);
    expect(brief.requiredChecks).toEqual(expect.arrayContaining([
      'anatomical-sanity', 'face-hand-foot-closeups', 'exterior-side-completeness', 'component-interfaces',
    ]));
  });

  it('passes the corrected plan footprint and blocks an unverified replacement', () => {
    const passed = auditAssemblyDetail(LAUREL_HOMES_BUILDING_B_IR);
    expect(passed).toMatchObject({ pass: true, footprintVerified: true, evidenceCoverage: 1 });
    const unverified = {
      ...LAUREL_HOMES_BUILDING_B_IR,
      metadata: { ...LAUREL_HOMES_BUILDING_B_IR.metadata, planFootprintVerified: false },
    };
    const blocked = auditAssemblyDetail(unverified);
    expect(blocked.pass).toBe(false);
    expect(blocked.blockers).toContain('plan footprint not verified');

    const reversedProjection = {
      ...LAUREL_HOMES_BUILDING_B_IR,
      components: LAUREL_HOMES_BUILDING_B_IR.components.map((component) => component.id === 'center_entry_wing_floor_slab'
        ? { ...component, position: [component.position?.[0] ?? 0, component.position?.[1] ?? 0, 3_800] as [number, number, number] }
        : component),
    };
    const projectionAudit = auditAssemblyDetail(reversedProjection);
    expect(projectionAudit.pass).toBe(false);
    expect(projectionAudit.blockers).toContain('side wings and center wing are not on opposite facades');
  });

  it('blocks duplicate edit-unit ids and non-finite transforms in the optimized detail audit', () => {
    const duplicate = structuredClone(LAUREL_HOMES_BUILDING_B_IR);
    duplicate.components[1].id = duplicate.components[0].id;
    const duplicateAudit = auditAssemblyDetail(duplicate);
    expect(duplicateAudit.pass).toBe(false);
    expect(duplicateAudit.duplicateComponentIds).toEqual([duplicate.components[0].id]);

    const invalidTransform = structuredClone(LAUREL_HOMES_BUILDING_B_IR);
    invalidTransform.components[0].position = [Number.POSITIVE_INFINITY, 0, 0];
    const transformAudit = auditAssemblyDetail(invalidTransform);
    expect(transformAudit.pass).toBe(false);
    expect(transformAudit.finiteTransformCoverage).toBeLessThan(1);
  });

  it('persists furniture translation, rotation, and reset in AssemblyIR', () => {
    const source = structuredClone(MODERNCAT_CONCEPT_RESIDENCE_IR);
    const original = source.components.find((component) => component.id === 'primary_bed');
    expect(original?.position).toBeTruthy();
    expect(isLayoutEditable('primary_bed')).toBe(true);
    const moved = editAssemblyLayout(source, 'primary_bed', { kind: 'translate', deltaMm: [250, 0, -250] });
    const movedBed = moved.components.find((component) => component.id === 'primary_bed');
    expect(movedBed?.position).toEqual([
      (original?.position?.[0] ?? 0) + 250,
      original?.position?.[1],
      (original?.position?.[2] ?? 0) - 250,
    ]);
    const rotated = editAssemblyLayout(moved, 'primary_bed', { kind: 'rotateY', radians: Math.PI / 12 });
    expect(rotated.components.find((component) => component.id === 'primary_bed')?.rotation?.[1])
      .toBeCloseTo((original?.rotation?.[1] ?? 0) + Math.PI / 12);
    const reset = editAssemblyLayout(rotated, 'primary_bed', { kind: 'reset', source });
    expect(reset.components.find((component) => component.id === 'primary_bed')).toMatchObject({
      position: original?.position,
      rotation: original?.rotation,
    });
  });
});
